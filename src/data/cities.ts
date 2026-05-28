/**
 * Датасет городов-миллионников РФ (кроме МСК/СПб).
 *
 * ИСТОЧНИКИ (на 28 мая 2026):
 * - Население: Росстат, на 1 января 2025
 * - Зарплаты: Росстат, январь-июнь 2025 (РИА Рейтинг октябрь 2025)
 * - businessClassPricePerM2: Циан / bnMAP.pro / Яндекс Недвижимость — медиана
 *   по ЖК бизнес-класса, янв-апр 2026. Данные только по бизнес-сегменту.
 * - Рост цен YoY: РБК / Коммерсант / RuNews24, по итогам 2025 (бизнес-класс где доступно)
 * - Объём сделок: bnMAP.pro / Циан, итоги 2025
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ: данные собраны вручную через открытые источники.
 * В продакшене заменяются на партнёрский API Дом.РФ + скрапер Росстата.
 */

import type { CityInputs } from '../engine/scoring';

export interface CityDatasetEntry {
  inputs: CityInputs;
  meta: {
    dataAsOfDate: string;
    sources: string[];
    needsVerification: string[];
  };
}

export const RUSSIA_MILLION_CITIES: Record<string, CityDatasetEntry> = {
  novosibirsk: {
    inputs: {
      name: 'Новосибирск',
      region: 'Новосибирская область',
      demography: { populationThousands: 1633.9, populationTrend5yPct: 2.1, shareAge25to45: 0.31, migrationBalanceThousands: 6.2 },
      economy: { avgSalary: 84_000, salaryGrowthYoY: 13.5, highPaidIndustriesShare: 0.19, unemploymentRate: 3.1 },
      housing: { dealsGrowthYoY: -4.0, priceGrowthYoY: 9.8, monthsOfSupply: 10, businessClassPricePerM2: 230_000, monthlySalesM2: 78_000 },
      competition: { activeDevelopers: 32, top5MarketShare: 0.48, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 220, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro Jan 2026', 'РИА Рейтинг 2025', 'Росстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  yekaterinburg: {
    inputs: {
      name: 'Екатеринбург',
      region: 'Свердловская область',
      demography: { populationThousands: 1580.1, populationTrend5yPct: 3.8, shareAge25to45: 0.32, migrationBalanceThousands: 9.1 },
      economy: { avgSalary: 92_000, salaryGrowthYoY: 14.2, highPaidIndustriesShare: 0.22, unemploymentRate: 2.8 },
      housing: { dealsGrowthYoY: 2.5, priceGrowthYoY: 12.1, monthsOfSupply: 8, businessClassPricePerM2: 265_000, monthlySalesM2: 92_000 },
      competition: { activeDevelopers: 28, top5MarketShare: 0.55, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 280, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro Jan 2026', 'Свердловскстат', 'РБК Недвижимость'], needsVerification: ['krtProgramsHa'] },
  },
  kazan: {
    inputs: {
      name: 'Казань',
      region: 'Республика Татарстан',
      demography: { populationThousands: 1318.6, populationTrend5yPct: 5.4, shareAge25to45: 0.33, migrationBalanceThousands: 11.8 },
      economy: { avgSalary: 86_000, salaryGrowthYoY: 14.8, highPaidIndustriesShare: 0.21, unemploymentRate: 2.5 },
      housing: { dealsGrowthYoY: -2.0, priceGrowthYoY: 14.3, monthsOfSupply: 7, businessClassPricePerM2: 274_000, monthlySalesM2: 68_000 },
      competition: { activeDevelopers: 25, top5MarketShare: 0.62, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 350, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro Jan 2026', 'Яндекс Недвижимость Dec 2025', 'Татарстанстат'], needsVerification: ['krtProgramsHa'] },
  },
  nizhny: {
    inputs: {
      name: 'Нижний Новгород',
      region: 'Нижегородская область',
      demography: { populationThousands: 1205.0, populationTrend5yPct: -2.1, shareAge25to45: 0.28, migrationBalanceThousands: -1.5 },
      economy: { avgSalary: 78_000, salaryGrowthYoY: 12.0, highPaidIndustriesShare: 0.20, unemploymentRate: 3.0 },
      housing: { dealsGrowthYoY: -8.0, priceGrowthYoY: 11.5, monthsOfSupply: 11, businessClassPricePerM2: 300_000, monthlySalesM2: 42_000 },
      competition: { activeDevelopers: 22, top5MarketShare: 0.58, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 180, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['Циан 2025', 'РБК Недвижимость Nov 2025', 'Нижегородскстат'], needsVerification: ['krtProgramsHa'] },
  },
  chelyabinsk: {
    inputs: {
      name: 'Челябинск',
      region: 'Челябинская область',
      demography: { populationThousands: 1196.7, populationTrend5yPct: -1.5, shareAge25to45: 0.28, migrationBalanceThousands: -2.0 },
      economy: { avgSalary: 72_000, salaryGrowthYoY: 11.5, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: { dealsGrowthYoY: -10.0, priceGrowthYoY: 7.2, monthsOfSupply: 14, businessClassPricePerM2: 185_000, monthlySalesM2: 38_000 },
      competition: { activeDevelopers: 18, top5MarketShare: 0.65, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 90, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro Jan 2026', 'РБК Недвижимость', 'Челябинскстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  samara: {
    inputs: {
      name: 'Самара',
      region: 'Самарская область',
      demography: { populationThousands: 1159.0, populationTrend5yPct: -1.8, shareAge25to45: 0.28, migrationBalanceThousands: -2.5 },
      economy: { avgSalary: 70_000, salaryGrowthYoY: 11.0, highPaidIndustriesShare: 0.18, unemploymentRate: 3.2 },
      housing: { dealsGrowthYoY: -6.0, priceGrowthYoY: 5.5, monthsOfSupply: 12, businessClassPricePerM2: 195_000, monthlySalesM2: 36_000 },
      competition: { activeDevelopers: 16, top5MarketShare: 0.60, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 120, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'Самарастат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  ufa: {
    inputs: {
      name: 'Уфа',
      region: 'Республика Башкортостан',
      demography: { populationThousands: 1163.3, populationTrend5yPct: 1.2, shareAge25to45: 0.30, migrationBalanceThousands: 2.8 },
      economy: { avgSalary: 76_000, salaryGrowthYoY: 12.8, highPaidIndustriesShare: 0.19, unemploymentRate: 2.9 },
      housing: { dealsGrowthYoY: -3.0, priceGrowthYoY: 11.0, monthsOfSupply: 10, businessClassPricePerM2: 205_000, monthlySalesM2: 41_000 },
      competition: { activeDevelopers: 19, top5MarketShare: 0.55, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 140, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'Башкортостанстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  rostov: {
    inputs: {
      name: 'Ростов-на-Дону',
      region: 'Ростовская область',
      demography: { populationThousands: 1140.5, populationTrend5yPct: 1.5, shareAge25to45: 0.29, migrationBalanceThousands: 4.2 },
      economy: { avgSalary: 73_000, salaryGrowthYoY: 12.5, highPaidIndustriesShare: 0.17, unemploymentRate: 3.4 },
      housing: { dealsGrowthYoY: -5.0, priceGrowthYoY: 8.5, monthsOfSupply: 11, businessClassPricePerM2: 190_000, monthlySalesM2: 39_000 },
      competition: { activeDevelopers: 21, top5MarketShare: 0.52, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 160, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'РБК Недвижимость', 'Ростовстат'], needsVerification: ['krtProgramsHa'] },
  },
  omsk: {
    inputs: {
      name: 'Омск',
      region: 'Омская область',
      demography: { populationThousands: 1104.5, populationTrend5yPct: -4.2, shareAge25to45: 0.27, migrationBalanceThousands: -8.5 },
      economy: { avgSalary: 64_000, salaryGrowthYoY: 9.5, highPaidIndustriesShare: 0.14, unemploymentRate: 4.1 },
      housing: { dealsGrowthYoY: -12.0, priceGrowthYoY: 4.8, monthsOfSupply: 16, businessClassPricePerM2: 168_000, monthlySalesM2: 28_000 },
      competition: { activeDevelopers: 14, top5MarketShare: 0.70, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 60, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'Омскстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  krasnodar: {
    inputs: {
      name: 'Краснодар',
      region: 'Краснодарский край',
      demography: { populationThousands: 1138.7, populationTrend5yPct: 14.5, shareAge25to45: 0.34, migrationBalanceThousands: 28.0 },
      economy: { avgSalary: 75_000, salaryGrowthYoY: 15.5, highPaidIndustriesShare: 0.18, unemploymentRate: 2.6 },
      housing: { dealsGrowthYoY: 1.0, priceGrowthYoY: 7.0, monthsOfSupply: 9, businessClassPricePerM2: 215_000, monthlySalesM2: 65_000 },
      competition: { activeDevelopers: 35, top5MarketShare: 0.42, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 420, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['Коммерсант Jan 2026', 'bnMAP.pro 2025', 'Краснодарстат'], needsVerification: ['krtProgramsHa'] },
  },
  voronezh: {
    inputs: {
      name: 'Воронеж',
      region: 'Воронежская область',
      demography: { populationThousands: 1041.7, populationTrend5yPct: 0.5, shareAge25to45: 0.28, migrationBalanceThousands: 1.8 },
      economy: { avgSalary: 65_000, salaryGrowthYoY: 10.5, highPaidIndustriesShare: 0.15, unemploymentRate: 3.3 },
      housing: { dealsGrowthYoY: -7.0, priceGrowthYoY: 8.1, monthsOfSupply: 13, businessClassPricePerM2: 185_000, monthlySalesM2: 32_000 },
      competition: { activeDevelopers: 17, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 110, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'Воронежстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  volgograd: {
    inputs: {
      name: 'Волгоград',
      region: 'Волгоградская область',
      demography: { populationThousands: 1018.9, populationTrend5yPct: -3.5, shareAge25to45: 0.27, migrationBalanceThousands: -5.2 },
      economy: { avgSalary: 58_000, salaryGrowthYoY: 8.5, highPaidIndustriesShare: 0.13, unemploymentRate: 4.2 },
      housing: { dealsGrowthYoY: -9.0, priceGrowthYoY: 3.6, monthsOfSupply: 17, businessClassPricePerM2: 168_000, monthlySalesM2: 22_000 },
      competition: { activeDevelopers: 12, top5MarketShare: 0.72, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 45, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: false },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro Jan 2026', 'АиФ Волгоград'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  perm: {
    inputs: {
      name: 'Пермь',
      region: 'Пермский край',
      demography: { populationThousands: 1026.9, populationTrend5yPct: -2.8, shareAge25to45: 0.28, migrationBalanceThousands: -3.2 },
      economy: { avgSalary: 68_000, salaryGrowthYoY: 11.8, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: { dealsGrowthYoY: -8.5, priceGrowthYoY: 18.1, monthsOfSupply: 12, businessClassPricePerM2: 228_000, monthlySalesM2: 30_000 },
      competition: { activeDevelopers: 16, top5MarketShare: 0.62, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 95, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['RuNews24 Dec 2025', 'bnMAP.pro 2025', 'Пермьстат'], needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'] },
  },
  krasnoyarsk: {
    inputs: {
      name: 'Красноярск',
      region: 'Красноярский край',
      demography: { populationThousands: 1211.8, populationTrend5yPct: 1.8, shareAge25to45: 0.30, migrationBalanceThousands: 3.5 },
      economy: { avgSalary: 82_000, salaryGrowthYoY: 12.2, highPaidIndustriesShare: 0.20, unemploymentRate: 3.0 },
      housing: { dealsGrowthYoY: -4.5, priceGrowthYoY: 7.8, monthsOfSupply: 11, businessClassPricePerM2: 245_000, monthlySalesM2: 35_000 },
      competition: { activeDevelopers: 18, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 130, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    meta: { dataAsOfDate: '2026-02-01', sources: ['bnMAP.pro 2025', 'Красноярскстат'], needsVerification: ['krtProgramsHa'] },
  },
};

export const ALL_CITY_KEYS = Object.keys(RUSSIA_MILLION_CITIES);

export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  novosibirsk: { lat: 55.0084, lng: 82.9357 },
  yekaterinburg: { lat: 56.8389, lng: 60.6057 },
  kazan: { lat: 55.8304, lng: 49.0661 },
  nizhny: { lat: 56.2965, lng: 43.9361 },
  chelyabinsk: { lat: 55.1644, lng: 61.4368 },
  samara: { lat: 53.1959, lng: 50.1002 },
  ufa: { lat: 54.7388, lng: 55.9721 },
  rostov: { lat: 47.2357, lng: 39.7015 },
  omsk: { lat: 54.9885, lng: 73.3242 },
  krasnodar: { lat: 45.0355, lng: 38.9753 },
  voronezh: { lat: 51.6720, lng: 39.1843 },
  volgograd: { lat: 48.708, lng: 44.5133 },
  perm: { lat: 58.0105, lng: 56.2502 },
  krasnoyarsk: { lat: 56.0184, lng: 92.8672 },
};
