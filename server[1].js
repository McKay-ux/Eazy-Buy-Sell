require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { prisma } = require('./db');
const routes = require('./routes');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set to a random secret of at least 32 characters.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by CORS.'));
} }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', service: 'eazybuysell-api' });
  } catch (_err) {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});
app.use('/api', routes);
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((err, _req, res, _next) => {
  if (process.env.NODE_ENV !== 'production') console.error(err);
  if (err && err.code === 'P2002') return res.status(409).json({ error: 'A record with that unique value already exists.' });
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`Eazy Buy & Sell API listening on ${port}`));
async function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
