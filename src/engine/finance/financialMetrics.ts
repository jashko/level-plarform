/**
 * NPV, IRR, sensitivity. Считаются от developerCashFlow (потока к застройщику),
 * а не от unlevered project CF — поэтому учитывают эскроу и ПФ.
 */

import { SENSITIVITY_DELTAS } from './config';
import type {
  MonteCarloResult,
  MonthlyCashFlow,
  ProjectInputs,
  RealOptionResult,
  ScenarioResult,
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
// Monte Carlo с корреляциями (разложение Холецкого)
// ────────────────────────────────────────────────────────────────

/**
 * Box-Muller: стандартное нормальное N(0,1).
 */
function normalRandom(): number {
  const u1 = Math.max(1e-15, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Генерирует 4 коррелированных N(0,1) через нижнетреугольную матрицу Холецкого L
 * корреляционной матрицы переменных (цена, себестоимость, темп продаж, ставка ПФ).
 *
 * Матрица корреляций Σ (откалибрована по РФ рынку недвижимости):
 *   ρ(цена, себестоимость)  = +0.30  (инфляция бьёт по обоим)
 *   ρ(цена, темп продаж)    = +0.60  (горячий рынок → и цена выше, и продаётся быстрее)
 *   ρ(цена, ставка ПФ)      = −0.20  (высокая ставка → ниже цены из-за доступности)
 *   ρ(себестоимость, темп)  = −0.10  (слабая)
 *   ρ(себестоимость, ПФ)    = +0.10  (слабая)
 *   ρ(темп, ставка ПФ)      = −0.30  (высокая ставка → ипотека дороже → меньше покупателей)
 *
 * Разложение Холецкого L вычислено аналитически и захардкожено.
 */
function correlatedNormals(): [number, number, number, number] {
  // Независимые N(0,1)
  const u1 = normalRandom();
  const u2 = normalRandom();
  const u3 = normalRandom();
  const u4 = normalRandom();

  // L — нижнетреугольная матрица Холецкого (L×Lᵀ = Σ)
  // [0]: цена, [1]: себестоимость, [2]: темп продаж, [3]: ставка ПФ
  const zPrice    = 1.00000 * u1;
  const zCost     = 0.30000 * u1 + 0.95394 * u2;
  const zVelocity = 0.60000 * u1 - 0.29350 * u2 + 0.74421 * u3;
  const zPfRate   =-0.20000 * u1 + 0.16773 * u2 - 0.17571 * u3 + 0.94923 * u4;

  return [zPrice, zCost, zVelocity, zPfRate];
}

/**
 * Monte Carlo: 500 итераций с КОРРЕЛИРОВАННЫМИ нормальными отклонениями.
 * Корреляции устраняют нереалистичные сценарии (дешёвые квартиры + ажиотажный спрос).
 *
 * σ-параметры (историческая волатильность РФ рынка):
 *  цена: 12%, себестоимость: 10%, темп продаж: 20%, ставка ПФ: ±1.5 п.п.
 */
export function runMonteCarlo(
  runner: ScenarioRunner,
  inputs: ProjectInputs,
  iterations = 500,
): MonteCarloResult {
  const irrs: number[] = [];
  const npvs: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const [zP, zC, zV, zR] = correlatedNormals();

    const p: ProjectInputs = {
      ...inputs,
      financing: { ...inputs.financing },
      basePricePerM2:          Math.max(10_000, inputs.basePricePerM2          * (1 + zP * 0.12)),
      constructionCostPerM2:   Math.max(50_000, inputs.constructionCostPerM2   * (1 + zC * 0.10)),
      salesVelocityM2PerMonth: Math.max(50,     inputs.salesVelocityM2PerMonth * (1 + zV * 0.20)),
    };
    p.financing.pfBaseRateAnnual = Math.max(4, inputs.financing.pfBaseRateAnnual + zR * 1.5);

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

// ────────────────────────────────────────────────────────────────
// Real Options (Black-Scholes / Merton)
// ────────────────────────────────────────────────────────────────

/**
 * Функция распределения стандартного нормального закона.
 * Аппроксимация Абрамовица–Стегана, ошибка < 7.5×10⁻⁸.
 */
function normalCDF(x: number): number {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = k * (0.319381530 + k * (-0.356563782 + k * (1.781477937
             + k * (-1.821255978 + k * 1.330274429))));
  const phi = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const p = 1 - phi * poly;
  return x >= 0 ? p : 1 - p;
}

/**
 * Расчёт реального опциона на ЗАДЕРЖКУ старта проекта (European call, Black-Scholes).
 *
 * Смысл: сколько стоит право НЕ НАЧИНАТЬ сейчас, а подождать до T лет
 * и принять решение, когда рыночная ситуация прояснится.
 *
 * Если opcionValue > NPV_сейчас: рациональнее подождать.
 * Если NPV_сейчас > opcionValue × 0.8: входить немедленно.
 */
export function calculateRealOption(
  inputs: ProjectInputs,
  mc: MonteCarloResult,
  base: ScenarioResult,
  optionYears = 2,
): RealOptionResult {
  // КС ≈ ставка ПФ − 2.2 п.п. (маржа банка), но не меньше 5%
  const ks = Math.max(5, inputs.financing.pfBaseRateAnnual - 2.2);
  const riskFreeRate = ks / 100;

  // S = текущая рыночная стоимость актива (что застройщик мог бы продать СЕГОДНЯ,
  // если бы объект был уже построен) = выручка по сегодняшним ценам.
  const S = base.actualTotalRevenue;

  // X = цена «входа» = суммарный CAPEX
  const X = base.capex.total;

  // σ (годовая) — волатильность стоимости актива.
  // Конвертируем σ(IRR) из Monte Carlo в σ(ln V):
  // σ_V ≈ σ(IRR)/100 / sqrt(T_project), ограничиваем снизу на 0.15.
  const projectYears = Math.max(1, base.totalProjectMonths / 12);
  const sigma = Math.max(0.15, (mc.stdDevIrrPct / 100) / Math.sqrt(projectYears));

  const T = optionYears;
  const sqrtT = Math.sqrt(T);

  const d1 = (Math.log(S / Math.max(X, 1)) + (riskFreeRate + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const callValue = S * normalCDF(d1) - X * Math.exp(-riskFreeRate * T) * normalCDF(d2);
  const delayOptionValueRub = Math.max(0, callValue);

  // Интерпретация по соотношению S/X (монейнесс) и знаку NPV.
  // Стоимость опциона ВСЕГДА ≥ max(0, S−Xe^{−rT}), поэтому сравнивать её с NPV напрямую неверно.
  // Правило Диксита-Пиндика: инвестировать оптимально при S/X > β/(β−1),
  //   где β = 0.5 + sqrt(0.25 + 2r/σ²).
  const npv = base.npv;
  const moneyness = S / Math.max(X, 1);
  const beta = 0.5 + Math.sqrt(0.25 + 2 * riskFreeRate / Math.max(sigma * sigma, 1e-6));
  const investThreshold = beta / (beta - 1); // критический S/X для немедленного входа

  let interpretation: 'invest_now' | 'wait' | 'borderline';
  if (npv > 0 && moneyness >= investThreshold * 0.95) {
    // Проект в деньгах и прибыльный — промедление обходится дороже
    interpretation = 'invest_now';
  } else if (npv < 0 || moneyness < 0.90) {
    // Проект убыточен или вне денег — опцион ценен как право подождать улучшения
    interpretation = 'wait';
  } else {
    // NPV положителен, но проект около порога — анализ чувствительности
    interpretation = 'borderline';
  }

  return { delayOptionValueRub, assetValueRub: S, strikeRub: X, sigma, riskFreeRate, optionYears, investThreshold, interpretation };
}
