/**
 * Датасет городов-миллионников РФ (кроме МСК/СПб).
 *
 * ВЕРСИЯ 3.0 — обновлено 31 мая 2026
 *
 * ИСТОЧНИКИ:
 * - Население: Росстат, актуализировано 2025
 * - Зарплаты: Росстат, янв-фев 2026 (visasam.ru, региональные данные)
 * - businessClassPricePerM2: bnMAP.pro / НДВ / МИР КВАРТИР — май 2026.
 *   ТОЛЬКО бизнес-сегмент.
 * - priceGrowthYoY: МИР КВАРТИР / ZSRF / НДВ, апрель-май 2026 (YoY)
 * - dealsGrowthYoY: Коммерсант, апрель 2026 (YoY по ДДУ)
 * - annualDduCount: Росреестр, итоги 2025 + Q1 2026
 * - constructionVolumeMkdThousM2: ЕИСЖС / РИА Рейтинг 2025-2026
 * - sellReadinessRatioPct, unsoldYearsOfSupply: ЕИСЖС / ДОМ.РФ, 01.01.2026
 * - krtProgramsHa, krtProjectsCount: Минстрой РФ / РБК региональные 2025-2026
 *
 * КОНТЕКСТ: Январь 2026 — ажиотаж (+66% YoY) из-за ужесточения
 * семейной ипотеки с 01.02.2026. Фев-апр — охлаждение (-27% YoY в среднем).
 * ЦБ РФ продолжает снижать ставку: 14.25% с 19.06.2026 (−25 б.п.; был пик 21% в 2024).
 * Следующее заседание Совета директоров — 24.07.2026.
 *
 * ПРИМЕЧАНИЕ: данные только по бизнес-классу и выше. Эконом нерелевантен.
 */

import type { CityInputs } from '../engine/scoring';

export interface CityFinanceData {
  /**
   * Нормативная себестоимость строительства МКД по Минстрою РФ 2025,
   * ₽/м² ОБЩЕЙ площади (стандартное жильё, без учёта класса).
   * Для бизнес-класса умножить на BUSINESS_CLASS_CONSTRUCTION_PREMIUM (1.22).
   */
  constructionNormativePerTotalM2: number;
  /**
   * Средний метраж квартиры бизнес-класса в данном городе, м².
   * Источник: аналитика bnMAP.pro / ДОМ.РФ по проектам бизнес-класса, 2025.
   */
  avgUnitSizeM2: number;
  /**
   * Стоимость земельного участка как % от выручки проекта.
   * Источник: Коллиерс/JLL Russia, раскрытия девелоперов, 2024–2025.
   * Диапазон: 6–18% (дешевле в слабых рынках, дороже в центрах).
   */
  landRevenuePct: number;
  /**
   * Инфраструктурные затраты ₽/м² ОБЩЕЙ площади строительства:
   * сети (вода/канализация/тепло/электро), дороги, благоустройство,
   * социальная нагрузка (КРТ). Источник: инженерные оценки 2025.
   */
  infraCostPerTotalM2: number;
}

