/**
 * Главный оркестратор данных.
 *
 * Что делает:
 *   1. Тянет ставку ЦБ из открытого XML-фида (РЕАЛЬНО автоматически)
 *   2. Берёт остальной макро-снимок из снапшота
 *   3. Считает MacroScore
 *   4. Прогоняет 14 городов через CityScore с этим макро
 *   5. Возвращает ранжированный рейтинг
 *
 * Это то самое «автоматическое подтягивание данных», которое запускается
 * при загрузке главного экрана. Скорость: единицы миллисекунд после ЦБ.
 */

import {
  calculateCityScore, calculateMacroScore, type MacroInputs,
  calculateMarketCycle, calculateCityRiskProfile, calculateAffordability,
  type MarketCycleResult, type CityRiskProfile, type AffordabilityIndex,
} from '../engine/scoring';
import {
  RUSSIA_MILLION_CITIES,
  ALL_CITY_KEYS,
  CITY_COORDINATES,
  type CityDatasetEntry,
} from './cities';
import { fetchCbrSnapshot, type CbrSnapshot } from '../engine/datasources/cbr';
import agentOutputRaw from './agent-output.json';

// Поля из cityDataUpdates агента, которые маппятся на inputs города
const AGENT_FIELD_MAP: Record<string, string[]> = {
  businessClassPricePerM2:      ['housing', 'businessClassPricePerM2'],
  priceGrowthYoY:               ['housing', 'priceGrowthYoY'],
  monthsOfSupply:                ['housing', 'monthsOfSupply'],
  dealsGrowthYoY:               ['housing', 'dealsGrowthYoY'],
  constructionVolumeMkdThousM2: ['housing', 'constructionVolumeMkdThousM2'],
  monthlySalesM2:               ['housing', 'monthlySalesM2'],
  annualDduCount:               ['housing', 'annualDduCount'],
  sellReadinessRatioPct:        ['housing', 'sellReadinessRatioPct'],
  unsoldYearsOfSupply:          ['housing', 'unsoldYearsOfSupply'],
  avgSalary:                    ['economy', 'avgSalary'],
  salaryGrowthYoY:              ['economy', 'salaryGrowthYoY'],
  unemploymentRate:             ['economy', 'unemploymentRate'],
  krtProgramsHa:                ['infrastructure', 'krtProgramsHa'],
  migrationBalanceThousands:    ['demography', 'migrationBalanceThousands'],
  populationThousands:          ['demography', 'populationThousands'],
};

function applyAgentCityUpdates(entries: typeof RUSSIA_MILLION_CITIES): typeof RUSSIA_MILLION_CITIES {
  const agentData = agentOutputRaw as { cityDataUpdates?: Array<{ cityKey: string; updates: Record<string, number>; confidence: number }> };
  const updates = agentData?.cityDataUpdates;
  if (!updates || updates.length === 0) return entries;

  // Глубокая копия чтобы не мутировать импортированные данные
  const merged: typeof RUSSIA_MILLION_CITIES = JSON.parse(JSON.stringify(entries));

  for (const upd of updates) {
    const entry = merged[upd.cityKey as keyof typeof merged];
    if (!entry) continue;
    if (upd.confidence < 0.5) continue; // игнорируем низкую уверенность

    for (const [field, value] of Object.entries(upd.updates)) {
      const path = AGENT_FIELD_MAP[field];
      if (!path) continue;
      const [section, key] = path;
      const inputs = entry.inputs as Record<string, Record<string, number>>;
      if (inputs[section!]) {
        inputs[section!]![key!] = value;
      }
    }
  }

  return merged;
}

export interface CityRankingEntry {
  key: string;
  name: string;
  region: string;
  cityScore: number;
  zone: 'red' | 'yellow' | 'orange' | 'green';
  breakdown: {
    demographyScore: number;
    economyScore: number;
    housingMarketScore: number;
    competitionScore: number;
    infrastructureScore: number;
  };
  summary: string;
  coordinates: { lat: number; lng: number };
  dataAsOfDate: string;
  sources: string[];
  /** Полный набор inputs для дальнейшего использования (карточка города). */
  inputs: CityDatasetEntry['inputs'];
  needsVerification: string[];
  /** Позиция рынка в цикле и сигнал входа. */
  marketCycle: MarketCycleResult;
  /** Профиль рисков по 5 измерениям. */
  riskProfile: CityRiskProfile;
  /** Индекс доступности бизнес-класса. */
  affordability: AffordabilityIndex;
}

