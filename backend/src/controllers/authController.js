const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');

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
    },
  });
}

module.exports = { login };
