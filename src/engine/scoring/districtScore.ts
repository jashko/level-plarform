/**
 * УРОВЕНЬ 3: РАЙОН.
 */

import { DEFAULT_SCORING_WEIGHTS, scoreToZone } from './config';
import { clamp, normalizePiecewise } from './normalize';
import type {
  DistrictInputs,
  DistrictScoreBreakdown,
  DistrictScoreResult,
  ScoringWeights,
} from './types';

export function calculateAccessScore(inputs: DistrictInputs): number {
  const timeScore = 100 -
    normalizePiecewise(inputs.travelTimeToCenterMin, [
      [5, 0],
      [25, 50],
      [60, 100],
    ]);
  const metroBonus = inputs.hasMetro ? 25 : 0;
  return clamp(timeScore + metroBonus, 0, 100);
}

export function calculateSocialInfraScore(inputs: DistrictInputs): number {
  return normalizePiecewise(inputs.socialFacilitiesPer1000, [
    [0.5, 0],
    [2.0, 50],
    [5.0, 100],
  ]);
}

export function calculateUrbanQualityScore(inputs: DistrictInputs): number {
  const walkability = clamp(inputs.walkabilityIndex, 0, 100);
  const parkBonus = inputs.hasParksOrWaterfront ? 25 : 0;
  return clamp(walkability * 0.7 + parkBonus, 0, 100);
}

export function calculateLocalMarketScore(
  inputs: DistrictInputs,
  cityAvgPricePerM2: number,
): number {
  const priceRatio = inputs.localPricePerM2 / Math.max(cityAvgPricePerM2, 1);
  const priceScore = normalizePiecewise(priceRatio, [
    [0.7, 30],
    [1.0, 60],
    [1.4, 90],
    [2.0, 100],
  ]);
  const dynamicsScore = normalizePiecewise(inputs.localPriceGrowthYoY, [
    [-5, 0],
    [5, 50],
    [15, 100],
  ]);
  // Чем больше прямых конкурентов — тем хуже
  const competitionPenalty = normalizePiecewise(inputs.directCompetitorsCount, [
    [0, 0],
    [5, 50],
    [15, 100],
  ]);
  return clamp(
    0.45 * priceScore + 0.35 * dynamicsScore + 0.20 * (100 - competitionPenalty),
    0,
    100,
  );
}

export function calculateAlignmentScore(inputs: DistrictInputs): number {
  return clamp(inputs.segmentAlignment * 100, 0, 100);
}

export interface DistrictScoreContext {
  /** Средняя цена м² по городу, ₽. */
  cityAvgPricePerM2: number;
}

export function calculateDistrictScore(
  inputs: DistrictInputs,
  context: DistrictScoreContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): DistrictScoreResult {
  const w = weights.district;
  const breakdown: DistrictScoreBreakdown = {
    accessScore: calculateAccessScore(inputs),
    socialInfraScore: calculateSocialInfraScore(inputs),
    urbanQualityScore: calculateUrbanQualityScore(inputs),
    localMarketScore: calculateLocalMarketScore(inputs, context.cityAvgPricePerM2),
    alignmentScore: calculateAlignmentScore(inputs),
  };

  const districtScore = clamp(
    w.access * breakdown.accessScore +
      w.socialInfra * breakdown.socialInfraScore +
      w.urbanQuality * breakdown.urbanQualityScore +
      w.localMarket * breakdown.localMarketScore +
      w.alignment * breakdown.alignmentScore,
    0,
    100,
  );

  return {
    districtName: inputs.name,
    cityName: inputs.cityName,
    breakdown,
    districtScore,
    zone: scoreToZone(districtScore),
  };
}
