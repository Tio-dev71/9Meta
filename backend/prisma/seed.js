require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { code: 'starter' },
    update: {
      monthlyPrice: 399000,
      yearlyPrice: 3830400,
    },
    create: {
      code: 'starter',
      name: 'Starter',
      monthlyPrice: 399000,
      yearlyPrice: 3830400,
      maxAccountsPerApp: 3,
      unlimitedProxies: false,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {
      monthlyPrice: 1190000,
      yearlyPrice: 11424000,
    },
    create: {
      code: 'pro',
      name: 'Pro',
      monthlyPrice: 1190000,
      yearlyPrice: 11424000,
      maxAccountsPerApp: 5,
      unlimitedProxies: true,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'enterprise' },
    update: {
      monthlyPrice: 3090000,
      yearlyPrice: 29664000,
    },
    create: {
      code: 'enterprise',
      name: 'Enterprise',
      monthlyPrice: 3090000,
      yearlyPrice: 29664000,
      maxAccountsPerApp: null,
      unlimitedProxies: true,
    },
  });

  console.log('Seeded plans successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
