import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, redis } from '../index.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';

export const cityRoutes = Router();

// ── Validation Schemas ───────────────────────────────────────────
const CityUpdateSchema = z.object({
  name: z.string().optional(),
  region: z.string().optional(),
  populationThousands: z.number().positive().optional(),
  populationTrend5yPct: z.number().optional(),
  shareAge25to45: z.number().min(0).max(1).optional(),
  migrationBalanceThousands: z.number().optional(),
  avgSalary: z.number().positive().optional(),
  salaryGrowthYoY: z.number().optional(),
  highPaidIndustriesShare: z.number().min(0).max(1).optional(),
  unemploymentRate: z.number().min(0).max(100).optional(),
  dealsGrowthYoY: z.number().optional(),
  priceGrowthYoY: z.number().optional(),
  monthsOfSupply: z.number().positive().optional(),
  businessClassPricePerM2: z.number().positive().optional(),
  monthlySalesM2: z.number().positive().optional(),
  annualDduCount: z.number().positive().optional(),
  constructionVolumeMkdThousM2: z.number().positive().optional(),
  sellReadinessRatioPct: z.number().min(0).max(150).optional(),
  unsoldYearsOfSupply: z.number().positive().optional(),
  activeDevelopers: z.number().int().positive().optional(),
  top5MarketShare: z.number().min(0).max(1).optional(),
  hasFederalPlayers: z.boolean().optional(),
  hasWhiteSpaceBusinessClass: z.boolean().optional(),
  krtProgramsHa: z.number().min(0).optional(),
  krtProjectsCount: z.number().int().min(0).optional(),
  hasMajorInfraProjects: z.boolean().optional(),
  hasUniversitiesOrTechparks: z.boolean().optional(),
  constructionNormativePerTotalM2: z.number().positive().optional(),
  avgUnitSizeM2: z.number().positive().optional(),
  landRevenuePct: z.number().min(0).max(100).optional(),
  infraCostPerTotalM2: z.number().min(0).optional(),
  sources: z.array(z.string()).optional(),
  needsVerification: z.array(z.string()).optional(),
});

// ── GET /api/cities — List all cities ────────────────────────────
cityRoutes.get('/', async (_req: Request, res: Response) => {
  const cacheKey = 'cities:list';
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  const cities = await prisma.city.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      key: true,
      name: true,
      region: true,
      country: true,
      businessClassPricePerM2: true,
      avgSalary: true,
      populationThousands: true,
      dataAsOfDate: true,
    },
  });

  await redis.setex(cacheKey, 300, JSON.stringify(cities)); // 5 min cache
  res.json(cities);
});

// ── GET /api/cities/:key — Get city details ──────────────────────
cityRoutes.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const city = await prisma.city.findUnique({
      where: { key },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
        },
        scores: {
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!city) {
      throw new AppError(404, `City '${key}' not found`);
    }

    res.json(city);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/cities/:key — Update city ───────────────────────────
cityRoutes.put('/:key', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const body = CityUpdateSchema.parse(req.body);

    const existing = await prisma.city.findUnique({ where: { key } });
    if (!existing) {
      throw new AppError(404, `City '${key}' not found`);
    }

    // Create version snapshot before update
    const lastVersion = await prisma.cityVersion.findFirst({
      where: { cityId: existing.id },
      orderBy: { version: 'desc' },
    });

    await prisma.cityVersion.create({
      data: {
        cityId: existing.id,
        version: (lastVersion?.version ?? 0) + 1,
        snapshot: existing as any,
        createdBy: req.userId || 'api',
      },
    });

    // Apply updates
    const updated = await prisma.city.update({
      where: { key },
      data: {
        ...body,
        dataAsOfDate: new Date(),
      },
    });

    // Audit log
    const changes = Object.entries(body).filter(([k, v]) => (existing as any)[k] !== v);
    for (const [field, newValue] of changes) {
      await prisma.auditLog.create({
        data: {
          entityType: 'city',
          entityId: existing.id,
          action: 'update',
          field,
          oldValue: (existing as any)[field],
          newValue,
          userId: req.userId,
        },
      });
    }

    // Invalidate cache
    await redis.del('cities:list');
    await redis.del(`city:${key}`);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/cities/:key/versions — Version history ──────────────
cityRoutes.get('/:key/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.params;
    const city = await prisma.city.findUnique({ where: { key } });
    if (!city) {
      throw new AppError(404, `City '${key}' not found`);
    }

    const versions = await prisma.cityVersion.findMany({
      where: { cityId: city.id },
      orderBy: { version: 'desc' },
      take: parseInt(req.query.limit as string) || 20,
    });

    res.json(versions);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/cities/:key/rollback/:version — Rollback to version ─
cityRoutes.post('/:key/rollback/:version', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { key, version } = req.params;

    const city = await prisma.city.findUnique({ where: { key } });
    if (!city) {
      throw new AppError(404, `City '${key}' not found`);
    }

    const targetVersion = await prisma.cityVersion.findFirst({
      where: {
        cityId: city.id,
        version: parseInt(version),
      },
    });

    if (!targetVersion) {
      throw new AppError(404, `Version ${version} not found`);
    }

    const snapshot = targetVersion.snapshot as any;

    // Create version of current state
    const lastVersion = await prisma.cityVersion.findFirst({
      where: { cityId: city.id },
      orderBy: { version: 'desc' },
    });

    await prisma.cityVersion.create({
      data: {
        cityId: city.id,
        version: (lastVersion?.version ?? 0) + 1,
        snapshot: city as any,
        comment: `Rollback to version ${version}`,
        createdBy: req.userId || 'api',
      },
    });

    // Apply rollback
    const { id: _id, createdAt: _ca, updatedAt: _ua, versions: _v, scores: _s, projects: _p, ...rest } = snapshot;
    const updated = await prisma.city.update({
      where: { key },
      data: rest,
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        entityType: 'city',
        entityId: city.id,
        action: 'rollback',
        oldValue: { version: lastVersion?.version },
        newValue: { version: parseInt(version) },
        userId: req.userId,
      },
    });

    await redis.del('cities:list');
    await redis.del(`city:${key}`);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});
