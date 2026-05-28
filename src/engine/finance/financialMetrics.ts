/**
 * NPV, IRR, sensitivity. Считаются от developerCashFlow (потока к застройщику),
 * а не от unlevered project CF — поэтому учитывают эскроу и ПФ.
 */

import { SENSITIVITY_DELTAS } from './config';
import type {
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
