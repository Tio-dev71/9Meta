const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  createOrder,
  getOrderStatus,
  sepayWebhook,
  getCheckoutLink,
} = require('../controllers/billingController');

const router = express.Router();

// Authenticated routes
router.post('/create-order', authMiddleware, createOrder);
router.get('/order-status/:code', authMiddleware, getOrderStatus);
router.post('/checkout-link', authMiddleware, getCheckoutLink);

// SePay webhook — NO auth middleware (SePay uses its own API key)
router.post('/webhook/sepay', sepayWebhook);

module.exports = router;
