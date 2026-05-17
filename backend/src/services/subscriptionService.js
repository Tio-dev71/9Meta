const { prisma } = require('../config/prisma');

function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  if (subscription.status === 'active') return true;
  if (subscription.status === 'trialing' && subscription.trialEndsAt && new Date(subscription.trialEndsAt) > new Date()) {
    return true;
  }
  return false;
}

function toFeatureFlags(subscription) {
  const plan = subscription?.plan;
  if (!plan) {
    return {
      maxAccountsPerApp: 0,
      unlimitedProxies: false,
    };
  }

  return {
    maxAccountsPerApp: plan.maxAccountsPerApp,
    unlimitedProxies: plan.unlimitedProxies,
  };
}

async function getLatestSubscriptionByUserId(userId) {
  return prisma.subscription.findFirst({
    where: { userId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  isSubscriptionActive,
  toFeatureFlags,
  getLatestSubscriptionByUserId,
};
