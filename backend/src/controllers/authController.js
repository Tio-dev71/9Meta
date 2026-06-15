const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');

async function register(req, res) {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ message: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: name || null,
    },
  });

  // Create trial subscription (3 days free)
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 3);

  await prisma.subscription.create({
    data: {
      userId: user.id,
      planCode: 'starter',
      status: 'trialing',
      cycle: 'monthly',
      trialEndsAt,
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEndsAt,
      provider: 'trial',
    },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return res.status(201).json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

async function login(req, res) {
  const { email, password, deviceId, appVersion, os } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  if (deviceId) {
    await prisma.appDevice.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId,
        },
      },
      update: {
        appVersion,
        os,
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        deviceId,
        appVersion,
        os,
        lastSeenAt: new Date(),
      },
    });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Return 200 even if not found to prevent email enumeration
    return res.json({ message: 'Nếu email tồn tại, mã xác nhận đã được gửi.' });
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  // Clear any existing tokens for this email
  await prisma.passwordResetToken.deleteMany({ where: { email } });

  await prisma.passwordResetToken.create({
    data: {
      email,
      code,
      expiresAt,
    },
  });

  const { sendPasswordResetEmail } = require('../utils/email');
  await sendPasswordResetEmail(email, code);

  return res.json({ message: 'Mã xác nhận đã được gửi vào email của bạn.' });
}

async function resetPassword(req, res) {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: 'Thiếu thông tin yêu cầu.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
  }

  const tokenRecord = await prisma.passwordResetToken.findFirst({
    where: {
      email,
      code,
      expiresAt: {
        gt: new Date(), // ensure not expired
      },
    },
  });

  if (!tokenRecord) {
    return res.status(400).json({ message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn.' });
  }

  // Update user password
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  // Delete the token
  await prisma.passwordResetToken.delete({ where: { id: tokenRecord.id } });

  return res.json({ message: 'Mật khẩu đã được đặt lại thành công.' });
}

module.exports = { register, login, forgotPassword, resetPassword };
