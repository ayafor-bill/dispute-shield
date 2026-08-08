const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const Merchant = require('../models/Merchant');
const { syncShopifyOrders } = require('../services/shopifyOrderSync');

router.use(requireAuth);

router.post('/sync', async (req, res, next) => {
  try {
    const requestedDays = Number(req.body?.days ?? 60);
    if (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 365) {
      return res.status(400).json({ error: 'days must be an integer between 1 and 365' });
    }
    const merchant = await Merchant.findById(req.merchant._id);
    const result = await syncShopifyOrders(merchant, requestedDays);
    res.json({ synced: true, ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
