const mongoose = require('mongoose');

const EvidencePacketSchema = new mongoose.Schema(
  {
    dispute: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', required: true, unique: true, index: true },
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },

    // AI-drafted narrative — maps into Stripe's evidence fields on submission
    narrative: { type: String, required: true },
    narrativeVersion: { type: Number, default: 1 }, // increments on regenerate
    narrativeHistory: [
      {
        text: String,
        generatedAt: Date,
      },
    ],

    // Merchant's final edited version (what actually gets submitted)
    editedNarrative: { type: String },

    // Mapped Stripe evidence fields (Stripe's schema, not ours — kept close to their API shape)
    stripeEvidenceFields: {
      product_description: String,
      shipping_carrier: String,
      shipping_tracking_number: String,
      shipping_date: String,
      customer_communication: String,
      uncategorized_text: String,
    },

    submission: {
      submittedAt: Date,
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' },
      status: {
        type: String,
        enum: ['not_submitted', 'submitted', 'submission_failed'],
        default: 'not_submitted',
      },
      stripeResponse: { type: mongoose.Schema.Types.Mixed, select: false },
      errorMessage: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EvidencePacket', EvidencePacketSchema);
