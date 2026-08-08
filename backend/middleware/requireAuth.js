const jwt = require('jsonwebtoken');
const Merchant = require('../models/Merchant');

module.exports = async function requireAuth(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      const error = new Error('JWT_SECRET is not configured');
      error.status = 500;
      throw error;
    }

    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Authentication required' });

    let payload;
    try {
      payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    if (!payload.sub) return res.status(401).json({ error: 'Invalid access token' });
    const merchant = await Merchant.findOne({ _id: payload.sub, isActive: true }).select('_id email businessName shopify stripe')
    if (!merchant) return res.status(401).json({ error: 'Invalid or expired access token' });

    req.merchant = merchant;
    next();
  } catch (error) {
    next(error);
  }
};
