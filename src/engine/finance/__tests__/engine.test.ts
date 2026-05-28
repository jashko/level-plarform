/**
 * Юнит-тесты финансового движка.
 * Запуск:  npm test
 *
 * Покрывают:
 *  1) Тривиальные расчёты (объёмы, выручка, CAPEX).
 *  2) Математику NPV и IRR на канонических примерах.
 *  3) Инварианты cashflow с эскроу:
 *      - сумма всех escrowInflow = выручка (за вычетом хвоста после ввода);
 *      - в момент раскрытия эскроу обнуляется;
 *      - сумма equityDraw ≤ equityCap (с учётом погрешности FP);
 *      - конечный ПФ-баланс → 0 если проект полностью продан и денег хватает.
 *  4) Чувствительность IRR к цене и себестоимости (направление).
 */

import { describe, expect, it } from 'vitest';
import {
  buildMonthlyCashFlow,
  calculateCapex,
  calculateRevenue,
  calculateVolumes,
  normalizedSCurveWeights,
} from '../calculations';
import {
  calculateIRR,
  calculateNPV,
} from '../financialMetrics';
import { runScenario, runFinancialModel } from '../engine';
import { calculateSuccessProb, normalizeIrrToScore } from '../successProb';
import { DEFAULT_FINANCING_PARAMS } from '../config';
import type { ProjectInputs } from '../types';

// ────────────────────────────────────────────────────────────────
// Общие фикстуры
// ────────────────────────────────────────────────────────────────

const baseInputs: ProjectInputs = {
  landAreaHa: 2.5,
  allowedDensityM2PerHa: 20_000,
  sellableRatio: 0.80,
  averageUnitSizeM2: 50,
  housingClass: 'comfort',
  basePricePerM2: 230_000,
  landCost: 600_000_000,
  constructionCostPerM2: 95_000,
  infrastructureCost: 250_000_000,
  marketingShare: 0.04,
  constructionMonths: 30,
  discountRateAnnual: 20,
  salesVelocityM2PerMonth: 1500,
  salesStartMonth: 3,
  financing: DEFAULT_FINANCING_PARAMS,
};

// ────────────────────────────────────────────────────────────────
// 1. Объёмы, выручка, CAPEX — детерминированные простые формулы
// ────────────────────────────────────────────────────────────────

describe('calculateVolumes', () => {
  it('считает площади и количество лотов корректно', () => {
    const v = calculateVolumes(baseInputs);
    expect(v.totalBuildableM2).toBe(50_000);
    expect(v.sellableM2).toBe(40_000);
    expect(v.unitCount).toBe(800);
  });

  it('floor-ит количество лотов', () => {
    const v = calculateVolumes({ ...baseInputs, averageUnitSizeM2: 47 });
    expect(v.unitCount).toBe(Math.floor(40_000 / 47));
  });
});

describe('calculateRevenue', () => {
  it('применяет ценовой множитель сценария', () => {
    const v = calculateVolumes(baseInputs);
    const base = calculateRevenue(baseInputs, v, 'base');
    const opt = calculateRevenue(baseInputs, v, 'optimistic');
    const stress = calculateRevenue(baseInputs, v, 'stress');

    expect(base.totalRevenue).toBe(40_000 * 230_000);
    // Оптимистичный: +15%, стрессовый: −15%
    expect(opt.totalRevenue / base.totalRevenue).toBeCloseTo(1.15, 5);
    expect(stress.totalRevenue / base.totalRevenue).toBeCloseTo(0.85, 5);
  });
});

describe('calculateCapex', () => {
  it('строит сумму = земля + стройка + инфра + маркетинг', () => {
    const v = calculateVolumes(baseInputs);
    const r = calculateRevenue(baseInputs, v, 'base');
    const c = calculateCapex(baseInputs, v, r.totalRevenue, 'base');
    expect(c.total).toBeCloseTo(
      c.land + c.construction + c.infrastructure + c.marketing,
      2,
    );
    expect(c.land).toBe(600_000_000);
    expect(c.construction).toBe(40_000 * 95_000);
    expect(c.marketing).toBeCloseTo(r.totalRevenue * 0.04, 2);
  });
});

// ────────────────────────────────────────────────────────────────
// 2. S-curve
// ────────────────────────────────────────────────────────────────

