#!/usr/bin/env tsx
/**
 * LEVEL Platform — ИИ Агент v3.0
 * Полностью переписан для максимальной эффективности.
 *
 * Улучшения v3.0:
 * - claude-sonnet-4-6 + extended thinking off (быстрее)
 * - Конкретные URL для каждого типа данных
 * - Агент реально обновляет данные городов (цены, сделки, зарплаты)
 * - Лучший промпт с примерами качественных инсайтов
 * - Retry логика для нестабильных источников
 * - Параллельный сбор данных где возможно
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'data', 'agent-output.json');
const MODEL = 'claude-sonnet-4-6';

// ── Типы ──────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  timestamp: string;
  category: 'macro' | 'housing' | 'mortgage' | 'city' | 'regulation' | 'krt' | 'forecast';
  title: string;
  summary: string;
  aiInsight: string;
  impact: 'positive' | 'negative' | 'neutral';
  impactLevel: 'high' | 'medium' | 'low';
  affectedCities: string[];
  sources: string[];
  dataUpdates?: DataUpdate[];
}

export interface DataUpdate {
  city?: string;
  field: string;
  oldValue: number | null;
  newValue: number;
  unit: string;
  source: string;
  confidence: number;
}

export interface MacroUpdate {
  keyRateAnnual?: number;
  mortgageRateAnnual?: number;
  inflationYoY?: number;
  mortgageShareOfDeals?: number;
  source: string;
  asOf: string;
}

export interface CityDataUpdate {
  cityKey: string;
  updates: Record<string, number>;
  source: string;
  confidence: number;
  notes?: string;
  updatedAt: string;
}

export interface AgentOutput {
  generatedAt: string;
  agentVersion: string;
  model: string;
  status: 'completed' | 'partial' | 'error';
  nextScheduledRun: string;
  runDurationMs: number;
  newsItems: NewsItem[];
  dataUpdates: DataUpdate[];
  cityDataUpdates: CityDataUpdate[];
  macroUpdate: MacroUpdate | null;
  agentActivity: AgentLogEntry[];
  summary: string;
}

export interface AgentLogEntry {
  ts: string;
  action: 'search' | 'fetch' | 'analyze' | 'update' | 'insight';
  description: string;
}

// ── Полезные URL для агента ───────────────────────────────────────────
const DATA_SOURCES = {
  macro: [
    'https://www.cbr.ru/press/pr/',                          // Пресс-релизы ЦБ
    'https://www.cbr.ru/hd_base/KeyRate/',                   // История ключевой ставки
    'https://rosstat.gov.ru/inflation',                      // Инфляция Росстат
  ],
  mortgage: [
    'https://www.banki.ru/products/hypothec/',               // Ипотека banki.ru
    'https://www.sravni.ru/ipoteka/',                        // Ипотека sravni.ru
    'https://xn--d1aqf.xn--p1ai/ipoteka/',                  // Дом.РФ ипотека
  ],
  news: [
    'https://www.rbc.ru/realty/',                            // РБК Недвижимость
    'https://realty.kommersant.ru/',                         // Коммерсант Недвижимость
    'https://www.vedomosti.ru/realty',                       // Ведомости
    'https://aif.ru/realty/',                                // АиФ Недвижимость
  ],
  domrf: [
    'https://xn--d1aqf.xn--p1ai/analytics/',                // Аналитика Дом.РФ
    'https://xn--d1aqf.xn--p1ai/press/news/',               // Новости Дом.РФ
  ],
  regional: {
    novosibirsk:  'https://ngs.ru/realty/',
    yekaterinburg:'https://www.e1.ru/realty/',
    kazan:        'https://www.kazan.kp.ru/realty/',
    nizhny:       'https://www.nn.ru/realty/',
    chelyabinsk:  'https://www.74.ru/realty/',
    samara:       'https://www.samara.ru/realty/',
    krasnodar:    'https://www.kuban.kp.ru/realty/',
    perm:         'https://www.perm.ru/realty/',
    rostov:       'https://www.161.ru/realty/',
    ufa:          'https://www.ufa.ru/realty/',
  },
  cian: 'https://www.cian.ru/stati-nedvizhimosti/',
  minstroi: 'https://minstroyrf.gov.ru/press/',
};

// ── Инструменты ───────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'fetch_url',
    description: `Загружает страницу и возвращает очищенный текст (до 3500 символов).
Лучшие источники для конкретных задач:
• КС и инфляция:   ${DATA_SOURCES.macro.join(', ')}
• Ипотека:         ${DATA_SOURCES.mortgage.join(', ')}
• Новости:         ${DATA_SOURCES.news.join(', ')}
• Дом.РФ:          ${DATA_SOURCES.domrf.join(', ')}
• ЦИАН аналитика:  ${DATA_SOURCES.cian}
• Минстрой:        ${DATA_SOURCES.minstroi}`,
    input_schema: {
      type: 'object' as const,
      properties: {
        url:     { type: 'string', description: 'Полный URL' },
        purpose: { type: 'string', description: 'Цель загрузки (для лога)' },
      },
      required: ['url', 'purpose'],
    },
  },
  {
    name: 'add_news_item',
    description: `Добавляет новость/инсайт в ленту.
ТРЕБОВАНИЕ: только реальные события с конкретными цифрами.
Плохо: "Рынок недвижимости показывает рост"
Хорошо: "ЦБ снизил КС до 14.5% — ставка ПФ упадёт с 6% до 4.5% при наполнении эскроу 80%"`,
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['macro', 'housing', 'mortgage', 'city', 'regulation', 'krt', 'forecast'],
        },
        title:    { type: 'string', description: 'Заголовок (до 90 символов, конкретный)' },
        summary:  { type: 'string', description: 'Суть события в 2-3 предложениях с цифрами' },
        aiInsight: { type: 'string', description: 'Что это значит для девелопера БК — конкретно и цифрами (3-4 предложения)' },
        impact:   { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        impactLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
        affectedCities: { type: 'array', items: { type: 'string' }, description: '[] = федеральный уровень' },
        sources: { type: 'array', items: { type: 'string' } },
      },
      required: ['category', 'title', 'summary', 'aiInsight', 'impact', 'impactLevel', 'affectedCities', 'sources'],
    },
  },
  {
    name: 'update_macro',
    description: 'Обновляет макроэкономические параметры платформы',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyRateAnnual:        { type: 'number', description: 'Ключевая ставка ЦБ, %' },
        mortgageRateAnnual:   { type: 'number', description: 'Рыночная ипотека, %' },
        inflationYoY:         { type: 'number', description: 'Инфляция CPI YoY, %' },
        mortgageShareOfDeals: { type: 'number', description: 'Доля ипотечных сделок 0..1' },
        source:               { type: 'string' },
        asOf:                 { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['source', 'asOf'],
    },
  },
  {
    name: 'update_city_data',
    description: `Обновляет данные конкретного города на основе найденных данных.
Вызывай ТОЛЬКО если нашёл реальные цифры из источника.

Доступные поля:
- businessClassPricePerM2  (цена м² бизнес-класс, ₽)
- priceGrowthYoY           (рост цены г/г, %)
- monthsOfSupply           (запас предложения, месяцев)
- dealsGrowthYoY           (рост сделок ДДУ г/г, %)
- avgSalary                (средняя зарплата, ₽/мес)
- salaryGrowthYoY          (рост зарплат г/г, %)
- unemploymentRate         (безработица, %)
- constructionVolumeMkdThousM2 (объём строительства МКД, тыс м²)
- monthlySalesM2           (продажи/мес, м²)
- annualDduCount           (ДДУ в год, шт)
- sellReadinessRatioPct    (распроданность/стройготовность, %)
- unsoldYearsOfSupply      (срок реализации остатков, лет)
- krtProgramsHa            (КРТ площадь, га)
- migrationBalanceThousands (миграционный баланс, тыс чел/год)`,
    input_schema: {
      type: 'object' as const,
      properties: {
        cityKey: {
          type: 'string',
          enum: ['novosibirsk','yekaterinburg','kazan','nizhny','chelyabinsk',
                 'samara','ufa','rostov','omsk','krasnodar','voronezh','volgograd','perm','krasnoyarsk'],
        },
        updates:    { type: 'object', additionalProperties: { type: 'number' } },
        source:     { type: 'string' },
        confidence: { type: 'number', description: '0.0–1.0' },
        notes:      { type: 'string' },
      },
      required: ['cityKey', 'updates', 'source', 'confidence'],
    },
  },
  {
    name: 'finish_report',
    description: 'Завершает сессию. Вызывать только после минимум 5 новостей и попытки обновить хотя бы 2 города.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Резюме: главные события дня + что обновлено (4-5 предложений)' },
      },
      required: ['summary'],
    },
  },
];

// ── Исполнитель инструментов ──────────────────────────────────────────

async function fetchWithRetry(url: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'ru-RU,ru;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      return text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s{3,}/g, '\n')
        .trim()
        .slice(0, 3500);
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return '';
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  state: {
    newsItems: NewsItem[];
    dataUpdates: DataUpdate[];
    cityDataUpdates: CityDataUpdate[];
    macroUpdate: MacroUpdate | null;
    activityLog: AgentLogEntry[];
    finished: boolean;
    summary: string;
  },
): Promise<string> {
  const ts = new Date().toISOString();

  if (name === 'fetch_url') {
    const url = input['url'] as string;
    const purpose = input['purpose'] as string;
    state.activityLog.push({ ts, action: 'fetch', description: `${purpose}: ${url}` });
    console.log(`  🌐 ${url}`);
    try {
      const text = await fetchWithRetry(url);
      return `[${url}]\n\n${text}`;
    } catch (e) {
      console.log(`  ⚠️  недоступен: ${(e as Error).message}`);
      return `Недоступен: ${url} — ${(e as Error).message}`;
    }
  }

  if (name === 'add_news_item') {
    const item: NewsItem = {
      id: `news-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: ts,
      category:       input['category'] as NewsItem['category'],
      title:          input['title'] as string,
      summary:        input['summary'] as string,
      aiInsight:      input['aiInsight'] as string,
      impact:         input['impact'] as NewsItem['impact'],
      impactLevel:    input['impactLevel'] as NewsItem['impactLevel'],
      affectedCities: (input['affectedCities'] as string[]) ?? [],
      sources:        (input['sources'] as string[]) ?? [],
    };
    state.newsItems.push(item);
    state.activityLog.push({ ts, action: 'insight', description: `📰 ${item.title}` });
    console.log(`  📰 [${item.category}/${item.impact}] ${item.title}`);
    return `OK: новость добавлена (всего: ${state.newsItems.length})`;
  }

  if (name === 'update_macro') {
    state.macroUpdate = input as unknown as MacroUpdate;
    state.activityLog.push({ ts, action: 'update', description: `📊 Макро: ${JSON.stringify(input)}` });
    console.log(`  📊 Макро:`, input);
    return 'OK: макро обновлено';
  }

  if (name === 'update_city_data') {
    const upd: CityDataUpdate = {
      cityKey:    input['cityKey'] as string,
      updates:    input['updates'] as Record<string, number>,
      source:     input['source'] as string,
      confidence: input['confidence'] as number,
      notes:      input['notes'] as string | undefined,
      updatedAt:  ts,
    };
    // Мерж если уже есть запись для города
    const existing = state.cityDataUpdates.find(u => u.cityKey === upd.cityKey);
    if (existing) {
      Object.assign(existing.updates, upd.updates);
      existing.updatedAt = ts;
    } else {
      state.cityDataUpdates.push(upd);
    }
    const fields = Object.keys(upd.updates).join(', ');
    state.activityLog.push({ ts, action: 'update', description: `🏙️  ${upd.cityKey}: ${fields}` });
    console.log(`  🏙️  ${upd.cityKey}:`, upd.updates);
    return `OK: ${upd.cityKey} обновлён (${fields})`;
  }

  if (name === 'finish_report') {
    state.finished = true;
    state.summary = input['summary'] as string;
    state.activityLog.push({ ts, action: 'analyze', description: '✅ Отчёт завершён' });
    return 'OK: сессия завершена';
  }

  return `Неизвестный инструмент: ${name}`;
}

// ── Системный промпт ──────────────────────────────────────────────────

function buildSystemPrompt(today: string, prevData: string): string {
  return `Ты — старший аналитик рынка недвижимости бизнес-класса России.
Платформа LEVEL Platform используется девелопером для принятия решений об экспансии в города-миллионники.
Сегодня: ${today}

${prevData}

═══════════════════════════════════════════════════════════
ЗАДАЧА: найди реальные данные и обнови платформу
═══════════════════════════════════════════════════════════

ШАГ 1 — МАКРО (обязательно):
fetch_url https://www.cbr.ru/press/pr/
→ найди КС, инфляцию, риторику ЦБ
→ update_macro + add_news_item[macro, high]

ШАГ 2 — ИПОТЕКА (обязательно):
fetch_url https://www.banki.ru/products/hypothec/
→ найди средние ставки топ-банков
→ add_news_item[mortgage]

ШАГ 3 — РЫНОК (2 источника):
fetch_url https://www.rbc.ru/realty/
fetch_url https://realty.kommersant.ru/
→ 2-3 add_news_item[housing/regulation/krt]

ШАГ 4 — ДАННЫЕ ГОРОДОВ (КРИТИЧЕСКИ ВАЖНО):
fetch_url https://xn--d1aqf.xn--p1ai/analytics/
→ найди данные по городам: цены, сделки, объёмы строительства
→ update_city_data для каждого города где нашёл цифры

ДОПОЛНИТЕЛЬНО — региональные новости:
fetch_url одного из региональных источников
→ add_news_item[city] + update_city_data если есть цифры

ШАГ 5 — ПРОГНОЗ:
→ add_news_item[forecast, high] — главный вывод дня для девелопера БК

ШАГ 6: finish_report

═══════════════════════════════════════════════════════════
СТАНДАРТ КАЧЕСТВА
═══════════════════════════════════════════════════════════

✅ ХОРОШИЙ инсайт:
"КС снижена до 14.5%. Ставка ПФ для проектов с наполнением эскроу >80% упадёт
примерно до 4-4.5%. На проект 5 млрд ₽ это экономия 75-100 млн ₽/год на обслуживании.
Следующее заседание 19 июня — вероятность снижения до 13.5% оцениваем в 60%."

❌ ПЛОХОЙ инсайт:
"Снижение ставки позитивно для рынка недвижимости."

Ключи городов для update_city_data:
novosibirsk | yekaterinburg | kazan | nizhny | chelyabinsk
samara | ufa | rostov | omsk | krasnodar | voronezh | volgograd | perm | krasnoyarsk

Минимум для завершения: 6 новостей + обновление хотя бы 2 городов.
Начинай с ШАГ 1!`;
}

// ── Главная функция ───────────────────────────────────────────────────

async function runAgent(): Promise<AgentOutput> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) { console.error('❌ ANTHROPIC_API_KEY не установлен'); process.exit(1); }

  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  const today = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   LEVEL Platform v3.0 — Daily Intelligence Agent    ║');
  console.log(`║   ${today}                                        ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const state = {
    newsItems:       [] as NewsItem[],
    dataUpdates:     [] as DataUpdate[],
    cityDataUpdates: [] as CityDataUpdate[],
    macroUpdate:     null as MacroUpdate | null,
    activityLog:     [] as AgentLogEntry[],
    finished:        false,
    summary:         '',
  };

  // Контекст из предыдущей сессии
  let prevData = '';
  try {
    if (existsSync(OUTPUT_PATH)) {
      const prev = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as AgentOutput;
      const prevMacro = prev.macroUpdate;
      const prevCities = prev.cityDataUpdates?.length ?? 0;
      prevData = `ПРЕДЫДУЩАЯ СЕССИЯ (${prev.generatedAt?.slice(0,10)}):
- КС: ${prevMacro?.keyRateAnnual ?? '?'}%, ипотека: ${prevMacro?.mortgageRateAnnual ?? '?'}%
- Новостей было: ${prev.newsItems?.length ?? 0}, городов обновлено: ${prevCities}
- Сосредоточься на том, что ИЗМЕНИЛОСЬ с тех пор`;
    }
  } catch { /* нет предыдущих данных */ }

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: 'Запускай ежедневный мониторинг. Собери максимум данных, особенно по городам.',
  }];

  let iteration = 0;
  const MAX_ITER = 25;

  while (!state.finished && iteration < MAX_ITER) {
    iteration++;
    console.log(`\n── Итерация ${iteration} ────────────────────────────`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystemPrompt(today, prevData),
      tools: TOOLS,
      messages,
    });

    console.log(`  stop: ${response.stop_reason} | tokens: ${response.usage.input_tokens}→${response.usage.output_tokens}`);

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      if (!state.finished) { state.summary = 'Завершено без finish_report.'; state.finished = true; }
      break;
    }

    const toolUses = response.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    if (toolUses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      const result = await executeTool(t.name, t.input as Record<string, unknown>, state);
      results.push({ type: 'tool_result', tool_use_id: t.id, content: result });
    }
    messages.push({ role: 'user', content: results });

    await new Promise(r => setTimeout(r, 300));
  }

  const output: AgentOutput = {
    generatedAt:      new Date().toISOString(),
    agentVersion:     '3.0',
    model:            MODEL,
    status:           state.newsItems.length >= 4 ? 'completed' : 'partial',
    nextScheduledRun: new Date(Date.now() + 86400_000).toISOString(),
    runDurationMs:    Date.now() - t0,
    newsItems:        state.newsItems,
    dataUpdates:      state.dataUpdates,
    cityDataUpdates:  state.cityDataUpdates,
    macroUpdate:      state.macroUpdate,
    agentActivity:    state.activityLog,
    summary:          state.summary,
  };

  console.log(`\n${'═'.repeat(54)}`);
  console.log(`✅ Завершено за ${(output.runDurationMs / 1000).toFixed(1)}с`);
  console.log(`📰 Новостей:         ${output.newsItems.length}`);
  console.log(`🏙️  Городов обновлено: ${output.cityDataUpdates.length}`);
  console.log(`📊 Статус:           ${output.status}`);
  console.log(`${'═'.repeat(54)}\n`);

  return output;
}

// ── Точка входа ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const output = await runAgent();
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`💾 Сохранено: ${OUTPUT_PATH}`);
    if (output.summary) console.log(`\n📌 Резюме:\n${output.summary}`);
  } catch (err) {
    console.error('❌ Ошибка агента:', err);
    const errOutput: AgentOutput = {
      generatedAt: new Date().toISOString(), agentVersion: '3.0', model: MODEL,
      status: 'error', nextScheduledRun: new Date(Date.now() + 86400_000).toISOString(),
      runDurationMs: 0, newsItems: [], dataUpdates: [], cityDataUpdates: [],
      macroUpdate: null,
      agentActivity: [{ ts: new Date().toISOString(), action: 'analyze', description: `Ошибка: ${(err as Error).message}` }],
      summary: `Ошибка: ${(err as Error).message}`,
    };
    writeFileSync(OUTPUT_PATH, JSON.stringify(errOutput, null, 2), 'utf-8');
    process.exit(1);
  }
}

main();
