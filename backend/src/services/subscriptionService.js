const { prisma } = require('../config/prisma');

function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  
  const now = new Date();

  // Kiểm tra trạng thái active CỘNG THÊM thời hạn chưa kết thúc
  if (subscription.status === 'active') {
    if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > now) {
      return true;
    }
  }

  // Kiểm tra thời hạn dùng thử
  if (subscription.status === 'trialing' && subscription.trialEndsAt && new Date(subscription.trialEndsAt) > now) {
    return true;
  }

  return false;
}

function toFeatureFlags(subscription) {
  const plan = subscription?.plan;
  const planCode = subscription?.planCode;

  if (!plan && !planCode) {
    return {
      maxAccountsPerApp: 0,
      unlimitedProxies: false,
    };
  }

  // Fallback defaults based on planCode if plan object is missing or incomplete
  let maxAccountsPerApp = plan?.maxAccountsPerApp;
  let unlimitedProxies = plan?.unlimitedProxies || false;

  if (planCode === 'starter') {
    maxAccountsPerApp = maxAccountsPerApp ?? 3;
    unlimitedProxies = unlimitedProxies ?? false;
  } else if (planCode === 'pro') {
    maxAccountsPerApp = maxAccountsPerApp ?? 5;
    unlimitedProxies = unlimitedProxies ?? true;
  } else if (planCode === 'enterprise') {
    maxAccountsPerApp = maxAccountsPerApp !== undefined ? maxAccountsPerApp : null; // null means unlimited
    unlimitedProxies = unlimitedProxies ?? true;
  }

  return {
    maxAccountsPerApp: maxAccountsPerApp,
    unlimitedProxies: unlimitedProxies,
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
