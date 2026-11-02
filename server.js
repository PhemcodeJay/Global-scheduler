require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const db = require('./config/database');
const autoBookService = require('./services/autoBook');

const requiredEnv = ['JWT_SECRET'];
if (process.env.NODE_ENV === 'production') requiredEnv.push('ADMIN_EMAIL', 'ADMIN_PASSWORD');
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`${key} must be configured`);
}
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/slots', require('./routes/slots'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/admin/settings', require('./routes/adminSettings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/auto-book', require('./routes/userSettings'));
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.json({ status: 'ok', service: 'Gonest International Scheduler', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});
app.get('/api/auto-book/status', (req, res) => res.json(autoBookService.getStatus()));
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, () => {
  console.log('='.repeat(50));
  console.log('Gonest International - Agency Scheduler');
  console.log(`Server: http://localhost:${port}`);
  console.log(`Auto-book monitor: ${autoBookService.getStatus().monitoring ? 'ACTIVE' : 'DISABLED'} (${autoBookService.getStatus().interval}ms)`);
  console.log('='.repeat(50));
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  autoBookService.stop();
  server.close(() => {
    try { db.close(); } catch (error) { console.error('Database close error:', error); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});
