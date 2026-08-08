const Order = require('../models/Order');
const Dispute = require('../models/Dispute');

/**
 * Attempts to link a newly-created Dispute to its matching Order.
 *
 * Match strategy (in priority order):
 *   1. Exact match on Stripe charge ID (best case — Shopify's payment gateway
 *      reference stored the charge ID at order time).
 *   2. Fallback: amount + currency match within a recent time window, for
 *      cases where the charge ID wasn't captured on the order.
 *
 * Step 3 will add a live Shopify API pull when no local match is found,
 * since right now this can only match against Orders already synced into our DB.
 */
async function matchOrderToDispute(dispute) {
  let order = await Order.findOne({
    merchant: dispute.merchant,
    'charge.stripeChargeId': dispute.stripeChargeId,
  });

  if (!order) {
    const windowStart = new Date(dispute.stripeCreatedAt);
    windowStart.setDate(windowStart.getDate() - 120); // disputes can land months after purchase

    order = await Order.findOne({
      merchant: dispute.merchant,
      'charge.amountCents': dispute.amountCents,
      'charge.currency': dispute.currency,
      'charge.chargedAt': { $gte: windowStart, $lte: dispute.stripeCreatedAt },
    });
  }

  if (!order) {
    console.warn(
      `[order-matcher] no order match found for dispute ${dispute.stripeDisputeId} (charge ${dispute.stripeChargeId})`
    );
    return null;
  }

  dispute.order = order._id;
  await dispute.save();

  console.log(`[order-matcher] matched dispute ${dispute.stripeDisputeId} to order ${order.orderNumber}`);
  return order;
}

module.exports = { matchOrderToDispute };
