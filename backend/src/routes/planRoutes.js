const express = require('express');
const { getPlans } = require('../controllers/planController');

const router = express.Router();

// Public endpoint — no auth needed
router.get('/', getPlans);

module.exports = router;