export interface RankingResult {
  cities: CityRankingEntry[];
  macroSnapshot: {
    keyRateAnnual: number;
    mortgageRateAnnual: number;
    mortgageRateSource: string;
    mortgageRateFetchedAt: string;
    preferentialMortgageRate: number | null;
    nextMeetingDate: string;
    asOfDate: string;
    source: string;
    fetchMethod: 'automatic' | 'manual';
    macroScore: number;
    macroMultiplier: number;
  };
  /** Время выполнения, мс. */
  durationMs: number;
}

const RU_MEDIAN_SALARY = 64_000;         // Росстат, медиана фев.2026 (нац. среднее 103 900)
const RU_MEDIAN_PRICE_PER_M2 = 158_648; // МИР КВАРТИР, I кв. 2026, 70 городов

/**
 * Главная функция — то самое «автоматически подтягивается».
 */
export async function buildCityRanking(): Promise<RankingResult> {
  const t0 = Date.now();

  // 1. ЦБ — единственный реально автоматический источник
  const cbr: CbrSnapshot = await fetchCbrSnapshot();

  // 2. Макро — собираем снимок
  const macroInputs: MacroInputs = {
    keyRateAnnual: cbr.keyRateAnnual,
    mortgageRateAnnual: cbr.mortgageRateAnnual,
    preferentialMortgageRate: cbr.preferentialMortgageRate,
    mortgageShareOfDeals: 0.76, // 76% сделок с ипотекой (охлаждение с 78%), апр.2026
    inflationYoY: 5.4,          // Росстат, май 2026: 5.36% (дезинфляция)
    realIncomeIndex3yr: 1.11,   // +11% за 3 года, Росстат янв.2026
    unemploymentRate: 3.2,
    medianMonthlyIncomeRu: RU_MEDIAN_SALARY,
    medianPricePerM2Ru: RU_MEDIAN_PRICE_PER_M2,
  };
  const macro = calculateMacroScore(macroInputs);

  // 3. Все города — мержим обновления от агента поверх базовых данных
  const CITIES_WITH_UPDATES = applyAgentCityUpdates(RUSSIA_MILLION_CITIES);

  const cities: CityRankingEntry[] = ALL_CITY_KEYS.map((key) => {
    const entry = CITIES_WITH_UPDATES[key]!;
    const score = calculateCityScore(entry.inputs, {
      macroMultiplier: macro.macroMultiplier,
      ruMedianSalary: RU_MEDIAN_SALARY,
    });
    return {
      key,
      name: score.cityName,
      region: score.region,
      cityScore: score.cityScore,
      zone: score.zone,
      breakdown: score.breakdown,
      summary: score.summary,
      coordinates: CITY_COORDINATES[key]!,
      dataAsOfDate: entry.meta.dataAsOfDate,
      sources: entry.meta.sources,
      inputs: entry.inputs,
      needsVerification: entry.meta.needsVerification,
      marketCycle:  calculateMarketCycle(entry.inputs),
      riskProfile:  calculateCityRiskProfile(entry.inputs),
      affordability: calculateAffordability(entry.inputs),
    };
  });

  // Сортировка по убыванию CityScore
  cities.sort((a, b) => b.cityScore - a.cityScore);

  return {
    cities,
    macroSnapshot: {
      keyRateAnnual: cbr.keyRateAnnual,
      mortgageRateAnnual: cbr.mortgageRateAnnual,
      mortgageRateSource: cbr.mortgageRateSource,
      mortgageRateFetchedAt: cbr.mortgageRateFetchedAt,
      preferentialMortgageRate: cbr.preferentialMortgageRate,
      nextMeetingDate: cbr.nextMeetingDate,
      asOfDate: cbr.asOfDate,
      source: cbr.source,
      fetchMethod: cbr.fetchMethod,
      macroScore: macro.macroScore,
      macroMultiplier: macro.macroMultiplier,
    },
    durationMs: Date.now() - t0,
  };
}
