/**
 * Загрузчик данных Банка России + рыночная ипотечная ставка.
 *
 * Ключевая ставка: live fetch из XML_keyrate.asp (ЦБ РФ) при каждом запуске.
 *
 * Рыночная ипотека: загружается из src/data/macro-cbr.json который
 *   обновляется еженедельно GitHub Actions (.github/workflows/weekly-rates.yml).
 *   Скрипт fetch-cbr.ts пробует 3 источника:
 *     A. Дом.РФ API (еженедельный индекс первичного рынка)
 *     B. ЦБ РФ статистика (HTML-парсинг)
 *     C. Расчётная: КС + исторический спред (fallback)
 */

import macroCbrJson from '../../data/macro-cbr.json';

// Типизация JSON-снапшота (записывается fetch-cbr.ts)
interface SavedSnapshot {
  fetchedAt: string;
  keyRate: { currentPct: number; effectiveSince: string };
  mortgage: {
    marketRatePct: number;
    marketRateSource: string;
    marketRateFetchedAt: string;
    preferentialRatePct: number;
  };
}

const saved = macroCbrJson as SavedSnapshot;

export interface CbrSnapshot {
  /** Дата актуальности. */
  asOfDate: string;
  /** Ключевая ставка ЦБ, % годовых (live). */
  keyRateAnnual: number;
  /** Средневзвешенная рыночная ставка по ипотеке, % годовых (из open data). */
  mortgageRateAnnual: number;
  /** Откуда взята рыночная ипотечная ставка. */
  mortgageRateSource: string;
  /** Когда последний раз обновлялась ипотечная ставка. */
  mortgageRateFetchedAt: string;
  /** Льготная ипотечная программа: ставка или null если не действует. */
  preferentialMortgageRate: number | null;
  /** Источник данных. */
  source: string;
  /** Метод получения. */
  fetchMethod: 'automatic' | 'manual';
}

/**
 * Исторический спред КС → рыночная ипотека (fallback если JSON устарел).
 * Спред сужается при высокой КС (банки уже включили риск в ставку).
 */
function calcMortgageSpread(keyRate: number): number {
  if (keyRate <= 10) return 3.5;
  if (keyRate <= 16) return 3.5 + (keyRate - 10) * 0.12;
  if (keyRate <= 20) return 4.2 - (keyRate - 16) * 0.1;
  return 3.8;
}

/**
 * Тянет ключевую ставку из открытого фида ЦБ РФ.
 * Рыночная ипотечная ставка берётся из pre-built macro-cbr.json
 * (обновляется еженедельно GitHub Actions).
 */
export async function fetchCbrSnapshot(): Promise<CbrSnapshot> {
  // Mortgage rate — из еженедельно обновляемого снапшота
  const savedMortgage  = saved?.mortgage?.marketRatePct;
  const mortgageSource = saved?.mortgage?.marketRateSource ?? 'расчётная';
  const mortgageFetchedAt = saved?.mortgage?.marketRateFetchedAt ?? saved?.fetchedAt ?? '';
  const preferential   = saved?.mortgage?.preferentialRatePct ?? 6.0;

  const FALLBACK: CbrSnapshot = {
    asOfDate: saved?.fetchedAt ? saved.fetchedAt.slice(0, 10) : (saved?.keyRate?.effectiveSince ?? '2026-04-27'),
    keyRateAnnual: saved?.keyRate?.currentPct ?? 14.5,
    mortgageRateAnnual: savedMortgage ?? 18.5,
    mortgageRateSource: mortgageSource,
    mortgageRateFetchedAt: mortgageFetchedAt,
    preferentialMortgageRate: preferential,
    source: 'Банк России / macro-cbr.json (статический снимок)',
    fetchMethod: 'manual',
  };

  if (typeof fetch !== 'function') return FALLBACK;

  try {
    // Live fetch ключевой ставки
    const url = 'https://www.cbr.ru/scripts/xml_keyrate.asp';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const fromDate = new Date(Date.now() - 30 * 86400_000)
      .toISOString().slice(0, 10).replace(/-/g, '/');
    const response = await fetch(`${url}?DateFrom=${fromDate}&DateTo=${today}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const rateMatches = [...xml.matchAll(/<Rate>([\d.,]+)<\/Rate>/g)];
    if (rateMatches.length === 0) throw new Error('no Rate tags');
    const liveKeyRate = parseFloat(
      rateMatches[rateMatches.length - 1]![1]!.replace(',', '.'),
    );

    // Рыночная ипотека: если есть актуальный снапшот — берём оттуда,
    // иначе рассчитываем из live КС
    const mortgageRate = (savedMortgage != null && savedMortgage > 0)
      ? savedMortgage
      : Math.round((liveKeyRate + calcMortgageSpread(liveKeyRate)) * 10) / 10;

    const mortgageSrc = (savedMortgage != null && savedMortgage > 0)
      ? mortgageSource
      : `расчётная (КС ${liveKeyRate}% + спред)`;

    return {
      asOfDate: new Date().toISOString().slice(0, 10),
      keyRateAnnual: liveKeyRate,
      mortgageRateAnnual: mortgageRate,
      mortgageRateSource: mortgageSrc,
      mortgageRateFetchedAt: mortgageFetchedAt,
      preferentialMortgageRate: preferential,
      source: 'cbr.ru (live КС) + macro-cbr.json (ипотека)',
      fetchMethod: 'automatic',
    };
  } catch (e) {
    console.warn('[cbr] live fetch failed, using snapshot:', e);
    return FALLBACK;
  }
}
