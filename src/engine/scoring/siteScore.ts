/**
 * УРОВЕНЬ 4: УЧАСТОК.
 */

import { DEFAULT_SCORING_WEIGHTS, scoreToZone } from './config';
import { clamp, normalizePiecewise } from './normalize';
import type {
  GoDecision,
  ScoringWeights,
  SiteInputs,
  SiteScoreBreakdown,
  SiteScoreResult,
} from './types';

export function calculateLegalScore(inputs: SiteInputs): number {
  let score = 100;
  if (inputs.ownershipStatus === 'encumbered') score -= 35;
  if (inputs.hasLegalDisputes) score -= 50;
  return clamp(score, 0, 100);
}

export function calculateTechScore(inputs: SiteInputs): number {
  // Достаточность мощностей
  const capacityRatio = inputs.electricityRequiredMw > 0
    ? inputs.electricityCapacityMw / inputs.electricityRequiredMw
    : 1;
  const capacityScore = normalizePiecewise(capacityRatio, [
    [0.5, 0],
    [1.0, 50],
    [1.5, 100],
  ]);
  // Близость к точкам подключения
  const utilityScore = 100 -
    normalizePiecewise(inputs.distanceToUtilitiesMeters, [
      [0, 0],
      [500, 50],
      [2000, 100],
    ]);
  // Ограничения
  let restrictions = 0;
  if (inputs.hasPowerLineRestriction) restrictions += 1;
  if (inputs.hasSanitaryZoneRestriction) restrictions += 1;
  if (inputs.hasProtectedAreaRestriction) restrictions += 1;
  const restrictionPenalty = restrictions * 15;

  return clamp(
    0.50 * capacityScore + 0.50 * utilityScore - restrictionPenalty,
    0,
    100,
  );
}

export function calculateSurroundingsScore(inputs: SiteInputs): number {
  const metroScore = 100 -
    normalizePiecewise(inputs.distanceToMetroMeters, [
      [200, 0],
      [800, 50],
      [3000, 100],
    ]);
  const schoolScore = 100 -
    normalizePiecewise(inputs.distanceToSchoolMeters, [
      [100, 0],
      [500, 50],
      [2000, 100],
    ]);
  const parkScore = 100 -
    normalizePiecewise(inputs.distanceToParkMeters, [
      [100, 0],
      [500, 50],
      [2000, 100],
    ]);
  const viewBonus = inputs.hasViewAdvantage ? 15 : 0;
  return clamp(
    0.40 * metroScore + 0.30 * schoolScore + 0.30 * parkScore + viewBonus,
    0,
    100,
  );
}

export function calculateMarketFitScore(inputs: SiteInputs): number {
  // Меньше прямых конкурентов = выше балл
  const competitionScore = 100 -
    normalizePiecewise(inputs.directCompetitorsNearby, [
      [0, 0],
      [3, 50],
      [10, 100],
    ]);
  return clamp(competitionScore, 0, 100);
}

export function calculateRawFinancialScore(inputs: SiteInputs): number {
  if (inputs.expectedCapex <= 0) return 0;
  const margin = (inputs.expectedRevenue - inputs.expectedCapex) / inputs.expectedCapex;
  // margin=0 → 0, margin=0.30 → 50, margin=1.0 → 100
  return normalizePiecewise(margin, [
    [-0.1, 0],
    [0.20, 40],
    [0.50, 75],
    [1.00, 100],
  ]);
}

function makeDecision(siteScore: number, breakdown: SiteScoreBreakdown): GoDecision {
  // Жёсткие блокеры по юридике или раннему чернову PnL
  if (breakdown.legalScore < 40) return 'no-go';
  if (breakdown.rawFinancialScore < 20) return 'no-go';
  if (siteScore >= 70) return 'go';
  if (siteScore >= 50) return 'soft-go';
  return 'no-go';
}

export function calculateSiteScore(
  inputs: SiteInputs,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): SiteScoreResult {
  const w = weights.site;
  const breakdown: SiteScoreBreakdown = {
    legalScore: calculateLegalScore(inputs),
    techScore: calculateTechScore(inputs),
    surroundingsScore: calculateSurroundingsScore(inputs),
    marketFitScore: calculateMarketFitScore(inputs),
    rawFinancialScore: calculateRawFinancialScore(inputs),
  };

  const siteScore = clamp(
    w.legal * breakdown.legalScore +
      w.tech * breakdown.techScore +
      w.surroundings * breakdown.surroundingsScore +
      w.marketFit * breakdown.marketFitScore +
      w.rawFinancial * breakdown.rawFinancialScore,
    0,
    100,
  );

  return {
    siteName: inputs.name,
    districtName: inputs.districtName,
    breakdown,
    siteScore,
    zone: scoreToZone(siteScore),
    decision: makeDecision(siteScore, breakdown),
  };
}
