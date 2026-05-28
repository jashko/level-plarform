/**
 * Пример запуска движка v0.2 (с эскроу + ПФ).
 * Запуск:  npx tsx src/engine/finance/example.ts
 */

import { runFinancialModel, DEFAULT_FINANCING_PARAMS, type ProjectInputs } from './index';

/**
 * Реалистичный кейс: комфорт-класс в крупном региональном городе РФ
 * (Казань / Екатеринбург / Краснодар).
 *
 * Цены и себестоимость взяты из публичных отчётов девелоперов
 * (Эталон, ЛСР, ПИК) и аналитики Дом.РФ за 2024–2025.
 */
const exampleInputs: ProjectInputs = {
  landAreaHa: 2.5,
  allowedDensityM2PerHa: 20_000,
  sellableRatio: 0.80,
  averageUnitSizeM2: 50,

  housingClass: 'comfort',
  basePricePerM2: 175_000,        // 175 тыс ₽/м² — комфорт-класс, регион

  landCost: 450_000_000,          // 450 млн ₽
  constructionCostPerM2: 105_000, // 105 тыс ₽/м² — с инжсетями
  infrastructureCost: 300_000_000,// 300 млн ₽ — дороги, сети, благоустройство
  marketingShare: 0.04,

  constructionMonths: 30,
  discountRateAnnual: 20,
  salesVelocityM2PerMonth: 1200,
  salesStartMonth: 3,

  financing: DEFAULT_FINANCING_PARAMS,
};

const result = runFinancialModel(exampleInputs, {
  successProbContext: {
    cityScore: 72,
    districtScore: 65,
    siteScore: 70,
    redRiskCount: 1,
    confidenceScore: 80,
  },
});

// ─────────────────────────────────────────────────────────────
const fmtRub = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} млрд ₽`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} млн ₽`;
  return `${n.toFixed(0)} ₽`;
};
const fmtPct = (n: number | null): string =>
  n === null ? 'не сходится' : `${n.toFixed(1)}%`;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  LEVEL Platform — Financial Engine v0.2 (эскроу + ПФ)');
console.log('═══════════════════════════════════════════════════════════════');

const v = result.scenarios.base.volumes;
console.log('\n■ ОБЪЁМЫ');
console.log(`  Общая площадь:        ${v.totalBuildableM2.toLocaleString('ru-RU')} м²`);
console.log(`  Продаваемая площадь:  ${v.sellableM2.toLocaleString('ru-RU')} м²`);
console.log(`  Лотов:                ${v.unitCount}`);

console.log('\n■ KPI ПО СЦЕНАРИЯМ');
console.log('  ┌───────────────────┬──────────────┬──────────────┬──────────────┐');
console.log('  │                   │    BASE      │  OPTIMISTIC  │    STRESS    │');
console.log('  ├───────────────────┼──────────────┼──────────────┼──────────────┤');

const rows: Array<[string, (s: typeof result.scenarios.base) => string]> = [
  ['Выручка',        (s) => fmtRub(s.revenue.totalRevenue)],
  ['CAPEX',          (s) => fmtRub(s.capex.total)],
  ['Equity',         (s) => fmtRub(s.totalEquityDeployed)],
  ['Пиковый ПФ',     (s) => fmtRub(s.peakPfBalance)],
  ['% по ПФ всего',  (s) => fmtRub(s.totalPfInterest)],
  ['NPV (devCF)',    (s) => fmtRub(s.npv)],
  ['IRR (devCF)',    (s) => fmtPct(s.irr)],
  ['Gross margin',   (s) => `${s.grossMargin.toFixed(1)}%`],
  ['Net margin',     (s) => `${s.netMargin.toFixed(1)}%`],
  ['Sell-out',       (s) => `${s.sellOutMonths.toFixed(1)} мес.`],
  ['Длит. проекта',  (s) => `${s.totalProjectMonths} мес.`],
];

for (const [label, fn] of rows) {
  const pad = (s: string, w = 12) => s.padStart(w);
  console.log(
    `  │ ${label.padEnd(17)} │ ${pad(fn(result.scenarios.base))} │ ${pad(
      fn(result.scenarios.optimistic),
    )} │ ${pad(fn(result.scenarios.stress))} │`,
  );
}
console.log('  └───────────────────┴──────────────┴──────────────┴──────────────┘');

console.log('\n■ ЧУВСТВИТЕЛЬНОСТЬ IRR (базовый сценарий)');
const labels: Record<string, string> = {
  pricePerM2: 'Цена ₽/м²',
  constructionCost: 'Себестоимость',
  salesVelocity: 'Темп продаж',
  discountRate: 'Ставка диск.',
  pfBaseRate: 'Ставка ПФ',
};
console.log(
  '  ' +
    'Параметр'.padEnd(18) +
    ['−15%', '−10%', '−5%', '0', '+5%', '+10%', '+15%']
      .map((s) => s.padStart(8))
      .join(''),
);
for (const t of result.sensitivity) {
  const cells = t.cells
    .map((c) => (c.irr === null ? '   n/a' : `${c.irr.toFixed(1)}%`).padStart(8))
    .join('');
  console.log('  ' + labels[t.variable]!.padEnd(18) + cells);
}

console.log('\n■ SUCCESS PROBABILITY');
console.log(`  P(успеха) = ${result.successProb.toFixed(1)}%`);

if (result.warnings.length > 0) {
  console.log('\n■ ПРЕДУПРЕЖДЕНИЯ');
  for (const w of result.warnings) console.log(`  ⚠️  ${w}`);
}

console.log('\n■ ВЫДЕРЖКА ИЗ CASH-FLOW (BASE)');
console.log(
  '  Мес. │  Эскроу     │  ПФ долг    │  ставка ПФ │  Поток девелоп. │  Накоп. devCF',
);
console.log(
  '  ─────┼─────────────┼─────────────┼────────────┼─────────────────┼───────────────',
);
const cf = result.scenarios.base.monthlyCashFlow;
const probe = [0, 6, 12, 18, 24, 30, 32, 34, 40];
for (const m of probe) {
  const row = cf[m];
  if (!row) continue;
  console.log(
    `  ${String(row.month).padStart(3)}  │ ${fmtRub(row.escrowBalance).padStart(11)} │ ` +
      `${fmtRub(row.pfBalanceEnd).padStart(11)} │ ${row.pfRateAnnualEffective
        .toFixed(1)
        .padStart(8)}%  │ ${fmtRub(row.developerCashFlow).padStart(15)} │ ` +
      `${fmtRub(row.cumulativeDeveloperCashFlow).padStart(13)}`,
  );
}

console.log('\n═══════════════════════════════════════════════════════════════');
