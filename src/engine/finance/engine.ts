/**
 * Публичный API финансового движка.
 * Орchestrates: volumes → revenue → capex → cashflow (с эскроу + ПФ) → NPV/IRR.
 */

import { SCENARIO_ADJUSTMENTS } from './config';
import {
  buildMonthlyCashFlow,
  calculateCapex,
  calculateRevenue,
  calculateVolumes,
} from './calculations';
import {
  buildSensitivity,
  calculateIRR,
  calculateNPV,
} from './financialMetrics';
import { calculateSuccessProb } from './successProb';
import type {
  FinancialModelOutput,
  ProjectInputs,
  Scenario,
  ScenarioResult,
  SuccessProbInputs,
} from './types';

export function runScenario(
  inputs: ProjectInputs,
  scenario: Scenario,
): ScenarioResult {
  const adj = SCENARIO_ADJUSTMENTS[scenario];

  const volumes = calculateVolumes(inputs);
  const revenue = calculateRevenue(inputs, volumes, scenario);
  const capex = calculateCapex(inputs, volumes, revenue.totalRevenue, scenario);
  const monthlyCashFlow = buildMonthlyCashFlow(
    inputs,
    volumes,
    revenue,
    capex,
    scenario,
  );

  const effectiveDiscountRate = inputs.discountRateAnnual + adj.discountRateDelta;
  const npv = calculateNPV(monthlyCashFlow, effectiveDiscountRate);
  const irr = calculateIRR(monthlyCashFlow);

  const totalPfInterest =
    monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativePfInterest ?? 0;
  const peakPfBalance = monthlyCashFlow.reduce(
    (max, f) => Math.max(max, f.pfBalanceEnd),
    0,
  );
  const totalEquityDeployed =
    monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativeEquityDrawn ?? 0;

  // Gross margin: выручка − все прямые затраты (земля + стройка + инфра + маркетинг).
  // Отраслевой стандарт: не включает финансовые расходы (проценты по ПФ).
  const grossMargin =
    revenue.totalRevenue > 0
      ? ((revenue.totalRevenue - capex.total) / revenue.totalRevenue) * 100
      : 0;

  // Net margin: учитывает CAPEX + проценты по ПФ (всё включено).
  const netMargin =
    revenue.totalRevenue > 0
      ? ((revenue.totalRevenue - capex.total - totalPfInterest) /
          revenue.totalRevenue) *
        100
      : 0;

  // ROE (Return on Equity): чистая прибыль / вложенный equity × 100%.
  // Ключевая метрика для девелопера: сколько заработал на каждый вложенный рубль.
  const netProfit = revenue.totalRevenue - capex.total - totalPfInterest;
  const roe = totalEquityDeployed > 0
    ? (netProfit / totalEquityDeployed) * 100
    : 0;

  // DSCR (Debt Service Coverage): макс. денежный поток проекта / пиковый ПФ.
  // >1.2 — норма, <1.0 — риск ковенантного нарушения.
  const maxMonthlyInflow = Math.max(
    ...monthlyCashFlow.map(f => f.directInflow + f.escrowReleased),
  );
  const dscr = peakPfBalance > 0 ? (netProfit / peakPfBalance) : null;

  const salesVelocity = inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier;
  const sellOutMonths = volumes.sellableM2 / Math.max(salesVelocity, 1);
  const totalProjectMonths = monthlyCashFlow.length - 1;

  return {
    scenario,
    volumes,
    revenue,
    capex,
    monthlyCashFlow,
    npv,
    irr,
    grossMargin,
    netMargin,
    roe,
    dscr,
    totalPfInterest,
    peakPfBalance,
    totalEquityDeployed,
    sellOutMonths,
    totalProjectMonths,
  };
}

export interface RunModelOptions {
  successProbContext?: Omit<SuccessProbInputs, 'irrBase' | 'irrStress'>;
}

