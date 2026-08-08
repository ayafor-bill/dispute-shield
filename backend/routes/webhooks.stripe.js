const router = require('express').Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Merchant = require('../models/Merchant');
const Dispute = require('../models/Dispute');
const { matchOrderToDispute } = require('../services/orderMatcher');

// POST /webhooks/stripe — receives charge.dispute.created and related events
// Mounted with express.raw() in app.js so signature verification works.
router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Respond to Stripe immediately — do the actual work after.
  // Stripe retries on non-2xx or slow responses; we don't want DB latency to trigger retries.
  res.json({ received: true });

  try {
    switch (event.type) {
      case 'charge.dispute.created':
        await handleDisputeCreated(event);
        break;
      case 'charge.dispute.closed':
        await handleDisputeClosed(event);
        break;
      default:
        break;
      case 'account.updated':
        await handleAccountUpdated(event);
      break;
    }
  } catch (err) {
    // Webhook already ack'd to Stripe — log for manual/alerted follow-up rather than retry-looping Stripe.
    console.error(`[stripe webhook] failed processing ${event.type}:`, err);
  }
});

async function handleDisputeCreated(event) {
  const stripeDispute = event.data.object;

  // account is present when using Stripe Connect (event.account); for a
  // platform-level key on a single merchant's account this may be undefined.
  const stripeAccountId = event.account || null;

  const merchant = stripeAccountId
    ? await Merchant.findOne({ 'stripe.accountId': stripeAccountId })
    : await Merchant.findOne(); // single-tenant dev fallback — replace once multi-merchant Connect is wired

  if (!merchant) {
    console.warn(`[stripe webhook] no merchant found for account ${stripeAccountId}, dispute ${stripeDispute.id} dropped`);
    return;
  }

  // Idempotency: Stripe can redeliver the same event.
  const existing = await Dispute.findOne({ stripeDisputeId: stripeDispute.id });
  if (existing) {
    console.log(`[stripe webhook] dispute ${stripeDispute.id} already recorded, skipping`);
    return;
  }

  const dispute = await Dispute.create({
    merchant: merchant._id,
    stripeDisputeId: stripeDispute.id,
    stripeChargeId: stripeDispute.charge,
    reason: stripeDispute.reason,
    amountCents: stripeDispute.amount,
    currency: stripeDispute.currency,
    status: 'needs_response',
    respondBy: new Date(stripeDispute.evidence_details.due_by * 1000),
    stripeCreatedAt: new Date(stripeDispute.created * 1000),
    rawStripePayload: stripeDispute,
  });

  console.log(`[stripe webhook] dispute created: ${dispute.stripeDisputeId} for merchant ${merchant._id}`);

  // Kick off order matching (Step 3 will make this actually pull from Shopify;
  // for now it attempts a match against Orders already in our DB).
  await matchOrderToDispute(dispute).catch((err) =>
    console.error(`[stripe webhook] order matching failed for dispute ${dispute._id}:`, err)
  );
}

async function handleAccountUpdated(event) {
  const account = event.data.object;
  await Merchant.findOneAndUpdate(
    { 'stripe.accountId': account.id },
    { $set: { 'stripe.chargesEnabled': account.charges_enabled, 'stripe.detailsSubmitted': account.details_submitted } }
  );
}

async function handleDisputeClosed(event) {
  const stripeDispute = event.data.object;

  const dispute = await Dispute.findOne({ stripeDisputeId: stripeDispute.id });
  if (!dispute) {
    console.warn(`[stripe webhook] dispute.closed received for unknown dispute ${stripeDispute.id}`);
    return;
  }

  const outcome = stripeDispute.status === 'won' ? 'won' : 'lost';

  dispute.status = outcome;
  dispute.outcome = outcome;
  dispute.resolvedAt = new Date();
  await dispute.save();

  const statInc =
    outcome === 'won'
      ? { 'stats.wins': 1, 'stats.totalRecoveredCents': dispute.amountCents }
      : { 'stats.losses': 1 };

  await Merchant.findByIdAndUpdate(dispute.merchant, { $inc: statInc });

  console.log(`[stripe webhook] dispute ${dispute.stripeDisputeId} closed as ${outcome}`);
}

module.exports = router;
