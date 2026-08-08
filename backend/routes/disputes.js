const mongoose = require('mongoose');
const Stripe = require('stripe');
const router = require('express').Router();
const Dispute = require('../models/Dispute');
const EvidencePacket = require('../models/EvidencePacket');
const Merchant = require('../models/Merchant');
const requireAuth = require('../middleware/requireAuth');
const { evidenceFields, generateNarrative } = require('../services/evidenceGenerator');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const disputes = await Dispute.find({ merchant: req.merchant._id }).sort({ respondBy: 1 }).limit(50);
    res.json(disputes);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Dispute not found' });
    const dispute = await Dispute.findOne({ _id: req.params.id, merchant: req.merchant._id }).populate('order');
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    res.json(dispute);
  } catch (error) { next(error); }
});

router.get('/:id/evidence', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Dispute not found' });
    const dispute = await Dispute.findOne({ _id: req.params.id, merchant: req.merchant._id }).select('_id');
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    const evidence = await EvidencePacket.findOne({ dispute: dispute._id, merchant: req.merchant._id });
    if (!evidence) return res.status(404).json({ error: 'Evidence has not been generated' });
    res.json(evidence);
  } catch (error) { next(error); }
});

router.post('/:id/generate-evidence', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Dispute not found' });
    const dispute = await Dispute.findOne({ _id: req.params.id, merchant: req.merchant._id }).populate('order');
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (!dispute.order) return res.status(409).json({ error: 'An order must be matched before evidence can be generated' });

    const narrative = await generateNarrative(dispute, dispute.order);
    const existing = await EvidencePacket.findOne({ dispute: dispute._id, merchant: req.merchant._id });
    let evidence;
    if (existing) {
      existing.narrativeHistory.push({ text: existing.narrative, generatedAt: existing.updatedAt });
      existing.narrative = narrative;
      existing.narrativeVersion += 1;
      existing.editedNarrative = undefined;
      existing.stripeEvidenceFields = evidenceFields(dispute.order);
      evidence = await existing.save();
    } else {
      evidence = await EvidencePacket.create({ dispute: dispute._id, merchant: req.merchant._id, narrative, stripeEvidenceFields: evidenceFields(dispute.order) });
    }
    dispute.status = 'draft_ready';
    await dispute.save();
    res.status(existing ? 200 : 201).json(evidence);
  } catch (error) {
    if (error.isAxiosError) {
      error.status = 502;
      error.message = 'Evidence generation provider failed';
    }
    next(error);
  }
});

router.put('/:id/evidence', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Evidence has not been generated' });
    const editedNarrative = typeof req.body?.editedNarrative === 'string' ? req.body.editedNarrative.trim() : '';
    if (!editedNarrative || editedNarrative.length > 10000) return res.status(400).json({ error: 'editedNarrative must be between 1 and 10,000 characters' });
    const evidence = await EvidencePacket.findOneAndUpdate({ dispute: req.params.id, merchant: req.merchant._id }, { $set: { editedNarrative } }, { new: true, runValidators: true });
    if (!evidence) return res.status(404).json({ error: 'Evidence has not been generated' });
    res.json(evidence);
  } catch (error) { next(error); }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) return res.status(404).json({ error: 'Dispute not found' });
    const dispute = await Dispute.findOne({ _id: req.params.id, merchant: req.merchant._id });
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (!['needs_response', 'draft_ready'].includes(dispute.status)) return res.status(409).json({ error: 'This dispute cannot be submitted in its current status' });
    if (dispute.respondBy <= new Date()) return res.status(409).json({ error: 'The Stripe response deadline has passed' });

    const evidence = await EvidencePacket.findOne({ dispute: dispute._id, merchant: req.merchant._id }).select('+submission.stripeResponse');
    if (!evidence) return res.status(409).json({ error: 'Generate evidence before submitting' });
    if (!evidence.editedNarrative) return res.status(409).json({ error: 'Save an edited narrative to approve the evidence before submitting' });
    if (evidence.submission?.status === 'submitted') return res.status(409).json({ error: 'Evidence has already been submitted' });

    const merchant = await Merchant.findById(req.merchant._id);
    if (!merchant?.stripe?.accountId) {
      return res.status(409).json({ error: 'Connect Stripe before submitting evidence' });
    }

    const fields = evidence.stripeEvidenceFields || {};
    const uncategorizedText = [
      evidence.editedNarrative,
      fields.uncategorized_text,
      fields.customer_communication ? `Customer communication:\n${fields.customer_communication}` : undefined,
    ].filter(Boolean).join('\n\n').slice(0, 20000);
    const stripeEvidence = Object.fromEntries(Object.entries({
      product_description: fields.product_description,
      shipping_carrier: fields.shipping_carrier,
      shipping_date: fields.shipping_date,
      shipping_tracking_number: fields.shipping_tracking_number,
      uncategorized_text: uncategorizedText,
    }).filter(([, value]) => value));

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const stripeDispute = await stripe.disputes.update(dispute.stripeDisputeId, {
      evidence: stripeEvidence,
      submit: true,
    }, { stripeAccount: merchant.stripe.accountId, idempotencyKey: `dispute-shield-evidence-${evidence._id}-v${evidence.narrativeVersion}` });

    evidence.submission = {
      submittedAt: new Date(),
      submittedBy: req.merchant._id,
      status: 'submitted',
      stripeResponse: stripeDispute,
      errorMessage: undefined,
    };
    await evidence.save();
    dispute.status = 'under_review';
    await dispute.save();
    res.json({ submitted: true, disputeId: dispute._id, stripeStatus: stripeDispute.status, submittedAt: evidence.submission.submittedAt });
  } catch (error) {
    if (error.isStripeError || error.rawType || String(error.type || '').startsWith('Stripe')) {
      try {
        const evidence = await EvidencePacket.findOne({ dispute: req.params.id, merchant: req.merchant._id });
        if (evidence) {
          evidence.submission = { ...evidence.submission?.toObject?.(), status: 'submission_failed', errorMessage: error.message };
          await evidence.save();
        }
      } catch (saveError) {
        console.error('Failed to record Stripe submission error:', saveError);
      }
      error.status = error.statusCode || 502;
      error.message = 'Stripe rejected the evidence submission';
    }
    next(error);
  }
});

module.exports = router;