export function runFinancialModel(
  inputs: ProjectInputs,
  options: RunModelOptions = {},
): FinancialModelOutput {
  const scenarios: Record<Scenario, ScenarioResult> = {
    base: runScenario(inputs, 'base'),
    optimistic: runScenario(inputs, 'optimistic'),
    stress: runScenario(inputs, 'stress'),
  };

  const sensitivity = buildSensitivity(inputs, (i, s) => {
    const r = runScenario(i, s);
    return { irr: r.irr, npv: r.npv };
  });

  const warnings: string[] = [];
  // ─── Warnings ─────────────────────────────────────────────────────
  const base = scenarios.base;

  if (base.irr !== null && base.irr < 0) {
    warnings.push('IRR отрицательный — проект убыточен в базовом сценарии');
  } else if (base.irr !== null && base.irr < 20) {
    warnings.push(`IRR ${base.irr.toFixed(1)}% < 20% — ниже порога для бизнес-класса. Норма: ≥20–25%`);
  }

  if (scenarios.stress.irr !== null && scenarios.stress.irr < 0) {
    warnings.push('IRR в стресс-сценарии отрицательный — рассмотрите Real Option: Delay/Abandon');
  }

  if (base.grossMargin < 20) {
    warnings.push(`Валовая маржа ${base.grossMargin.toFixed(1)}% < 20% — критически низкая. Проверьте цену или себестоимость`);
  } else if (base.grossMargin < 30) {
    warnings.push(`Валовая маржа ${base.grossMargin.toFixed(1)}% — допустимо, но без резерва на риски`);
  }

  if (base.netMargin < 10) {
    warnings.push(`Чистая маржа ${base.netMargin.toFixed(1)}% < 10% — низкая буферная зона`);
  }

  if (base.roe < 40) {
    warnings.push(`ROE ${base.roe.toFixed(1)}% < 40% — ниже отраслевого стандарта для бизнес-класса (норма: 40–80%)`);
  }

  // LTV-ковенант: пиковый ПФ / (выручка × 0.7) > 0.85 = риск margin call
  const ltvRatio = base.revenue.totalRevenue > 0
    ? base.peakPfBalance / (base.revenue.totalRevenue * 0.70)
    : Infinity;
  if (ltvRatio > 0.85) {
    warnings.push(`Пиковый LTV ${(ltvRatio * 100).toFixed(0)}% > 85% — риск ковенантного нарушения. Увеличьте equity или ускорьте продажи`);
  }

  const coverRatio = base.totalEquityDeployed > 0
    ? base.peakPfBalance / base.totalEquityDeployed
    : Infinity;
  if (coverRatio > 6) {
    warnings.push(`Пиковый ПФ / equity = ${coverRatio.toFixed(1)}× > 6 — слишком высокий левередж`);
  }

  if (base.dscr !== null && base.dscr < 1.2) {
    warnings.push(`DSCR ${base.dscr.toFixed(2)} < 1.2 — недостаточное покрытие долга. Банк может потребовать доп. обеспечение`);
  }

  const months = base.totalProjectMonths;
  if (months > 60) {
    warnings.push(`Длительность проекта ${months} мес. > 5 лет — высокая чувствительность к ставке ЦБ`);
  }

  // Земля > 20% от выручки — сигнал переплаты
  const landToRevenue = base.revenue.totalRevenue > 0
    ? base.capex.land / base.revenue.totalRevenue
    : 0;
  if (landToRevenue > 0.25) {
    warnings.push(`Стоимость земли ${(landToRevenue * 100).toFixed(0)}% от выручки > 25% — высокая. Норма для бизнес-класса: ≤15–20%`);
  }

  let successProb = 0;
  if (options.successProbContext) {
    successProb = calculateSuccessProb({
      ...options.successProbContext,
      irrBase: scenarios.base.irr ?? 0,
      irrStress: scenarios.stress.irr ?? 0,
    });
  }

  return { scenarios, sensitivity, successProb, warnings };
}
