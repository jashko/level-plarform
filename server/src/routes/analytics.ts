import { Router, Request, Response } from 'express';
import { prisma, redis } from '../index.js';

export const analyticsRoutes = Router();

// ── GET /api/analytics/sensitivity — Sensitivity heatmap data ────
analyticsRoutes.get('/sensitivity', async (_req: Request, res: Response) => {
  const cacheKey = 'analytics:sensitivity';
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  // Get all projects with their last run results
  const projects = await prisma.project.findMany({
    where: { lastRunResult: { not: null } },
    include: {
      city: { select: { key: true, name: true } },
    },
  });

  const heatmap = projects.map(p => {
    const result = p.lastRunResult as any;
    return {
      projectKey: p.city.key,
      cityName: p.city.name,
      projectName: p.name,
      irrBase: result?.scenarios?.base?.irr ?? null,
      npvBase: result?.scenarios?.base?.npv ?? null,
      successProb: result?.successProb ?? null,
      warnings: result?.warnings ?? [],
    };
  });

  await redis.setex(cacheKey, 600, JSON.stringify(heatmap));
  res.json(heatmap);
});

// ── GET /api/analytics/trends — Time series of key metrics ───────
analyticsRoutes.get('/trends', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 90;

  // Macro snapshots over time
  const snapshots = await prisma.macroSnapshot.findMany({
    orderBy: { fetchedAt: 'desc' },
    take: limit,
    select: {
      fetchedAt: true,
      keyRateAnnual: true,
      mortgageRateAnnual: true,
      inflationYoY: true,
      scores: {
        select: { macroScore: true },
      },
    },
  });

  const trends = snapshots.map(s => ({
    date: s.fetchedAt,
    keyRate: s.keyRateAnnual,
    mortgageRate: s.mortgageRateAnnual,
    inflation: s.inflationYoY,
    macroScore: s.scores[0]?.macroScore ?? null,
  })).reverse();

  res.json(trends);
});

// ── GET /api/analytics/alerts — Get recent alerts ────────────────
analyticsRoutes.get('/alerts', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const unacknowledgedOnly = req.query.unacknowledged === 'true';

  const where: any = {};
  if (unacknowledgedOnly) where.acknowledged = false;

  const alerts = await prisma.alert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(alerts);
});

// ── POST /api/analytics/alerts/:id/acknowledge ───────────────────
analyticsRoutes.post('/alerts/:id/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.alert.update({
      where: { id: req.params.id },
      data: { acknowledged: true },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/analytics/usage — API usage stats ───────────────────
analyticsRoutes.get('/usage', async (_req: Request, res: Response) => {
  const totalProjects = await prisma.project.count();
  const totalRuns = await prisma.scenario.groupBy({
    by: ['projectId'],
    _count: true,
  });
  const totalApiKeys = await prisma.apiKey.count({ where: { active: true } });

  // Recent activity
  const recentProjects = await prisma.project.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      name: true,
      lastRunAt: true,
      city: { select: { name: true } },
    },
  });

  res.json({
    totalProjects,
    totalApiKeys,
    totalCalculations: totalRuns.reduce((sum, r) => sum + r._count, 0),
    recentProjects,
  });
});

// ── GET /api/analytics/audit — Audit log ─────────────────────────
analyticsRoutes.get('/audit', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const entityType = req.query.entityType as string;
  const entityId = req.query.entityId as string;

  const where: any = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(logs);
});
