require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { code: 'starter' },
    update: {
      monthlyPrice: 299000,
      yearlyPrice: 2870400,
    },
    create: {
      code: 'starter',
      name: 'Starter',
      monthlyPrice: 299000,
      yearlyPrice: 2870400,
      maxAccountsPerApp: 3,
      unlimitedProxies: false,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {
      monthlyPrice: 599000,
      yearlyPrice: 5750400,
    },
    create: {
      code: 'pro',
      name: 'Pro',
      monthlyPrice: 599000,
      yearlyPrice: 5750400,
      maxAccountsPerApp: 5,
      unlimitedProxies: true,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'enterprise' },
    update: {
      monthlyPrice: 799000,
      yearlyPrice: 7670400,
    },
    create: {
      code: 'enterprise',
      name: 'Enterprise',
      monthlyPrice: 799000,
      yearlyPrice: 7670400,
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
