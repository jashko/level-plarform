/**
 * УРОВЕНЬ 1: МАКРО.
 *
 * Возвращает MacroScore (0–100) и macroMultiplier для каскада к городу.
 */

import { DEFAULT_SCORING_WEIGHTS } from './config';
import { clamp, normalizePiecewise } from './normalize';
import type { MacroInputs, MacroScoreResult, ScoringWeights } from './types';

/**
 * MortgageAffordabilityIndex по формуле ТЗ:
 *   (Медианный доход * 12) / (Ставка ипотеки/100 * Цена м² * 50 м²)
 * Чем выше — тем доступнее ипотека.
 */
export function calculateMortgageAffordability(inputs: MacroInputs): number {
  // Эффективная ставка — взвешенная между рыночной и льготной (если есть)
  const effRate = inputs.preferentialMortgageRate !== null
    ? inputs.mortgageRateAnnual * (1 - inputs.mortgageShareOfDeals * 0.5) +
      inputs.preferentialMortgageRate * (inputs.mortgageShareOfDeals * 0.5)
    : inputs.mortgageRateAnnual;

  const denom = (effRate / 100) * inputs.medianPricePerM2Ru * 50;
  if (denom <= 0) return 0;
  const raw = (inputs.medianMonthlyIncomeRu * 12) / denom;

  // Нормализация: raw=0.05 → плохо (0), raw=0.30 → отлично (100).
  // Это эмпирический коридор: при ставке 17%, цене 130к, доходе 70к/мес
  // получаем raw ≈ 70000*12 / (0.17 * 130000 * 50) ≈ 0.76 — комфорт.
  return normalizePiecewise(raw, [
    [0.05, 0],
    [0.15, 30],
    [0.30, 70],
    [0.60, 100],
  ]);
}

/**
 * RealIncomeIndex: динамика реальных доходов за 3 года.
 * Принимает индекс относительно базового года (1.0 = без изменений).
 */
export function calculateRealIncomeIndex(inputs: MacroInputs): number {
  const changePct = (inputs.realIncomeIndex3yr - 1) * 100;
  // -10% → 0, 0% → 40, +10% → 80, +20% → 100
  return normalizePiecewise(changePct, [
    [-10, 0],
    [0, 40],
    [10, 80],
    [20, 100],
  ]);
}

/**
 * MacroRiskIndex: композит негативных факторов.
 * Чем выше — тем хуже (используется как 100 - x).
 */
export function calculateMacroRiskIndex(inputs: MacroInputs): number {
  // Высокая ключевая ставка
  const keyRatePenalty = normalizePiecewise(inputs.keyRateAnnual, [
    [5, 0],
    [10, 30],
    [16, 60],
    [22, 100],
  ]);
  // Высокая инфляция
  const inflationPenalty = normalizePiecewise(inputs.inflationYoY, [
    [3, 0],
    [6, 30],
    [12, 70],
    [20, 100],
  ]);
  // Падение реальных доходов
  const incomePenalty = inputs.realIncomeIndex3yr < 1
    ? normalizePiecewise((1 - inputs.realIncomeIndex3yr) * 100, [
        [0, 0],
        [5, 50],
        [15, 100],
      ])
    : 0;
  // Безработица
  const unemploymentPenalty = normalizePiecewise(inputs.unemploymentRate, [
    [2, 0],
    [5, 30],
    [10, 80],
    [15, 100],
  ]);

  return clamp(
    0.30 * keyRatePenalty +
      0.25 * inflationPenalty +
      0.25 * incomePenalty +
      0.20 * unemploymentPenalty,
    0,
    100,
  );
}

export function calculateMacroScore(
  inputs: MacroInputs,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): MacroScoreResult {
  const w = weights.macro;
  const mortgageAffordabilityIndex = calculateMortgageAffordability(inputs);
  const realIncomeIndex = calculateRealIncomeIndex(inputs);
  const macroRiskIndex = calculateMacroRiskIndex(inputs);

  const macroScore = clamp(
    w.mortgageAffordability * mortgageAffordabilityIndex +
      w.realIncome * realIncomeIndex +
      w.macroRisk * (100 - macroRiskIndex),
    0,
    100,
  );

  return {
    mortgageAffordabilityIndex,
    realIncomeIndex,
    macroRiskIndex,
    macroScore,
    macroMultiplier: macroScore / 100,
  };
}
