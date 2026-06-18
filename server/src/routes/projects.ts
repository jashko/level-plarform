import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, redis } from '../index.js';
import { AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { runFinancialModel } from '../services/financialEngine.js';

export const projectRoutes = Router();

// ── Validation Schemas ───────────────────────────────────────────
const CreateProjectSchema = z.object({
  cityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  landAreaHa: z.number().positive(),
  allowedDensityM2PerHa: z.number().positive(),
  sellableRatio: z.number().min(0).max(1),
  averageUnitSizeM2: z.number().positive(),
  housingClass: z.enum(['comfort', 'business']).default('business'),
  basePricePerM2: z.number().positive(),
  landCost: z.number().min(0),
  constructionCostPerM2: z.number().positive(),
  infrastructureCost: z.number().min(0),
  marketingShare: z.number().min(0).max(1),
  constructionMonths: z.number().positive(),
  discountRateAnnual: z.number().positive(),
  salesVelocityM2PerMonth: z.number().positive(),
  salesStartMonth: z.number().positive(),
  equityShare: z.number().min(0).max(1),
  pfBaseRateAnnual: z.number().positive(),
  pfEscrowCoveredRateAnnual: z.number().positive(),
  escrowReleaseLagMonths: z.number().min(0),
  escrowCoverageDiscount: z.number().min(0).max(1),
  escrowDiscountActivationProgress: z.number().min(0).max(1),
  pfCommitmentFeeAnnual: z.number().min(0),
  pfCommittedLineMultiplier: z.number().positive(),
  escrowMidReleasePct: z.number().min(0).max(1),
  escrowMidReleaseProgressPct: z.number().min(0).max(1),
  dduCancellationRatePct: z.number().min(0).max(100).optional(),
  workingCapitalPct: z.number().min(0).max(100).optional(),
  opexPctOfConstructionAnnual: z.number().min(0).max(100).optional(),
  propertyTaxPct: z.number().min(0).max(100).optional(),
  seasonalityEnabled: z.boolean().default(true),
  projectStartCalendarMonth: z.number().min(1).max(12).default(3),
  corpTaxRatePct: z.number().min(0).max(100).optional(),
  annualPriceGrowthPct: z.number().min(0).max(100).optional(),
  annualCostInflationPct: z.number().min(0).max(100).optional(),
});

const RunModelSchema = z.object({
  projectId: z.string().uuid(),
  successProbContext: z.object({
    cityScore: z.number(),
    districtScore: z.number().optional(),
    siteScore: z.number().optional(),
    redRiskCount: z.number().optional(),
    confidenceScore: z.number().optional(),
  }).optional(),
});

// ── GET /api/projects — List projects ────────────────────────────
projectRoutes.get('/', async (req: Request, res: Response) => {
  const { cityId, status } = req.query;

  const where: any = {};
  if (cityId) where.cityId = cityId as string;
  if (status) where.status = status as string;

  const projects = await prisma.project.findMany({
    where,
    include: {
      city: {
        select: { key: true, name: true, region: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  res.json(projects);
});

// ── GET /api/projects/:id — Get project ──────────────────────────
projectRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        city: true,
        scenarios: true,
        sensitivityResults: true,
        monteCarloResults: true,
      },
    });

    if (!project) {
      throw new AppError(404, 'Project not found');
    }

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/projects — Create project ──────────────────────────
projectRoutes.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = CreateProjectSchema.parse(req.body);

    // Verify city exists
    const city = await prisma.city.findUnique({ where: { id: body.cityId } });
    if (!city) {
      throw new AppError(404, 'City not found');
    }

    const project = await prisma.project.create({
      data: body,
      include: { city: { select: { key: true, name: true } } },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        entityType: 'project',
        entityId: project.id,
        action: 'create',
        newValue: body,
        userId: req.userId,
      },
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/projects/:id — Update project ───────────────────────
projectRoutes.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const body = CreateProjectSchema.partial().parse(req.body);

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Project not found');
    }

    const updated = await prisma.project.update({
      where: { id },
      data: body,
    });

    // Audit
    const changes = Object.entries(body).filter(([k, v]) => (existing as any)[k] !== v);
    for (const [field, newValue] of changes) {
      await prisma.auditLog.create({
        data: {
          entityType: 'project',
          entityId: id,
          action: 'update',
          field,
          oldValue: (existing as any)[field],
          newValue,
          userId: req.userId,
        },
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/projects/:id — Delete project ────────────────────
projectRoutes.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Project not found');
    }

    await prisma.project.delete({ where: { id } });

    // Audit
    await prisma.auditLog.create({
      data: {
        entityType: 'project',
        entityId: id,
        action: 'delete',
        oldValue: existing,
        userId: req.userId,
      },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── POST /api/projects/run — Run financial model ─────────────────
projectRoutes.post('/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, successProbContext } = RunModelSchema.parse(req.body);

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { city: true },
    });

    if (!project) {
      throw new AppError(404, 'Project not found');
    }

    // Build ProjectInputs from DB
    const inputs = {
      landAreaHa: project.landAreaHa,
      allowedDensityM2PerHa: project.allowedDensityM2PerHa,
      sellableRatio: project.sellableRatio,
      averageUnitSizeM2: project.averageUnitSizeM2,
      housingClass: project.housingClass as 'comfort' | 'business',
      basePricePerM2: project.basePricePerM2,
      landCost: project.landCost,
      constructionCostPerM2: project.constructionCostPerM2,
      infrastructureCost: project.infrastructureCost,
      marketingShare: project.marketingShare,
      constructionMonths: project.constructionMonths,
      discountRateAnnual: project.discountRateAnnual,
      salesVelocityM2PerMonth: project.salesVelocityM2PerMonth,
      salesStartMonth: project.salesStartMonth,
      financing: {
        equityShare: project.equityShare,
        pfBaseRateAnnual: project.pfBaseRateAnnual,
        pfEscrowCoveredRateAnnual: project.pfEscrowCoveredRateAnnual,
        escrowReleaseLagMonths: project.escrowReleaseLagMonths,
        escrowCoverageDiscount: project.escrowCoverageDiscount,
        escrowDiscountActivationProgress: project.escrowDiscountActivationProgress,
        pfCommitmentFeeAnnual: project.pfCommitmentFeeAnnual,
        pfCommittedLineMultiplier: project.pfCommittedLineMultiplier,
        escrowMidReleasePct: project.escrowMidReleasePct,
        escrowMidReleaseProgressPct: project.escrowMidReleaseProgressPct,
      },
      dduCancellationRatePct: project.dduCancellationRatePct ?? undefined,
      workingCapitalPct: project.workingCapitalPct ?? undefined,
      opexPctOfConstructionAnnual: project.opexPctOfConstructionAnnual ?? undefined,
      propertyTaxPct: project.propertyTaxPct ?? undefined,
      seasonalityEnabled: project.seasonalityEnabled,
      projectStartCalendarMonth: project.projectStartCalendarMonth,
      corpTaxRatePct: project.corpTaxRatePct ?? undefined,
      annualPriceGrowthPct: project.annualPriceGrowthPct ?? undefined,
      annualCostInflationPct: project.annualCostInflationPct ?? undefined,
    };

    // Run the financial model
    const result = runFinancialModel(inputs, { successProbContext });

    // Save scenarios
    await prisma.scenario.deleteMany({ where: { projectId } });
    for (const [scenarioType, scenarioResult] of Object.entries(result.scenarios)) {
      await prisma.scenario.create({
        data: {
          projectId,
          scenarioType,
          result: scenarioResult as any,
        },
      });
    }

    // Save sensitivity
    await prisma.sensitivityResult.deleteMany({ where: { projectId } });
    for (const table of result.sensitivity) {
      await prisma.sensitivityResult.create({
        data: {
          projectId,
          variable: table.variable,
          cells: table.cells as any,
        },
      });
    }

    // Save Monte Carlo
    await prisma.monteCarloResult.deleteMany({ where: { projectId } });
    await prisma.monteCarloResult.create({
      data: {
        projectId,
        iterations: result.monteCarlo.iterations,
        result: result.monteCarlo as any,
      },
    });

    // Update project
    await prisma.project.update({
      where: { id: projectId },
      data: {
        lastRunAt: new Date(),
        lastRunResult: result as any,
      },
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/projects/:id/history — Get calculation history ──────
projectRoutes.get('/:id/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const scenarios = await prisma.scenario.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit as string) || 10,
    });

    res.json(scenarios);
  } catch (err) {
    next(err);
  }
});
