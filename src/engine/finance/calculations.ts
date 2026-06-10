/**
 * Базовые расчётные блоки v0.2:
 * объёмы → выручка → CAPEX → помесячный cash-flow с эскроу и ПФ.
 *
 * КЛЮЧЕВОЕ ОТЛИЧИЕ ОТ v0.1:
 * Продажи во время стройки НЕ идут напрямую застройщику.
 * Они копятся на эскроу, застройщик финансируется через ПФ под капитализируемый
 * процент, эскроу раскрывается после ввода → гасит ПФ → остаток забирает застройщик.
 *
 * Эффективная ставка ПФ в каждом месяце:
 *   effective = base · (1 − coverage) + low · coverage,
 *   где coverage = min(1, escrowBalance / pfBalance)
 * Это создаёт стимул быстро продавать — каждый ДДУ снижает стоимость долга.
 */

import { SALES_SEASONALITY, PROPERTY_TAX_RATE_DEFAULT, SCENARIO_ADJUSTMENTS } from './config';
import type {
  CapexBreakdown,
  MonthlyCashFlow,
  ProjectInputs,
  RevenueBreakdown,
  Scenario,
  VolumeBreakdown,
} from './types';

// ────────────────────────────────────────────────────────────────
// ШАГ 1: Объёмы
// ────────────────────────────────────────────────────────────────

export function calculateVolumes(inputs: ProjectInputs): VolumeBreakdown {
  const totalBuildableM2 = inputs.landAreaHa * inputs.allowedDensityM2PerHa;
  const sellableM2 = totalBuildableM2 * inputs.sellableRatio;
  const unitCount = Math.floor(sellableM2 / inputs.averageUnitSizeM2);
  return { totalBuildableM2, sellableM2, unitCount };
}

// ────────────────────────────────────────────────────────────────
// ШАГ 2: Выручка
// ────────────────────────────────────────────────────────────────

export function calculateRevenue(
  inputs: ProjectInputs,
  volumes: VolumeBreakdown,
  scenario: Scenario,
): RevenueBreakdown {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const pricePerM2 = inputs.basePricePerM2 * adj.priceMultiplier;
  const totalRevenue = volumes.sellableM2 * pricePerM2;
  return { pricePerM2, totalRevenue, scenario };
}

// ────────────────────────────────────────────────────────────────
// ШАГ 3: CAPEX
// ────────────────────────────────────────────────────────────────

export function calculateCapex(
  inputs: ProjectInputs,
  volumes: VolumeBreakdown,
  totalRevenue: number,
  scenario: Scenario,
): CapexBreakdown {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const land = inputs.landCost;
  const construction =
    volumes.sellableM2 * inputs.constructionCostPerM2 * adj.costMultiplier;
  const infrastructure = inputs.infrastructureCost;
  const marketing = totalRevenue * inputs.marketingShare;
  // Рабочий капитал: банковские комиссии эскроу + страхование + регистрация.
  // Уплачивается в month 0 из equity. Default: 1.0% от выручки.
  const transactions = totalRevenue * ((inputs.workingCapitalPct ?? 1.0) / 100);
  const total = land + construction + infrastructure + marketing + transactions;
  return { land, construction, infrastructure, marketing, transactions, total };
}

// ────────────────────────────────────────────────────────────────
// ШАГ 4: Помесячный cash-flow с эскроу и ПФ
// ────────────────────────────────────────────────────────────────

