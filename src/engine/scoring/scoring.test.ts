/**
 * Тесты модуля scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMacroScore,
  calculateCityScore,
  calculateDistrictScore,
  calculateSiteScore,
  scoreToZone,
  type MacroInputs,
  type CityInputs,
  type DistrictInputs,
  type SiteInputs,
} from './index';
import { normalizeMinMax, normalizePiecewise, clamp } from './normalize';

// ─────────────────────────────────────────────────────────────
describe('normalize utilities', () => {
  it('normalizeMinMax: 0/50/100 на границах', () => {
    expect(normalizeMinMax(0, 0, 100)).toBe(0);
    expect(normalizeMinMax(50, 0, 100)).toBe(50);
    expect(normalizeMinMax(100, 0, 100)).toBe(100);
  });
  it('normalizeMinMax: клиппинг за границы', () => {
    expect(normalizeMinMax(-10, 0, 100)).toBe(0);
    expect(normalizeMinMax(150, 0, 100)).toBe(100);
  });
  it('normalizePiecewise линейно интерполирует', () => {
    expect(normalizePiecewise(5, [[0, 0], [10, 100]])).toBe(50);
    expect(normalizePiecewise(7.5, [[0, 0], [10, 100]])).toBe(75);
  });
  it('normalizePiecewise работает с 3+ якорями', () => {
    const v = normalizePiecewise(15, [[0, 0], [10, 50], [20, 100]]);
    expect(v).toBe(75);
  });
  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(20, 0, 10)).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
const goodMacro: MacroInputs = {
  keyRateAnnual: 10,
  mortgageRateAnnual: 12,
  preferentialMortgageRate: 8,
  mortgageShareOfDeals: 0.6,
  inflationYoY: 4,
  realIncomeIndex3yr: 1.10,
  unemploymentRate: 3.5,
  medianMonthlyIncomeRu: 65_000,
  medianPricePerM2Ru: 150_000,
};

const badMacro: MacroInputs = {
  keyRateAnnual: 20,
  mortgageRateAnnual: 22,
  preferentialMortgageRate: null,
  mortgageShareOfDeals: 0.3,
  inflationYoY: 15,
  realIncomeIndex3yr: 0.92,
  unemploymentRate: 8,
  medianMonthlyIncomeRu: 55_000,
  medianPricePerM2Ru: 180_000,
};

describe('calculateMacroScore', () => {
  it('возвращает все компоненты в [0;100]', () => {
    const r = calculateMacroScore(goodMacro);
    expect(r.macroScore).toBeGreaterThanOrEqual(0);
    expect(r.macroScore).toBeLessThanOrEqual(100);
    expect(r.mortgageAffordabilityIndex).toBeGreaterThanOrEqual(0);
    expect(r.realIncomeIndex).toBeGreaterThanOrEqual(0);
  });

  it('благоприятный макро даёт выше балл чем неблагоприятный', () => {
    expect(calculateMacroScore(goodMacro).macroScore).toBeGreaterThan(
      calculateMacroScore(badMacro).macroScore,
    );
  });

  it('macroMultiplier ≈ macroScore / 100', () => {
    const r = calculateMacroScore(goodMacro);
    expect(r.macroMultiplier).toBeCloseTo(r.macroScore / 100, 5);
  });
});

// ─────────────────────────────────────────────────────────────
const sampleCity: CityInputs = {
  name: 'Казань',
  region: 'Республика Татарстан',
  demography: {
    populationThousands: 1300,
    populationTrend5yPct: 3,
    shareAge25to45: 0.30,
    migrationBalanceThousands: 8,
  },
  economy: {
    avgSalary: 72_000,
    salaryGrowthYoY: 12,
    highPaidIndustriesShare: 0.18,
    unemploymentRate: 3.2,
  },
  housing: {
    dealsGrowthYoY: 5,
    priceGrowthYoY: 8,
    monthsOfSupply: 9,
    businessClassPricePerM2: 265_000,
    monthlySalesM2: 60_000,
  },
  competition: {
    activeDevelopers: 25,
    top5MarketShare: 0.55,
    hasFederalPlayers: true,
    hasWhiteSpaceBusinessClass: true,
  },
  infrastructure: {
    krtProgramsHa: 150,
    hasMajorInfraProjects: true,
    hasUniversitiesOrTechparks: true,
  },
};

describe('calculateCityScore', () => {
  const macro = calculateMacroScore(goodMacro);
  const result = calculateCityScore(sampleCity, {
    macroMultiplier: macro.macroMultiplier,
    ruMedianSalary: 65_000,
  });

  it('возвращает балл в [0;100] и зону', () => {
    expect(result.cityScore).toBeGreaterThanOrEqual(0);
    expect(result.cityScore).toBeLessThanOrEqual(100);
    expect(['red', 'yellow', 'orange', 'green']).toContain(result.zone);
  });

  it('breakdown содержит 5 подскоров, каждый в [0;100]', () => {
    const b = result.breakdown;
    expect(Object.keys(b).length).toBe(5);
    for (const v of Object.values(b)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('генерирует summary с именем города', () => {
    expect(result.summary).toContain('Казань');
    expect(result.summary.length).toBeGreaterThan(40);
  });

  it('плохой макро снижает HousingMarketScore', () => {
    const badMulti = calculateMacroScore(badMacro).macroMultiplier;
    const goodMulti = macro.macroMultiplier;
    const badResult = calculateCityScore(sampleCity, {
      macroMultiplier: badMulti,
      ruMedianSalary: 65_000,
    });
    expect(badResult.breakdown.housingMarketScore).toBeLessThan(
      result.breakdown.housingMarketScore,
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe('scoreToZone', () => {
  it('красная зона < 40', () => {
    expect(scoreToZone(0)).toBe('red');
    expect(scoreToZone(39.9)).toBe('red');
  });
  it('жёлтая 40–59', () => {
    expect(scoreToZone(40)).toBe('yellow');
    expect(scoreToZone(59)).toBe('yellow');
  });
  it('оранжевая 60–74', () => {
    expect(scoreToZone(60)).toBe('orange');
    expect(scoreToZone(74)).toBe('orange');
  });
  it('зелёная ≥ 75', () => {
    expect(scoreToZone(75)).toBe('green');
    expect(scoreToZone(100)).toBe('green');
  });
});

// ─────────────────────────────────────────────────────────────
const sampleDistrict: DistrictInputs = {
  name: 'Ново-Савиновский',
  cityName: 'Казань',
  travelTimeToCenterMin: 20,
  hasMetro: true,
  socialFacilitiesPer1000: 3.2,
  hasParksOrWaterfront: true,
  walkabilityIndex: 65,
  localPricePerM2: 180_000,
  localPriceGrowthYoY: 10,
  directCompetitorsCount: 3,
  segmentAlignment: 0.85,
};

describe('calculateDistrictScore', () => {
  const result = calculateDistrictScore(sampleDistrict, {
    cityAvgPricePerM2: 165_000,
  });

  it('даёт балл в [0;100] и зону', () => {
    expect(result.districtScore).toBeGreaterThanOrEqual(0);
    expect(result.districtScore).toBeLessThanOrEqual(100);
    expect(result.cityName).toBe('Казань');
  });

  it('метро повышает access score', () => {
    const noMetro = calculateDistrictScore(
      { ...sampleDistrict, hasMetro: false },
      { cityAvgPricePerM2: 165_000 },
    );
    expect(result.breakdown.accessScore).toBeGreaterThan(noMetro.breakdown.accessScore);
  });

  it('конкуренция снижает локальный балл', () => {
    const highComp = calculateDistrictScore(
      { ...sampleDistrict, directCompetitorsCount: 15 },
      { cityAvgPricePerM2: 165_000 },
    );
    expect(highComp.breakdown.localMarketScore).toBeLessThan(
      result.breakdown.localMarketScore,
    );
  });
});

// ─────────────────────────────────────────────────────────────
const sampleSite: SiteInputs = {
  name: 'Участок А',
  districtName: 'Ново-Савиновский',
  areaHa: 2.5,
  ownershipStatus: 'clean',
  hasLegalDisputes: false,
  electricityCapacityMw: 8,
  electricityRequiredMw: 6,
  distanceToUtilitiesMeters: 200,
  hasPowerLineRestriction: false,
  hasSanitaryZoneRestriction: false,
  hasProtectedAreaRestriction: false,
  distanceToMetroMeters: 600,
  distanceToSchoolMeters: 300,
  distanceToParkMeters: 400,
  hasViewAdvantage: true,
  expectedRevenue: 7_000_000_000,
  expectedCapex: 5_200_000_000,
  directCompetitorsNearby: 2,
};

describe('calculateSiteScore', () => {
  const result = calculateSiteScore(sampleSite);

  it('даёт балл, зону и go-decision', () => {
    expect(result.siteScore).toBeGreaterThanOrEqual(0);
    expect(result.siteScore).toBeLessThanOrEqual(100);
    expect(['go', 'soft-go', 'no-go']).toContain(result.decision);
  });

  it('юридический спор → legal=0 → no-go', () => {
    const disputed = calculateSiteScore({
      ...sampleSite,
      hasLegalDisputes: true,
      ownershipStatus: 'encumbered',
    });
    expect(disputed.breakdown.legalScore).toBeLessThan(40);
    expect(disputed.decision).toBe('no-go');
  });

  it('ограничения снижают tech score', () => {
    const restricted = calculateSiteScore({
      ...sampleSite,
      hasPowerLineRestriction: true,
      hasSanitaryZoneRestriction: true,
    });
    expect(restricted.breakdown.techScore).toBeLessThan(result.breakdown.techScore);
  });
});
