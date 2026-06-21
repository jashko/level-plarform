/**
 * Автозагрузка макроэкономических данных.
 *
 * Запуск:  npx tsx scripts/fetch-cbr.ts
 *
 * Что делает:
 *   1. Ключевая ставка — XML_keyrate.asp (ЦБ РФ), обновляется только в дни заседаний
 *   2. Рыночная ипотека — banki.ru → sravni.ru → ЦБ РФ XML → расчётная
 *   3. Сохраняет src/data/macro-cbr.json
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'data', 'macro-cbr.json');

// ── Расписание заседаний Совета директоров ЦБ РФ (2026) ──────────
// Источник: https://www.cbr.ru/press/event/?id=...
// Обновляй этот список раз в год когда ЦБ публикует календарь
// Официальный календарь заседаний по ключевой ставке на 2026 (cbr.ru/dkp/cal_mp/)
const CBR_MEETING_DATES_2026 = [
  '2026-02-13',
  '2026-03-20',
  '2026-04-24',
  '2026-06-19',
  '2026-07-24', // следующее заседание
  '2026-09-11',
  '2026-10-23',
  '2026-12-18',
];

const CBR_MEETING_DATES_2027 = [
  '2027-02-12',
  '2027-03-19',
  '2027-04-23',
  '2027-06-11',
  '2027-07-23',
  '2027-09-10',
  '2027-10-22',
  '2027-12-17',
];

const ALL_CBR_MEETINGS = [...CBR_MEETING_DATES_2026, ...CBR_MEETING_DATES_2027];

function isTodayCbrMeetingDay(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return ALL_CBR_MEETINGS.includes(today);
}

function getNextCbrMeeting(): string {
  const today = new Date().toISOString().slice(0, 10);
  const next = ALL_CBR_MEETINGS.find(d => d > today);
  return next ?? 'неизвестно';
}

interface MacroSnapshot {
  source: string;
  fetchedAt: string;
  keyRate: {
    currentPct: number;
    effectiveSince: string;
    nextMeetingDate: string;
    history12mo: Array<{ date: string; ratePct: number }>;
  };
  inflation: {
    yoyPct: number;
    asOf: string;
    target: number;
  };
  mortgage: {
    marketRatePct: number;
    marketRateSource: string;
    marketRateFetchedAt: string;
    preferentialRatePct: number;
    note: string;
  };
}

async function fetchCbrKeyRateHistory(): Promise<Array<{ date: string; rate: number }>> {
  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(today.getFullYear() - 1);

  const fmt = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  const url = `https://www.cbr.ru/scripts/XML_keyrate.asp?from=${fmt(yearAgo)}&to=${fmt(today)}`;
  console.log(`Запрос КС: ${url}`);

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const records: Array<{ date: string; rate: number }> = [];
    const recordRegex = /<Record\s+Date="([^"]+)"\s*>[\s\S]*?<Rate>([^<]+)<\/Rate>/g;
    let m: RegExpExecArray | null;
    while ((m = recordRegex.exec(xml)) !== null) {
      records.push({ date: m[1]!, rate: parseFloat(m[2]!.replace(',', '.')) });
    }
    return records.sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn('⚠️  ЦБ API недоступен:', (e as Error).message);
    return [];
  }
}

function isoFromCbrDate(cbrDate: string): string {
  const [dd, mm, yyyy] = cbrDate.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Источник A: banki.ru ──────────────────────────────────────────
async function fetchFromBankiru(): Promise<number | null> {
  const urls = [
    'https://www.banki.ru/products/hypothec/',
    'https://www.banki.ru/mortgage/',
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'ru-RU,ru',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Ищем ставки вида 17.5%, 18.3% и т.д. рядом со словами "ипотека", "ставка"
      const mortgageSection = html.slice(
        Math.max(0, html.toLowerCase().indexOf('ипотек') - 200),
        Math.min(html.length, html.toLowerCase().indexOf('ипотек') + 3000)
      );

      const patterns = [
        /от\s*(1[3-9]|2[0-9])[,.](\d)\s*%/gi,
        /"rate":\s*"?(1[3-9]|2[0-9])[,.](\d)"?/g,
        />(1[3-9]|2[0-9])[,.](\d)\s*%</g,
      ];

      const found: number[] = [];
      for (const rx of patterns) {
        let m: RegExpExecArray | null;
        const text = mortgageSection || html;
        while ((m = rx.exec(text)) !== null) {
          const n = parseFloat(`${m[1]}.${m[2]}`);
          if (n >= 13 && n <= 35) found.push(n);
        }
      }

      if (found.length > 0) {
        // Берём минимальную из найденных (обычно это "от X%")
        const rate = Math.min(...found);
        if (rate >= 13 && rate <= 35) {
          console.log(`  ✅ banki.ru: ${rate}%`);
          return rate;
        }
      }
    } catch (e) {
      console.log(`  ℹ️  banki.ru недоступен: ${(e as Error).message}`);
    }
  }
  return null;
}

// ── Источник B: sravni.ru ─────────────────────────────────────────
async function fetchFromSravniru(): Promise<number | null> {
  const urls = [
    'https://www.sravni.ru/ipoteka/',
    'https://www.sravni.ru/ipoteka/novostrojki/',
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'ru-RU,ru',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      const patterns = [
        /от\s*(1[3-9]|2[0-9])[,.](\d+)\s*%/gi,
        /"minRate":\s*(1[3-9]|2[0-9])[,.]?(\d*)/g,
        /"rate":\s*(1[3-9]|2[0-9])[,.]?(\d*)/g,
      ];

      const found: number[] = [];
      for (const rx of patterns) {
        let m: RegExpExecArray | null;
        while ((m = rx.exec(html)) !== null) {
          const n = parseFloat(`${m[1]}.${m[2] || '0'}`);
          if (n >= 13 && n <= 35) found.push(n);
        }
      }

      if (found.length > 0) {
        const rate = Math.min(...found);
        if (rate >= 13 && rate <= 35) {
          console.log(`  ✅ sravni.ru: ${rate}%`);
          return rate;
        }
      }
    } catch (e) {
      console.log(`  ℹ️  sravni.ru недоступен: ${(e as Error).message}`);
    }
  }
  return null;
}

// ── Источник C: ЦБ РФ XML ────────────────────────────────────────
async function fetchFromCbrXml(): Promise<number | null> {
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  const INDICATOR_IDS = ['MKICORRG', 'MKIKORRF'];
  for (const id of INDICATOR_IDS) {
    try {
      const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(threeMonthsAgo)}&date_req2=${fmt(today)}&VAL_NM_RQ=${id}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const matches = [...xml.matchAll(/<Value>([\d.,]+)<\/Value>/g)];
      if (matches.length > 0) {
        const n = parseFloat(matches[matches.length - 1]![1]!.replace(',', '.'));
        if (n >= 10 && n <= 40) {
          console.log(`  ✅ ЦБ XML (${id}): ${n}%`);
          return n;
        }
      }
    } catch { /* next */ }
  }
  return null;
}

