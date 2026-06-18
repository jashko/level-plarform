import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../middleware/auth.js';
import { runPipeline } from '../services/dataPipeline.js';
import { getSchedulerStatus, startScheduler, stopScheduler } from '../services/scheduler.js';
import { validateAllCities } from '../services/validation.js';
import { AppError } from '../middleware/errors.js';

export const scheduleRoutes = Router();

// All schedule routes require admin
scheduleRoutes.use(requireRole('admin'));

// ── GET /api/schedule/status — Get scheduler status ──────────────
scheduleRoutes.get('/status', (_req: Request, res: Response) => {
  const status = getSchedulerStatus();
  res.json({
    status: 'running',
    jobs: status,
    uptime: process.uptime(),
  });
});

// ── POST /api/schedule/start — Start scheduler ───────────────────
scheduleRoutes.post('/start', (_req: Request, res: Response) => {
  startScheduler();
  res.json({ message: 'Scheduler started' });
});

// ── POST /api/schedule/stop — Stop scheduler ─────────────────────
scheduleRoutes.post('/stop', (_req: Request, res: Response) => {
  stopScheduler();
  res.json({ message: 'Scheduler stopped' });
});

// ── POST /api/schedule/run/:type — Run pipeline manually ─────────
scheduleRoutes.post('/run/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    const validTypes = ['cbr_fetch', 'city_update', 'validation'];

    if (!validTypes.includes(type)) {
      throw new AppError(400, `Invalid pipeline type. Valid types: ${validTypes.join(', ')}`);
    }

    const result = await runPipeline(type);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/schedule/validate — Run validation ─────────────────
scheduleRoutes.post('/validate', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await validateAllCities();
    res.json({
      message: 'Validation completed',
      ...result,
    });
  } catch (err) {
    next(err);
  }
});
