/**
 * NPV, IRR, sensitivity. Считаются от developerCashFlow (потока к застройщику),
 * а не от unlevered project CF — поэтому учитывают эскроу и ПФ.
 */

import { SENSITIVITY_DELTAS } from './config';
import type {
  MonteCarloResult,
  MonthlyCashFlow,
  ProjectInputs,
  Scenario,
  SensitivityCell,
  SensitivityTable,
  SensitivityVariable,
} from './types';

// ────────────────────────────────────────────────────────────────
// NPV
// ────────────────────────────────────────────────────────────────

export function calculateNPV(
  monthlyCashFlow: MonthlyCashFlow[],
  discountRateAnnualPct: number,
): number {
  const monthlyRate = discountRateAnnualPct / 100 / 12;
  return monthlyCashFlow.reduce(
    (npv, f) => npv + f.developerCashFlow / Math.pow(1 + monthlyRate, f.month),
    0,
  );
}

// ────────────────────────────────────────────────────────────────
// IRR — бисекция по месячной ставке, перевод в годовую
// ────────────────────────────────────────────────────────────────

export function calculateIRR(monthlyCashFlow: MonthlyCashFlow[]): number | null {
  const hasPositive = monthlyCashFlow.some((f) => f.developerCashFlow > 0);
  const hasNegative = monthlyCashFlow.some((f) => f.developerCashFlow < 0);
  if (!hasPositive || !hasNegative) return null;

  const npvAtMonthly = (r: number): number =>
    monthlyCashFlow.reduce(
      (s, f) => s + f.developerCashFlow / Math.pow(1 + r, f.month),
      0,
    );

  let lo = -0.05;
  let hi = 0.20;
  let npvLo = npvAtMonthly(lo);
  let npvHi = npvAtMonthly(hi);

  for (let i = 0; i < 6 && npvLo * npvHi > 0; i++) {
    lo = Math.max(-0.95, lo * 1.5 - 0.05);
    hi = Math.min(5.0, hi * 2);
    npvLo = npvAtMonthly(lo);
    npvHi = npvAtMonthly(hi);
  }
  if (npvLo * npvHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAtMonthly(mid);
    if (Math.abs(npvMid) < 1 || hi - lo < 1e-10) {
      return (Math.pow(1 + mid, 12) - 1) * 100;
    }
    if (npvLo * npvMid < 0) {
      hi = mid;
      npvHi = npvMid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

// ────────────────────────────────────────────────────────────────
// Sensitivity
// ────────────────────────────────────────────────────────────────

export type ScenarioRunner = (
  inputs: ProjectInputs,
  scenario: Scenario,
) => { irr: number | null; npv: number };

export function buildSensitivity(
  inputs: ProjectInputs,
  runner: ScenarioRunner,
): SensitivityTable[] {
  const variables: SensitivityVariable[] = [
    'pricePerM2',
    'constructionCost',
    'salesVelocity',
    'discountRate',
    'pfBaseRate',
  ];

  return variables.map((variable) => {
    const cells: SensitivityCell[] = SENSITIVITY_DELTAS.map((delta) => {
      const adjusted = applyDelta(inputs, variable, delta);
      const { irr, npv } = runner(adjusted, 'base');
      return { variable, delta, irr, npv };
    });
    return { variable, cells };
  });
}

function applyDelta(
  inputs: ProjectInputs,
  variable: SensitivityVariable,
  delta: number,
): ProjectInputs {
  const factor = 1 + delta;
  const copy: ProjectInputs = { ...inputs, financing: { ...inputs.financing } };
  switch (variable) {
    case 'pricePerM2':
      copy.basePricePerM2 *= factor;
      break;
    case 'constructionCost':
      copy.constructionCostPerM2 *= factor;
      break;
    case 'salesVelocity':
      copy.salesVelocityM2PerMonth *= factor;
      break;
    case 'discountRate':
      copy.discountRateAnnual *= factor;
      break;
    case 'pfBaseRate':
      copy.financing.pfBaseRateAnnual *= factor;
      break;
  }
  return copy;
}

// ────────────────────────────────────────────────────────────────
// Monte Carlo
// ────────────────────────────────────────────────────────────────

/**
 * Генератор нормально распределённой случайной величины (метод Бокса-Мюллера).
 * Возвращает стандартное нормальное: μ=0, σ=1.
 */
function normalRandom(): number {
  const u1 = Math.max(1e-15, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Симуляция Монте-Карло: 500 итераций с нормально распределёнными
 * отклонениями ключевых переменных от базовых значений.
 *
 * Распределения (σ выбраны по историческому РФ рынку):
 *  - Цена: σ = 12% (волатильность цен бизнес-класса)
 *  - Себестоимость: σ = 10% (строительная инфляция + риски подрядчика)
 *  - Скорость продаж: σ = 20% (наибольшая неопределённость)
 *  - Ставка ПФ: σ = 1.5 п.п. (зависит от ДКП ЦБ)
 */
export function runMonteCarlo(
  runner: ScenarioRunner,
  inputs: ProjectInputs,
  iterations = 500,
): MonteCarloResult {
  const irrs: number[] = [];
  const npvs: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const priceFactor      = 1 + normalRandom() * 0.12;
    const costFactor       = 1 + normalRandom() * 0.10;
    const velocityFactor   = 1 + normalRandom() * 0.20;
    const pfRateDeltaPp    = normalRandom() * 1.5;

    const p: ProjectInputs = {
      ...inputs,
      financing: { ...inputs.financing },
      basePricePerM2:         Math.max(10_000, inputs.basePricePerM2 * priceFactor),
      constructionCostPerM2:  Math.max(50_000, inputs.constructionCostPerM2 * costFactor),
      salesVelocityM2PerMonth: Math.max(50, inputs.salesVelocityM2PerMonth * velocityFactor),
    };
    p.financing.pfBaseRateAnnual = Math.max(4, inputs.financing.pfBaseRateAnnual + pfRateDeltaPp);

    const { irr, npv } = runner(p, 'base');
    if (irr !== null && isFinite(irr)) irrs.push(irr);
    npvs.push(npv);
  }

  const sorted = [...irrs].sort((a, b) => a - b);
  const n = sorted.length || 1;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;

  return {
    iterations,
    meanIrrPct:         mean,
    medianIrrPct:       sorted[Math.floor(n * 0.50)] ?? 0,
    p10IrrPct:          sorted[Math.floor(n * 0.10)] ?? 0,
    p90IrrPct:          sorted[Math.floor(n * 0.90)] ?? 0,
    stdDevIrrPct:       Math.sqrt(variance),
    probIrrAbove20Pct:  (sorted.filter(r => r >= 20).length / n) * 100,
    probIrrAbove25Pct:  (sorted.filter(r => r >= 25).length / n) * 100,
    probNpvPositivePct: (npvs.filter(v => v > 0).length / iterations) * 100,
  };
}
