/**
 * Автозагрузка макроэкономических данных с открытого API ЦБ РФ.
 *
 * Запуск:
 *   npx tsx scripts/fetch-cbr.ts
 *
 * Что делает:
 *   1. Тянет историю ключевой ставки за последние 12 мес. с cbr.ru
 *   2. Парсит XML-ответ
 *   3. Сохраняет в src/data/macro-cbr.json
 *
 * Источник: https://www.cbr.ru/scripts/XML_dynamic.asp
 * (это ОТКРЫТЫЙ API ЦБ, не требует ключа, лимиты разумные)
 *
 * В UI этот JSON подгружается при старте — пользователь видит АКТУАЛЬНЫЕ
 * показатели ЦБ, обновляется через CRON / GitHub Actions раз в сутки.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'data', 'macro-cbr.json');

interface MacroSnapshot {
  source: string;
  fetchedAt: string;
  keyRate: {
    currentPct: number;
    effectiveSince: string;
    history12mo: Array<{ date: string; ratePct: number }>;
  };
  inflation: {
    yoyPct: number;
    asOf: string;
    target: number;
  };
  mortgage: {
    marketRatePct: number;        // оценка
    preferentialRatePct: number;  // семейная
    note: string;
  };
}

async function fetchCbrKeyRateHistory(): Promise<Array<{ date: string; rate: number }>> {
  // ЦБ API: даты в формате DD/MM/YYYY
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(today.getFullYear() - 1);

  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  // Индикатор «Ключевая ставка» в системе ЦБ — code 000000
  // Используем XML_keyrate.asp — специальный endpoint
  const url = `https://www.cbr.ru/scripts/XML_keyrate.asp?from=${fmt(yearAgo)}&to=${fmt(today)}`;

  console.log(`Запрос: ${url}`);

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml, text/xml, */*' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const xml = await response.text();
    // Простой regex-парсинг (легче чем тянуть xml-парсер)
    // Формат записи: <Record Date="14.05.2026"><Rate>14.5</Rate></Record>
    const records: Array<{ date: string; rate: number }> = [];
    const recordRegex = /<Record\s+Date="([^"]+)"\s*>[\s\S]*?<Rate>([^<]+)<\/Rate>/g;
    let m: RegExpExecArray | null;
    while ((m = recordRegex.exec(xml)) !== null) {
      const date = m[1]!;
      const rate = parseFloat(m[2]!.replace(',', '.'));
      records.push({ date, rate });
    }
    return records.sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn('⚠️  Не удалось обратиться к API ЦБ:', (e as Error).message);
    return [];
  }
}

function isoFromCbrDate(cbrDate: string): string {
  // 14.05.2026 → 2026-05-14
  const [dd, mm, yyyy] = cbrDate.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Автозагрузка макроданных ЦБ РФ');
  console.log('═══════════════════════════════════════════');

  const history = await fetchCbrKeyRateHistory();

  let snapshot: MacroSnapshot;

  if (history.length > 0) {
    const latest = history[history.length - 1]!;
    snapshot = {
      source: 'cbr.ru (XML_keyrate.asp)',
      fetchedAt: new Date().toISOString(),
      keyRate: {
        currentPct: latest.rate,
        effectiveSince: isoFromCbrDate(latest.date),
        history12mo: history.map((r) => ({
          date: isoFromCbrDate(r.date),
          ratePct: r.rate,
        })),
      },
      inflation: {
        // Эти показатели публикуются Росстатом отдельно, в API ЦБ их нет.
        // Берём с пресс-релиза ЦБ от 24 апреля 2026.
        yoyPct: 5.9,
        asOf: '2026-04',
        target: 4.0,
      },
      mortgage: {
        // Этих ставок тоже нет в открытом API одной строкой —
        // ЦБ публикует помесячные таблицы, для MVP захардкожено.
        marketRatePct: 18.5,
        preferentialRatePct: 6,
        note: 'Среднерыночная и семейная ипотека по итогам Q1 2026',
      },
    };
    console.log(`✅ Получено ${history.length} записей по ключевой ставке`);
    console.log(`   Текущая ставка: ${latest.rate}% c ${latest.date}`);
  } else {
    // Fallback на захардкоженные данные если API недоступен
    console.log('ℹ️  Используется fallback (нет доступа к cbr.ru)');
    snapshot = {
      source: 'fallback (cbr.ru недоступен)',
      fetchedAt: new Date().toISOString(),
      keyRate: {
        currentPct: 14.5,
        effectiveSince: '2026-04-27',
        history12mo: [
          { date: '2025-06-06', ratePct: 20 },
          { date: '2025-07-25', ratePct: 18 },
          { date: '2025-09-12', ratePct: 17 },
          { date: '2025-10-24', ratePct: 16.5 },
          { date: '2025-12-19', ratePct: 16 },
          { date: '2026-02-16', ratePct: 15.5 },
          { date: '2026-04-27', ratePct: 14.5 },
        ],
      },
      inflation: { yoyPct: 5.9, asOf: '2026-04', target: 4.0 },
      mortgage: {
        marketRatePct: 18.5,
        preferentialRatePct: 6,
        note: 'Среднерыночная и семейная ипотека по итогам Q1 2026',
      },
    };
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`✅ Сохранено: ${OUTPUT_PATH}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
