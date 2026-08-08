const axios = require('axios');
const Order = require('../models/Order');
const { getShopifyAccessToken } = require('./shopifyAuth');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const ORDERS_QUERY = `
  query OrdersForSync($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id name email processedAt currencyCode note
        customer { displayName email }
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { address1 city provinceCode zip countryCodeV2 }
        lineItems(first: 100) { nodes { title quantity originalUnitPriceSet { shopMoney { amount } } } }
        fulfillments(first: 20) {
          createdAt deliveredAt status trackingInfo { company number url }
        }
        transactions(first: 50) {
          kind status gateway paymentId processedAt
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function cents(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function bestFulfillment(fulfillments) {
  const fulfillment = (fulfillments || []).find((item) => item.deliveredAt)
    || (fulfillments || []).find((item) => item.trackingInfo?.length)
    || (fulfillments || [])[0];
  if (!fulfillment) return undefined;
  const tracking = fulfillment.trackingInfo?.[0] || {};
  const status = String(fulfillment.status || '').toUpperCase();
  return {
    carrier: tracking.company,
    trackingNumber: tracking.number,
    trackingUrl: tracking.url,
    shippedAt: fulfillment.createdAt ? new Date(fulfillment.createdAt) : undefined,
    deliveredAt: fulfillment.deliveredAt ? new Date(fulfillment.deliveredAt) : undefined,
    deliveryStatus: fulfillment.deliveredAt ? 'delivered' : ['SUCCESS', 'OPEN', 'IN_PROGRESS'].includes(status) ? 'shipped' : 'unknown',
  };
}

function stripeChargeId(transactions) {
  const paidTransaction = (transactions || []).find((item) =>
    ['SUCCESS', 'PENDING'].includes(String(item.status).toUpperCase())
    && ['SALE', 'CAPTURE'].includes(String(item.kind).toUpperCase())
    && String(item.paymentId || '').startsWith('ch_')
  );
  return paidTransaction?.paymentId;
}

function toOrderDocument(merchantId, node) {
  const total = node.totalPriceSet?.shopMoney;
  const payment = (node.transactions || []).find((item) =>
    ['SUCCESS', 'PENDING'].includes(String(item.status).toUpperCase())
    && ['SALE', 'CAPTURE'].includes(String(item.kind).toUpperCase())
  );
  return {
    merchant: merchantId,
    shopifyOrderId: node.id,
    orderNumber: node.name || node.id,
    customer: { name: node.customer?.displayName, email: node.customer?.email || node.email },
    charge: {
      stripeChargeId: stripeChargeId(node.transactions),
      amountCents: cents(total?.amount),
      currency: String(total?.currencyCode || node.currencyCode || 'USD').toLowerCase(),
      chargedAt: payment?.processedAt ? new Date(payment.processedAt) : new Date(node.processedAt),
    },
    lineItems: (node.lineItems?.nodes || []).map((item) => ({
      title: item.title,
      quantity: item.quantity,
      priceCents: cents(item.originalUnitPriceSet?.shopMoney?.amount),
    })),
    shipping: {
      address: node.shippingAddress ? {
        line1: node.shippingAddress.address1,
        city: node.shippingAddress.city,
        state: node.shippingAddress.provinceCode,
        zip: node.shippingAddress.zip,
        country: node.shippingAddress.countryCodeV2,
      } : undefined,
      ...bestFulfillment(node.fulfillments),
    },
    communications: node.note ? [{ source: 'shopify_note', body: node.note, occurredAt: new Date(node.processedAt) }] : [],
    rawShopifyPayload: node,
  };
}

async function syncShopifyOrders(merchant, days) {
  if (!merchant.shopify?.shopDomain) {
    const error = new Error('Connect Shopify before syncing orders');
    error.status = 400;
    throw error;
  }

  // Token is fetched fresh (and cached in-memory with auto-refresh) rather than
  // read from the merchant record — see services/shopifyAuth.js for why this
  // app uses the client credentials grant instead of a stored OAuth token.
  const accessToken = merchant.shopify?.accessToken || await getShopifyAccessToken();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = axios.create({
    baseURL: `https://${merchant.shopify.shopDomain}/admin/api/${API_VERSION}/graphql.json`,
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  let after = null;
  let imported = 0;

  do {
    const response = await client.post('', { query: ORDERS_QUERY, variables: { first: 100, after, query: `processed_at:>=${since}` } });
    if (response.data.errors?.length) {
      const error = new Error(`Shopify GraphQL error: ${response.data.errors[0].message}`);
      error.status = 502;
      throw error;
    }
    const connection = response.data.data?.orders;
    if (!connection) throw new Error('Shopify returned no order data');
    for (const node of connection.nodes) {
      const document = toOrderDocument(merchant._id, node);
      await Order.findOneAndUpdate(
        { merchant: merchant._id, shopifyOrderId: document.shopifyOrderId },
        { $set: document },
        { upsert: true, new: true, runValidators: true }
      );
      imported += 1;
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return { imported, since };
}

module.exports = { syncShopifyOrders };
