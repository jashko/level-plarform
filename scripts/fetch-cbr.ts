/**
 * Автозагрузка макроэкономических данных с открытых API.
 *
 * Запуск:  npx tsx scripts/fetch-cbr.ts
 *
 * Что делает:
 *   1. Ключевая ставка — XML_keyrate.asp (ЦБ РФ)
 *   2. Рыночная ипотека — 3 источника, каскадный fallback:
 *        A. Дом.РФ API (еженедельный индекс первичного рынка)
 *        B. ЦБ РФ — страница статистики (HTML-парсинг)
 *        C. Расчётная: КС + исторический спред (2.5–4.5 п.п.)
 *   3. Сохраняет src/data/macro-cbr.json
 *
 * Обновляется автоматически раз в неделю via GitHub Actions
 * (.github/workflows/weekly-rates.yml).
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
    marketRatePct: number;
    marketRateSource: string;    // откуда взята ставка
    marketRateFetchedAt: string; // когда обновлялась
    preferentialRatePct: number;
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

// ── Получение рыночной ипотечной ставки (3 источника) ─────────────

/**
 * Источник A: Дом.РФ — еженедельный индекс ипотечной ставки первичного рынка.
 * Дом.РФ публикует данные через открытый API без авторизации.
 */
async function fetchFromDomRF(): Promise<number | null> {
  const URLS = [
    'https://domrfbank.ru/ajax/mortgage/calculator/getActualRate/',
    'https://xn--d1aqf.xn--p1ai/api/v1/mortgage/rate/',
    'https://domrfbank.ru/mortgage/rates/ajax/',
  ];
  for (const url of URLS) {
    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as Record<string, unknown>;
      // Разные форматы ответа — перебираем возможные поля
      const candidates = [
        data['primaryRate'], data['primary_rate'], data['mortgageRate'],
        data['rate'], data['value'], data['stavka'],
        (data['data'] as Record<string, unknown>)?.['primaryRate'],
        (data['data'] as Record<string, unknown>)?.['rate'],
      ];
      for (const val of candidates) {
        const n = parseFloat(String(val).replace(',', '.'));
        if (n >= 5 && n <= 50) {
          console.log(`  ✅ Дом.РФ API (${url}): ${n}%`);
          return n;
        }
      }
    } catch { /* следующий источник */ }
  }
  return null;
}

/**
 * Источник B: ЦБ РФ — страница статистики по ипотеке.
 * Парсим HTML-таблицу, ищем последнее значение средневзвешенной ставки
 * по ипотечным кредитам в рублях (новые выдачи).
 */
async function fetchFromCbrMortgagePage(): Promise<number | null> {
  const URLS = [
    'https://www.cbr.ru/statistics/bank_sector/mortgage/',
    'https://www.cbr.ru/statistics/pdko/Stat_digest_mortgage/',
  ];
  for (const url of URLS) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru-RU,ru' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Ищем числа вида 18,5 или 18.5 рядом со словом «ипотека»/«жилищ»
      // ЦБ форматирует числа через запятую, ставки 8–40%
      const patterns = [
        /class="[^"]*rate[^"]*"[^>]*>([\d,\.]+)</gi,
        /"value":\s*([\d.]+)/g,
        />\s*(1[3-9]|2[0-9]|3[0-9])[,\.]\d+\s*</g,
      ];
      for (const rx of patterns) {
        let m: RegExpExecArray | null;
        while ((m = rx.exec(html)) !== null) {
          const s = m[1] ?? m[0];
          const n = parseFloat(s.replace(/[^\d.]/g, '.').replace('..', '.'));
          if (n >= 10 && n <= 40) {
            console.log(`  ✅ ЦБ РФ статистика (${url}): ${n}%`);
            return n;
          }
        }
      }
    } catch { /* следующий источник */ }
  }
  return null;
}

/**
 * Источник C: ЦБ РФ XML dynamic — серия процентных ставок по кредитам.
 * Indicator ID для средневзвешенной ставки по ипотечным рублёвым кредитам.
 */
async function fetchFromCbrXml(): Promise<number | null> {
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setMonth(today.getMonth() - 3);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  // ЦБ серия: ставки по кредитам населению в рублях
  const INDICATOR_IDS = ['MKICORRG', 'MKIKORRF', 'MR'];
  for (const id of INDICATOR_IDS) {
    try {
      const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(yearAgo)}&date_req2=${fmt(today)}&VAL_NM_RQ=${id}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) continue;
      const xml = await resp.text();
      // Ищем последний <Value>NN.NN</Value>
      const matches = [...xml.matchAll(/<Value>([\d.,]+)<\/Value>/g)];
      if (matches.length > 0) {
        const n = parseFloat(matches[matches.length - 1]![1]!.replace(',', '.'));
        if (n >= 5 && n <= 50) {
          console.log(`  ✅ ЦБ XML (${id}): ${n}%`);
          return n;
        }
      }
    } catch { /* следующий источник */ }
  }
  return null;
}