export function buildMonthlyCashFlow(
  inputs: ProjectInputs,
  volumes: VolumeBreakdown,
  revenue: RevenueBreakdown,
  capex: CapexBreakdown,
  scenario: Scenario,
): MonthlyCashFlow[] {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  // Расторжения ДДУ: часть покупателей возвращает деньги с эскроу.
  // Эффективный темп «чистых» продаж (net settled) ниже на долю расторжений.
  const cancellationRate = (inputs.dduCancellationRatePct ?? 7) / 100;
  const salesVelocity =
    inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier * (1 - cancellationRate);

  const pfBaseRate = inputs.financing.pfBaseRateAnnual + adj.pfRateDelta;
  const pfLowRate = inputs.financing.pfEscrowCoveredRateAnnual;

  // Ежемесячные ставки роста для стадийного удорожания и строительной инфляции
  const priceGrowthMonthly = (inputs.annualPriceGrowthPct ?? 0) / 100 / 12;
  const costInflationMonthly = (inputs.annualCostInflationPct ?? 0) / 100 / 12;

  const equityCap = capex.total * inputs.financing.equityShare;

  const constructionEndMonth = inputs.constructionMonths;
  const escrowReleaseMonth =
    constructionEndMonth + inputs.financing.escrowReleaseLagMonths;

  const sellOutMonths = Math.ceil(volumes.sellableM2 / Math.max(salesVelocity, 1));
  const horizon = Math.max(
    escrowReleaseMonth + 6,
    inputs.salesStartMonth + sellOutMonths + 3,
  );

  const sCurve = normalizedSCurveWeights(inputs.constructionMonths);

  const flows: MonthlyCashFlow[] = [];

  // Running state
  let cumulativeM2 = 0;
  let cumulativeEquity = 0;
  let cumulativeCapexSpent = 0;
  let pfBalance = 0;
  let cumulativePfInterest = 0;
  let escrowBalance = 0;
  let cumulativeDevCash = 0;

  // Поэтапное раскрытие эскроу (промежуточная транш при достижении готовности)
  const midReleasePct = inputs.financing.escrowMidReleasePct ?? 0;
  const midReleaseProgress = inputs.financing.escrowMidReleaseProgressPct ?? 0.50;
  let midReleaseTriggered = false;

  // Операционные расходы после ввода (содержание непроданных квартир)
  const opexMonthlyRate = (inputs.opexPctOfConstructionAnnual ?? 0.8) / 100 / 12;

  // Налог на имущество (НК РФ ст. 380): на стройку — с накопленного CAPEX
  const propertyTaxMonthlyRate = (inputs.propertyTaxPct ?? PROPERTY_TAX_RATE_DEFAULT) / 100 / 12;
  let cumulativePropertyTax = 0; // для исключения из constructionProgress

  // Сезонность продаж
  const seasonEnabled = inputs.seasonalityEnabled !== false; // true по умолчанию
  const startCalMonth = (inputs.projectStartCalendarMonth ?? 3) - 1; // 0-based

  // Лимит кредитной линии — для расчёта commitment fee
  const pfCommittedLine =
    capex.total *
    (1 - inputs.financing.equityShare) *
    inputs.financing.pfCommittedLineMultiplier;

  for (let m = 0; m <= horizon; m++) {
    // ─── 1. Operational expenses ─────────────────────────────────
    // Строительная инфляция: каждый месяц затраты растут на costInflationMonthly.
    // Коэффициент отсчитывается с месяца 1 (начало стройки).
    const inflationFactor = m >= 1
      ? Math.pow(1 + costInflationMonthly, m)
      : 1;
    // Рабочий капитал уплачивается в month 0 вместе с покупкой земли
    const landSpend = m === 0 ? capex.land + capex.transactions : 0;
    const constructionSpend =
      m >= 1 && m <= constructionEndMonth
        ? capex.construction * sCurve[m - 1]! * inflationFactor
        : 0;
    const infraSpend =
      m >= 1 && m <= constructionEndMonth
        ? (capex.infrastructure / constructionEndMonth) * inflationFactor
        : 0;

    // ─── 2. Продажи ──────────────────────────────────────────────
    // Сезонный коэффициент: умножаем темп продаж на помесячный индекс спроса.
    const calMonth = (startCalMonth + m) % 12;
    const seasonFactor = seasonEnabled ? SALES_SEASONALITY[calMonth]! : 1.0;
    let m2Sold = 0;
    if (m >= inputs.salesStartMonth && cumulativeM2 < volumes.sellableM2) {
      m2Sold = Math.min(salesVelocity * seasonFactor, volumes.sellableM2 - cumulativeM2);
    }
    cumulativeM2 += m2Sold;
    // Стадийный рост цены: каждый месяц продаж цена выше на priceGrowthMonthly.
    // Отсчёт от salesStartMonth — базовая цена в момент начала продаж.
    const priceGrowthFactor = m >= inputs.salesStartMonth
      ? Math.pow(1 + priceGrowthMonthly, m - inputs.salesStartMonth)
      : 1;
    const revenueMonth = m2Sold * revenue.pricePerM2 * priceGrowthFactor;

    const isDuringConstruction = m <= constructionEndMonth;
    const escrowInflow = isDuringConstruction ? revenueMonth : 0;
    let directInflow = isDuringConstruction ? 0 : revenueMonth;

    const marketingSpend = revenueMonth * inputs.marketingShare;

    // ─── 1b. Налог на имущество (НК РФ ст. 380) ─────────────────────────
    // Во время стройки: база = накопленный CAPEX (без самого НИ).
    // Финансируется из equity/ПФ как операционная статья проекта.
    const propertyTaxDuringConstruction = m >= 1 && m <= constructionEndMonth
      ? (cumulativeCapexSpent - cumulativePropertyTax) * propertyTaxMonthlyRate
      : 0;
    cumulativePropertyTax += propertyTaxDuringConstruction;

    const totalSpend = landSpend + constructionSpend + infraSpend + marketingSpend + propertyTaxDuringConstruction;

    // ─── 1c. Операционные расходы (после ввода в эксплуатацию) ──────────
    // Содержание непроданных квартир: ЖКУ, управляющая компания, охрана.
    // Начисляются с месяца после ввода, пропорционально непроданному остатку.
    const unsoldRatio = volumes.sellableM2 > 0
      ? Math.max(0, 1 - cumulativeM2 / volumes.sellableM2)
      : 0;
    // Opex + НИ после ввода: оба финансируются из поступлений от продаж (не из ПФ/equity)
    const postCompletionPropertyTax = m > constructionEndMonth
      ? capex.construction * unsoldRatio * propertyTaxMonthlyRate
      : 0;
    const opexSpend = m > constructionEndMonth && unsoldRatio > 0
      ? capex.construction * unsoldRatio * opexMonthlyRate + postCompletionPropertyTax
      : 0;

    // ─── 3. Финансирование: сначала equity, потом ПФ ────────────
    let equityDraw = 0;
    let pfDraw = 0;
    if (totalSpend > 0) {
      const equityRoom = Math.max(0, equityCap - cumulativeEquity);
      equityDraw = Math.min(equityRoom, totalSpend);
      pfDraw = totalSpend - equityDraw;
    }
    cumulativeEquity += equityDraw;
    cumulativeCapexSpent += totalSpend;

    // ─── 4. Эффективная ставка ПФ с floor + дисконтом ───────────
    const pfBalanceStart = pfBalance;
    // Готовность стройки = доля кумулятивного освоения CAPEX (без маркетинга и НИ).
    // НИ и маркетинг — операционные расходы, не индикатор строительной готовности.
    const constructionProgress =
      Math.min(1, (cumulativeCapexSpent - cumulativePropertyTax) / Math.max(1, capex.total - capex.marketing));

    let effectiveRateAnnual: number;
    if (constructionProgress < inputs.financing.escrowDiscountActivationProgress) {
      // Скидка ещё не активирована — ставка базовая
      effectiveRateAnnual = pfBaseRate;
    } else {
      const discountedEscrow = escrowBalance * inputs.financing.escrowCoverageDiscount;
      const coverage =
        pfBalanceStart > 0 ? Math.min(1, discountedEscrow / pfBalanceStart) : 0;
      effectiveRateAnnual = pfBaseRate * (1 - coverage) + pfLowRate * coverage;
    }
    const monthlyRate = effectiveRateAnnual / 100 / 12;
    const pfInterestAccrued = pfBalanceStart * monthlyRate;

    // Commitment fee — на неиспользованную часть лимита
    const unusedLine = Math.max(0, pfCommittedLine - pfBalanceStart);
    const commitmentFee =
      isDuringConstruction
        ? unusedLine * (inputs.financing.pfCommitmentFeeAnnual / 100 / 12)
        : 0;

    const totalFinanceCharge = pfInterestAccrued + commitmentFee;
    cumulativePfInterest += totalFinanceCharge;
    pfBalance = pfBalanceStart + pfDraw + totalFinanceCharge;

    escrowBalance += escrowInflow;

    // ─── 4b. Промежуточное (поэтапное) раскрытие эскроу ─────────────────
    // ФЗ-214 ред.2023: банк может раскрыть часть эскроу при достижении
    // застройщиком заданной строительной готовности (по спецсоглашению).
    if (
      midReleasePct > 0 &&
      !midReleaseTriggered &&
      m <= constructionEndMonth &&
      constructionProgress >= midReleaseProgress &&
      escrowBalance > 0
    ) {
      midReleaseTriggered = true;
      const midEscrow = escrowBalance * midReleasePct;
      escrowBalance -= midEscrow;
      const midPfRepay = Math.min(pfBalance, midEscrow);
      pfBalance -= midPfRepay;
      // Остаток от промежуточного раскрытия сверх долга — застройщику
      directInflow += Math.max(0, midEscrow - midPfRepay);
    }

    // ─── 5. Раскрытие эскроу ─────────────────────────────────────
    let escrowReleased = 0;
    let pfRepayment = 0;
    if (m === escrowReleaseMonth && escrowBalance > 0) {
      escrowReleased = escrowBalance;
      escrowBalance = 0;
      pfRepayment = Math.min(pfBalance, escrowReleased);
      pfBalance -= pfRepayment;
      // Остаток от эскроу после погашения ПФ — застройщику
      const surplus = escrowReleased - pfRepayment;
      directInflow += surplus;
    }

    // ─── 6. Хвостовые продажи после ввода: гасят остаток ПФ ──────
    if (m > escrowReleaseMonth && directInflow > 0 && pfBalance > 0) {
      const tailRepayment = Math.min(pfBalance, directInflow);
      pfBalance -= tailRepayment;
      pfRepayment += tailRepayment;
      directInflow -= tailRepayment;
    }

    // ─── 7. Чистый поток к девелоперу ────────────────────────────
    // Equity — отток для инвестора, прямые поступления — приток.
    // opexSpend — операционные расходы, финансируются из продаж (не из equity/ПФ).
    const developerCashFlow = directInflow - equityDraw - opexSpend;
    cumulativeDevCash += developerCashFlow;

    flows.push({
      month: m,
      landSpend,
      constructionSpend,
      infraSpend,
      marketingSpend,
      totalSpend,
      m2Sold,
      cumulativeM2Sold: cumulativeM2,
      revenue: revenueMonth,
      projectNetCashFlow: revenueMonth - totalSpend,
      equityDraw,
      cumulativeEquityDrawn: cumulativeEquity,
      pfDraw,
      pfBalanceStart,
      pfRateAnnualEffective: effectiveRateAnnual,
      pfInterestAccrued: totalFinanceCharge,
      cumulativePfInterest,
      pfRepayment,
      pfBalanceEnd: pfBalance,
      escrowInflow,
      escrowBalance,
      escrowReleased,
      directInflow,
      opexSpend,
      developerCashFlow,
      cumulativeDeveloperCashFlow: cumulativeDevCash,
    });

    // Ранний выход: всё построено, всё продано, эскроу раскрыто, ПФ закрыт
    const allDone =
      cumulativeM2 >= volumes.sellableM2 &&
      m > escrowReleaseMonth &&
      pfBalance < 1 &&
      escrowBalance < 1;
    if (allDone) break;
  }

  return flows;
}

/**
 * S-кривая распределения CAPEX по месяцам строительства.
 * Бета-форма x^α · (1-x)^β с α=β=1.5 → симметричный колокол с пиком в середине.
 */
export function normalizedSCurveWeights(months: number): number[] {
  if (months <= 0) return [];
  const raw: number[] = [];
  for (let i = 0; i < months; i++) {
    const x = (i + 0.5) / months;
    raw.push(Math.pow(x, 1.5) * Math.pow(1 - x, 1.5));
  }
  const sum = raw.reduce((s, w) => s + w, 0) || 1;
  return raw.map((w) => w / sum);
}
