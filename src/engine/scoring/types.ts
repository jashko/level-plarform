/**
 * Модуль скоринга — публичные типы.
 * Реализует уровни 1–4 из ТЗ: Macro → City → District → Site.
 */

// ────────────────────────────────────────────────────────────────
// УРОВЕНЬ 1: МАКРО
// ────────────────────────────────────────────────────────────────

export interface MacroInputs {
  /** Ключевая ставка ЦБ, % годовых. */
  keyRateAnnual: number;
  /** Рыночная ставка ипотеки, % годовых. */
  mortgageRateAnnual: number;
  /** Льготная ставка ипотеки, % годовых (или null если не действует). */
  preferentialMortgageRate: number | null;
  /** Доля ипотечных сделок, 0..1. */
  mortgageShareOfDeals: number;
  /** Инфляция CPI YoY, %. */
  inflationYoY: number;
  /** Реальные доходы — индекс к 3-летней давности (1.0 = без изменений). */
  realIncomeIndex3yr: number;
  /** Уровень безработицы, %. */
  unemploymentRate: number;
  /** Медианный месячный доход по РФ, ₽. */
  medianMonthlyIncomeRu: number;
  /** Медианная цена м² по РФ, ₽. */
  medianPricePerM2Ru: number;
}

export interface MacroScoreResult {
  mortgageAffordabilityIndex: number; // 0–100
  realIncomeIndex: number;            // 0–100
  macroRiskIndex: number;             // 0–100 (выше = хуже)
  macroScore: number;                 // 0–100
  /** Передаётся вниз городам как коэффициент спроса. */
  macroMultiplier: number;            // ≈ macroScore / 100
}

// ────────────────────────────────────────────────────────────────
// УРОВЕНЬ 2: ГОРОД
// ────────────────────────────────────────────────────────────────

export interface CityDemographyInputs {
  /** Численность населения, тыс. чел. */
  populationThousands: number;
  /** Тренд населения за 5 лет, % (положит. = рост). */
  populationTrend5yPct: number;
  /** Доля возрастной группы 25–45 лет, 0..1. */
  shareAge25to45: number;
  /** Миграционный баланс, тыс. чел/год. */
  migrationBalanceThousands: number;
}

export interface CityEconomyInputs {
  /** Средняя зарплата, ₽/мес. */
  avgSalary: number;
  /** Динамика зарплат YoY, %. */
  salaryGrowthYoY: number;
  /** Доля высокооплачиваемых отраслей (IT, финансы, ОПК-ИТР), 0..1. */
  highPaidIndustriesShare: number;
  /** Безработица, %. */
  unemploymentRate: number;
}

export interface CityHousingMarketInputs {
  /** Рост объёма сделок новостроек YoY, %. */
  dealsGrowthYoY: number;
  /** Рост цены м² YoY, %. */
  priceGrowthYoY: number;
  /** Темп поглощения — запас в месяцах (предложение / помесячные продажи). */
  monthsOfSupply: number;
  /** Средняя цена м² бизнес-класса в городе, ₽. */
  businessClassPricePerM2: number;
  /** Помесячный объём продаж новостроек, м²/мес. */
  monthlySalesM2: number;
  /** Годовое число зарегистрированных ДДУ (Росреестр). */
  annualDduCount?: number;
  /** Объём жилья МКД в активном строительстве, тыс. м² (ЕИСЖС / ДОМ.РФ). */
  constructionVolumeMkdThousM2?: number;
}

export interface CityCompetitionInputs {
  /** Число активных девелоперов в городе. */
  activeDevelopers: number;
  /** Доля топ-5 в продажах, 0..1. */
  top5MarketShare: number;
  /** Присутствие федеральных игроков. */
  hasFederalPlayers: boolean;
  /** Есть ли «белые пятна» по бизнес-классу. */
  hasWhiteSpaceBusinessClass: boolean;
}

export interface CityInfrastructureInputs {
  /** Объём программ КРТ, га (площадь территорий по договорам/решениям). */
  krtProgramsHa: number;
  /** Число заключённых договоров / принятых решений КРТ (по данным Минстроя). */
  krtProjectsCount?: number;
  /** Крупные инфраструктурные проекты (метро/дороги) запланированы в 5-летке. */
  hasMajorInfraProjects: boolean;
  /** Есть ли вузы/технопарки. */
  hasUniversitiesOrTechparks: boolean;
}

