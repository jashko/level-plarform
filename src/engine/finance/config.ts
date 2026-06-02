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
 * Возвращает параметры ПФ, откалиброванные под текущую ключевую ставку ЦБ.
 *
 * Реальная практика (Сбер/ВТБ/ДОМ.РФ, 2024–2026):
 *  - Базовая ставка ПФ ≈ КС + 2.0–2.5 п.п. (без эскроу-покрытия)
 *  - Льготная ставка ПФ при покрытии эскроу ≈ КС × 0.01% (символическая, по 214-ФЗ)
 *    На практике от 0.01% до 4% в зависимости от банка и условий
 *  - Equity share: бизнес-класс обычно 20–25% (банки требуют "кожу в игре")
 */
export function getDefaultFinancingParams(ks: number = 14.5): ProjectFinanceParams {
  // Базовая ставка ПФ = КС + маржа банка (~2.2 п.п. в нормальных условиях)
  const pfBaseRate = Math.round((ks + 2.2) * 10) / 10;
  // Льготная ставка при 100% покрытии эскроу: практика Сбер/ВТБ ≈ 0.1–5%
  // При высокой КС банки держат её чуть выше, при низкой — символическая
  const pfEscrowRate = ks > 16 ? 4.0 : ks > 12 ? 3.0 : 2.0;

  return {
    equityShare:                       0.20,
    pfBaseRateAnnual:                  pfBaseRate,
    pfEscrowCoveredRateAnnual:         pfEscrowRate,
    escrowReleaseLagMonths:            2,
    escrowCoverageDiscount:            0.70,
    escrowDiscountActivationProgress:  0.30,
    pfCommitmentFeeAnnual:             1.5,
    pfCommittedLineMultiplier:         1.0,
  };
}

/**
 * Дефолтные параметры при КС = 14.5% (актуально на июнь 2026).
 * Используется как начальное значение в UI до подгрузки актуальных данных.
 */
export const DEFAULT_FINANCING_PARAMS: ProjectFinanceParams = getDefaultFinancingParams(14.5);
