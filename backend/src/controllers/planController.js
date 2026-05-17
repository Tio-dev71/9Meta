const { prisma } = require('../config/prisma');

async function getPlans(req, res) {
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { monthlyPrice: 'asc' },
  });

  return res.json({
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      monthlyPrice: p.monthlyPrice,
      yearlyPrice: p.yearlyPrice,
      maxAccountsPerApp: p.maxAccountsPerApp,
      unlimitedProxies: p.unlimitedProxies,
    })),
  });
}

module.exports = { getPlans };
