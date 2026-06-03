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
  calculateRealOption,
  runMonteCarlo,
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

  const totalPfInterest =
    monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativePfInterest ?? 0;
  const peakPfBalance = monthlyCashFlow.reduce(
    (max, f) => Math.max(max, f.pfBalanceEnd),
    0,
  );
  const totalEquityDeployed =
    monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativeEquityDrawn ?? 0;

  // Фактическая выручка с учётом стадийного роста цены (sum реальных потоков).
  const actualTotalRevenue = monthlyCashFlow.reduce((s, f) => s + f.revenue, 0);
  // Фактический CAPEX с учётом строительной инфляции (sum реальных потоков).
  const actualTotalSpend = monthlyCashFlow.reduce((s, f) => s + f.totalSpend, 0);
  // Совокупные операционные расходы хвостового периода (содержание непроданных кв.)
  const totalOpex = monthlyCashFlow.reduce((s, f) => s + f.opexSpend, 0);

  // Gross margin: выручка − прямые затраты (без ПФ и опекс — отраслевой стандарт).
  const grossMargin =
    actualTotalRevenue > 0
      ? ((actualTotalRevenue - actualTotalSpend) / actualTotalRevenue) * 100
      : 0;

  // Чистая прибыль ДО налога: выручка − CAPEX − % ПФ − операционные расходы.
  const netProfitPreTax = actualTotalRevenue - actualTotalSpend - totalPfInterest - totalOpex;

  // Налог на прибыль (НК РФ гл. 25): 25% с 2025 для крупного бизнеса (20% для МСП).
  // База: max(0, выручка − затраты − % ПФ). Уплачивается через квартал после сдачи.
  const corpTaxRate = (inputs.corpTaxRatePct ?? 25) / 100;
  const corpTaxAmount = Math.max(0, netProfitPreTax) * corpTaxRate;

  // Добавляем налог как отток в квартал после завершения продаж.
  const lastFlowBeforeTax = monthlyCashFlow[monthlyCashFlow.length - 1];
  if (corpTaxAmount > 0 && lastFlowBeforeTax) {
    const taxMonth = lastFlowBeforeTax.month + 3;
    monthlyCashFlow.push({
      month: taxMonth,
      landSpend: 0, constructionSpend: 0, infraSpend: 0, marketingSpend: 0,
      totalSpend: 0, m2Sold: 0, cumulativeM2Sold: lastFlowBeforeTax.cumulativeM2Sold,
      revenue: 0, projectNetCashFlow: 0,
      equityDraw: 0, cumulativeEquityDrawn: totalEquityDeployed,
      pfDraw: 0, pfBalanceStart: 0, pfRateAnnualEffective: 0,
      pfInterestAccrued: 0, cumulativePfInterest: totalPfInterest,
      pfRepayment: 0, pfBalanceEnd: 0,
      escrowInflow: 0, escrowBalance: 0, escrowReleased: 0,
      directInflow: 0, opexSpend: 0,
      developerCashFlow: -corpTaxAmount,
      cumulativeDeveloperCashFlow: lastFlowBeforeTax.cumulativeDeveloperCashFlow - corpTaxAmount,
    });
  }

  // NPV и IRR вычисляются ПОСЛЕ добавления налога в cash flow.
  const npv = calculateNPV(monthlyCashFlow, effectiveDiscountRate);
  const irr = calculateIRR(monthlyCashFlow);

  // Net margin и ROE — после налога (то, что реально остаётся девелоперу).
  const netProfitAfterTax = netProfitPreTax - corpTaxAmount;
  const netMargin =
    actualTotalRevenue > 0
      ? (netProfitAfterTax / actualTotalRevenue) * 100
      : 0;

  const roe = totalEquityDeployed > 0
    ? (netProfitAfterTax / totalEquityDeployed) * 100
    : 0;

  // DSCR = эскроу в момент раскрытия / ПФ в момент раскрытия.
  // ≥1.0 — эскроу полностью закрывает ПФ; <0.70 — высокая зависимость от хвостовых продаж.
  const releaseFlow = monthlyCashFlow.find(f => f.escrowReleased > 0);
  const pfAtRelease = releaseFlow ? releaseFlow.pfRepayment + releaseFlow.pfBalanceEnd : 0;
  const dscr = pfAtRelease > 0 && releaseFlow
    ? releaseFlow.escrowReleased / pfAtRelease
    : null;

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
    actualTotalRevenue,
    corpTaxAmount,
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

  // LTV-ковенант: пиковый ПФ / (фактическая выручка × 0.7) > 0.85 = риск margin call
  const ltvRatio = base.actualTotalRevenue > 0
    ? base.peakPfBalance / (base.actualTotalRevenue * 0.70)
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

  if (base.dscr !== null && base.dscr < 0.70) {
    warnings.push(`Покрытие ПФ эскроу ${(base.dscr * 100).toFixed(0)}% < 70% — высокая зависимость от продаж после ввода. Ускорьте темп продаж или увеличьте equity`);
  }

  const months = base.totalProjectMonths;
  if (months > 60) {
    warnings.push(`Длительность проекта ${months} мес. > 5 лет — высокая чувствительность к ставке ЦБ`);
  }

  // Земля > 20% от фактической выручки — сигнал переплаты
  const landToRevenue = base.actualTotalRevenue > 0
    ? base.capex.land / base.actualTotalRevenue
    : 0;
  if (landToRevenue > 0.25) {
    warnings.push(`Стоимость земли ${(landToRevenue * 100).toFixed(0)}% от выручки > 25% — высокая. Норма для бизнес-класса: ≤15–20%`);
  }

  // Налог на прибыль > 15% от выручки — существенная нагрузка
  const taxToRevenue = base.actualTotalRevenue > 0
    ? base.corpTaxAmount / base.actualTotalRevenue
    : 0;
  if (taxToRevenue > 0.12) {
    warnings.push(`Налог на прибыль ${(taxToRevenue * 100).toFixed(1)}% от выручки — убедитесь в корректности ставки (крупный бизнес: 25%, МСП: 20%)`);
  }

  let successProb = 0;
  if (options.successProbContext) {
    successProb = calculateSuccessProb({
      ...options.successProbContext,
      irrBase: scenarios.base.irr ?? 0,
      irrStress: scenarios.stress.irr ?? 0,
    });
  }

  // Monte Carlo: 500 итераций для получения статистически обоснованного
  // распределения IRR. Заменяет эвристическую successProb на P(IRR ≥ 20%).
  const monteCarlo = runMonteCarlo(
    (inp, sc) => {
      const r = runScenario(inp, sc);
      return { irr: r.irr, npv: r.npv };
    },
    inputs,
    500,
  );

  // Обновляем successProb на основе Monte Carlo (P(IRR ≥ 20%) взвешенная).
  // Если был передан контекст скоров, используем гибрид: 50% MC, 50% scoring.
  if (options.successProbContext) {
    successProb = Math.round(0.5 * successProb + 0.5 * monteCarlo.probIrrAbove20Pct);
  } else {
    successProb = Math.round(monteCarlo.probIrrAbove20Pct);
  }

  // Real Option: опцион на задержку старта (2 года, Black-Scholes)
  const realOption = calculateRealOption(inputs, monteCarlo, scenarios.base);

  // Добавляем предупреждение, если опцион ценнее немедленного входа
  if (realOption.interpretation === 'wait') {
    warnings.push(
      `Real Option: опцион на задержку (${realOption.optionYears} года) стоит `
      + `${(realOption.delayOptionValueRub / 1e6).toFixed(0)} млн ₽ — `
      + `рынок может вознаградить терпение. Текущий NPV: ${(scenarios.base.npv / 1e6).toFixed(0)} млн ₽`
    );
  }

  return { scenarios, sensitivity, successProb, monteCarlo, realOption, warnings };
}