export interface CityInputs {
  name: string;
  region: string;
  demography: CityDemographyInputs;
  economy: CityEconomyInputs;
  housing: CityHousingMarketInputs;
  competition: CityCompetitionInputs;
  infrastructure: CityInfrastructureInputs;
}

export interface CityScoreBreakdown {
  demographyScore: number;     // 0–100
  economyScore: number;        // 0–100
  housingMarketScore: number;  // 0–100 (уже скорректировано на macroMultiplier)
  competitionScore: number;    // 0–100
  infrastructureScore: number; // 0–100
}

export type ScoreZone = 'red' | 'yellow' | 'orange' | 'green';

export interface CityScoreResult {
  cityName: string;
  region: string;
  breakdown: CityScoreBreakdown;
  cityScore: number;          // 0–100
  zone: ScoreZone;
  summary: string;            // авто-генерируемое резюме
}

// ────────────────────────────────────────────────────────────────
// УРОВЕНЬ 3: РАЙОН
// ────────────────────────────────────────────────────────────────

export interface DistrictInputs {
  name: string;
  cityName: string;
  /** Время до делового центра, мин. */
  travelTimeToCenterMin: number;
  /** Наличие метро. */
  hasMetro: boolean;
  /** Школы и сады на 1000 жителей. */
  socialFacilitiesPer1000: number;
  /** Доступ к паркам и набережным. */
  hasParksOrWaterfront: boolean;
  /** Walkability index 0–100. */
  walkabilityIndex: number;
  /** Локальная цена м², ₽. */
  localPricePerM2: number;
  /** Динамика локальных цен YoY, %. */
  localPriceGrowthYoY: number;
  /** Прямые конкуренты в радиусе 1 км. */
  directCompetitorsCount: number;
  /** Подходит ли район под бизнес/комфорт-класс (0..1). */
  segmentAlignment: number;
}

export interface DistrictScoreBreakdown {
  accessScore: number;
  socialInfraScore: number;
  urbanQualityScore: number;
  localMarketScore: number;
  alignmentScore: number;
}

export interface DistrictScoreResult {
  districtName: string;
  cityName: string;
  breakdown: DistrictScoreBreakdown;
  districtScore: number;
  zone: ScoreZone;
}

// ────────────────────────────────────────────────────────────────
// УРОВЕНЬ 4: УЧАСТОК
// ────────────────────────────────────────────────────────────────

export interface SiteInputs {
  name: string;
  districtName: string;
  /** Площадь, га. */
  areaHa: number;
  /** Тип собственности: clean = собственность, encumbered = с обременениями. */
  ownershipStatus: 'clean' | 'encumbered';
  hasLegalDisputes: boolean;
  /** Наличие электричества, требуемой мощности (МВт). */
  electricityCapacityMw: number;
  electricityRequiredMw: number;
  /** Расстояние до точек подключения, м. */
  distanceToUtilitiesMeters: number;
  hasPowerLineRestriction: boolean;   // ЛЭП
  hasSanitaryZoneRestriction: boolean;
  hasProtectedAreaRestriction: boolean;
  /** Расстояния до окружения, м. */
  distanceToMetroMeters: number;
  distanceToSchoolMeters: number;
  distanceToParkMeters: number;
  /** Видовые характеристики. */
  hasViewAdvantage: boolean;
  /** Ожидаемая выручка, ₽ (черновая). */
  expectedRevenue: number;
  /** Ожидаемый CAPEX, ₽ (черновой). */
  expectedCapex: number;
  /** Прямые конкуренты в радиусе 1 км. */
  directCompetitorsNearby: number;
}

export interface SiteScoreBreakdown {
  legalScore: number;
  techScore: number;
  surroundingsScore: number;
  marketFitScore: number;
  rawFinancialScore: number;
}

export type GoDecision = 'go' | 'soft-go' | 'no-go';

export interface SiteScoreResult {
  siteName: string;
  districtName: string;
  breakdown: SiteScoreBreakdown;
  siteScore: number;
  zone: ScoreZone;
  decision: GoDecision;
}

// ────────────────────────────────────────────────────────────────
// ВЕСА (редактируемые через UI/JSON)
// ────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  macro: {
    mortgageAffordability: number;
    realIncome: number;
    macroRisk: number;
  };
  city: {
    demography: number;
    economy: number;
    housing: number;
    competition: number;
    infrastructure: number;
  };
  district: {
    access: number;
    socialInfra: number;
    urbanQuality: number;
    localMarket: number;
    alignment: number;
  };
  site: {
    legal: number;
    tech: number;
    surroundings: number;
    marketFit: number;
    rawFinancial: number;
  };
}
