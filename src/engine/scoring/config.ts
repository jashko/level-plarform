/**
 * Конфигурация скоринга. Все веса — редактируемые (в проде через UI).
 */

import type { ScoreZone, ScoringWeights } from './types';

/** Веса по ТЗ. Сумма в каждом блоке = 1.0. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  macro: {
    mortgageAffordability: 0.40,
    realIncome: 0.35,
    macroRisk: 0.25,
  },
  city: {
    demography: 0.20,
    economy: 0.25,
    housing: 0.30,
    competition: 0.15,
    infrastructure: 0.10,
  },
  district: {
    access: 0.25,
    socialInfra: 0.20,
    urbanQuality: 0.20,
    localMarket: 0.20,
    alignment: 0.15,
  },
  site: {
    legal: 0.20,
    tech: 0.20,
    surroundings: 0.25,
    marketFit: 0.20,
    rawFinancial: 0.15,
  },
};

/** Пороги зон по ТЗ: 0–39 / 40–59 / 60–74 / 75–100. */
export const ZONE_THRESHOLDS = {
  yellow: 40,
  orange: 60,
  green: 75,
};

export function scoreToZone(score: number): ScoreZone {
  if (score >= ZONE_THRESHOLDS.green) return 'green';
  if (score >= ZONE_THRESHOLDS.orange) return 'orange';
  if (score >= ZONE_THRESHOLDS.yellow) return 'yellow';
  return 'red';
}
