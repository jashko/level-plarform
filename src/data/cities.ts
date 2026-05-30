/**
 * Датасет городов-миллионников РФ (кроме МСК/СПб).
 *
 * ВЕРСИЯ 2.0 — обновлено 30 мая 2026
 *
 * ИСТОЧНИКИ:
 * - Население, зарплаты: Росстат, РИА Рейтинг 2025
 * - businessClassPricePerM2: bnMAP.pro / Циан / Яндекс Недвижимость — медиана
 *   по ЖК бизнес-класса, янв-апр 2026. ТОЛЬКО бизнес-сегмент.
 * - dealsGrowthYoY: Росреестр (ДДУ), итоги 2025 г. (РБК Недвижимость)
 * - priceGrowthYoY: Коммерсант / РБК Недвижимость / Сибдом / Метр.ТВ 2025
 * - monthlySalesM2: расчёт из annualDduCount × средняя площадь сделки
 * - annualDduCount: Росреестр, итоги 2025 г.
 * - constructionVolumeMkdThousM2: ЕИСЖС / наш.дом.рф / РИА Рейтинг 2025
 * - krtProgramsHa, krtProjectsCount: Минстрой РФ, РБК региональные 2025
 *
 * ПРИМЕЧАНИЕ: данные только по бизнес-классу и выше. Эконом-сегмент нерелевантен.
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
      housing: {
        dealsGrowthYoY: -7.5,         // Росреестр: ДДУ -7.5% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 10.9,          // Сибдом: +10.9% янв-нояб 2025
        monthsOfSupply: 10,
        businessClassPricePerM2: 230_000,
        monthlySalesM2: 72_000,        // 15 600 ДДУ/год × 55 м² / 12
        annualDduCount: 15_600,
        constructionVolumeMkdThousM2: 2_700, // 7-е место в РФ, РИА Рейтинг
        sellReadinessRatioPct: 63,     // ЕИСЖС / ДОМ.РФ, 01.01.2026
        unsoldYearsOfSupply: 3.7,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 32, top5MarketShare: 0.48, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: {
        krtProgramsHa: 822,            // 821.57 га, 54 участка КРТ (РБК Новосибирск, дек.2025)
        krtProjectsCount: 54,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro Jan 2026', 'РИА Рейтинг 2025', 'Росстат', 'Сибдом нояб.2025', 'РБК Новосибирск дек.2025', 'Росреестр 2025'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  yekaterinburg: {
    inputs: {
      name: 'Екатеринбург',
      region: 'Свердловская область',
      demography: { populationThousands: 1580.1, populationTrend5yPct: 3.8, shareAge25to45: 0.32, migrationBalanceThousands: 9.1 },
      economy: { avgSalary: 92_000, salaryGrowthYoY: 14.2, highPaidIndustriesShare: 0.22, unemploymentRate: 2.8 },
      housing: {
        dealsGrowthYoY: -4.6,          // Росреестр: ДДУ -4.6% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 8.5,           // Метр.ТВ: +8.5% г/г янв-июл 2025
        monthsOfSupply: 8,
        businessClassPricePerM2: 265_000,
        monthlySalesM2: 84_000,        // ~18k ДДУ/год (экстраполяция) × 55м² / 12
        annualDduCount: 18_300,        // расчётно по данным янв-июл 2025
        constructionVolumeMkdThousM2: 3_700, // РИА Рейтинг / ЕРЗ.РФ
        sellReadinessRatioPct: 82,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит предложения
        unsoldYearsOfSupply: 3.7,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 28, top5MarketShare: 0.55, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 280,
        krtProjectsCount: 11,          // 11 договоров КРТ (7 жил. + 4 нежил.), РБК Екатеринбург
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro Jan 2026', 'Метр.ТВ авг.2025', 'Свердловскстат', 'Росреестр 2025'],
      needsVerification: ['krtProgramsHa'],
    },
  },

  kazan: {
    inputs: {
      name: 'Казань',
      region: 'Республика Татарстан',
      demography: { populationThousands: 1318.6, populationTrend5yPct: 5.4, shareAge25to45: 0.33, migrationBalanceThousands: 11.8 },
      economy: { avgSalary: 86_000, salaryGrowthYoY: 14.8, highPaidIndustriesShare: 0.21, unemploymentRate: 2.5 },
      housing: {
        dealsGrowthYoY: 6.0,           // Росреестр: ДДУ +6.0% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 14.3,          // Коммерсант: +14.3% г/г нояб.2025
        monthsOfSupply: 7,
        businessClassPricePerM2: 274_000,
        monthlySalesM2: 44_000,        // 9 700 ДДУ/год × 55м² / 12 = 44.5k
        annualDduCount: 9_700,         // РБК Недвижимость, итоги 2025
        constructionVolumeMkdThousM2: undefined, // нет данных по городу отдельно
        sellReadinessRatioPct: 71,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — баланс
        unsoldYearsOfSupply: 2.9,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 25, top5MarketShare: 0.62, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: {
        krtProgramsHa: 228,            // Кадерле 140 га + Васильевский остров 88 га
        krtProjectsCount: 2,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro Jan 2026', 'Коммерсант нояб.2025', 'Татарстанстат', 'Росреестр 2025'],
      needsVerification: [],
    },
  },

  nizhny: {
    inputs: {
      name: 'Нижний Новгород',
      region: 'Нижегородская область',
      demography: { populationThousands: 1205.0, populationTrend5yPct: -2.1, shareAge25to45: 0.28, migrationBalanceThousands: -1.5 },
      economy: { avgSalary: 78_000, salaryGrowthYoY: 12.0, highPaidIndustriesShare: 0.20, unemploymentRate: 3.0 },
      housing: {
        dealsGrowthYoY: 36.6,          // Росреестр: ДДУ +36.6% г/г — лидер РФ (РБК Нед-ть, 2025)
        priceGrowthYoY: 16.4,          // РБК: +16.4% с нач.2025 — 1-е место среди миллионников
        monthsOfSupply: 7,             // Сокращение запасов подтверждается ростом ДДУ
        businessClassPricePerM2: 300_000,
        monthlySalesM2: 32_000,        // 6 900 ДДУ/год × 55м² / 12 = 31.6k
        annualDduCount: 6_900,         // РБК Недвижимость янв-нояб 2025
        constructionVolumeMkdThousM2: 810, // Домострой НН, авг.2025
        sellReadinessRatioPct: 100,    // ЕИСЖС / ДОМ.РФ, 01.01.2026 — максимальный дефицит предложения
        unsoldYearsOfSupply: 2.0,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 22, top5MarketShare: 0.58, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: {
        krtProgramsHa: 180,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['Циан 2025', 'РБК Недвижимость нояб.2025', 'Нижегородстат', 'Росреестр 2025', 'Домострой НН авг.2025'],
      needsVerification: ['krtProgramsHa'],
    },
  },

  chelyabinsk: {
    inputs: {
      name: 'Челябинск',
      region: 'Челябинская область',
      demography: { populationThousands: 1196.7, populationTrend5yPct: -1.5, shareAge25to45: 0.28, migrationBalanceThousands: -2.0 },
      economy: { avgSalary: 72_000, salaryGrowthYoY: 11.5, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: {
        dealsGrowthYoY: -5.9,          // Росреестр: ДДУ -5.9% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 3.5,           // Коммерсант Челябинск: +3.5% г/г — один из слабейших
        monthsOfSupply: 14,
        businessClassPricePerM2: 185_000,
        monthlySalesM2: 38_000,
        sellReadinessRatioPct: 56,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит спроса
        unsoldYearsOfSupply: 4.0,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 18, top5MarketShare: 0.65, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 349,            // 349 га, 47 участков (Интерфакс-Урал)
        krtProjectsCount: 78,          // 78 проектов запланировано до 2032 (pchela.news)
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro Jan 2026', 'Коммерсант Челябинск июн.2025', 'Интерфакс-Урал', 'Росреестр 2025'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  samara: {
    inputs: {
      name: 'Самара',
      region: 'Самарская область',
      demography: { populationThousands: 1159.0, populationTrend5yPct: -1.8, shareAge25to45: 0.28, migrationBalanceThousands: -2.5 },
      economy: { avgSalary: 70_000, salaryGrowthYoY: 11.0, highPaidIndustriesShare: 0.18, unemploymentRate: 3.2 },
      housing: {
        dealsGrowthYoY: -7.9,          // Росреестр: ДДУ -7.9% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 6.0,           // Реальные сделки ~6% (предложение +29% — артефакт)
        monthsOfSupply: 12,
        businessClassPricePerM2: 195_000,
        monthlySalesM2: 36_000,
        constructionVolumeMkdThousM2: 1_500, // фев.2026: 1.5 млн м² (-16.7% г/г)
        sellReadinessRatioPct: 65,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — баланс
        unsoldYearsOfSupply: 3.3,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 16, top5MarketShare: 0.60, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 120,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'Самарастат', 'Росреестр 2025'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  ufa: {
    inputs: {
      name: 'Уфа',
      region: 'Республика Башкортостан',
      demography: { populationThousands: 1163.3, populationTrend5yPct: 1.2, shareAge25to45: 0.30, migrationBalanceThousands: 2.8 },
      economy: { avgSalary: 76_000, salaryGrowthYoY: 12.8, highPaidIndustriesShare: 0.19, unemploymentRate: 2.9 },
      housing: {
        dealsGrowthYoY: -4.6,          // Росреестр: ДДУ -4.6% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 7.0,           // РБК Уфа: +7% с нач.2025 (167.9→179.6 тыс./м²)
        monthsOfSupply: 10,
        businessClassPricePerM2: 205_000,
        monthlySalesM2: 38_000,        // ~5.14k ДДУ (янв-авг) × 55м² / 8 мес
        constructionVolumeMkdThousM2: 2_500, // РИА Рейтинг
        sellReadinessRatioPct: 56,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит спроса
        unsoldYearsOfSupply: 4.2,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 19, top5MarketShare: 0.55, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 140,
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'РБК Уфа нояб.2025', 'Башкортостанстат', 'Росреестр 2025'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  rostov: {
    inputs: {
      name: 'Ростов-на-Дону',
      region: 'Ростовская область',
      demography: { populationThousands: 1140.5, populationTrend5yPct: 1.5, shareAge25to45: 0.29, migrationBalanceThousands: 4.2 },
      economy: { avgSalary: 73_000, salaryGrowthYoY: 12.5, highPaidIndustriesShare: 0.17, unemploymentRate: 3.4 },
      housing: {
        dealsGrowthYoY: 13.2,          // Росреестр: ДДУ +13.2% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 4.8,           // Коммерсант дек.2025: +4.76% г/г (152.6→159.9 тыс.)
        monthsOfSupply: 9,
        businessClassPricePerM2: 190_000,
        monthlySalesM2: 68_000,        // 16 500 ДДУ/год × 50м² / 12 = 68.75k
        annualDduCount: 16_500,        // РБК Недвижимость, итоги 2025
        constructionVolumeMkdThousM2: 3_400, // РИА Рейтинг; 5-е место в РФ
        sellReadinessRatioPct: 80,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — граница баланс/дефицит предложения
        unsoldYearsOfSupply: 4.0,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 21, top5MarketShare: 0.52, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: {
        krtProgramsHa: 500,            // ~500 га, 6 проектов в стройке (РБК Ростов 2025)
        krtProjectsCount: 6,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'Коммерсант дек.2025', 'Ростовстат', 'Росреестр 2025', 'РБК Ростов 2025', 'Домклик/РБК 2025'],
      needsVerification: [],
    },
  },

  omsk: {
    inputs: {
      name: 'Омск',
      region: 'Омская область',
      demography: { populationThousands: 1104.5, populationTrend5yPct: -4.2, shareAge25to45: 0.27, migrationBalanceThousands: -8.5 },
      economy: { avgSalary: 64_000, salaryGrowthYoY: 9.5, highPaidIndustriesShare: 0.14, unemploymentRate: 4.1 },
      housing: {
        dealsGrowthYoY: 20.7,          // Росреестр: ДДУ +20.7% г/г (рост с низкой базы!)
        priceGrowthYoY: 3.6,           // РБК рейтинг: +3.6% г/г
        monthsOfSupply: 18,            // Превышение: маленький рынок + доля новостроек 14-24%
        businessClassPricePerM2: 168_000,
        monthlySalesM2: 10_000,        // 2 200 ДДУ/год × 50м² / 12 = 9.2k (крошечный рынок!)
        annualDduCount: 2_200,         // Вечерний Омск: 2 200 квартир куплено в 2025
        sellReadinessRatioPct: 55,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит спроса (оценка, отдельно нет)
        unsoldYearsOfSupply: 4.5,      // ЕИСЖС / ДОМ.РФ, 01.01.2026 — оценка (Прочие СФО)
      },
      competition: { activeDevelopers: 14, top5MarketShare: 0.70, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 115,            // 115.38 га по 12 решениям КРТ
        krtProjectsCount: 5,           // 5 договоров заключено
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'Омскстат', 'Вечерний Омск 2025', 'Росреестр 2025'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  krasnodar: {
    inputs: {
      name: 'Краснодар',
      region: 'Краснодарский край',
      demography: { populationThousands: 1138.7, populationTrend5yPct: 14.5, shareAge25to45: 0.34, migrationBalanceThousands: 28.0 },
      economy: { avgSalary: 75_000, salaryGrowthYoY: 15.5, highPaidIndustriesShare: 0.18, unemploymentRate: 2.6 },
      housing: {
        dealsGrowthYoY: -25.6,         // Росреестр: ДДУ -25.6% г/г — рынок перегрет (РБК, 2025)
        priceGrowthYoY: 7.0,           // РБК: +7-10% г/г
        monthsOfSupply: 14,            // 29 400 нераспроданных квартир (2-е место РФ!)
        businessClassPricePerM2: 215_000,
        monthlySalesM2: 73_000,        // 17 600 ДДУ/год × 50м² / 12 = 73.3k
        annualDduCount: 17_600,        // РБК Недвижимость, итоги 2025
        constructionVolumeMkdThousM2: 5_300, // ~5.3 млн м²; 2-е место в РФ
        sellReadinessRatioPct: 43,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — тяжёлый дефицит спроса
        unsoldYearsOfSupply: 6.1,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 35, top5MarketShare: 0.42, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: {
        krtProgramsHa: 400,            // ~400 га в городе (3681 га — весь Краснодарский край)
        krtProjectsCount: 10,          // 10 договоров КРТ (РБК Краснодар авг.2025)
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['Коммерсант янв.2026', 'bnMAP.pro 2025', 'Краснодарстат', 'Росреестр 2025', 'РБК Краснодар авг.2025', 'Минстрой РФ'],
      needsVerification: [],
    },
  },

  voronezh: {
    inputs: {
      name: 'Воронеж',
      region: 'Воронежская область',
      demography: { populationThousands: 1041.7, populationTrend5yPct: 0.5, shareAge25to45: 0.28, migrationBalanceThousands: 1.8 },
      economy: { avgSalary: 65_000, salaryGrowthYoY: 10.5, highPaidIndustriesShare: 0.15, unemploymentRate: 3.3 },
      housing: {
        dealsGrowthYoY: 3.7,           // Росреестр: ДДУ ~+3.7% г/г (рост с -7% в прошлой версии)
        priceGrowthYoY: 6.5,           // Коммерсант Воронеж / РБК: +6.5% г/г
        monthsOfSupply: 13,
        businessClassPricePerM2: 185_000,
        monthlySalesM2: 30_000,        // 6 900 ДДУ/год × 52м² / 12 = 29.9k
        annualDduCount: 6_900,         // РБК янв-нояб 2025
        sellReadinessRatioPct: 48,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит спроса
        unsoldYearsOfSupply: 3.0,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 17, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 110,
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'Коммерсант Воронеж 2025', 'Росреестр 2025', 'Домклик/РБК 2025'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  volgograd: {
    inputs: {
      name: 'Волгоград',
      region: 'Волгоградская область',
      demography: { populationThousands: 1018.9, populationTrend5yPct: -3.5, shareAge25to45: 0.27, migrationBalanceThousands: -5.2 },
      economy: { avgSalary: 58_000, salaryGrowthYoY: 8.5, highPaidIndustriesShare: 0.13, unemploymentRate: 4.2 },
      housing: {
        dealsGrowthYoY: -5.1,          // Росреестр: ДДУ -5.1% г/г (МК Волгоград, 2025)
        priceGrowthYoY: 2.9,           // Слабейший рост среди миллионников (РБК)
        monthsOfSupply: 22,            // 35 500 нераспроданных квартир — 1-е место в РФ!
        businessClassPricePerM2: 168_000,
        monthlySalesM2: 17_000,        // 4 200 ДДУ/год × 50м² / 12 = 17.5k
        annualDduCount: 4_200,         // МК Волгоград, янв-нояб 2025
        sellReadinessRatioPct: 44,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — глубокий дефицит спроса
        unsoldYearsOfSupply: 7.0,      // ЕИСЖС / ДОМ.РФ, 01.01.2026 — худший показатель
      },
      competition: { activeDevelopers: 12, top5MarketShare: 0.72, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 45,
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: false,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro Jan 2026', 'МК Волгоград 2025', 'Росреестр 2025'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  perm: {
    inputs: {
      name: 'Пермь',
      region: 'Пермский край',
      demography: { populationThousands: 1026.9, populationTrend5yPct: -2.8, shareAge25to45: 0.28, migrationBalanceThousands: -3.2 },
      economy: { avgSalary: 68_000, salaryGrowthYoY: 11.8, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: {
        dealsGrowthYoY: 15.7,          // Росреестр: ДДУ +15.7% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 15.2,          // URA.news: +15.2% г/г — 2-е место среди миллионников
        monthsOfSupply: 10,
        businessClassPricePerM2: 228_000,
        monthlySalesM2: 36_000,        // 7 800 ДДУ/год × 55м² / 12 = 35.75k
        annualDduCount: 7_800,         // РБК Недвижимость, итоги 2025
        sellReadinessRatioPct: 68,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — баланс
        unsoldYearsOfSupply: 3.2,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 16, top5MarketShare: 0.62, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 770,            // 770+ га, 43 договора КРТ (Business-Class.su сент.2025)
        krtProjectsCount: 40,          // 40 проектов КРТ в Пермском крае
        hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['URA.news 2025', 'bnMAP.pro 2025', 'Пермьстат', 'Росреестр 2025', 'Business-Class.su сент.2025', 'Домклик/РБК 2025'],
      needsVerification: [],
    },
  },

  krasnoyarsk: {
    inputs: {
      name: 'Красноярск',
      region: 'Красноярский край',
      demography: { populationThousands: 1211.8, populationTrend5yPct: 1.8, shareAge25to45: 0.30, migrationBalanceThousands: 3.5 },
      economy: { avgSalary: 82_000, salaryGrowthYoY: 12.2, highPaidIndustriesShare: 0.20, unemploymentRate: 3.0 },
      housing: {
        dealsGrowthYoY: -11.0,         // Росреестр: ДДУ -11.0% г/г (РБК Нед-ть, 2025)
        priceGrowthYoY: 4.5,           // Сибдом: ~145.3→147 тыс./м², +4.5% г/г
        monthsOfSupply: 11,
        businessClassPricePerM2: 245_000,
        monthlySalesM2: 35_000,
        sellReadinessRatioPct: 55,     // ЕИСЖС / ДОМ.РФ, 01.01.2026 — дефицит спроса
        unsoldYearsOfSupply: 5.2,      // ЕИСЖС / ДОМ.РФ, 01.01.2026
      },
      competition: { activeDevelopers: 18, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: {
        krtProgramsHa: 130,
        hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true,
      },
    },
    meta: {
      dataAsOfDate: '2026-05-30',
      sources: ['bnMAP.pro 2025', 'Сибдом 2025', 'Красноярскстат', 'Росреестр 2025'],
      needsVerification: ['krtProgramsHa'],
    },
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
