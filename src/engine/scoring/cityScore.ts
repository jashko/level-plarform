/**
 * УРОВЕНЬ 2: ГОРОД.
 *
 * Объединяет 5 подскоров (Demography, Economy, HousingMarket, Competition,
 * Infrastructure) и применяет macroMultiplier к рынку жилья.
 */

import { DEFAULT_SCORING_WEIGHTS, scoreToZone } from './config';
import { clamp, normalizePiecewise } from './normalize';
import type {
  CityCompetitionInputs,
  CityDemographyInputs,
  CityEconomyInputs,
  CityHousingMarketInputs,
  CityInfrastructureInputs,
  CityInputs,
  CityScoreBreakdown,
  CityScoreResult,
  ScoringWeights,
} from './types';

// ────────────────────────────────────────────────────────────────
// Подскоры
// ────────────────────────────────────────────────────────────────

export function calculateDemographyScore(inputs: CityDemographyInputs): number {
  const trendScore = normalizePiecewise(inputs.populationTrend5yPct, [
    [-10, 0],
    [-2, 30],
    [0, 50],
    [5, 80],
    [15, 100],
  ]);
  const ageScore = normalizePiecewise(inputs.shareAge25to45, [
    [0.15, 0],
    [0.25, 50],
    [0.35, 100],
  ]);
  const migrationScore = normalizePiecewise(inputs.migrationBalanceThousands, [
    [-20, 0],
    [0, 50],
    [10, 80],
    [50, 100],
  ]);
  return clamp(0.40 * trendScore + 0.35 * ageScore + 0.25 * migrationScore, 0, 100);
}

export function calculateEconomyScore(
  inputs: CityEconomyInputs,
  ruMedianSalary: number,
): number {
  const salaryRatio = inputs.avgSalary / Math.max(ruMedianSalary, 1);
  const salaryScore = normalizePiecewise(salaryRatio, [
    [0.7, 0],
    [1.0, 40],
    [1.5, 80],
    [2.0, 100],
  ]);
  const growthScore = normalizePiecewise(inputs.salaryGrowthYoY, [
    [-5, 0],
    [0, 30],
    [10, 70],
    [20, 100],
  ]);
  const industryScore = normalizePiecewise(inputs.highPaidIndustriesShare, [
    [0.05, 0],
    [0.15, 50],
    [0.30, 100],
  ]);
  const unemploymentScore = 100 -
    normalizePiecewise(inputs.unemploymentRate, [
      [2, 0],
      [5, 40],
      [10, 100],
    ]);
  return clamp(
    0.35 * salaryScore +
      0.25 * growthScore +
      0.25 * industryScore +
      0.15 * unemploymentScore,
    0,
    100,
  );
}

export function calculateHousingMarketScore(
  inputs: CityHousingMarketInputs,
  macroMultiplier: number,
): number {
  const dealsScore = normalizePiecewise(inputs.dealsGrowthYoY, [
    [-30, 0],
    [-10, 30],
    [0, 50],
    [10, 80],
    [25, 100],
  ]);
  const priceScore = normalizePiecewise(inputs.priceGrowthYoY, [
    [-5, 0],
    [0, 40],
    [10, 80],
    [20, 100],
  ]);
  // Темп поглощения: чем ниже, тем дефицитнее → выше балл.
  const absorptionScore = 100 -
    normalizePiecewise(inputs.monthsOfSupply, [
      [3, 0],
      [12, 50],
      [30, 100],
    ]);
  const raw = clamp(
    0.40 * dealsScore + 0.30 * priceScore + 0.30 * absorptionScore,
    0,
    100,
  );
  return clamp(raw * macroMultiplier, 0, 100);
}

export function calculateCompetitionScore(inputs: CityCompetitionInputs): number {
  // Используем долю топ-5 как proxy HHI: чем выше концентрация — тем сложнее войти.
  // top5=0.30 → благоприятно (фрагментированный рынок), top5=0.80 → концентрировано.
  let score = 100 -
    normalizePiecewise(inputs.top5MarketShare, [
      [0.20, 0],
      [0.50, 50],
      [0.80, 100],
    ]);
  // Федеральные игроки — конкуренция выше
  if (inputs.hasFederalPlayers) score -= 10;
  // Белые пятна в премиальном сегменте — это плюс
  if (inputs.hasWhiteSpaceBusinessClass) score += 15;
  return clamp(score, 0, 100);
}

export function calculateInfrastructureScore(
  inputs: CityInfrastructureInputs,
): number {
  // Диапазон расширен по реальным данным: от 45 га (Волгоград) до 822 га (Новосибирск).
  const krtScore = normalizePiecewise(inputs.krtProgramsHa, [
    [0, 0],
    [100, 30],
    [350, 65],
    [800, 100],
  ]);
  const infraBonus = inputs.hasMajorInfraProjects ? 30 : 0;
  const educationBonus = inputs.hasUniversitiesOrTechparks ? 15 : 0;
  return clamp(krtScore * 0.55 + infraBonus + educationBonus, 0, 100);
}

// ────────────────────────────────────────────────────────────────
// Главная функция
// ────────────────────────────────────────────────────────────────

export interface CityScoreContext {
  /** macroMultiplier (0..1+) — каскад с уровня 1. */
  macroMultiplier: number;
  /** Медианная зарплата по РФ, ₽. */
  ruMedianSalary: number;
}

export function calculateCityScore(
  inputs: CityInputs,
  context: CityScoreContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): CityScoreResult {
  const w = weights.city;

  const breakdown: CityScoreBreakdown = {
    demographyScore: calculateDemographyScore(inputs.demography),
    economyScore: calculateEconomyScore(inputs.economy, context.ruMedianSalary),
    housingMarketScore: calculateHousingMarketScore(
      inputs.housing,
      context.macroMultiplier,
    ),
    competitionScore: calculateCompetitionScore(inputs.competition),
    infrastructureScore: calculateInfrastructureScore(inputs.infrastructure),
  };

  const cityScore = clamp(
    w.demography * breakdown.demographyScore +
      w.economy * breakdown.economyScore +
      w.housing * breakdown.housingMarketScore +
      w.competition * breakdown.competitionScore +
      w.infrastructure * breakdown.infrastructureScore,
    0,
    100,
  );

  return {
    cityName: inputs.name,
    region: inputs.region,
    breakdown,
    cityScore,
    zone: scoreToZone(cityScore),
    summary: generateCitySummary(inputs.name, breakdown, cityScore),
  };
}

// ────────────────────────────────────────────────────────────────
// Авто-резюме (по шаблону из ТЗ)
// ────────────────────────────────────────────────────────────────

function describe(score: number, options: [string, string, string]): string {
  if (score >= 70) return options[0]!;
  if (score >= 45) return options[1]!;
  return options[2]!;
}

function generateCitySummary(
  name: string,
  b: CityScoreBreakdown,
  total: number,
): string {
  const demand = describe(b.housingMarketScore, ['высокий', 'средний', 'низкий']);
  const competition = describe(b.competitionScore, [
    'низкую',
    'среднюю',
    'высокую',
  ]);
  const economy = describe(b.economyScore, ['растущую', 'стабильную', 'слабую']);
  const verdict = total >= 75
    ? 'приоритетный кандидат для запуска'
    : total >= 60
      ? 'требует детального анализа'
      : total >= 40
        ? 'высокий риск — заходить выборочно'
        : 'не рекомендуется';

  return (
    `Город ${name} показывает ${demand} спрос, ${competition} конкуренцию, ` +
    `${economy} экономику. Композитный балл ${total.toFixed(0)}/100 — ${verdict}.`
  );
}
