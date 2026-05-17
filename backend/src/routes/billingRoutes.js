const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  getCheckoutLink,
  paymentWebhook,
} = require('../controllers/billingController');

const router = express.Router();

router.post('/checkout-link', authMiddleware, getCheckoutLink);
router.post('/webhook/:provider', paymentWebhook);

module.exports = router;
