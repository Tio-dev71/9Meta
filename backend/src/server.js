require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const meRoutes = require('./routes/meRoutes');
const billingRoutes = require('./routes/billingRoutes');
const planRoutes = require('./routes/planRoutes');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'zalopre-backend', version: '1.1.0' });
});

app.use('/v1/auth', authRoutes);
app.use('/v1/me', meRoutes);
app.use('/v1/billing', billingRoutes);
app.use('/v1/plans', planRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
