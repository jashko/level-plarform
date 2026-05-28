/**
 * Публичный API модуля scoring.
 *
 *   import { calculateCityScore, calculateMacroScore, ... } from '@/engine/scoring';
 */

export type {
  MacroInputs,
  MacroScoreResult,
  CityInputs,
  CityScoreResult,
  CityScoreBreakdown,
  CityDemographyInputs,
  CityEconomyInputs,
  CityHousingMarketInputs,
  CityCompetitionInputs,
  CityInfrastructureInputs,
  DistrictInputs,
  DistrictScoreResult,
  DistrictScoreBreakdown,
  SiteInputs,
  SiteScoreResult,
  SiteScoreBreakdown,
  ScoreZone,
  GoDecision,
  ScoringWeights,
} from './types';

export { calculateMacroScore } from './macroScore';
export { calculateCityScore } from './cityScore';
export { calculateDistrictScore } from './districtScore';
export { calculateSiteScore } from './siteScore';
export type { CityScoreContext } from './cityScore';
export type { DistrictScoreContext } from './districtScore';

export {
  DEFAULT_SCORING_WEIGHTS,
  ZONE_THRESHOLDS,
  scoreToZone,
} from './config';
