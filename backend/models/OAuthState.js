const crypto = require('crypto');
const mongoose = require('mongoose');

const OAuthStateSchema = new mongoose.Schema({
  merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true, index: true },
  provider: { type: String, enum: ['stripe', 'shopify'], required: true, index: true },
  stateHash: { type: String, required: true, unique: true },
  shopDomain: String,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

OAuthStateSchema.statics.hash = function hash(state) {
  return crypto.createHash('sha256').update(state).digest('hex');
};

module.exports = mongoose.model('OAuthState', OAuthStateSchema);
