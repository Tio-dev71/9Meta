const { prisma } = require('../config/prisma');

async function getCheckoutLink(req, res) {
  const { plan, cycle } = req.body;

  if (!plan || !['starter', 'pro', 'enterprise'].includes(plan)) {
    return res.status(400).json({ message: 'Invalid plan' });
  }

  if (!cycle || !['monthly', 'yearly'].includes(cycle)) {
    return res.status(400).json({ message: 'Invalid cycle' });
  }

  const checkoutUrl = `${process.env.APP_WEB_URL}/checkout?plan=${plan}&cycle=${cycle}`;
  return res.json({ checkoutUrl });
}

async function paymentWebhook(req, res) {
  const provider = req.params.provider;
  const payload = req.body;

  // TODO: Verify signature per provider before processing.
  const eventId = payload.eventId || payload.transactionId || `${Date.now()}`;
  const eventType = payload.eventType || 'payment.success';
  const userId = payload.userId || null;

  await prisma.paymentEvent.create({
    data: {
      userId,
      provider,
      eventId,
      eventType,
      payload,
    },
  }).catch(() => null);

  // TODO: map provider payload -> subscription update logic.
  return res.json({ received: true });
}

module.exports = {
  getCheckoutLink,
  paymentWebhook,
};