describe('normalizedSCurveWeights', () => {
  it('сумма весов = 1', () => {
    const w = normalizedSCurveWeights(30);
    const sum = w.reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
  it('пик веса — около середины (симметричный колокол)', () => {
    const w = normalizedSCurveWeights(30);
    const maxIdx = w.indexOf(Math.max(...w));
    expect(maxIdx).toBeGreaterThanOrEqual(13);
    expect(maxIdx).toBeLessThanOrEqual(16);
  });
  it('для нулевого срока возвращает пустой массив', () => {
    expect(normalizedSCurveWeights(0)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. NPV и IRR — каноника
// ────────────────────────────────────────────────────────────────

describe('calculateNPV', () => {
  it('NPV нулевого потока = 0', () => {
    expect(calculateNPV([], 10)).toBe(0);
  });

  it('NPV(r=0) равен сумме потоков', () => {
    // искусственный поток: -100 в м.0, +50 в м.12, +60 в м.24
    const cf = [
      makeFlow(0, -100),
      makeFlow(12, 50),
      makeFlow(24, 60),
    ];
    expect(calculateNPV(cf, 0)).toBeCloseTo(10, 6);
  });

  it('NPV монотонно убывает по ставке для проекта с поздними притоками', () => {
    const cf = [makeFlow(0, -1000), makeFlow(36, 2000)];
    const npv0 = calculateNPV(cf, 0);
    const npv10 = calculateNPV(cf, 10);
    const npv50 = calculateNPV(cf, 50);
    expect(npv0).toBeGreaterThan(npv10);
    expect(npv10).toBeGreaterThan(npv50);
  });
});

describe('calculateIRR', () => {
  it('возвращает null если нет смены знака', () => {
    expect(calculateIRR([makeFlow(0, -100), makeFlow(12, -50)])).toBeNull();
    expect(calculateIRR([makeFlow(0, 100), makeFlow(12, 50)])).toBeNull();
  });

  it('канонический пример: -1000 сейчас, +1100 через 12 мес → IRR ≈ 10%', () => {
    const cf = [makeFlow(0, -1000), makeFlow(12, 1100)];
    const irr = calculateIRR(cf);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(10, 0); // годовая 10%
  });

  it('канонический пример: -1000 сейчас, +1500 через 24 мес → IRR ≈ 22.5%', () => {
    const cf = [makeFlow(0, -1000), makeFlow(24, 1500)];
    const irr = calculateIRR(cf);
    expect(irr).not.toBeNull();
    // sqrt(1.5) - 1 ≈ 0.2247
    expect(irr!).toBeCloseTo(22.47, 1);
  });

  it('NPV в точке IRR должен быть ≈ 0', () => {
    const cf = [
      makeFlow(0, -1000),
      makeFlow(6, 200),
      makeFlow(12, 400),
      makeFlow(24, 800),
    ];
    const irr = calculateIRR(cf);
    expect(irr).not.toBeNull();
    const npvAtIrr = calculateNPV(cf, irr!);
    expect(Math.abs(npvAtIrr)).toBeLessThan(100); // ₽ — допуск на FP-погрешность месяц↔год
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Инварианты cashflow с эскроу
// ────────────────────────────────────────────────────────────────

describe('buildMonthlyCashFlow — escrow invariants', () => {
  it('сумма escrowInflow за время стройки = выручка от ДДУ', () => {
    const v = calculateVolumes(baseInputs);
    const r = calculateRevenue(baseInputs, v, 'base');
    const c = calculateCapex(baseInputs, v, r.totalRevenue, 'base');
    const flow = buildMonthlyCashFlow(baseInputs, v, r, c, 'base');

    const escrowSum = flow.reduce((s, f) => s + f.escrowInflow, 0);
    const ddaRevenue = flow
      .filter((f) => f.month <= baseInputs.constructionMonths)
      .reduce((s, f) => s + f.revenue, 0);
    expect(escrowSum).toBeCloseTo(ddaRevenue, 0);
  });

  it('эскроу обнуляется в месяц раскрытия и не пополняется после', () => {
    const v = calculateVolumes(baseInputs);
    const r = calculateRevenue(baseInputs, v, 'base');
    const c = calculateCapex(baseInputs, v, r.totalRevenue, 'base');
    const flow = buildMonthlyCashFlow(baseInputs, v, r, c, 'base');

    const release = baseInputs.constructionMonths +
      baseInputs.financing.escrowReleaseLagMonths;
    const releaseRow = flow.find((f) => f.month === release)!;
    expect(releaseRow.escrowReleased).toBeGreaterThan(0);
    expect(releaseRow.escrowBalance).toBe(0);

    const afterRelease = flow.filter((f) => f.month > release);
    for (const f of afterRelease) {
      expect(f.escrowInflow).toBe(0);
      expect(f.escrowBalance).toBe(0);
    }
  });

  it('пиковый ПФ возникает В ИЛИ ДО раскрытия эскроу', () => {
    const result = runScenario(baseInputs, 'base');
    const release = baseInputs.constructionMonths +
      baseInputs.financing.escrowReleaseLagMonths;
    const peakMonth = result.monthlyCashFlow.reduce((acc, f) =>
      f.pfBalanceEnd > acc.pfBalanceEnd ? f : acc,
    );
    expect(peakMonth.month).toBeLessThanOrEqual(release);
  });

  it('сумма поднятого equity ≈ заявленному equityShare × CAPEX', () => {
    const result = runScenario(baseInputs, 'base');
    const equityCap = result.capex.total * baseInputs.financing.equityShare;
    expect(result.totalEquityDeployed).toBeLessThanOrEqual(equityCap + 1);
    // В нормальном проекте equity выбирается полностью
    expect(result.totalEquityDeployed).toBeGreaterThan(equityCap * 0.95);
  });

  it('итоговый ПФ-баланс ≈ 0 в успешном проекте', () => {
    const result = runScenario(baseInputs, 'base');
    const lastRow = result.monthlyCashFlow[result.monthlyCashFlow.length - 1]!;
    // Допустимая погрешность: 0.1% от пикового долга (накапливаются проценты за лаг)
    expect(lastRow.pfBalanceEnd).toBeLessThan(result.peakPfBalance * 0.001);
  });
});

// ────────────────────────────────────────────────────────────────
// 5. SuccessProb — нормализация и штрафы
// ────────────────────────────────────────────────────────────────

describe('normalizeIrrToScore', () => {
  it('IRR ≤ floor → 0, IRR ≥ ceiling → 100', () => {
    expect(normalizeIrrToScore(0)).toBe(0);
    expect(normalizeIrrToScore(15)).toBe(0);
    expect(normalizeIrrToScore(40)).toBe(100);
    expect(normalizeIrrToScore(100)).toBe(100);
  });
  it('середина диапазона — 50', () => {
    expect(normalizeIrrToScore(27.5)).toBeCloseTo(50, 1);
  });
});

describe('calculateSuccessProb', () => {
  it('штраф за красные риски снижает SuccessProb на 5 п.п. каждый', () => {
    const base = calculateSuccessProb({
      cityScore: 70, districtScore: 70, siteScore: 70,
      irrBase: 25, irrStress: 5,
      redRiskCount: 0, confidenceScore: 100,
    });
    const withRisk = calculateSuccessProb({
      cityScore: 70, districtScore: 70, siteScore: 70,
      irrBase: 25, irrStress: 5,
      redRiskCount: 2, confidenceScore: 100,
    });
    expect(base - withRisk).toBeCloseTo(10, 5);
  });

  it('штраф за отрицательный IRR_stress = 20 п.п.', () => {
    const ok = calculateSuccessProb({
      cityScore: 80, districtScore: 80, siteScore: 80,
      irrBase: 30, irrStress: 5, redRiskCount: 0, confidenceScore: 100,
    });
    const bad = calculateSuccessProb({
      cityScore: 80, districtScore: 80, siteScore: 80,
      irrBase: 30, irrStress: -5, redRiskCount: 0, confidenceScore: 100,
    });
    expect(ok - bad).toBeCloseTo(20, 5);
  });

  it('всегда в [0, 100]', () => {
    const bad = calculateSuccessProb({
      cityScore: 0, districtScore: 0, siteScore: 0,
      irrBase: 0, irrStress: -50, redRiskCount: 20, confidenceScore: 0,
    });
    const great = calculateSuccessProb({
      cityScore: 100, districtScore: 100, siteScore: 100,
      irrBase: 100, irrStress: 50, redRiskCount: 0, confidenceScore: 100,
    });
    expect(bad).toBeGreaterThanOrEqual(0);
    expect(great).toBeLessThanOrEqual(100);
  });
});

// ────────────────────────────────────────────────────────────────
// 6. Направление чувствительности
// ────────────────────────────────────────────────────────────────

describe('runFinancialModel — sensitivity directions', () => {
  it('рост цены → рост IRR (монотонно)', () => {
    const result = runFinancialModel(baseInputs);
    const table = result.sensitivity.find((t) => t.variable === 'pricePerM2')!;
    const irrs = table.cells.map((c) => c.irr!).filter((x) => x !== null);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]!).toBeGreaterThanOrEqual(irrs[i - 1]!);
    }
  });

  it('рост себестоимости → падение IRR (монотонно)', () => {
    const result = runFinancialModel(baseInputs);
    const table = result.sensitivity.find((t) => t.variable === 'constructionCost')!;
    const irrs = table.cells.map((c) => c.irr!).filter((x) => x !== null);
    for (let i = 1; i < irrs.length; i++) {
      expect(irrs[i]!).toBeLessThanOrEqual(irrs[i - 1]!);
    }
  });

  it('базовый сценарий всегда лучше стресса', () => {
    const r = runFinancialModel(baseInputs);
    expect(r.scenarios.base.npv).toBeGreaterThan(r.scenarios.stress.npv);
    expect(r.scenarios.optimistic.npv).toBeGreaterThan(r.scenarios.base.npv);
  });
});

// ────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────

function makeFlow(month: number, developerCashFlow: number) {
  return {
    month,
    landSpend: 0, constructionSpend: 0, infraSpend: 0, marketingSpend: 0,
    totalSpend: 0, m2Sold: 0, cumulativeM2Sold: 0, revenue: 0,
    projectNetCashFlow: 0,
    equityDraw: 0, cumulativeEquityDrawn: 0, pfDraw: 0,
    pfBalanceStart: 0, pfRateAnnualEffective: 0, pfInterestAccrued: 0,
    cumulativePfInterest: 0, pfRepayment: 0, pfBalanceEnd: 0,
    escrowInflow: 0, escrowBalance: 0, escrowReleased: 0,
    directInflow: 0,
    developerCashFlow,
    cumulativeDeveloperCashFlow: developerCashFlow,
  };
}
