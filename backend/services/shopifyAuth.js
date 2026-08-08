const axios = require('axios');

/**
 * Token exchange for Shopify's client credentials grant — the correct auth
 * method (as of the 2026 Dev Dashboard) for an app you build for your own
 * store, installed within the same Shopify organization.
 *
 * This deliberately does NOT use the authorization_code + redirect flow that
 * routes/auth.js's original /shopify/connect and /shopify/callback implement —
 * that flow is for public/custom apps distributed to OTHER merchants, where
 * each merchant must individually consent via a redirect to Shopify's
 * authorize screen. For a single-store app already installed via the Dev
 * Dashboard, no such consent step exists — Shopify simply expects a direct
 * token request using the app's Client ID/secret.
 *
 * Tokens expire after 24h (86399s per Shopify's docs), so this caches in
 * memory and refetches with 60s of buffer before expiry.
 */

let cachedToken = null;
let cachedExpiresAt = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`${name} is not configured`);
    error.status = 500;
    throw error;
  }
  return value;
}

/** Returns just the *.myshopify.com domain, built from SHOPIFY_SHOP. */
function getShopDomain() {
  return `${requireEnv('SHOPIFY_SHOP')}.myshopify.com`;
}

/** Always resolves to the access token string, whether cached or freshly fetched. */
async function getShopifyAccessToken() {
  if (cachedToken && Date.now() < cachedExpiresAt - 60_000) {
    return cachedToken;
  }

  const shop = requireEnv('SHOPIFY_SHOP'); // just the subdomain, e.g. "dispute-shield"
  const clientId = requireEnv('SHOPIFY_API_KEY');
  const clientSecret = requireEnv('SHOPIFY_API_SECRET');

  let response;
  try {
    response = await axios.post(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
  } catch (err) {
    // Shopify's most common failure here is shop_not_permitted — surface it clearly
    // rather than a generic axios error, since it's almost always an org-mismatch issue.
    const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    const error = new Error(`Shopify client credentials token request failed: ${detail}`);
    error.status = err.response?.status || 502;
    throw error;
  }

  const { access_token, expires_in } = response.data;
  if (!access_token) throw new Error('Shopify token response did not include an access_token');

  cachedToken = access_token;
  cachedExpiresAt = Date.now() + expires_in * 1000;

  return cachedToken;
}

/** Clears the cached token — useful for testing or after a credential rotation. */
function clearCache() {
  cachedToken = null;
  cachedExpiresAt = 0;
}

module.exports = { getShopifyAccessToken, getShopDomain, clearCache };
