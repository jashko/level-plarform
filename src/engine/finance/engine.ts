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

  // Gross margin: выручка − стройка − инфраструктура (без процентов).
  const grossMargin =
    revenue.totalRevenue > 0
      ? ((revenue.totalRevenue - capex.construction - capex.infrastructure) /
          revenue.totalRevenue) *
        100
      : 0;

  // Net margin: учитывает CAPEX + проценты по ПФ.
  const netMargin =
    revenue.totalRevenue > 0
      ? ((revenue.totalRevenue - capex.total - totalPfInterest) /
          revenue.totalRevenue) *
        100
      : 0;

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
  if (scenarios.stress.irr !== null && scenarios.stress.irr < 0) {
    warnings.push(
      'IRR в стресс-сценарии отрицательный — рассмотрите Real Option: Abandon / Delay',
    );
  }
  if (scenarios.base.irr !== null && scenarios.base.irr < 15) {
    warnings.push('Базовый IRR < 15% — проект не пройдёт Stage 2 (Pre-Feasibility)');
  }
  if (scenarios.base.netMargin < 10) {
    warnings.push(
      'Чистая маржа базового сценария < 10% — низкая буферная зона по себестоимости',
    );
  }
  // Cover ratio: пиковый долг к equity > 5 = высокий риск covenant breach
  const coverRatio =
    scenarios.base.totalEquityDeployed > 0
      ? scenarios.base.peakPfBalance / scenarios.base.totalEquityDeployed
      : Infinity;
  if (coverRatio > 5) {
    warnings.push(
      `Пиковый ПФ / equity = ${coverRatio.toFixed(1)}× — увеличьте долю equity или поэтапный запуск`,
    );
  }
  const months = scenarios.base.totalProjectMonths;
  if (months > 72) {
    warnings.push(
      `Длительность проекта ${months} мес. — высокая чувствительность к ставке ЦБ`,
    );
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
