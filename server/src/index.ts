import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { cityRoutes } from './routes/cities.js';
import { projectRoutes } from './routes/projects.js';
import { macroRoutes } from './routes/macro.js';
import { scoringRoutes } from './routes/scoring.js';
import { authRoutes } from './routes/auth.js';
import { webhookRoutes } from './routes/webhooks.js';
import { analyticsRoutes } from './routes/analytics.js';
import { adminRoutes } from './routes/admin.js';
import { scheduleRoutes } from './routes/schedule.js';
import { verificationRoutes } from './routes/verification.js';
import { assetClassRoutes } from './routes/assetClasses.js';
import { apiKeyMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/logger.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ── Database ─────────────────────────────────────────────────────
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// ── Redis (optional) ─────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL;
let redis: any = null;

if (REDIS_URL && REDIS_URL !== 'redis://localhost:6379') {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
  redis.on('error', (err: any) => logger.error({ err }, 'Redis connection error'));
  redis.on('connect', () => logger.info('Redis connected'));
} else {
  // In-memory fallback for development
  const cache = new Map<string, { value: string; expires: number }>();
  redis = {
    get: async (key: string) => {
      const item = cache.get(key);
      if (item && item.expires > Date.now()) return item.value;
      cache.delete(key);
      return null;
    },
    set: async (key: string, value: string) => {
      cache.set(key, { value, expires: Date.now() + 3600000 });
    },
    setex: async (key: string, ttl: number, value: string) => {
      cache.set(key, { value, expires: Date.now() + ttl * 1000 });
    },
    del: async (...keys: string[]) => {
      keys.forEach(k => cache.delete(k));
    },
    zadd: async () => {},
    zrangebyscore: async () => [],
    zremrangebyscore: async () => {},
    disconnect: () => {},
  };
  logger.info('Using in-memory cache (Redis not available)');
}

export { redis };

// ── Express App ──────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Security
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// Request logging
app.use(requestLogger(logger));

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/cities', apiKeyMiddleware, cityRoutes);
app.use('/api/projects', apiKeyMiddleware, projectRoutes);
app.use('/api/macro', apiKeyMiddleware, macroRoutes);
app.use('/api/scoring', apiKeyMiddleware, scoringRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', apiKeyMiddleware, analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/schedule', apiKeyMiddleware, scheduleRoutes);
app.use('/api/verification', apiKeyMiddleware, verificationRoutes);
app.use('/api/asset-classes', apiKeyMiddleware, assetClassRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler(logger));

// ── Start Server ─────────────────────────────────────────────────
async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    // Start scheduler (unless disabled)
    if (process.env.ENABLE_SCHEDULER !== 'false') {
      startScheduler();
    }

    app.listen(PORT, () => {
      logger.info(`LEVEL Platform API running on port ${PORT}`);
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  stopScheduler();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});

export default app;
