/**
 * Публичный API модуля finance.
 *
 *   import { runFinancialModel, DEFAULT_FINANCING_PARAMS, type ProjectInputs }
 *     from '@/engine/finance';
 */

export type {
  Scenario,
  HousingClass,
  ProjectInputs,
  ProjectFinanceParams,
  ScenarioAdjustments,
  VolumeBreakdown,
  RevenueBreakdown,
  CapexBreakdown,
  MonthlyCashFlow,
  ScenarioResult,
  SensitivityCell,
  SensitivityTable,
  SensitivityVariable,
  SuccessProbInputs,
  FinancialModelOutput,
} from './types';

export { runScenario, runFinancialModel, type RunModelOptions } from './engine';
export { calculateNPV, calculateIRR } from './financialMetrics';
export { calculateSuccessProb, normalizeIrrToScore } from './successProb';
export {
  SCENARIO_ADJUSTMENTS,
  SENSITIVITY_DELTAS,
  IRR_NORMALIZATION,
  SUCCESS_PROB_WEIGHTS,
  SUCCESS_PROB_PENALTIES,
  DEFAULT_FINANCING_PARAMS,
  getDefaultFinancingParams,
} from './config';
