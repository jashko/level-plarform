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
  grossMargin: number;
  /** Чистая маржа с учётом процентов по ПФ. */
  netMargin: number;
  /** Совокупный капитализированный процент по ПФ, ₽. */
  totalPfInterest: number;
  /** Пиковый долг по ПФ, ₽ (нужен для DSCR/LTV-ковенант). */
  peakPfBalance: number;
  /** Совокупный equity, поставленный в проект, ₽. */
  totalEquityDeployed: number;
  sellOutMonths: number;
  totalProjectMonths: number;
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

export interface FinancialModelOutput {
  scenarios: Record<Scenario, ScenarioResult>;
  sensitivity: SensitivityTable[];
  successProb: number;
  warnings: string[];
}
