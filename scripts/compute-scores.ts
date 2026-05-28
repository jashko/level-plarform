/**
 * Считает CityScore для всех 14 городов на реальных данных.
 * Запуск: npx tsx scripts/compute-scores.ts
 */

import { CITIES_DATASET, RU_CONTEXT } from '../src/data/cities';
import { calculateCityScore, calculateMacroScore } from '../src/engine/scoring';

const macro = calculateMacroScore({
  keyRateAnnual: RU_CONTEXT.keyRateAnnual,
  mortgageRateAnnual: RU_CONTEXT.mortgageRateMarket,
  preferentialMortgageRate: RU_CONTEXT.mortgageRatePreferential,
  mortgageShareOfDeals: RU_CONTEXT.mortgageShareOfDeals,
  inflationYoY: RU_CONTEXT.inflationYoY,
  realIncomeIndex3yr: RU_CONTEXT.realIncomeIndex3yr,
  unemploymentRate: RU_CONTEXT.unemploymentRate,
  medianMonthlyIncomeRu: RU_CONTEXT.medianMonthlySalary,
  medianPricePerM2Ru: RU_CONTEXT.medianPricePerM2,
});

console.log('═══════════════════════════════════════════════════════════════');
console.log('  МАКРОСРЕЗ');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  MortgageAffordabilityIndex: ${macro.mortgageAffordabilityIndex.toFixed(1)}/100`);
console.log(`  RealIncomeIndex:            ${macro.realIncomeIndex.toFixed(1)}/100`);
console.log(`  MacroRiskIndex:             ${macro.macroRiskIndex.toFixed(1)}/100 (выше=хуже)`);
console.log(`  MacroScore:                 ${macro.macroScore.toFixed(1)}/100`);
console.log(`  MacroMultiplier:            ${macro.macroMultiplier.toFixed(2)} (передаётся городам)`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  РЕЙТИНГ ГОРОДОВ-МИЛЛИОННИКОВ (CityScore)');
console.log('═══════════════════════════════════════════════════════════════');

const ranked = CITIES_DATASET
  .map((city) => ({
    city,
    result: calculateCityScore(city, {
      macroMultiplier: macro.macroMultiplier,
      ruMedianSalary: RU_CONTEXT.medianMonthlySalary,
    }),
  }))
  .sort((a, b) => b.result.cityScore - a.result.cityScore);

const zoneIcon = { green: '🟢', orange: '🟡', yellow: '🟠', red: '🔴' };

console.log(
  '\n' +
    '#'.padStart(3) +
    '  ' +
    'Город'.padEnd(20) +
    'Score  Zone  Demo  Econ  Hous  Comp  Infra  Conf',
);
console.log('  ' + '─'.repeat(75));

ranked.forEach((r, i) => {
  const b = r.result.breakdown;
  console.log(
    `${String(i + 1).padStart(3)}. ` +
      r.city.name.padEnd(20) +
      r.result.cityScore.toFixed(1).padStart(5) +
      '  ' +
      zoneIcon[r.result.zone] +
      '   ' +
      b.demographyScore.toFixed(0).padStart(4) +
      '  ' +
      b.economyScore.toFixed(0).padStart(4) +
      '  ' +
      b.housingMarketScore.toFixed(0).padStart(4) +
      '  ' +
      b.competitionScore.toFixed(0).padStart(4) +
      '  ' +
      b.infrastructureScore.toFixed(0).padStart(5) +
      '  ' +
      r.city.confidenceScore.toString().padStart(4),
  );
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  SUMMARY (топ-3 и аутсайдеры)');
console.log('═══════════════════════════════════════════════════════════════');
for (let i = 0; i < 3; i++) {
  const r = ranked[i]!;
  console.log(`\n${i + 1}. ${r.result.summary}`);
}
console.log('\n...\n');
for (let i = ranked.length - 2; i < ranked.length; i++) {
  const r = ranked[i]!;
  console.log(`${i + 1}. ${r.result.summary}`);
}
console.log();
