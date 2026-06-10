/**
 * Финансовый движок LEVEL Platform — публичные типы.
 * v0.2: добавлено проектное финансирование и эскроу (214-ФЗ ред. 2019).
 */

export type Scenario = 'base' | 'optimistic' | 'stress';
export type HousingClass = 'comfort' | 'business';

/**
 * Параметры проектного финансирования и эскроу-счёта.
 *
 * Российская схема пост-2019:
 * - продажи по ДДУ во время стройки идут на эскроу (заморожены);
 * - стройка ведётся на кредитную линию банка (ПФ);
 * - эффективная ставка ПФ снижается по мере наполнения эскроу;
 * - проценты капитализируются в тело долга;
 * - эскроу раскрывается после ввода в эксплуатацию (+лаг).
 */
export interface ProjectFinanceParams {
  /** Доля собственного капитала в общем CAPEX (0..1). Обычно 0.15–0.25. */
  equityShare: number;
  /** Базовая ставка ПФ, % годовых (когда эскроу не покрывает тело долга). */
  pfBaseRateAnnual: number;
  /** Льготная ставка ПФ, % годовых (при полном покрытии после активации). */
  pfEscrowCoveredRateAnnual: number;
  /** Лаг от ввода в эксплуатацию до раскрытия эскроу, мес. (обычно 1–3). */
  escrowReleaseLagMonths: number;
  /**
   * Дисконт на «зачёт» эскроу при расчёте покрытия (0..1).
   * Банк учитывает только часть остатка эскроу как обеспечение.
   * Реальная практика: 0.6–0.8.
   */
  escrowCoverageDiscount: number;
  /**
   * Готовность стройки (доля кумулятивного освоения CAPEX), с которой
   * начинает действовать скидка от эскроу. До этого ставка = базовая.
   * Реальная практика: 0.20–0.40.
   */
  escrowDiscountActivationProgress: number;
  /**
   * Комиссия за резерв неиспользованного лимита кредитной линии, % годовых.
   * Реальная практика: 1–2%.
   */
  pfCommitmentFeeAnnual: number;
  /**
   * Лимит кредитной линии как множитель к CAPEX (после equity).
   * Обычно линия открывается ровно под потребность, поэтому коэффициент ~1.0.
   */
  pfCommittedLineMultiplier: number;
  /**
   * Промежуточное (поэтапное) раскрытие эскроу: доля накопленного эскроу,
   * раскрываемая при достижении готовности `escrowMidReleaseProgressPct`.
   * По ФЗ-214 ред.2023 доступно при готовности ≥30% по спецсоглашению с банком.
   * 0 = только финальное раскрытие (консервативная схема). Норма: 0.30–0.50.
   */
  escrowMidReleasePct: number;
  /**
   * Готовность стройки (0..1), при которой происходит промежуточное раскрытие.
   * Типично 0.50 (при 50% CAPEX освоения). Игнорируется если escrowMidReleasePct=0.
   */
  escrowMidReleaseProgressPct: number;
}

export interface ProjectInputs {
  // --- Участок и плотность ---
  landAreaHa: number;
  allowedDensityM2PerHa: number;
  sellableRatio: number;
  averageUnitSizeM2: number;

  // --- Класс и цена ---
  housingClass: HousingClass;
  basePricePerM2: number;

  // --- Затраты ---
  landCost: number;
  constructionCostPerM2: number;
  infrastructureCost: number;
  marketingShare: number;

  // --- Сроки и финансы ---
  constructionMonths: number;
  discountRateAnnual: number;
  salesVelocityM2PerMonth: number;
  salesStartMonth: number;

  /** Параметры проектного финансирования. Обязательны (по 214-ФЗ). */
  financing: ProjectFinanceParams;

  /**
   * Доля расторжений ДДУ: покупатели, отказавшиеся от сделки после подписания.
   * Деньги возвращаются с эскроу, застройщик ищет нового покупателя.
   * Реальная практика РФ 2024–2025: 5–12%. Default: 7%.
   * Эффект: замедляет накопление эскроу, удлиняет период продаж.
   */
  dduCancellationRatePct?: number;

  /**
   * Рабочий капитал и транзакционные издержки, % от выручки.
   * Включает: комиссию банка за ведение счёта эскроу (~0.5%/год),
   * страхование объекта (~0.3%), регистрационные сборы (~0.2%).
   * Уплачивается в month 0 из equity. Если не задан — 1.0%.
   */
  workingCapitalPct?: number;

  /**
   * Операционные расходы на содержание непроданных квартир после ввода, % от
   * себестоимости строительства в год (управляющая компания, ЖКУ, охрана).
   * Если не задан — 0.8%.
   */
  opexPctOfConstructionAnnual?: number;

