import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { getAssetClasses, getRegions, getAssetClassByName, getRegionByCountry, validateAssetClassForRegion } from '../services/assetClasses.js';
import { AppError } from '../middleware/errors.js';

export const assetClassRoutes = Router();

// ── GET /api/asset-classes — List all asset classes ───────────────
assetClassRoutes.get('/', async (_req: Request, res: Response) => {
  const classes = await getAssetClasses();
  res.json(classes);
});

// ── GET /api/asset-classes/:name — Get asset class by name ───────
assetClassRoutes.get('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assetClass = await getAssetClassByName(req.params.name);
    if (!assetClass) {
      throw new AppError(404, `Asset class '${req.params.name}' not found`);
    }
    res.json(assetClass);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/regions — List all regions ───────────────────────────
assetClassRoutes.get('/regions', async (_req: Request, res: Response) => {
  const regions = await getRegions();
  res.json(regions);
});

// ── GET /api/regions/:countryCode — Get region by country ────────
assetClassRoutes.get('/regions/:countryCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const region = await getRegionByCountry(req.params.countryCode);
    if (!region) {
      throw new AppError(404, `Region '${req.params.countryCode}' not found`);
    }
    res.json(region);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/asset-classes/validate — Validate asset class for region
assetClassRoutes.post('/validate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { assetClassName, countryCode } = req.body;

    const assetClass = await getAssetClassByName(assetClassName);
    if (!assetClass) {
      throw new AppError(404, `Asset class '${assetClassName}' not found`);
    }

    const region = await getRegionByCountry(countryCode);
    if (!region) {
      throw new AppError(404, `Region '${countryCode}' not found`);
    }

    const validation = validateAssetClassForRegion(assetClass, region);

    res.json({
      assetClass: assetClass.name,
      region: region.name,
      ...validation,
    });
  } catch (err) {
    next(err);
  }
});
