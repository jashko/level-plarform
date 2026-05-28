/**
 * Демонстрация полного потока «автоматического подтягивания данных».
 * Запуск:  npx tsx src/data/ranking.demo.ts
 */

import { buildCityRanking } from './ranking';

const result = await buildCityRanking();

console.log('═══════════════════════════════════════════════════════════════');
console.log('  LEVEL Platform — Рейтинг городов-миллионников РФ');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('■ МАКРО-СНИМОК (источник: ЦБ РФ)');
console.log(`  Ключевая ставка:     ${result.macroSnapshot.keyRateAnnual.toFixed(2)}%`);
console.log(`  Рыночная ипотека:    ${result.macroSnapshot.mortgageRateAnnual.toFixed(2)}%`);
console.log(`  Семейная ипотека:    ${result.macroSnapshot.preferentialMortgageRate ?? '—'}%`);
console.log(`  MacroScore:          ${result.macroSnapshot.macroScore.toFixed(1)}/100`);
console.log(`  Метод получения:     ${result.macroSnapshot.fetchMethod}`);
console.log(`  Источник:            ${result.macroSnapshot.source}`);
console.log(`  Дата актуальности:   ${result.macroSnapshot.asOfDate}`);

const zoneIcon = { green: '🟢', orange: '🟠', yellow: '🟡', red: '🔴' };

console.log('\n■ РЕЙТИНГ ГОРОДОВ');
console.log('  Ранг │ Город              │ Score │ Зона │ Демогр │ Эконом │ Жильё │ Конкур │ Инфра');
console.log('  ─────┼────────────────────┼───────┼──────┼────────┼────────┼───────┼────────┼──────');
result.cities.forEach((c, i) => {
  const b = c.breakdown;
  console.log(
    `  ${String(i + 1).padStart(3)}. │ ${c.name.padEnd(18)} │ ${c.cityScore.toFixed(1).padStart(5)} │  ${zoneIcon[c.zone]}  │ ${b.demographyScore.toFixed(0).padStart(5)}  │ ${b.economyScore.toFixed(0).padStart(5)}  │ ${b.housingMarketScore.toFixed(0).padStart(4)}  │ ${b.competitionScore.toFixed(0).padStart(5)}  │ ${b.infrastructureScore.toFixed(0).padStart(4)}`,
  );
});

console.log('\n■ ТОП-3 СВОДКИ');
result.cities.slice(0, 3).forEach((c, i) => {
  console.log(`  ${i + 1}. ${c.summary}`);
});

console.log(`\n  Расчёт занял: ${result.durationMs} мс`);
console.log('═══════════════════════════════════════════════════════════════\n');
