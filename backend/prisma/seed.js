require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { code: 'starter' },
    update: {},
    create: {
      code: 'starter',
      name: 'Starter',
      monthlyPrice: 799000,
      yearlyPrice: 7670400,
      maxAccountsPerApp: 3,
      unlimitedProxies: false,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'pro' },
    update: {},
    create: {
      code: 'pro',
      name: 'Pro',
      monthlyPrice: 1590000,
      yearlyPrice: 15264000,
      maxAccountsPerApp: 5,
      unlimitedProxies: true,
    },
  });

  await prisma.plan.upsert({
    where: { code: 'enterprise' },
    update: {},
    create: {
      code: 'enterprise',
      name: 'Enterprise',
      monthlyPrice: 3490000,
      yearlyPrice: 33504000,
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
