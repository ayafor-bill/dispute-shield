const mongoose = require('mongoose');

const MerchantSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    businessName: { type: String, trim: true },

    // Shopify connection
    shopify: {
      shopDomain: { type: String, trim: true }, // e.g. mystore.myshopify.com
      accessToken: { type: String, select: false }, // never returned by default
      connectedAt: Date,
      scope: String,
    },

    // Stripe connection (Stripe Connect OAuth)
    stripe: {
      accountId: { type: String, trim: true }, // acct_xxx
      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      connectedAt: Date,
      webhookSecret: { type: String, select: false }, // per-account signing secret
    },

    // Denormalized stats for fast dashboard reads (updated by dispute resolution jobs)
    stats: {
      totalDisputes: { type: Number, default: 0 },
      totalRecoveredCents: { type: Number, default: 0 },
      totalAtRiskCents: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

MerchantSchema.index({ 'shopify.shopDomain': 1 });
MerchantSchema.index({ 'stripe.accountId': 1 });

module.exports = mongoose.model('Merchant', MerchantSchema);
