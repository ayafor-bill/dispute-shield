const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const router = require('express').Router();
const Merchant = require('../models/Merchant');
const OAuthState = require('../models/OAuthState');
const requireAuth = require('../middleware/requireAuth');
const { getShopifyAccessToken, getShopDomain } = require('../services/shopifyAuth');

const STATE_TTL_MS = 10 * 60 * 1000;
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function requiredEnvironment(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing required OAuth configuration: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }
}

async function createState(merchantId, provider, shopDomain) {
  const state = crypto.randomBytes(32).toString('base64url');
  await OAuthState.create({
    merchant: merchantId,
    provider,
    shopDomain,
    stateHash: OAuthState.hash(state),
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });
  return state;
}

function signAccessToken(merchant) {
  requiredEnvironment(['JWT_SECRET']);
  return jwt.sign({ sub: merchant._id.toString(), email: merchant.email }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });
}

function serializeMerchant(merchant) {
  return {
    id: merchant._id,
    email: merchant.email,
    businessName: merchant.businessName,
    shopifyConnected: Boolean(merchant.shopify?.shopDomain),
    stripeConnected: Boolean(merchant.stripe?.accountId),
  };
}

function sendAuthorizationResponse(req, res, authorizationUrl) {
  if (req.query.format === 'json') return res.json({ authorizationUrl });
  return res.redirect(302, authorizationUrl);
}

router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const businessName = typeof req.body.businessName === 'string' ? req.body.businessName.trim() : undefined;
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
    if (await Merchant.exists({ email })) return res.status(409).json({ error: 'An account with that email already exists' });

    const merchant = await Merchant.create({ email, passwordHash: await bcrypt.hash(password, 12), businessName });
    res.status(201).json({ accessToken: signAccessToken(merchant), merchant: serializeMerchant(merchant) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'An account with that email already exists' });
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const merchant = await Merchant.findOne({ email, isActive: true }).select('+passwordHash');
    if (!merchant || !(await bcrypt.compare(password, merchant.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ accessToken: signAccessToken(merchant), merchant: serializeMerchant(merchant) });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ merchant: serializeMerchant(req.merchant) });
});

async function consumeState(state, provider) {
  if (!state || typeof state !== 'string') {
    const error = new Error('Missing OAuth state');
    error.status = 400;
    throw error;
  }

  const record = await OAuthState.findOneAndDelete({
    provider,
    stateHash: OAuthState.hash(state),
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    const error = new Error('OAuth state is invalid or expired');
    error.status = 400;
    throw error;
  }
  return record;
}

function normalizeShopDomain(value) {
  const shop = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!SHOP_DOMAIN_RE.test(shop)) {
    const error = new Error('shop must be a valid *.myshopify.com domain');
    error.status = 400;
    throw error;
  }
  return shop;
}