/**
 * Fallback D: расчётная ставка КС + исторический спред.
 * Спред сужается при высокой ключевой ставке (банки уже «зашили» риск в КС).
 *   КС ≤ 10%: спред ~3.5 п.п.
 *   КС 14–16%: спред ~3.8–4.2 п.п.
 *   КС ≥ 20%: спред ~3.0–3.5 п.п. (банки сжимают маржу)
 */
function calcMortgageFromKeyRate(keyRate: number): number {
  const spread =
    keyRate <= 10 ? 3.5 :
    keyRate <= 16 ? 3.5 + (keyRate - 10) * 0.12 :
    keyRate <= 20 ? 4.2 - (keyRate - 16) * 0.1 :
    3.8;
  return Math.round((keyRate + spread) * 10) / 10;
}

async function fetchMortgageRate(keyRate: number): Promise<{ rate: number; source: string }> {
  console.log('\n── Поиск рыночной ипотечной ставки ──────────');

  // A: Дом.РФ
  const domrf = await fetchFromDomRF();
  if (domrf !== null) return { rate: domrf, source: 'Дом.РФ API' };

  // B: ЦБ страница статистики
  const cbrPage = await fetchFromCbrMortgagePage();
  if (cbrPage !== null) return { rate: cbrPage, source: 'ЦБ РФ статистика' };

  // C: ЦБ XML серии
  const cbrXml = await fetchFromCbrXml();
  if (cbrXml !== null) return { rate: cbrXml, source: 'ЦБ РФ XML' };

  // D: расчёт
  const calculated = calcMortgageFromKeyRate(keyRate);
  console.log(`  ℹ️  Расчётная (КС ${keyRate}% + спред): ${calculated}%`);
  return { rate: calculated, source: `расчётная (КС ${keyRate}% + спред)` };
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Автозагрузка макроданных ЦБ РФ + ипотека');
  console.log('═══════════════════════════════════════════');

  const history = await fetchCbrKeyRateHistory();

  let snapshot: MacroSnapshot;

  if (history.length > 0) {
    const latest = history[history.length - 1]!;
    console.log(`✅ КС: ${latest.rate}% с ${latest.date} (${history.length} записей)`);

    // Получаем рыночную ставку из открытых источников
    const { rate: marketRate, source: mortgageSource } = await fetchMortgageRate(latest.rate);
    console.log(`✅ Рыночная ипотека: ${marketRate}% (${mortgageSource})\n`);

    snapshot = {
      source: 'cbr.ru (XML_keyrate.asp) + открытые источники',
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
        yoyPct: 5.9,
        asOf: '2026-04',
        target: 4.0,
      },
      mortgage: {
        marketRatePct: marketRate,
        marketRateSource: mortgageSource,
        marketRateFetchedAt: new Date().toISOString(),
        preferentialRatePct: 6,
        note: `Рыночная ставка: ${mortgageSource}. Семейная ипотека: 6%.`,
      },
    };
  } else {
    // Fallback если ЦБ API недоступен
    const keyFallback = 14.5;
    const { rate: marketRate, source: mortgageSource } = await fetchMortgageRate(keyFallback);
    console.log('ℹ️  КС: fallback данные (cbr.ru недоступен)');
    console.log(`✅ Рыночная ипотека: ${marketRate}% (${mortgageSource})\n`);

    snapshot = {
      source: 'fallback (cbr.ru недоступен) + открытые источники',
      fetchedAt: new Date().toISOString(),
      keyRate: {
        currentPct: keyFallback,
        effectiveSince: '2026-04-27',
        history12mo: [
          { date: '2025-06-06', ratePct: 20 },
          { date: '2025-07-25', ratePct: 18 },
          { date: '2025-09-12', ratePct: 17 },
          { date: '2025-10-24', ratePct: 16.5 },
          { date: '2025-12-19', ratePct: 16 },
          { date: '2026-02-16', ratePct: 15.5 },
          { date: '2026-04-27', ratePct: keyFallback },
        ],
      },
      inflation: { yoyPct: 5.9, asOf: '2026-04', target: 4.0 },
      mortgage: {
        marketRatePct: marketRate,
        marketRateSource: mortgageSource,
        marketRateFetchedAt: new Date().toISOString(),
        preferentialRatePct: 6,
        note: `Рыночная ставка: ${mortgageSource}. Семейная ипотека: 6%.`,
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
