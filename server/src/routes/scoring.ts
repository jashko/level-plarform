import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, redis } from '../index.js';
import { AppError } from '../middleware/errors.js';

export const scoringRoutes = Router();

// ── Validation Schemas ───────────────────────────────────────────
const CalculateScoreSchema = z.object({
  cityKey: z.string(),
  macroSnapshotId: z.string().uuid().optional(),
});

const BatchScoreSchema = z.object({
  cityKeys: z.array(z.string()).optional(), // all if empty
  macroSnapshotId: z.string().uuid().optional(),
});

// ── POST /api/scoring/calculate — Calculate city score ───────────
scoringRoutes.post('/calculate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityKey, macroSnapshotId } = CalculateScoreSchema.parse(req.body);

    const city = await prisma.city.findUnique({ where: { key: cityKey } });
    if (!city) {
      throw new AppError(404, `City '${cityKey}' not found`);
    }

    // Get latest macro snapshot
    const macroSnapshot = macroSnapshotId
      ? await prisma.macroSnapshot.findUnique({ where: { id: macroSnapshotId } })
      : await prisma.macroSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } });

    if (!macroSnapshot) {
      throw new AppError(404, 'No macro data available');
    }

    // Calculate score (simplified — in production, import from engine)
    const score = calculateCityScore(city, macroSnapshot);

    // Save
    const cityScore = await prisma.cityScore.create({
      data: {
        cityId: city.id,
        macroSnapshotId: macroSnapshot.id,
        cityScore: score.cityScore,
        zone: score.zone,
        breakdown: score.breakdown,
        summary: score.summary,
      },
    });

    res.json(cityScore);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/scoring/batch — Batch calculate scores ─────────────
scoringRoutes.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cityKeys, macroSnapshotId } = BatchScoreSchema.parse(req.body);

    const macroSnapshot = macroSnapshotId
      ? await prisma.macroSnapshot.findUnique({ where: { id: macroSnapshotId } })
      : await prisma.macroSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } });

    if (!macroSnapshot) {
      throw new AppError(404, 'No macro data available');
    }

    const cities = cityKeys?.length
      ? await prisma.city.findMany({ where: { key: { in: cityKeys } } })
      : await prisma.city.findMany();

    const results = [];
    for (const city of cities) {
      const score = calculateCityScore(city, macroSnapshot);
      const cityScore = await prisma.cityScore.create({
        data: {
          cityId: city.id,
          macroSnapshotId: macroSnapshot.id,
          cityScore: score.cityScore,
          zone: score.zone,
          breakdown: score.breakdown,
          summary: score.summary,
        },
      });
      results.push({ cityKey: city.key, ...cityScore });
    }

    // Sort by score descending
    results.sort((a, b) => b.cityScore - a.cityScore);

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/scoring/ranking — Get city ranking ──────────────────
scoringRoutes.get('/ranking', async (_req: Request, res: Response) => {
  const cacheKey = 'scoring:ranking';
  const cached = await redis.get(cacheKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  // Get latest score for each city
  const cities = await prisma.city.findMany({
    include: {
      scores: {
        orderBy: { calculatedAt: 'desc' },
        take: 1,
      },
    },
  });

  const ranking = cities
    .filter(c => c.scores.length > 0)
    .map(c => ({
      key: c.key,
      name: c.name,
      region: c.region,
      cityScore: c.scores[0].cityScore,
      zone: c.scores[0].zone,
      breakdown: c.scores[0].breakdown,
    }))
    .sort((a, b) => b.cityScore - a.cityScore);

  await redis.setex(cacheKey, 300, JSON.stringify(ranking));
  res.json(ranking);
});

// ── Helper: Calculate City Score ─────────────────────────────────
function calculateCityScore(city: any, macro: any): any {
  // Simplified scoring — in production, import from engine
  const macroMultiplier = macro.scores?.[0]?.macroMultiplier ?? 0.5;

  const demographyScore = Math.min(100, Math.max(0,
    (city.populationTrend5yPct + 5) * 10 +
    city.shareAge25to45 * 200 +
    (city.migrationBalanceThousands + 10) * 2
  ));

  const economyScore = Math.min(100, Math.max(0,
    (city.avgSalary / 64000) * 40 +
    city.salaryGrowthYoY * 3 +
    city.highPaidIndustriesShare * 200 +
    (10 - city.unemploymentRate) * 5
  ));

  const housingMarketScore = Math.min(100, Math.max(0,
    (city.dealsGrowthYoY + 30) * 1.5 +
    city.priceGrowthYoY * 4 +
    (30 - city.monthsOfSupply) * 2
  )) * macroMultiplier;

  const competitionScore = Math.min(100, Math.max(0,
    (1 - city.top5MarketShare) * 100 +
    (city.hasFederalPlayers ? -10 : 0) +
    (city.hasWhiteSpaceBusinessClass ? 15 : 0)
  ));

  const infrastructureScore = Math.min(100, Math.max(0,
    (city.krtProgramsHa / 800) * 55 +
    (city.hasMajorInfraProjects ? 30 : 0) +
    (city.hasUniversitiesOrTechparks ? 15 : 0)
  ));

  // Weighted average
  const cityScore = Math.min(100, Math.max(0,
    0.25 * demographyScore +
    0.25 * economyScore +
    0.30 * housingMarketScore +
    0.10 * competitionScore +
    0.10 * infrastructureScore
  ));

  const zone = cityScore >= 75 ? 'green' : cityScore >= 55 ? 'orange' : cityScore >= 40 ? 'yellow' : 'red';

  const summary = `City ${city.name} scores ${cityScore.toFixed(0)}/100 — ${zone} zone.`;

  return {
    cityScore,
    zone,
    breakdown: { demographyScore, economyScore, housingMarketScore, competitionScore, infrastructureScore },
    summary,
  };
}