function verifyShopifyHmac(req) {
  const hmac = req.query.hmac;
  if (!hmac || typeof hmac !== 'string') return false;

  const queryString = req.originalUrl.split('?')[1] || '';
  const params = new URLSearchParams(queryString);
  params.delete('hmac');
  params.sort();
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(params.toString())
    .digest('hex');
  const received = Buffer.from(hmac, 'utf8');
  const expected = Buffer.from(digest, 'utf8');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// Start a Stripe Connect OAuth flow for the authenticated merchant.
router.get('/stripe/connect', requireAuth, async (req, res, next) => {
  try {
    requiredEnvironment(['STRIPE_SECRET_KEY', 'APP_BASE_URL', 'FRONTEND_URL']);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let merchant = await Merchant.findById(req.merchant._id);
    let accountId = merchant.stripe?.accountId;

    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'standard', email: merchant.email });
      accountId = account.id;
      await Merchant.findByIdAndUpdate(merchant._id, { $set: { 'stripe.accountId': accountId } });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/?stripe=refresh`,
      return_url: `${process.env.FRONTEND_URL}/?stripe=return`,
      type: 'account_onboarding',
    });

    sendAuthorizationResponse(req, res, accountLink.url);
  } catch (error) {
    next(error);
  }
});

router.get('/stripe/callback', async (req, res, next) => {
  try {
    requiredEnvironment(['STRIPE_SECRET_KEY', 'STRIPE_CLIENT_ID', 'STRIPE_REDIRECT_URI']);
    if (req.query.error) {
      const error = new Error(req.query.error_description || req.query.error);
      error.status = 400;
      throw error;
    }
    if (!req.query.code || typeof req.query.code !== 'string') {
      const error = new Error('Missing Stripe authorization code');
      error.status = 400;
      throw error;
    }

    const oauthState = await consumeState(req.query.state, 'stripe');
    const tokenResponse = await axios.post('https://connect.stripe.com/oauth/token', new URLSearchParams({
      client_secret: process.env.STRIPE_SECRET_KEY,
      code: req.query.code,
      grant_type: 'authorization_code',
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    const token = tokenResponse.data;
    if (!token.stripe_user_id || !token.access_token) throw new Error('Stripe returned an incomplete OAuth token response');

    await Merchant.findByIdAndUpdate(oauthState.merchant, {
      $set: {
        'stripe.accountId': token.stripe_user_id,
        'stripe.accessToken': token.access_token,
        'stripe.refreshToken': token.refresh_token || undefined,
        'stripe.connectedAt': new Date(),
      },
    });
    res.json({ connected: true, provider: 'stripe', accountId: token.stripe_user_id });
  } catch (error) {
    next(error);
  }
});

// Connect Shopify for the authenticated merchant.
//
// NOTE: This uses the client credentials grant, not a browser redirect —
// correct for a single-store app installed via the Shopify Dev Dashboard
// within your own organization (no per-merchant consent screen exists for
// this app type; the app was already granted access at install time).
// The original redirect_uri + authorization code flow below (kept as
// /shopify/callback) is what you'd need instead if this app is ever
// distributed to OTHER merchants' stores — that's a real architecture
// fork to revisit before onboarding real customers, not just a config change.
router.get('/shopify/connect', requireAuth, async (req, res, next) => {
  try {
    requiredEnvironment(['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_REDIRECT_URI']);
    const shop = normalizeShopDomain(req.query.shop);
    const state = await createState(req.merchant._id, 'shopify', shop);
    const authorizationUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizationUrl.search = new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY,
      scope: process.env.SHOPIFY_SCOPES || 'read_orders,read_fulfillments,read_customers',
      redirect_uri: process.env.SHOPIFY_REDIRECT_URI,
      state,
    }).toString();
    sendAuthorizationResponse(req, res, authorizationUrl.toString());
  } catch (error) {
    next(error);
  }
});

router.get('/shopify/callback', async (req, res, next) => {
  try {
    requiredEnvironment(['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_REDIRECT_URI']);
    if (!verifyShopifyHmac(req)) {
      const error = new Error('Invalid Shopify callback signature');
      error.status = 400;
      throw error;
    }
    const shop = normalizeShopDomain(req.query.shop);
    if (!req.query.code || typeof req.query.code !== 'string') {
      const error = new Error('Missing Shopify authorization code');
      error.status = 400;
      throw error;
    }

    const oauthState = await consumeState(req.query.state, 'shopify');
    if (oauthState.shopDomain !== shop) {
      const error = new Error('Shopify callback shop does not match the authorization request');
      error.status = 400;
      throw error;
    }
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code: req.query.code,
    }, { timeout: 15000 });
    const token = tokenResponse.data;
    if (!token.access_token) throw new Error('Shopify returned an incomplete OAuth token response');

    await Merchant.findByIdAndUpdate(oauthState.merchant, {
      $set: {
        'shopify.shopDomain': shop,
        'shopify.accessToken': token.access_token,
        'shopify.scope': token.scope || process.env.SHOPIFY_SCOPES,
        'shopify.connectedAt': new Date(),
      },
    });
    res.json({ connected: true, provider: 'shopify', shopDomain: shop, scope: token.scope });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