// ── Fallback: расчётная ──────────────────────────────────────────
function calcMortgageFromKeyRate(keyRate: number): number {
  const spread =
    keyRate <= 10 ? 3.5 :
    keyRate <= 16 ? 3.5 + (keyRate - 10) * 0.12 :
    keyRate <= 20 ? 4.2 - (keyRate - 16) * 0.1 :
    3.8;
  return Math.round((keyRate + spread) * 10) / 10;
}

async function fetchMortgageRate(keyRate: number): Promise<{ rate: number; source: string }> {
  console.log('\n── Поиск рыночной ипотечной ставки (banki.ru → sravni.ru → ЦБ) ──');

  const bankiru = await fetchFromBankiru();
  if (bankiru !== null) return { rate: bankiru, source: 'banki.ru' };

  const sravniru = await fetchFromSravniru();
  if (sravniru !== null) return { rate: sravniru, source: 'sravni.ru' };

  const cbrXml = await fetchFromCbrXml();
  if (cbrXml !== null) return { rate: cbrXml, source: 'ЦБ РФ XML' };

  const calculated = calcMortgageFromKeyRate(keyRate);
  console.log(`  ℹ️  Расчётная (КС ${keyRate}%): ${calculated}%`);
  return { rate: calculated, source: 'расчётная' };
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════');
  console.log('  Автозагрузка макроданных ЦБ РФ + ипотека');
  console.log('═══════════════════════════════════════════');

  const isMeetingDay = isTodayCbrMeetingDay();
  const nextMeeting = getNextCbrMeeting();

  console.log(`📅 Сегодня ${isMeetingDay ? '🔔 ДЕНЬ ЗАСЕДАНИЯ ЦБ' : 'не день заседания ЦБ'}`);
  console.log(`📅 Следующее заседание: ${nextMeeting}`);

  // Читаем предыдущий снапшот
  let prevSnapshot: MacroSnapshot | null = null;
  try {
    if (existsSync(OUTPUT_PATH)) {
      prevSnapshot = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as MacroSnapshot;
    }
  } catch { /* нет предыдущих данных */ }

  // КС: live fetch только в день заседания, иначе берём из предыдущего снапшота
  let keyRateValue = prevSnapshot?.keyRate?.currentPct ?? 14.25;
  let effectiveSince = prevSnapshot?.keyRate?.effectiveSince ?? '2026-06-19';
  let history12mo = prevSnapshot?.keyRate?.history12mo ?? [];

  if (isMeetingDay || !prevSnapshot) {
    console.log('\n── Загружаю актуальную КС с cbr.ru ──────────');
    const records = await fetchCbrKeyRateHistory();
    if (records.length > 0) {
      const latest = records[records.length - 1]!;
      keyRateValue = latest.rate;
      effectiveSince = isoFromCbrDate(latest.date);
      history12mo = records.map(r => ({ date: isoFromCbrDate(r.date), ratePct: r.rate }));
      console.log(`✅ КС: ${keyRateValue}% с ${effectiveSince}`);
    }
  } else {
    console.log(`ℹ️  КС: используем кэш ${keyRateValue}% (следующее заседание ${nextMeeting})`);
  }

  // Ипотека: обновляем ежедневно с banki.ru/sravni.ru
  const { rate: marketRate, source: mortgageSource } = await fetchMortgageRate(keyRateValue);
  console.log(`✅ Рыночная ипотека: ${marketRate}% (${mortgageSource})\n`);

  const snapshot: MacroSnapshot = {
    source: `banki.ru / sravni.ru + ${isMeetingDay ? 'cbr.ru live' : 'кэш КС'}`,
    fetchedAt: new Date().toISOString(),
    keyRate: {
      currentPct: keyRateValue,
      effectiveSince,
      nextMeetingDate: nextMeeting,
      history12mo,
    },
    inflation: {
      yoyPct: prevSnapshot?.inflation?.yoyPct ?? 5.31,
      asOf: prevSnapshot?.inflation?.asOf ?? '2026-05',
      target: 4.0,
    },
    mortgage: {
      marketRatePct: marketRate,
      marketRateSource: mortgageSource,
      marketRateFetchedAt: new Date().toISOString(),
      preferentialRatePct: 6,
      note: `Рыночная ставка: ${mortgageSource} (топ-20 банков). Семейная ипотека: 6%. КС обновляется только в дни заседаний ЦБ (следующее: ${nextMeeting}).`,
    },
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`✅ Сохранено: ${OUTPUT_PATH}`);
  console.log('═══════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
