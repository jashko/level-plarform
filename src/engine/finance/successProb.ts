/**
 * Расчёт вероятности успеха проекта (SuccessProb).
 *
 * SuccessProb = (взвешенный композит скоров) − штрафы.
 *
 * Это упрощённая proxy-оценка по композитному баллу.
 * В следующей итерации заменим/дополним на P(IRR > порог) из Monte Carlo
 * на ключевые входы (цена, темп, себестоимость, ставка) с матрицей корреляций.
 */

import {
  IRR_NORMALIZATION,
  SUCCESS_PROB_PENALTIES,
  SUCCESS_PROB_WEIGHTS,
} from './config';
import type { SuccessProbInputs } from './types';

/**
 * Нормализует IRR (в %, годовых) в шкалу 0–100.
 *  - IRR ≤ floor → 0
 *  - IRR ≥ ceiling → 100
 *  - линейная интерполяция между
 */
export function normalizeIrrToScore(irrPct: number): number {
  const { floorPct, ceilingPct } = IRR_NORMALIZATION;
  if (irrPct <= floorPct) return 0;
  if (irrPct >= ceilingPct) return 100;
  return ((irrPct - floorPct) / (ceilingPct - floorPct)) * 100;
}

export function calculateSuccessProb(inputs: SuccessProbInputs): number {
  const financialScore = normalizeIrrToScore(inputs.irrBase);

  const base =
    SUCCESS_PROB_WEIGHTS.cityScore * inputs.cityScore +
    SUCCESS_PROB_WEIGHTS.districtScore * inputs.districtScore +
    SUCCESS_PROB_WEIGHTS.siteScore * inputs.siteScore +
    SUCCESS_PROB_WEIGHTS.financialScore * financialScore;

  let penalties = 0;
  penalties += inputs.redRiskCount * SUCCESS_PROB_PENALTIES.perRedRisk;
  if (inputs.irrStress < 0) penalties += SUCCESS_PROB_PENALTIES.stressIrrNegative;
  if (inputs.confidenceScore < 50) {
    penalties += (50 - inputs.confidenceScore) / SUCCESS_PROB_PENALTIES.confidenceDivisor;
  }

  return clamp(base - penalties, 0, 100);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
