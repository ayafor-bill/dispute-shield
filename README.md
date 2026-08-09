# DisputeShield

**Automated chargeback evidence system for small Shopify/Stripe merchants.**

DisputeShield listens for Stripe chargeback disputes in real time, automatically matches them to the original Shopify order, drafts an evidence response using an LLM, and lets the merchant review and submit it — turning a manual, time-pressured process into a guided workflow.

Live demo: https://dispute-shield-ten.vercel.app
_(Test-mode data only — no real payments or merchants are affected.)_

---

## The problem

Chargeback/dispute automation tools (Chargeflow, Justt, etc.) exist, but they take a percentage of recovered revenue and typically only onboard merchants doing significant monthly volume. Small sellers doing a few thousand dollars a month are underserved — too small to be profitable for those platforms, but still losing real money to disputes they don't have time to fight manually. DisputeShield targets that underserved segment directly.

## How it works

```
Customer disputes a charge with their bank
              │
              ▼
   Stripe fires a webhook (charge.dispute.created)
              │
              ▼
   DisputeShield verifies the signature, records the dispute,
   and matches it to a synced Shopify order
              │
              ▼
   Merchant clicks "Generate evidence draft" — an LLM drafts a
   response using only the verified order/shipping/fulfillment data
              │
              ▼
   Merchant reviews and edits the draft, then submits it to Stripe
              │
              ▼
   Stripe forwards it to the customer's bank for review
```

## Architecture

**Multi-tenant from the ground up** — this isn't a single-merchant tool. Each merchant connects their own Shopify store and their own Stripe account:

- **Shopify**: standard OAuth (authorization code flow) — each merchant authorizes DisputeShield to read their orders, fulfillments, and customer data via their own Shopify consent screen.
- **Stripe**: Connect Standard accounts via hosted onboarding (Account Links) — each merchant gets a real, separate connected Stripe account. Disputes and evidence submissions are scoped per-account using Stripe's `stripeAccount` parameter, not a shared platform token.
- **Order matching**: exact match on Stripe charge ID when available, with a fallback to amount + currency + date-window matching for stores where the charge ID isn't directly exposed (e.g. Shopify Payments).
- **Evidence generation**: an LLM drafts the response using only verified order data — the system prompt explicitly forbids claiming delivery, communication, or any fact not present in the retrieved data, to avoid fabricating evidence.
- **Idempotency**: webhook events are deduplicated by Stripe dispute ID; evidence submissions use idempotency keys to prevent duplicate charges to the AI provider or duplicate Stripe API calls on retry.

## Tech stack

**Backend:** Node.js, Express, MongoDB (Mongoose), JWT authentication, Stripe SDK, Shopify Admin GraphQL API

**Frontend:** React, Vite, Tailwind CSS

**Infrastructure:** MongoDB Atlas, Render (backend), Vercel (frontend)

**AI:** LLM-based evidence drafting with a constrained, fact-only system prompt

## Local development

**Backend**
```bash
cd backend
npm install
npm run dev
```

**Frontend**
```bash
cd frontend
npm install 
npm run dev
```

**Testing the webhook flow locally** requires the [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:4000/webhooks/stripe --forward-connect-to localhost:4000/webhooks/stripe
```

## Current limitations / roadmap

- Disputes that arrive before a matching order has been synced aren't automatically re-checked once the order does show up — a retry mechanism is planned.
- No rate limiting yet on evidence generation or auth endpoints.
- Frontend is currently a single-file component; a proper component-per-file structure is in progress.

## License

This repository is shared for portfolio and evaluation purposes only. All rights reserved — no permission is granted to use, copy, modify, or distribute this code without explicit consent.

---

Built by [Bill Adib](https://github.com/ayafor-bill)