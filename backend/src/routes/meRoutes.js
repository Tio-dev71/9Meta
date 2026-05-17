const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  getMySubscription,
  registerDevice,
} = require('../controllers/subscriptionController');

const router = express.Router();

router.get('/subscription', authMiddleware, getMySubscription);
router.post('/register-device', authMiddleware, registerDevice);

module.exports = router;
