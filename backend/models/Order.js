const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },

    // Shopify identifiers
    shopifyOrderId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true }, // human-readable, e.g. "10293"

    customer: {
      name: String,
      email: { type: String, index: true },
    },

    // Used to match this order to a Stripe dispute when no direct ID link exists
    charge: {
      stripeChargeId: { type: String, index: true }, // ch_xxx, if Shopify exposes it via payment gateway ref
      amountCents: Number,
      currency: { type: String, default: 'usd' },
      chargedAt: Date,
    },

    lineItems: [
      {
        title: String,
        quantity: Number,
        priceCents: Number,
      },
    ],

    shipping: {
      address: {
        line1: String,
        city: String,
        state: String,
        zip: String,
        country: String,
      },
      carrier: String,
      trackingNumber: String,
      trackingUrl: String,
      shippedAt: Date,
      deliveredAt: Date,
      deliveryStatus: {
        type: String,
        enum: ['pending', 'shipped', 'delivered', 'exception', 'unknown'],
        default: 'unknown',
      },
    },

    // Raw customer communication pulled from Shopify order timeline/notes
    communications: [
      {
        source: { type: String, enum: ['shopify_note', 'email', 'other'], default: 'shopify_note' },
        body: String,
        occurredAt: Date,
      },
    ],

    rawShopifyPayload: { type: mongoose.Schema.Types.Mixed, select: false }, // full payload for reprocessing if needed
  },
  { timestamps: true }
);

OrderSchema.index({ merchant: 1, shopifyOrderId: 1 }, { unique: true });

module.exports = mongoose.model('Order', OrderSchema);
