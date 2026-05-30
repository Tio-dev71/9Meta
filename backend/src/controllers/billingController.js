const crypto = require('crypto');
const { prisma } = require('../config/prisma');
const {
  getLatestSubscriptionByUserId,
} = require('../services/subscriptionService');

// Generate a short unique order code like "9M-A3X7K2"
function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '9M';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Create a subscription order and return VietQR data
async function createOrder(req, res) {
  const { planCode, cycle } = req.body;
  const userId = req.user.id;

  if (!planCode || !['starter', 'pro', 'enterprise'].includes(planCode)) {
    return res.status(400).json({ message: 'Invalid plan' });
  }
  if (!cycle || !['monthly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ message: 'Invalid cycle' });
  }

  // Get plan pricing
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  let amount = cycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;

  if (req.body.affiliateCode) {
    try {
      const webUrl = process.env.APP_WEB_URL || 'https://tiodev.io.vn';
      const fetchRes = await fetch(`${webUrl}/api/affiliates/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: req.body.affiliateCode.trim().toUpperCase() }),
      });
      const data = await fetchRes.json();
      if (data.valid && data.discountPercent) {
        const discountAmount = Math.round((amount * data.discountPercent) / 100);
        amount = amount - discountAmount;
      }
    } catch (err) {
      console.error('[Billing] Failed to validate affiliate code:', err.message);
    }
  }

  // Check for existing pending order (avoid duplicates)
  const existingPending = await prisma.subscriptionOrder.findFirst({
    where: {
      userId,
      planCode,
      cycle,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
  });

  if (existingPending) {
    // Return existing pending order
    const bankId = process.env.VIETQR_BANK_ID || '970422';
    const accountNo = process.env.VIETQR_ACCOUNT_NO || '';
    const accountName = process.env.VIETQR_ACCOUNT_NAME || '';

    const qrImageUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${existingPending.amount}&addInfo=${encodeURIComponent(existingPending.code)}&accountName=${encodeURIComponent(accountName)}`;

    return res.json({
      order: {
        code: existingPending.code,
        amount: existingPending.amount,
        planCode: existingPending.planCode,
        cycle: existingPending.cycle,
        expiresAt: existingPending.expiresAt,
      },
      vietqr: {
        qrImageUrl,
        bankId,
        accountNo,
        accountName,
        amount: existingPending.amount,
        description: existingPending.code,
      },
    });
  }

  // Generate unique order code
  let code;
  let attempts = 0;
  do {
    code = generateOrderCode();
    const existing = await prisma.subscriptionOrder.findUnique({ where: { code } });
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  // Order expires in 30 minutes
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);

  const order = await prisma.subscriptionOrder.create({
    data: {
      code,
      userId,
      planCode,
      cycle,
      amount,
      status: 'pending',
      expiresAt,
    },
  });

  // Generate VietQR
  const bankId = process.env.VIETQR_BANK_ID || '970422';
  const accountNo = process.env.VIETQR_ACCOUNT_NO || '';
  const accountName = process.env.VIETQR_ACCOUNT_NAME || '';

  const qrImageUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(accountName)}`;

  return res.json({
    order: {
      code: order.code,
      amount: order.amount,
      planCode: order.planCode,
      cycle: order.cycle,
      expiresAt: order.expiresAt,
    },
    vietqr: {
      qrImageUrl,
      bankId,
      accountNo,
      accountName,
      amount,
      description: code,
    },
  });
}

// Check order payment status (polling endpoint)
async function getOrderStatus(req, res) {
  const { code } = req.params;

  const order = await prisma.subscriptionOrder.findUnique({
    where: { code },
  });

  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }

  // Check if order belongs to user (if auth present)
  if (req.user && order.userId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return res.json({
    code: order.code,
    status: order.status,
    paidAt: order.paidAt,
    amount: order.amount,
    planCode: order.planCode,
    cycle: order.cycle,
  });
}

// SePay webhook handler
async function sepayWebhook(req, res) {
  // Verify API Key from SePay
  const authHeader = req.headers.authorization || '';
  const expectedKey = process.env.SEPAY_API_KEY;

  if (expectedKey) {
    const providedKey = authHeader.replace('Apikey ', '').replace('Bearer ', '').trim();
    if (providedKey !== expectedKey) {
      console.error('[SePay Webhook] Invalid API key');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
  }

  const payload = req.body;
  console.log('[SePay Webhook] Received:', JSON.stringify(payload));

  // SePay payload fields:
  // id, gateway, transactionDate, accountNumber, code, content, transferType,
  // transferAmount, accumulated, subAccount, referenceCode, description
  const {
    id: sepayTxnId,
    content,
    transferAmount,
    transferType,
  } = payload;

  // Only process incoming transfers
  if (transferType === 'out') {
    return res.json({ success: true });
  }

  // Log payment event
  await prisma.paymentEvent.create({
    data: {
      provider: 'sepay',
      eventId: String(sepayTxnId || Date.now()),
      eventType: 'payment.received',
      payload,
    },
  }).catch((err) => {
    console.error('[SePay Webhook] Failed to log event:', err.message);
  });

  // Extract order code from transfer content
  // Content might be: "9MAB3X7K chuyen tien" or just "9MAB3X7K"
  const orderCodeMatch = (content || '').match(/9M[A-Z0-9]{6}/i);

  if (!orderCodeMatch) {
    console.log('[SePay Webhook] No order code found in content:', content);
    return res.json({ success: true });
  }

  const orderCode = orderCodeMatch[0].toUpperCase();
  console.log('[SePay Webhook] Found order code:', orderCode);

  // Find pending order
  const order = await prisma.subscriptionOrder.findUnique({
    where: { code: orderCode },
    include: { plan: true, user: true },
  });

  if (!order) {
    console.log('[SePay Webhook] Order not found:', orderCode);
    return res.json({ success: true });
  }

  if (order.status === 'paid') {
    console.log('[SePay Webhook] Order already paid:', orderCode);
    return res.json({ success: true });
  }

  // Verify amount (allow small rounding differences)
  if (transferAmount < order.amount) {
    console.error(`[SePay Webhook] Amount mismatch: received ${transferAmount}, expected ${order.amount}`);
    return res.json({ success: true });
  }

  // Mark order as paid
  await prisma.subscriptionOrder.update({
    where: { code: orderCode },
    data: {
      status: 'paid',
      sepayTxnId: String(sepayTxnId),
      paidAt: new Date(),
    },
  });

  // Calculate subscription period
  const now = new Date();
  const periodEnd = new Date(now);
  if (order.cycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // Check if user has existing active subscription to extend
  const existingSub = await prisma.subscription.findFirst({
    where: {
      userId: order.userId,
      status: { in: ['active', 'trialing'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingSub) {
    // Upgrade/renew existing subscription
    const startDate = existingSub.currentPeriodEnd && new Date(existingSub.currentPeriodEnd) > now
      ? new Date(existingSub.currentPeriodEnd)
      : now;
    const newEnd = new Date(startDate);
    if (order.cycle === 'yearly') {
      newEnd.setFullYear(newEnd.getFullYear() + 1);
    } else {
      newEnd.setMonth(newEnd.getMonth() + 1);
    }

    await prisma.subscription.update({
      where: { id: existingSub.id },
      data: {
        planCode: order.planCode,
        status: 'active',
        cycle: order.cycle,
        currentPeriodStart: startDate,
        currentPeriodEnd: newEnd,
        provider: 'sepay',
        trialEndsAt: null,
      },
    });
  } else {
    // Create new subscription
    await prisma.subscription.create({
      data: {
        userId: order.userId,
        planCode: order.planCode,
        status: 'active',
        cycle: order.cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        provider: 'sepay',
      },
    });
  }

  // Update payment event with userId
  await prisma.paymentEvent.updateMany({
    where: {
      provider: 'sepay',
      eventId: String(sepayTxnId),
    },
    data: { userId: order.userId },
  }).catch(() => null);

  console.log(`[SePay Webhook] ✅ Subscription activated for user ${order.user.email}, plan ${order.planCode} (${order.cycle})`);

  return res.json({ success: true });
}

// Legacy checkout link (kept for backward compat)
async function getCheckoutLink(req, res) {
  const { plan, cycle } = req.body;

  if (!plan || !['starter', 'pro', 'enterprise'].includes(plan)) {
    return res.status(400).json({ message: 'Invalid plan' });
  }

  if (!cycle || !['monthly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ message: 'Invalid cycle' });
  }

  const checkoutUrl = `${process.env.APP_WEB_URL}/subscription/checkout?plan=${plan}&cycle=${cycle}`;
  return res.json({ checkoutUrl });
}

module.exports = {
  createOrder,
  getOrderStatus,
  sepayWebhook,
  getCheckoutLink,
};
