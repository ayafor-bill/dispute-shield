const mongoose = require('mongoose');

const DISPUTE_REASONS = [
  'duplicate',
  'fraudulent',
  'subscription_canceled',
  'product_unacceptable',
  'product_not_received',
  'unrecognized',
  'credit_not_processed',
  'general',
  'incorrect_account_details',
  'insufficient_funds',
  'bank_cannot_process',
  'debit_not_authorized',
  'customer_initiated',
];

const DISPUTE_STATUSES = [
  'needs_response', // just came in, no evidence drafted yet
  'draft_ready',     // AI evidence generated, awaiting merchant review
  'under_review',    // submitted to Stripe, awaiting bank decision
  'won',
  'lost',
];

const DisputeSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', index: true }, // null until matched

    // Stripe identifiers
    stripeDisputeId: { type: String, required: true, unique: true }, // dp_xxx
    stripeChargeId: { type: String, required: true, index: true },

    reason: { type: String, enum: DISPUTE_REASONS, required: true },
    amountCents: { type: Number, required: true },
    currency: { type: String, default: 'usd' },

    status: { type: String, enum: DISPUTE_STATUSES, default: 'needs_response', index: true },

    respondBy: { type: Date, required: true }, // Stripe's evidence_details.due_by
    stripeCreatedAt: { type: Date, required: true },

    resolvedAt: Date,
    outcome: { type: String, enum: ['won', 'lost', null], default: null },

    rawStripePayload: { type: mongoose.Schema.Types.Mixed, select: false },
  },
  { timestamps: true }
);

DisputeSchema.index({ merchant: 1, status: 1 });
DisputeSchema.index({ respondBy: 1 });

module.exports = mongoose.model('Dispute', DisputeSchema);
module.exports.DISPUTE_REASONS = DISPUTE_REASONS;
module.exports.DISPUTE_STATUSES = DISPUTE_STATUSES;
