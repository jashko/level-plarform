/**
 * Конфигурация сценарного движка. В проде — редактируемый JSON.
 */

import type {
  ProjectFinanceParams,
  Scenario,
  ScenarioAdjustments,
} from './types';

export const SCENARIO_ADJUSTMENTS: Record<Scenario, ScenarioAdjustments> = {
  base: {
    priceMultiplier: 1.0,
    costMultiplier: 1.0,
    salesVelocityMultiplier: 1.0,
    discountRateDelta: 0,
    pfRateDelta: 0,
  },
  optimistic: {
    priceMultiplier: 1.15,
    costMultiplier: 0.95,
    salesVelocityMultiplier: 1.30,
    discountRateDelta: -3,
    pfRateDelta: -2,
  },
  stress: {
    priceMultiplier: 0.85,
    costMultiplier: 1.15,
    salesVelocityMultiplier: 0.60,
    discountRateDelta: 3,
    pfRateDelta: 3,
  },
};

/** Параметры чувствительности (по ТЗ ±5/10/15%). */
export const SENSITIVITY_DELTAS: number[] = [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];

/** Пороги нормализации IRR для FinancialScore (0–100). */
export const IRR_NORMALIZATION = {
  floorPct: 15,
  ceilingPct: 40,
};

export const SUCCESS_PROB_WEIGHTS = {
  cityScore: 0.30,
  districtScore: 0.20,
  siteScore: 0.20,
  financialScore: 0.30,
};

export const SUCCESS_PROB_PENALTIES = {
  perRedRisk: 5,
  stressIrrNegative: 20,
  confidenceDivisor: 2,
};

/**
 * Дефолтные параметры проектного финансирования для крупного российского
 * девелопера (Сбер / ВТБ / ДОМ.РФ) при текущем уровне ставок.
 * Калиброваны для реалистичного IRR 22–28% в комфорт-классе.
 */
export const DEFAULT_FINANCING_PARAMS: ProjectFinanceParams = {
  equityShare: 0.20,
  pfBaseRateAnnual: 17,
  pfEscrowCoveredRateAnnual: 9,
  escrowReleaseLagMonths: 2,
  escrowCoverageDiscount: 0.70,
  escrowDiscountActivationProgress: 0.30,
  pfCommitmentFeeAnnual: 1.5,
  pfCommittedLineMultiplier: 1.0,
};
