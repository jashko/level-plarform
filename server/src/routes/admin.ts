import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../index.js';
import { requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';

export const adminRoutes = Router();

// All admin routes require admin token
adminRoutes.use(requireRole('admin'));

// ── GET /api/admin/stats — Platform statistics ───────────────────
adminRoutes.get('/stats', async (_req: Request, res: Response) => {
  const [
    totalCities,
    totalProjects,
    totalScenarios,
    totalApiKeys,
    activeApiKeys,
    totalWebhooks,
    activeWebhooks,
    totalAlerts,
    unacknowledgedAlerts,
    recentAuditLogs,
  ] = await Promise.all([
    prisma.city.count(),
    prisma.project.count(),
    prisma.scenario.count(),
    prisma.apiKey.count(),
    prisma.apiKey.count({ where: { active: true } }),
    prisma.webhook.count(),
    prisma.webhook.count({ where: { active: true } }),
    prisma.alert.count(),
    prisma.alert.count({ where: { acknowledged: false } }),
    prisma.auditLog.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  res.json({
    cities: totalCities,
    projects: totalProjects,
    scenarios: totalScenarios,
    apiKeys: { total: totalApiKeys, active: activeApiKeys },
    webhooks: { total: totalWebhooks, active: activeWebhooks },
    alerts: { total: totalAlerts, unacknowledged: unacknowledgedAlerts },
    recentActivity: recentAuditLogs,
  });
});

// ── POST /api/admin/reset-api-usage — Reset monthly API usage ────
adminRoutes.post('/reset-api-usage', async (_req: Request, res: Response) => {
  await prisma.apiKey.updateMany({
    data: { usedThisMonth: 0 },
  });

  res.json({ message: 'API usage reset for all keys' });
});

// ── GET /api/admin/pipeline-runs — Data pipeline history ─────────
adminRoutes.get('/pipeline-runs', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const type = req.query.type as string;

  const where: any = {};
  if (type) where.type = type;

  const runs = await prisma.dataPipelineRun.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
  });

  res.json(runs);
});

// ── POST /api/admin/trigger-pipeline — Trigger data pipeline ──────
adminRoutes.post('/trigger-pipeline', async (req: Request, res: Response) => {
  const { type } = req.body;

  const run = await prisma.dataPipelineRun.create({
    data: {
      type: type || 'manual',
      status: 'running',
    },
  });

  // In production, this would queue a BullMQ job
  // For now, just return the run ID
  res.json({
    message: 'Pipeline triggered',
    runId: run.id,
    startedAt: run.startedAt,
  });
});

// ── GET /api/admin/health — System health ────────────────────────
adminRoutes.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbHealthy = true;
    const dbLatency = Date.now();

    res.json({
      status: 'healthy',
      database: { healthy: dbHealthy, latency: `${Date.now() - dbLatency}ms` },
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: { healthy: false, error: (err as Error).message },
    });
  }
});
