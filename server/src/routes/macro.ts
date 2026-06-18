import { Router, Request, Response, NextFunction } from 'express';
import { prisma, redis } from '../index.js';
import { AppError } from '../middleware/errors.js';

export const macroRoutes = Router();

// ── GET /api/macro/latest — Get latest macro snapshot ────────────
macroRoutes.get('/latest', async (_req: Request, res: Response) => {
  const cacheKey = 'macro:latest';
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const snapshot = await prisma.macroSnapshot.findFirst({
    orderBy: { fetchedAt: 'desc' },
    include: {
      scores: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!snapshot) {
    throw new AppError(404, 'No macro data available');
  }

  await redis.setex(cacheKey, 600, JSON.stringify(snapshot)); // 10 min cache
  res.json(snapshot);
});

// ── GET /api/macro/history — Get macro history ───────────────────
macroRoutes.get('/history', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 30;

  const snapshots = await prisma.macroSnapshot.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: limit,
    include: {
      scores: true,
    },
  });

  res.json(snapshots);
});

// ── POST /api/macro/fetch — Trigger CBR fetch ────────────────────
macroRoutes.post('/fetch', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // This would trigger the CBR fetch script
    // For now, return a message
    res.json({
      message: 'CBR fetch triggered. Check /api/macro/latest for results.',
      triggeredAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
