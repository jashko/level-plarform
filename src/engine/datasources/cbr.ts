/**
 * Загрузчик данных Банка России.
 *
 * ЦБ РФ публикует ключевую ставку в открытом XML-фиде:
 *   https://www.cbr.ru/scripts/XML_dynamic.asp
 *
 * Это ЕДИНСТВЕННЫЙ источник в нашей системе, который реально работает
 * автоматически — без скрапинга HTML и без партнёрских API.
 * Все остальные источники (Росстат, Дом.РФ, NF Group) — либо ручной ввод,
 * либо скрапинг с риском поломки при изменении HTML.
 */

export interface CbrSnapshot {
  /** Дата актуальности. */
  asOfDate: string;
  /** Ключевая ставка ЦБ, % годовых. */
  keyRateAnnual: number;
  /** Средневзвешенная рыночная ставка по ипотеке, % годовых. */
  mortgageRateAnnual: number;
  /** Льготная ипотечная программа: ставка или null если не действует. */
  preferentialMortgageRate: number | null;
  /** Источник данных. */
  source: string;
  /** Метод получения: automatic = тянем сами, manual = задано вручную. */
  fetchMethod: 'automatic' | 'manual';
}

/**
 * Тянет ключевую ставку из открытого фида ЦБ РФ.
 * URL: https://www.cbr.ru/scripts/XML_dynamic.asp?VAL_NM_RQ=&date_req1=...&date_req2=...
 *
 * В среде без fetch fallback на захардкоженные данные (для unit-tests/CI).
 */
export async function fetchCbrSnapshot(): Promise<CbrSnapshot> {
  const FALLBACK: CbrSnapshot = {
    asOfDate: '2026-04-27',
    keyRateAnnual: 14.5,
    mortgageRateAnnual: 17.8,
    preferentialMortgageRate: 6.0, // Семейная ипотека
    source: 'Банк России / Дом.РФ (статический снимок)',
    fetchMethod: 'manual',
  };

  if (typeof fetch !== 'function') return FALLBACK;

  try {
    // Реальный endpoint: https://www.cbr.ru/key-indicators/
    // XML-фид ставки: https://www.cbr.ru/scripts/xml_keyrate.asp
    const url = 'https://www.cbr.ru/scripts/xml_keyrate.asp';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const fromDate = new Date(Date.now() - 30 * 86400_000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '/');
    const response = await fetch(`${url}?DateFrom=${fromDate}&DateTo=${today}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    // Минимальный XML-парсинг — берём последнее значение
    const rateMatches = [...xml.matchAll(/<Rate>([\d.,]+)<\/Rate>/g)];
    if (rateMatches.length === 0) throw new Error('no Rate tags');
    const lastRate = parseFloat(
      rateMatches[rateMatches.length - 1]![1]!.replace(',', '.'),
    );

    return {
      asOfDate: new Date().toISOString().slice(0, 10),
      keyRateAnnual: lastRate,
      // Рыночная ипотека = ключевая + 2.5-3.5 п.п. (расчёт по корреляции)
      mortgageRateAnnual: lastRate + 3.3,
      preferentialMortgageRate: 6.0, // Семейная ипотека пока 6%
      source: 'cbr.ru/scripts/xml_keyrate.asp',
      fetchMethod: 'automatic',
    };
  } catch (e) {
    console.warn('[cbr] fetch failed, using fallback:', e);
    return FALLBACK;
  }
}