  /**
   * Налог на имущество организаций (НК РФ ст. 380), % годовых.
   * База: балансовая стоимость строящегося объекта + незавершённый остаток.
   * Федеральный max 2.2%; регионы вправе снижать. Если не задан — 2.2%.
   */
  propertyTaxPct?: number;

  /**
   * Учитывать ли сезонность продаж (ежемесячные коэффициенты спроса).
   * Если true: темп продаж умножается на SALES_SEASONALITY[calendarMonth].
   * По умолчанию: включена (true).
   */
  seasonalityEnabled?: boolean;

  /**
   * Месяц начала проекта по календарю (1–12).
   * Используется для расчёта сезонных коэффициентов и распределения налогов.
   * Default: 3 (март — типичный старт весеннего девелоперского цикла).
   */
  projectStartCalendarMonth?: number;

  /**
   * Налог на прибыль, %. С 2025 года крупный бизнес — 25%, МСП — 20%.
   * Применяется к чистой прибыли (выручка − CAPEX − % ПФ).
   * Если не задан — по умолчанию 25%.
   */
  corpTaxRatePct?: number;

  /**
   * Стадийный рост цены продажи в процессе строительства, %/год.
   * По мере строительства бизнес-класс дорожает: рынок учитывает снижение риска.
   * Норма: 8–12%/год. Если не задан — 0 (нет роста).
   */
  annualPriceGrowthPct?: number;

  /**
   * Инфляция себестоимости строительства, %/год.
   * По данным Росстат 2025: рост цен строительного производства ~7%/год.
   * Если не задан — 0 (нет инфляции).
   */
  annualCostInflationPct?: number;
}

export interface ScenarioAdjustments {
  priceMultiplier: number;
  costMultiplier: number;
  salesVelocityMultiplier: number;
  discountRateDelta: number;
  /** Дельта к базовой ставке ПФ (в стрессе банки повышают, в оптимизме — снижают). */
  pfRateDelta: number;
}

export interface VolumeBreakdown {
  totalBuildableM2: number;
  sellableM2: number;
  unitCount: number;
}

export interface RevenueBreakdown {
  pricePerM2: number;
  totalRevenue: number;
  scenario: Scenario;
}

export interface CapexBreakdown {
  land: number;
  construction: number;
  infrastructure: number;
  marketing: number;
  /** Рабочий капитал: банк. комиссии + страхование + регистрация, ₽. */
  transactions: number;
  total: number;
}

/**
 * Помесячный денежный поток.
 * Содержит ТРИ среза одной картины:
 *   1) операционный (что физически тратится и продаётся),
 *   2) финансирование (эквити vs ПФ, проценты),
 *   3) эскроу (что заморожено и когда раскроется),
 * и итоговый `developerCashFlow` — это то, что идёт в NPV/IRR.
 */
export interface MonthlyCashFlow {
  month: number;

  // ── Operational (project-level) ─────────────────────────────
  landSpend: number;
  constructionSpend: number;
  infraSpend: number;
  marketingSpend: number;
  totalSpend: number;
  m2Sold: number;
  cumulativeM2Sold: number;
  /** Объём продаж (ДДУ + ДКП), ₽. Это «начисление», а не cash для девелопера. */
  revenue: number;
  /** Unlevered cash flow проекта (revenue − totalSpend). Справочно. */
  projectNetCashFlow: number;

  // ── Financing ───────────────────────────────────────────────
  equityDraw: number;
  cumulativeEquityDrawn: number;
  pfDraw: number;
  pfBalanceStart: number;
  /** Эффективная годовая ставка ПФ в этом месяце, %. */
  pfRateAnnualEffective: number;
  /** Капитализированный процент за месяц + commitment fee, ₽. */
  pfInterestAccrued: number;
  cumulativePfInterest: number;
  pfRepayment: number;
  pfBalanceEnd: number;

  // ── Эскроу ──────────────────────────────────────────────────
  /** Поступления на эскроу от ДДУ-сделок во время стройки. */
  escrowInflow: number;
  escrowBalance: number;
  /** Разблокировка эскроу (только в месяц раскрытия). */
  escrowReleased: number;

