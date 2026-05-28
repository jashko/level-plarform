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

import { SCENARIO_ADJUSTMENTS } from './config';
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
  const total = land + construction + infrastructure + marketing;
  return { land, construction, infrastructure, marketing, total };
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
  const salesVelocity = inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier;

  const pfBaseRate = inputs.financing.pfBaseRateAnnual + adj.pfRateDelta;
  const pfLowRate = inputs.financing.pfEscrowCoveredRateAnnual;
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

  // Лимит кредитной линии — для расчёта commitment fee
  const pfCommittedLine =
    capex.total *
    (1 - inputs.financing.equityShare) *
    inputs.financing.pfCommittedLineMultiplier;

  for (let m = 0; m <= horizon; m++) {
    // ─── 1. Operational expenses ─────────────────────────────────
    const landSpend = m === 0 ? capex.land : 0;
    const constructionSpend =
      m >= 1 && m <= constructionEndMonth ? capex.construction * sCurve[m - 1]! : 0;
    const infraSpend =
      m >= 1 && m <= constructionEndMonth
        ? capex.infrastructure / constructionEndMonth
        : 0;

    // ─── 2. Продажи ──────────────────────────────────────────────
    let m2Sold = 0;
    if (m >= inputs.salesStartMonth && cumulativeM2 < volumes.sellableM2) {
      m2Sold = Math.min(salesVelocity, volumes.sellableM2 - cumulativeM2);
    }
    cumulativeM2 += m2Sold;
    const revenueMonth = m2Sold * revenue.pricePerM2;

    const isDuringConstruction = m <= constructionEndMonth;
    const escrowInflow = isDuringConstruction ? revenueMonth : 0;
    let directInflow = isDuringConstruction ? 0 : revenueMonth;

    const marketingSpend = revenueMonth * inputs.marketingShare;
    const totalSpend = landSpend + constructionSpend + infraSpend + marketingSpend;

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
    // Готовность стройки = доля кумулятивного освоения CAPEX (excluding marketing).
    // Маркетинг исключаем, т.к. это операционный расход, а не индикатор готовности.
    const constructionProgress =
      Math.min(1, cumulativeCapexSpent / Math.max(1, capex.total - capex.marketing));

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
    // Маркетинг во время стройки оплачивается из equity/ПФ, в operating блок
    // уже учли, поэтому здесь только баланс инвестора.
    const developerCashFlow = directInflow - equityDraw;
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
