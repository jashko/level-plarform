import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../middleware/auth.js';
import { runBacktest, prepareExcelExport } from '../services/backtesting.js';
import { generateProjectExport, generateCSV, generateModelCards } from '../services/excelExport.js';
import { AppError } from '../middleware/errors.js';

export const verificationRoutes = Router();

// ── GET /api/verification/backtest — Run backtest ────────────────
verificationRoutes.get('/backtest', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runBacktest();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/verification/export/:projectId — Export project to CSV
verificationRoutes.get('/export/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;

    const exportData = await generateProjectExport(projectId);
    const csv = generateCSV(exportData);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportData.filename}"`);
    res.send('\ufeff' + csv); // BOM for Excel compatibility
  } catch (err) {
    next(err);
  }
});

// ── GET /api/verification/model-cards — Get model cards ──────────
verificationRoutes.get('/model-cards', (_req: Request, res: Response) => {
  const cards = generateModelCards();
  res.json(cards);
});

// ── GET /api/verification/parameters — Get parameter documentation
verificationRoutes.get('/parameters', (_req: Request, res: Response) => {
  const parameters = [
    {
      name: 'businessClassPricePerM2',
      displayName: 'Цена м² бизнес-класс',
      description: 'Средняя цена квадратного метра в новостройках бизнес-класса',
      type: 'number',
      unit: '₽/m²',
      range: { min: 50000, max: 500000 },
      defaultValue: 200000,
      source: {
        name: 'bnMAP.pro',
        url: 'https://bnmap.pro',
        type: 'api',
      },
      lastUpdated: '2026-05-31',
      confidence: 'high',
      notes: 'Только бизнес-сегмент. Эконом класс не учитывается.',
    },
    {
      name: 'avgSalary',
      displayName: 'Средняя зарплата',
      description: 'Среднемесячная начисленная зарплата по городу',
      type: 'number',
      unit: '₽/мес',
      range: { min: 30000, max: 200000 },
      defaultValue: 70000,
      source: {
        name: 'Росстат',
        url: 'https://rosstat.gov.ru',
        type: 'government',
      },
      lastUpdated: '2026-05-31',
      confidence: 'high',
      notes: 'Данные по региону, могут отличаться от городских.',
    },
    {
      name: 'dealsGrowthYoY',
      displayName: 'Рост сделок ДДУ г/г',
      description: 'Рост объёма сделок новостроек год к году',
      type: 'number',
      unit: '%',
      range: { min: -100, max: 100 },
      defaultValue: 0,
      source: {
        name: 'Коммерсант',
        url: 'https://www.kommersant.ru',
        type: 'media',
      },
      lastUpdated: '2026-05-31',
      confidence: 'medium',
      notes: 'Может быть завышен в месяцы с низкой базой.',
    },
    {
      name: 'monthsOfSupply',
      displayName: 'Запас предложения',
      description: 'Число месяцев для реализации текущего объёма предложения',
      type: 'number',
      unit: 'месяцев',
      range: { min: 1, max: 36 },
      defaultValue: 12,
      source: {
        name: 'ЕИСЖС / ДОМ.РФ',
        url: 'https://xn--d1aqf.xn--p1ai',
        type: 'government',
      },
      lastUpdated: '2026-01-01',
      confidence: 'medium',
      notes: '<6 мес = дефицит, 6-12 = норма, >12 = избыток.',
    },
    {
      name: 'keyRateAnnual',
      displayName: 'Ключевая ставка ЦБ',
      description: 'Базовая процентная ставка ЦБ РФ',
      type: 'number',
      unit: '%',
      range: { min: 1, max: 30 },
      defaultValue: 14.5,
      source: {
        name: 'ЦБ РФ',
        url: 'https://www.cbr.ru',
        type: 'government',
        fetchMethod: 'automatic',
      },
      lastUpdated: 'Автоматически',
      confidence: 'high',
      notes: 'Обновляется в дни заседаний Совета директоров.',
    },
  ];

  res.json(parameters);
});