  // ── Итог для девелопера ─────────────────────────────────────
  /** Прямые продажи после ввода (ДКП). */
  directInflow: number;
  /** Операционные расходы на содержание непроданных квартир после ввода, ₽. */
  opexSpend: number;
  /** Чистый поток к девелоперу. Используется в NPV/IRR. */
  developerCashFlow: number;
  cumulativeDeveloperCashFlow: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  volumes: VolumeBreakdown;
  revenue: RevenueBreakdown;
  capex: CapexBreakdown;
  monthlyCashFlow: MonthlyCashFlow[];
  npv: number;
  irr: number | null;
  /** Валовая маржа: (Выручка − все прямые затраты) / Выручка × 100%. Без процентов по ПФ. */
  grossMargin: number;
  /** Чистая маржа: (Выручка − CAPEX − проценты ПФ) / Выручка × 100%. */
  netMargin: number;
  /** ROE: чистая прибыль / вложенный equity × 100%. Ключевая метрика для девелопера. */
  roe: number;
  /** DSCR = эскроу при раскрытии / ПФ при раскрытии. ≥1.0 = полное покрытие; <0.70 = риск хвостовых продаж. */
  dscr: number | null;
  /** Совокупный капитализированный процент по ПФ, ₽. */
  totalPfInterest: number;
  /** Пиковый долг по ПФ, ₽ (нужен для DSCR/LTV-ковенант). */
  peakPfBalance: number;
  /** Совокупный equity, поставленный в проект, ₽. */
  totalEquityDeployed: number;
  sellOutMonths: number;
  totalProjectMonths: number;
  /** Фактическая выручка с учётом стадийного роста цены, ₽. */
  actualTotalRevenue: number;
  /** Налог на прибыль (25% / 20%), начисленный на проект, ₽. */
  corpTaxAmount: number;
}

export interface SensitivityCell {
  variable: SensitivityVariable;
  delta: number;
  irr: number | null;
  npv: number;
}

export type SensitivityVariable =
  | 'pricePerM2'
  | 'constructionCost'
  | 'salesVelocity'
  | 'discountRate'
  | 'pfBaseRate';

export interface SensitivityTable {
  variable: SensitivityVariable;
  cells: SensitivityCell[];
}

export interface SuccessProbInputs {
  cityScore: number;
  districtScore: number;
  siteScore: number;
  irrBase: number;
  irrStress: number;
  redRiskCount: number;
  confidenceScore: number;
}

/**
 * Результат расчёта реального опциона на задержку старта проекта.
 *
 * Модель: European call (Black-Scholes/Merton).
 *  S  = текущая рыночная стоимость будущих доходов (≈ выручка по текущим ценам)
 *  X  = суммарный CAPEX (цена «входа»)
 *  σ  = волатильность стоимости актива (из Monte Carlo, годовая)
 *  T  = горизонт опциона, лет (обычно 1–2 года)
 *  r  = безрисковая ставка (КС)
 *
 * Интерпретация: стоимость права ПОДОЖДАТЬ до T лет перед принятием
 * инвестиционного решения. Если NPV > опцион → вход сейчас оптимален.
 */
export interface RealOptionResult {
  /** Стоимость опциона на задержку, ₽. */
  delayOptionValueRub: number;
  /** Текущая рыночная стоимость актива S, ₽. */
  assetValueRub: number;
  /** Цена «входа» X (суммарный CAPEX), ₽. */
  strikeRub: number;
  /** Годовая волатильность σ, доли (не %). */
  sigma: number;
  /** Безрисковая ставка r, доли. */
  riskFreeRate: number;
  /** Горизонт опциона T, лет. */
  optionYears: number;
  /** Критическое S/X по Дикситу-Пиндику (порог немедленного входа). */
  investThreshold: number;
  /** Рекомендация: войти сейчас / подождать / выйти. */
  interpretation: 'invest_now' | 'wait' | 'borderline';
}

/**
 * Результаты симуляции Монте-Карло (500 итераций).
 * Ключевые входные переменные перемешиваются нормальным распределением:
 * цена ±12%, себестоимость ±10%, скорость продаж ±20%, ставка ПФ ±1.5 п.п.
 */
export interface MonteCarloResult {
  iterations: number;
  meanIrrPct: number;
  medianIrrPct: number;
  p10IrrPct: number;   // 10-й перцентиль: пессимистичный исход
  p90IrrPct: number;   // 90-й перцентиль: оптимистичный исход
  stdDevIrrPct: number;
  probIrrAbove20Pct: number;  // P(IRR ≥ 20%) — минимальный порог
  probIrrAbove25Pct: number;  // P(IRR ≥ 25%) — целевой порог
  probNpvPositivePct: number; // P(NPV > 0)
}

export interface FinancialModelOutput {
  scenarios: Record<Scenario, ScenarioResult>;
  sensitivity: SensitivityTable[];
  successProb: number;
  monteCarlo: MonteCarloResult;
  realOption: RealOptionResult;
  warnings: string[];
}
