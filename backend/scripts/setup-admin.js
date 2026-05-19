/**
 * One-off script: Set admin password and lifetime subscription
 * Usage: node scripts/setup-admin.js
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const ADMIN_EMAIL = 'thonguyen7106@gmail.com';
  const NEW_PASSWORD = '07012006tho';

  // 1. Update password
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 12);
  
  const user = await prisma.user.update({
    where: { email: ADMIN_EMAIL },
    data: { passwordHash },
  });
  
  console.log(`✅ Password updated for ${user.email}`);

  // 2. Set lifetime subscription (expires year 2099)
  const lifetimeEnd = new Date('2099-12-31T23:59:59Z');
  
  // Find existing subscription
  const existing = await prisma.subscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        planCode: 'enterprise',
        cycle: 'lifetime',
        currentPeriodStart: new Date(),
        currentPeriodEnd: lifetimeEnd,
        trialEndsAt: null,
        provider: 'admin',
      },
    });
    console.log(`✅ Subscription upgraded to LIFETIME (enterprise) until 2099`);
  } else {
    // Ensure enterprise plan exists
    await prisma.plan.upsert({
      where: { code: 'enterprise' },
      update: {},
      create: {
        code: 'enterprise',
        name: 'Enterprise',
        monthlyPrice: 0,
        yearlyPrice: 0,
        maxAccountsPerApp: null,
        unlimitedProxies: true,
        active: true,
      },
    });

    await prisma.subscription.create({
      data: {
        userId: user.id,
        planCode: 'enterprise',
        status: 'active',
        cycle: 'lifetime',
        currentPeriodStart: new Date(),
        currentPeriodEnd: lifetimeEnd,
        provider: 'admin',
      },
    });
    console.log(`✅ Created LIFETIME subscription (enterprise) until 2099`);
  }

  console.log('\n🎉 Admin setup complete!');
  console.log(`   Email: ${ADMIN_EMAIL}`);
  console.log(`   Password: ${NEW_PASSWORD}`);
  console.log(`   Plan: Enterprise (lifetime)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