export interface CityDatasetEntry {
  inputs: CityInputs;
  finance: CityFinanceData;
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
      economy: {
        avgSalary: 78_000,         // Росстат / visasam.ru, 2026
        salaryGrowthYoY: 8.0,      // умеренный рост
        highPaidIndustriesShare: 0.19, unemploymentRate: 3.1,
      },
      housing: {
        dealsGrowthYoY: -25.6,     // Коммерсант: ДДУ апрель 2026 -25.6% YoY
        priceGrowthYoY: 6.0,       // МИР КВАРТИР/ZSRF: ~+6% YoY к маю 2026
        monthsOfSupply: 10,
        businessClassPricePerM2: 228_000, // bnMAP.pro/НДВ май 2026
        monthlySalesM2: 68_000,    // апрель 664 ДДУ; 2025 годовой темп скорр.
        annualDduCount: 14_400,    // 2025 факт 15 600, Q1 2026 снижение
        constructionVolumeMkdThousM2: 2_700,
        sellReadinessRatioPct: 63, unsoldYearsOfSupply: 3.7,
      },
      competition: { activeDevelopers: 32, top5MarketShare: 0.48, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 822, krtProjectsCount: 54, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 88_000, avgUnitSizeM2: 63, landRevenuePct: 11.5, infraCostPerTotalM2: 7_500 }, // Новосибирск
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР апр.2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат 2026', 'РБК НСК мар.2026'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  yekaterinburg: {
    inputs: {
      name: 'Екатеринбург',
      region: 'Свердловская область',
      demography: { populationThousands: 1580.1, populationTrend5yPct: 3.8, shareAge25to45: 0.32, migrationBalanceThousands: 9.1 },
      economy: {
        avgSalary: 80_000,         // Росстат Свердловская обл. 2026
        salaryGrowthYoY: 10.0,
        highPaidIndustriesShare: 0.22, unemploymentRate: 2.8,
      },
      housing: {
        dealsGrowthYoY: -16.9,     // Коммерсант: ДДУ апрель 2026 -16.9% YoY
        priceGrowthYoY: 9.0,       // НДВ: 184 600 апр.2026; ZSRF: >+2%/мес май
        monthsOfSupply: 8,
        businessClassPricePerM2: 272_000, // апр.2026 рынок +2%; bnMAP.pro
        monthlySalesM2: 82_000,    // 1 288 ДДУ × 55м² апрель + тренд
        annualDduCount: 17_500,    // Q1 5 400 ÷ 3 = 1 800/мес → ~18k/год экстраполяция
        constructionVolumeMkdThousM2: 3_700,
        sellReadinessRatioPct: 82, unsoldYearsOfSupply: 3.7,
      },
      competition: { activeDevelopers: 28, top5MarketShare: 0.55, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 280, krtProjectsCount: 11, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 87_000, avgUnitSizeM2: 65, landRevenuePct: 14.5, infraCostPerTotalM2: 8_500 }, // Екатеринбург
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['НДВ апр.2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат 2026', 'ФедералПресс Q1 2026'],
      needsVerification: ['krtProgramsHa'],
    },
  },

  kazan: {
    inputs: {
      name: 'Казань',
      region: 'Республика Татарстан',
      demography: { populationThousands: 1318.6, populationTrend5yPct: 5.4, shareAge25to45: 0.33, migrationBalanceThousands: 11.8 },
      economy: {
        avgSalary: 91_000,         // Росстат Татарстан, фев.2026 = 90 787 руб.
        salaryGrowthYoY: 10.0,
        highPaidIndustriesShare: 0.21, unemploymentRate: 2.5,
      },
      housing: {
        dealsGrowthYoY: 2.6,       // Коммерсант: ДДУ апрель 2026 +2.6% YoY — один из двух городов с ростом!
        priceGrowthYoY: 12.0,      // НДВ: 284 300 апр (+1.4%); ZSRF +1.9%/мес май
        monthsOfSupply: 7,
        businessClassPricePerM2: 278_000, // апр.2026; 2-е место по цене среди миллионников
        monthlySalesM2: 43_000,    // 548 ДДУ апр × 55м²
        annualDduCount: 9_500,     // Q1 2026: 1 800 ×4 = ~7 200/год; с учётом яп. ажиотажа
        constructionVolumeMkdThousM2: undefined,
        sellReadinessRatioPct: 71, unsoldYearsOfSupply: 2.9,
      },
      competition: { activeDevelopers: 25, top5MarketShare: 0.62, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 228, krtProjectsCount: 2, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 91_000, avgUnitSizeM2: 61, landRevenuePct: 13.0, infraCostPerTotalM2: 8_500 }, // Казань
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['НДВ апр.2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат Татарстан фев.2026'],
      needsVerification: [],
    },
  },

  nizhny: {
    inputs: {
      name: 'Нижний Новгород',
      region: 'Нижегородская область',
      demography: { populationThousands: 1205.0, populationTrend5yPct: -2.1, shareAge25to45: 0.28, migrationBalanceThousands: -1.5 },
      economy: {
        avgSalary: 77_000,         // Росстат Нижегородская обл. фев.2026 = 76 581 руб.
        salaryGrowthYoY: 11.0,
        highPaidIndustriesShare: 0.20, unemploymentRate: 3.0,
      },
      housing: {
        dealsGrowthYoY: 0.0,       // Коммерсант: ДДУ апрель 2026 — стабилизация 0% YoY
        priceGrowthYoY: 18.0,      // МИР КВАРТИР: лидер роста апрель 2026 (+2.3%/мес)
        monthsOfSupply: 7,
        businessClassPricePerM2: 310_000, // НДВ май 2026: 225 400 × 1.38 (БК-премиум)
        monthlySalesM2: 31_000,    // 373 ДДУ апр × 55м²
        annualDduCount: 6_500,     // скорр. апрель данные
        constructionVolumeMkdThousM2: 810,
        sellReadinessRatioPct: 100, unsoldYearsOfSupply: 2.0,
      },
      competition: { activeDevelopers: 22, top5MarketShare: 0.58, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 180, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 82_000, avgUnitSizeM2: 63, landRevenuePct: 12.0, infraCostPerTotalM2: 7_500 }, // Нижний Новгород
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР май 2026', 'Коммерсант апр.2026', 'Росстат Нижегор.обл. фев.2026'],
      needsVerification: ['krtProgramsHa'],
    },
  },

  chelyabinsk: {
    inputs: {
      name: 'Челябинск',
      region: 'Челябинская область',
      demography: { populationThousands: 1196.7, populationTrend5yPct: -1.5, shareAge25to45: 0.28, migrationBalanceThousands: -2.0 },
      economy: {
        avgSalary: 73_000,         // Росстат Челябинская обл. 2026
        salaryGrowthYoY: 8.0,
        highPaidIndustriesShare: 0.16, unemploymentRate: 3.5,
      },
      housing: {
        dealsGrowthYoY: -24.9,     // Коммерсант: ДДУ апрель 2026 -24.9% YoY
        priceGrowthYoY: 1.0,       // МИР КВАРТИР: -1.6% QoQ в Q1; апр: -3.1% — давление на цены
        monthsOfSupply: 14,
        businessClassPricePerM2: 183_000, // апр.2026: снижение от 185k
        monthlySalesM2: 36_000,    // 172 ДДУ апр × 55м² — очень мало; 2025 год ~3 200/мес
        annualDduCount: 8_500,     // Q1 2026: 1 100 × 4 = 4 400; 2025 год скорр.
        sellReadinessRatioPct: 56, unsoldYearsOfSupply: 4.0,
      },
      competition: { activeDevelopers: 18, top5MarketShare: 0.65, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 349, krtProjectsCount: 78, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 67_000, avgUnitSizeM2: 59, landRevenuePct: 9.0, infraCostPerTotalM2: 6_000 }, // Челябинск
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'Коммерсант апр.2026', 'Интерфакс-Урал', 'Росстат 2026'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  samara: {
    inputs: {
      name: 'Самара',
      region: 'Самарская область',
      demography: { populationThousands: 1159.0, populationTrend5yPct: -1.8, shareAge25to45: 0.28, migrationBalanceThousands: -2.5 },
      economy: {
        avgSalary: 76_000,         // Росстат Самарская обл. фев.2026 = 75 977 руб.
        salaryGrowthYoY: 9.0,
        highPaidIndustriesShare: 0.18, unemploymentRate: 3.2,
      },
      housing: {
        dealsGrowthYoY: -19.1,     // Коммерсант: ДДУ апрель 2026 -19.1% YoY
        priceGrowthYoY: 5.0,       // МИР КВАРТИР: +2.8% QoQ Q1; ZSRF: >+2%/мес май
        monthsOfSupply: 12,
        businessClassPricePerM2: 200_000, // Самара +2.8% QoQ от 195k → 200k
        monthlySalesM2: 34_000,    // 208 ДДУ апр × 55м²; Q1 2026 самый слабый
        annualDduCount: 7_000,     // Q1 2026: 600 — самый слабый квартал; 2025 был ~9k
        constructionVolumeMkdThousM2: 1_500,
        sellReadinessRatioPct: 65, unsoldYearsOfSupply: 3.3,
      },
      competition: { activeDevelopers: 16, top5MarketShare: 0.60, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 120, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 74_000, avgUnitSizeM2: 61, landRevenuePct: 11.0, infraCostPerTotalM2: 6_500 }, // Самара
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат 2026'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  ufa: {
    inputs: {
      name: 'Уфа',
      region: 'Республика Башкортостан',
      demography: { populationThousands: 1163.3, populationTrend5yPct: 1.2, shareAge25to45: 0.30, migrationBalanceThousands: 2.8 },
      economy: {
        avgSalary: 67_000,         // Росстат Башкортостан 2026 = 66 868 руб.
        salaryGrowthYoY: 8.0,
        highPaidIndustriesShare: 0.19, unemploymentRate: 2.9,
      },
      housing: {
        dealsGrowthYoY: -5.6,      // Коммерсант: ДДУ апрель 2026 -5.6% YoY
        priceGrowthYoY: 2.0,       // МИР КВАРТИР: -5.6% QoQ Q1 — резкое охлаждение; ZSRF -2.9%/мес май
        monthsOfSupply: 11,
        businessClassPricePerM2: 195_000, // снижение с 205k из-за -5.6% QoQ
        monthlySalesM2: 37_000,    // 539 ДДУ апр × 55м²
        annualDduCount: 8_500,     // Q1 2026: 2 600; 2025 снижение
        constructionVolumeMkdThousM2: 2_500,
        sellReadinessRatioPct: 56, unsoldYearsOfSupply: 4.2,
      },
      competition: { activeDevelopers: 19, top5MarketShare: 0.55, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 140, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 76_000, avgUnitSizeM2: 62, landRevenuePct: 10.5, infraCostPerTotalM2: 7_000 }, // Уфа
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат Башкортостан 2026'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  rostov: {
    inputs: {
      name: 'Ростов-на-Дону',
      region: 'Ростовская область',
      demography: { populationThousands: 1140.5, populationTrend5yPct: 1.5, shareAge25to45: 0.29, migrationBalanceThousands: 4.2 },
      economy: {
        avgSalary: 64_000,         // Росстат Ростовская обл. 2026 = 64 309 руб.
        salaryGrowthYoY: 9.0,
        highPaidIndustriesShare: 0.17, unemploymentRate: 3.4,
      },
      housing: {
        dealsGrowthYoY: -17.9,     // Коммерсант: ДДУ апрель 2026 -17.9% YoY (охлаждение)
        priceGrowthYoY: 2.0,       // МИР КВАРТИР: -4.8% QoQ Q1; апр. +2.1% откат
        monthsOfSupply: 10,
        businessClassPricePerM2: 185_000, // снижение с 190k; рынок охлаждается
        monthlySalesM2: 65_000,    // 846 ДДУ апр × 50м²; Q1 +32% YoY — сильный год!
        annualDduCount: 15_000,    // 2025: 16 500; Q1 2026: 3 200
        constructionVolumeMkdThousM2: 3_400,
        sellReadinessRatioPct: 80, unsoldYearsOfSupply: 4.0,
      },
      competition: { activeDevelopers: 21, top5MarketShare: 0.52, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 500, krtProjectsCount: 6, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 74_000, avgUnitSizeM2: 63, landRevenuePct: 11.5, infraCostPerTotalM2: 7_000 }, // Ростов-на-Дону
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'НДВ апр.2026', 'Коммерсант апр.2026', 'КП Ростов апр.2026', 'Росстат 2026'],
      needsVerification: [],
    },
  },

  omsk: {
    inputs: {
      name: 'Омск',
      region: 'Омская область',
      demography: { populationThousands: 1104.5, populationTrend5yPct: -4.2, shareAge25to45: 0.27, migrationBalanceThousands: -8.5 },
      economy: {
        avgSalary: 76_000,         // Росстат Омская обл. фев.2026 = 75 611 руб.
        salaryGrowthYoY: 12.0,     // значительный рост с низкой базы
        highPaidIndustriesShare: 0.14, unemploymentRate: 4.1,
      },
      housing: {
        dealsGrowthYoY: -24.4,     // Коммерсант: ДДУ апрель 2026 -24.4% YoY — мелкий рынок
        priceGrowthYoY: 3.0,       // МИР КВАРТИР: -0.1% QoQ Q1; ZSRF +0.4%/мес май
        monthsOfSupply: 18,
        businessClassPricePerM2: 175_000, // Омск слабый рынок; рост вслед за рынком
        monthlySalesM2: 9_000,     // 102 ДДУ апр × 50м² — крошечный рынок!
        annualDduCount: 2_000,     // Q1 2026: 500; ниже 2025 (2 200)
        sellReadinessRatioPct: 55, unsoldYearsOfSupply: 4.5,
      },
      competition: { activeDevelopers: 14, top5MarketShare: 0.70, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 115, krtProjectsCount: 5, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 67_000, avgUnitSizeM2: 57, landRevenuePct: 8.0, infraCostPerTotalM2: 5_000 }, // Омск
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат Омская обл. 2026'],
      needsVerification: ['hasWhiteSpaceBusinessClass'],
    },
  },

  krasnodar: {
    inputs: {
      name: 'Краснодар',
      region: 'Краснодарский край',
      demography: { populationThousands: 1138.7, populationTrend5yPct: 14.5, shareAge25to45: 0.34, migrationBalanceThousands: 28.0 },
      economy: {
        avgSalary: 70_000,         // Росстат Краснодарский край 2026 = 70 081 руб.
        salaryGrowthYoY: 9.0,
        highPaidIndustriesShare: 0.18, unemploymentRate: 2.6,
      },
      housing: {
        dealsGrowthYoY: -7.2,      // Коммерсант: ДДУ апрель 2026 -7.2% YoY — улучшение
        priceGrowthYoY: 5.0,       // МИР КВАРТИР: -1.6% QoQ Q1; май +2.7% откат вверх
        monthsOfSupply: 14,        // 29 400+ нераспроданных — 2-е место РФ
        businessClassPricePerM2: 218_000, // ZSRF май: 186 200 × 1.17 (БК-премиум)
        monthlySalesM2: 72_000,    // 851 ДДУ апр × 50м²; янв 2026 — лидер +235%!
        annualDduCount: 16_000,    // Q1: 4 600; апр: 851; скорр.
        constructionVolumeMkdThousM2: 5_300,
        sellReadinessRatioPct: 43, unsoldYearsOfSupply: 6.1,
      },
      competition: { activeDevelopers: 35, top5MarketShare: 0.42, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 400, krtProjectsCount: 10, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 76_000, avgUnitSizeM2: 65, landRevenuePct: 11.0, infraCostPerTotalM2: 8_000 }, // Краснодар
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'НДВ апр.2026', 'Коммерсант апр.2026', 'Росстат 2026'],
      needsVerification: [],
    },
  },

  voronezh: {
    inputs: {
      name: 'Воронеж',
      region: 'Воронежская область',
      demography: { populationThousands: 1041.7, populationTrend5yPct: 0.5, shareAge25to45: 0.28, migrationBalanceThousands: 1.8 },
      economy: {
        avgSalary: 64_000,         // Росстат Воронежская обл. 2026 = 63 879 руб.
        salaryGrowthYoY: 9.0,
        highPaidIndustriesShare: 0.15, unemploymentRate: 3.3,
      },
      housing: {
        dealsGrowthYoY: 18.6,      // Коммерсант: ДДУ апрель 2026 +18.6% YoY — ЛИДЕР РОСТА!
        priceGrowthYoY: 11.0,      // МИР КВАРТИР: лидер Q1 +3.7% QoQ; ZSRF +0.5%/мес
        monthsOfSupply: 12,
        businessClassPricePerM2: 198_000, // рост с 185k: +3.7% QoQ → ~192k + май
        monthlySalesM2: 30_000,    // 503 ДДУ апр × 52м²
        annualDduCount: 7_200,     // Q1: 1 800; апр: 503 YoY +18.6% — сильный тренд
        sellReadinessRatioPct: 48, unsoldYearsOfSupply: 3.0,
      },
      competition: { activeDevelopers: 17, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 110, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 73_000, avgUnitSizeM2: 61, landRevenuePct: 10.0, infraCostPerTotalM2: 6_500 }, // Воронеж
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат 2026'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  volgograd: {
    inputs: {
      name: 'Волгоград',
      region: 'Волгоградская область',
      demography: { populationThousands: 1018.9, populationTrend5yPct: -3.5, shareAge25to45: 0.27, migrationBalanceThousands: -5.2 },
      economy: {
        avgSalary: 61_000,         // Росстат 2026 = 60 653 руб. — минимум среди 14 городов
        salaryGrowthYoY: 8.0,
        highPaidIndustriesShare: 0.13, unemploymentRate: 4.2,
      },
      housing: {
        dealsGrowthYoY: -49.7,     // Коммерсант: ДДУ апрель 2026 -49.7% YoY — ХУДШИЙ РЕЗУЛЬТАТ!
        priceGrowthYoY: 2.0,       // МИР КВАРТИР: -1.2% QoQ Q1; ZSRF +0.3%/мес
        monthsOfSupply: 22,        // 35 500+ нераспроданных — 1-е место в РФ
        businessClassPricePerM2: 170_000, // скромный рост от 168k
        monthlySalesM2: 14_000,    // 173 ДДУ апр × 50м² — рынок схлопнулся
        annualDduCount: 3_500,     // 2025: 4 200; Q1 2026: 1 100; апр: 173 — обвал
        sellReadinessRatioPct: 44, unsoldYearsOfSupply: 7.0,
      },
      competition: { activeDevelopers: 12, top5MarketShare: 0.72, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 45, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: false },
    },
    finance: { constructionNormativePerTotalM2: 64_000, avgUnitSizeM2: 58, landRevenuePct: 8.0, infraCostPerTotalM2: 5_500 }, // Волгоград
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'Коммерсант апр.2026', 'Росстат 2026'],
      needsVerification: ['krtProgramsHa', 'hasWhiteSpaceBusinessClass'],
    },
  },

  perm: {
    inputs: {
      name: 'Пермь',
      region: 'Пермский край',
      demography: { populationThousands: 1026.9, populationTrend5yPct: -2.8, shareAge25to45: 0.28, migrationBalanceThousands: -3.2 },
      economy: {
        avgSalary: 75_000,         // Росстат Пермский край 2026 = 74 984 руб.
        salaryGrowthYoY: 10.0,
        highPaidIndustriesShare: 0.16, unemploymentRate: 3.5,
      },
      housing: {
        dealsGrowthYoY: 0.0,       // Коммерсант: ДДУ апрель 2026 — стабилизация 0% YoY
        priceGrowthYoY: 20.0,      // МИР КВАРТИР: актуализовано +2.5% QoQ; рост ускорился май-июнь 2026
        monthsOfSupply: 10,
        businessClassPricePerM2: 238_000, // +2.2% QoQ × 2 от 228k
        monthlySalesM2: 34_000,    // 548 ДДУ апр × 55м²
        annualDduCount: 7_800,     // стабилизация vs 2025
        sellReadinessRatioPct: 68, unsoldYearsOfSupply: 3.2,
      },
      competition: { activeDevelopers: 16, top5MarketShare: 0.62, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 770, krtProjectsCount: 40, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 68_000, avgUnitSizeM2: 60, landRevenuePct: 8.5, infraCostPerTotalM2: 6_000 }, // Пермь: 8.5% — фактические КРТ-сделки (ДКЖ 25 га — 767 млн, Куйбышева 12.5 га — 356 млн) + умеренное расселение
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат 2026', 'РБК Пермь Q1 2026'],
      needsVerification: [],
    },
  },

  krasnoyarsk: {
    inputs: {
      name: 'Красноярск',
      region: 'Красноярский край',
      demography: { populationThousands: 1211.8, populationTrend5yPct: 1.8, shareAge25to45: 0.30, migrationBalanceThousands: 3.5 },
      economy: {
        avgSalary: 95_000,         // Росстат Красноярский кр. фев.2026 = 106 429 (с ресурс.регионами);
        // ~95 000 для города Красноярск (без отдалённых горно-промышленных территорий)
        salaryGrowthYoY: 14.0,     // ресурсодобыча тянет зарплаты вверх
        highPaidIndustriesShare: 0.20, unemploymentRate: 3.0,
      },
      housing: {
        dealsGrowthYoY: -2.2,      // Коммерсант: ДДУ апрель 2026 -2.2% YoY — почти ноль
        priceGrowthYoY: 5.0,       // МИР КВАРТИР: +1.8% QoQ Q1; НДВ апр +1.4%
        monthsOfSupply: 11,
        businessClassPricePerM2: 252_000, // +1.8% QoQ от 245k → +апрель +1.4%
        monthlySalesM2: 34_000,    // 444 ДДУ апр × 55м²
        annualDduCount: 13_500,    // 2025: снижение; Q1 2026: 1 400
        sellReadinessRatioPct: 55, unsoldYearsOfSupply: 5.2,
      },
      competition: { activeDevelopers: 18, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 130, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true },
    },
    finance: { constructionNormativePerTotalM2: 86_000, avgUnitSizeM2: 64, landRevenuePct: 11.5, infraCostPerTotalM2: 7_000 }, // Красноярск
    meta: {
      dataAsOfDate: '2026-05-31',
      sources: ['МИР КВАРТИР Q1 2026', 'НДВ апр.2026', 'ZSRF май 2026', 'Коммерсант апр.2026', 'Росстат Красноярский кр. 2026'],
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
