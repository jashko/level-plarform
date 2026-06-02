#!/usr/bin/env tsx
/**
 * LEVEL Platform — ИИ Агент ежедневного обновления данных
 *
 * Архитектура:
 *   1. PHASE RESEARCH — агент обходит открытые источники (ЦБ, ДОМ.РФ, РБК, Коммерсант...)
 *   2. PHASE ANALYSIS — Claude интерпретирует данные как экономист-аналитик
 *   3. PHASE OUTPUT   — формирует JSON: новости + обновления данных + инсайты
 *   4. Сохраняет src/data/agent-output.json → коммитится GitHub Actions
 *
 * Запуск:
 *   ANTHROPIC_API_KEY=sk-ant-xxx npx tsx scripts/data-agent.ts
 *
 * Требования:
 *   - Node 18+ (встроенный fetch)
 *   - ANTHROPIC_API_KEY в переменных окружения
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'data', 'agent-output.json');

// ── Типы ────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  timestamp: string;
  category: 'macro' | 'housing' | 'mortgage' | 'city' | 'regulation' | 'krt' | 'forecast';
  title: string;
  summary: string;
  aiInsight: string;
  impact: 'positive' | 'negative' | 'neutral';
  impactLevel: 'high' | 'medium' | 'low';
  affectedCities: string[];   // city keys или [] для общефедерального
  sources: string[];          // URLs или названия источников
  dataUpdates?: DataUpdate[]; // какие данные изменились
}

export interface DataUpdate {
  city?: string;   // пустой = макро
  field: string;
  oldValue: number | null;
  newValue: number;
  unit: string;
  source: string;
  confidence: number; // 0–1
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

// ── Инструменты агента ──────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'fetch_url',
    description: `Загружает содержимое URL. Используй для получения данных с открытых источников:
      - cbr.ru (ставки, инфляция)
      - domrf.ru / наш.дом.рф (ипотека, строительство)
      - rbc.ru/realty (новости рынка)
      - kommersant.ru (аналитика)
      - rosreestr.gov.ru (ДДУ статистика)
      - consultant.ru (регуляторика)
    Возвращает первые 4000 символов текста страницы.`,
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Полный URL для загрузки' },
        purpose: { type: 'string', description: 'Зачем загружаем (для лога)' },
      },
      required: ['url', 'purpose'],
    },
  },
  {
    name: 'add_news_item',
    description: 'Записывает выявленную новость или инсайт в итоговый отчёт',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['macro', 'housing', 'mortgage', 'city', 'regulation', 'krt', 'forecast'],
          description: 'Категория новости',
        },
        title: { type: 'string', description: 'Заголовок новости (до 100 символов)' },
        summary: { type: 'string', description: 'Краткое содержание (2-3 предложения, факты)' },
        aiInsight: {
          type: 'string',
          description: 'Ваша аналитическая интерпретация — что это означает для девелопера бизнес-класса (2-4 предложения)',
        },
        impact: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
          description: 'Влияние на рынок девелопмента бизнес-класса',
        },
        impactLevel: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Уровень важности новости',
        },
        affectedCities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ключи городов (novosibirsk, yekaterinburg и т.д.) или [] для общефедерального',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Источники (URL или название)',
        },
        dataUpdates: {
          type: 'array',
          description: 'Изменения числовых показателей (если применимо)',
          items: {
            type: 'object',
            properties: {
              city:       { type: 'string' },
              field:      { type: 'string' },
              oldValue:   { type: 'number' },
              newValue:   { type: 'number' },
              unit:       { type: 'string' },
              source:     { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['field', 'newValue', 'unit', 'source', 'confidence'],
          },
        },
      },
      required: ['category', 'title', 'summary', 'aiInsight', 'impact', 'impactLevel', 'affectedCities', 'sources'],
    },
  },
  {
    name: 'update_macro',
    description: 'Обновляет глобальные макроэкономические параметры',
    input_schema: {
      type: 'object',
      properties: {
        keyRateAnnual:        { type: 'number', description: 'Ключевая ставка ЦБ, %' },
        mortgageRateAnnual:   { type: 'number', description: 'Рыночная ипотека, %' },
        inflationYoY:         { type: 'number', description: 'Инфляция YoY, %' },
        mortgageShareOfDeals: { type: 'number', description: 'Доля ипотечных сделок 0..1' },
        source:               { type: 'string', description: 'Источник данных' },
        asOf:                 { type: 'string', description: 'Дата актуальности (YYYY-MM-DD)' },
      },
      required: ['source', 'asOf'],
    },
  },
  {
    name: 'update_city_data',
    description: `Обновляет данные по конкретному городу на основе найденной информации.
Используй когда нашёл актуальные данные по: ценам, сделкам, зарплатам, вводу жилья,
ипотечной активности, новым КРТ-проектам, инфраструктурным решениям.`,
    input_schema: {
      type: 'object',
      properties: {
        cityKey: {
          type: 'string',
          description: 'Ключ города: novosibirsk | yekaterinburg | kazan | nizhny | chelyabinsk | samara | ufa | rostov | omsk | krasnodar | voronezh | volgograd | perm | krasnoyarsk',
        },
        updates: {
          type: 'object',
          description: 'Словарь обновлённых полей. Возможные ключи: businessClassPricePerM2, priceGrowthYoY, monthsOfSupply, dealsGrowthYoY, avgSalary, salaryGrowthYoY, unemploymentRate, constructionVolumeMkdThousM2, monthlySalesM2, annualDduCount, sellReadinessRatioPct, unsoldYearsOfSupply, krtProgramsHa, migrationBalanceThousands, populationThousands',
          additionalProperties: { type: 'number' },
        },
        source: { type: 'string', description: 'Источник данных (URL или название)' },
        confidence: { type: 'number', description: 'Уверенность в данных 0.0–1.0' },
        notes: { type: 'string', description: 'Комментарий (опционально)' },
      },
      required: ['cityKey', 'updates', 'source', 'confidence'],
    },
  },
  {
    name: 'finish_report',
    description: 'Завершает работу агента и формирует итоговое резюме',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Краткое резюме сессии: что было найдено, какие главные выводы (3-5 предложений)',
        },
      },
      required: ['summary'],
    },
  },
];

// ── Исполнитель инструментов ────────────────────────────────────────

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
    state.activityLog.push({ ts, action: 'fetch', description: `Загружаю: ${url} (${purpose})` });
    console.log(`  🌐 fetch_url: ${url}`);
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LevelPlatformBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(6_000),
      });
      if (!resp.ok) return `Ошибка HTTP ${resp.status} для ${url}`;
      const text = await resp.text();
      // Убираем HTML-теги, оставляем текст
      const clean = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s{3,}/g, '\n')
        .replace(/\n{4,}/g, '\n\n')
        .trim()
        .slice(0, 2500);  // Уменьшаем с 4000 до 2500 для экономии токенов
      return `URL: ${url}\n\n${clean}`;
    } catch (e) {
      return `Не удалось загрузить ${url}: ${(e as Error).message}`;
    }
  }

  if (name === 'add_news_item') {
    const item: NewsItem = {
      id: `news-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: ts,
      category:      input['category'] as NewsItem['category'],
      title:         input['title'] as string,
      summary:       input['summary'] as string,
      aiInsight:     input['aiInsight'] as string,
      impact:        input['impact'] as NewsItem['impact'],
      impactLevel:   input['impactLevel'] as NewsItem['impactLevel'],
      affectedCities: input['affectedCities'] as string[],
      sources:       input['sources'] as string[],
      dataUpdates:   (input['dataUpdates'] as DataUpdate[] | undefined) ?? [],
    };
    state.newsItems.push(item);
    if (item.dataUpdates) state.dataUpdates.push(...item.dataUpdates);
    state.activityLog.push({ ts, action: 'insight', description: `Добавлена новость: ${item.title}` });
    console.log(`  📰 add_news_item: "${item.title}" [${item.impact}/${item.impactLevel}]`);
    return `Новость добавлена: "${item.title}" (id: ${item.id})`;
  }

  if (name === 'update_city_data') {
    const cityUpdate: CityDataUpdate = {
      cityKey:   input['cityKey'] as string,
      updates:   input['updates'] as Record<string, number>,
      source:    input['source'] as string,
      confidence: input['confidence'] as number,
      notes:     input['notes'] as string | undefined,
      updatedAt: ts,
    };
    // Merge: если уже есть обновление для этого города — мержим поля
    const existing = state.cityDataUpdates.find(u => u.cityKey === cityUpdate.cityKey);
    if (existing) {
      Object.assign(existing.updates, cityUpdate.updates);
      existing.updatedAt = ts;
      existing.source = cityUpdate.source;
    } else {
      state.cityDataUpdates.push(cityUpdate);
    }
    state.activityLog.push({ ts, action: 'update', description: `Данные города ${cityUpdate.cityKey}: ${Object.keys(cityUpdate.updates).join(', ')}` });
    console.log(`  🏙️  update_city_data [${cityUpdate.cityKey}]:`, cityUpdate.updates);
    return `Данные города ${cityUpdate.cityKey} обновлены: ${JSON.stringify(cityUpdate.updates)}`;
  }

  if (name === 'update_macro') {
    state.macroUpdate = input as unknown as MacroUpdate;
    state.activityLog.push({ ts, action: 'update', description: `Макро обновлено: ${JSON.stringify(input)}` });
    console.log(`  📊 update_macro:`, input);
    return `Макропараметры обновлены: ${JSON.stringify(input)}`;
  }

  if (name === 'finish_report') {
    state.finished = true;
    state.summary = input['summary'] as string;
    state.activityLog.push({ ts, action: 'analyze', description: 'Отчёт завершён' });
    console.log(`  ✅ finish_report: ${state.summary.slice(0, 80)}...`);
    return 'Отчёт завершён успешно.';
  }

  return `Неизвестный инструмент: ${name}`;
}

// ── Системный промпт агента ─────────────────────────────────────────

function buildSystemPrompt(today: string): string {
  return `Вы — ИИ-аналитик рынка недвижимости. Ваша задача: ежедневный мониторинг рынка
первичной недвижимости бизнес-класса России и обновление данных платформы LEVEL Platform.

Сегодняшняя дата: ${today}

ЗОНА ОТВЕТСТВЕННОСТИ — 14 городов-миллионников РФ (ключи для update_city_data):
novosibirsk | yekaterinburg | kazan | nizhny | chelyabinsk | samara
ufa | rostov | omsk | krasnodar | voronezh | volgograd | perm | krasnoyarsk

═══════════════════════════════════════════════
ПОРЯДОК РАБОТЫ (строго соблюдать!)
═══════════════════════════════════════════════

ШАГ 1 — МАКРО (2 фетча → update_macro + 1 новость):
  fetch_url: https://www.cbr.ru/press/pr/
  fetch_url: https://www.banki.ru/products/hypothec/
  → update_macro (КС, ипотека, инфляция)
  → add_news_item категория=macro

ШАГ 2 — РЫНОК ЖИЛЬЯ (2 фетча → 2-3 новости):
  fetch_url: https://www.rbc.ru/realty/
  fetch_url: https://realty.kommersant.ru/
  → 2-3 add_news_item (цены, сделки, тренды)

ШАГ 3 — ДАННЫЕ ГОРОДОВ (2 фетча → update_city_data для 2-3 городов):
  fetch_url: https://naш.дом.рф/сервисы/аналитика-рынка-недвижимости  (или https://xn--d1aqf.xn--p1ai/)
  fetch_url: https://www.cian.ru/stati-nedvizhimosti/ или региональные новости
  → update_city_data для найденных городов (цены м², темп продаж, объём строительства)
  → add_news_item категория=city

ШАГ 4 — КРТ И ИНФРАСТРУКТУРА (1 фетч → 1 новость + update_city_data если есть данные):
  fetch_url: https://minstroyrf.gov.ru/press/ или https://www.rbc.ru/regions/
  → add_news_item категория=krt или regulation
  → update_city_data если нашёл данные по КРТ-программам

ШАГ 5 — ПРОГНОЗ (без фетча → 1 новость):
  На основе всего найденного — прогноз для девелопера бизнес-класса
  → add_news_item категория=forecast

ШАГ 6: finish_report

ИТОГО: 7-8 фетчей, 6-10 новостей, 2-4 обновления городов.

═══════════════════════════════════════════════
ПАРАМЕТРЫ ДЛЯ update_city_data
═══════════════════════════════════════════════
Обновляй только те поля, по которым есть РЕАЛЬНЫЕ данные из источника:
- businessClassPricePerM2  — цена м² бизнес-класс, ₽
- priceGrowthYoY           — рост цены г/г, %
- monthsOfSupply           — запас предложения, месяцев
- dealsGrowthYoY           — рост сделок г/г, %
- avgSalary                — средняя зарплата, ₽/мес
- salaryGrowthYoY          — рост зарплат г/г, %
- unemploymentRate         — безработица, %
- constructionVolumeMkdThousM2 — объём строительства МКД, тыс м²
- monthlySalesM2           — продажи/мес, м²
- annualDduCount           — ДДУ в год, шт
- sellReadinessRatioPct    — распроданность/стройготовность, %
- unsoldYearsOfSupply      — срок реализации остатков, лет
- krtProgramsHa            — КРТ площадь, га
- migrationBalanceThousands — миграционный баланс, тыс чел/год

═══════════════════════════════════════════════
ТРЕБОВАНИЯ К КАЧЕСТВУ
═══════════════════════════════════════════════
- Только факты с цифрами, без воды
- Инсайт = что это значит для девелопера бизнес-класса конкретно
- Пример хорошего инсайта: "КС снижена до 14.5% — ставка ПФ по эскроу упадёт
  с ~6% до ~4.5% при наполнении 80%. Для проекта 5 млрд ₽ экономия ~75 млн ₽/год."
- Пример плохого: "Снижение ставки положительно для рынка"

Начинай с ШАГ 1!`;
}

// ── Главная функция ─────────────────────────────────────────────────

async function runAgent(): Promise<AgentOutput> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY не установлен');
    process.exit(1);
  }

  const client = new Anthropic({
    apiKey,
    timeout: 120_000,  // 2 минуты на запрос
    maxRetries: 2,
  });
  const today = new Date().toISOString().slice(0, 10);
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  LEVEL Platform — ИИ Агент ежедневного мониторинга  ║');
  console.log(`║  ${today} ${new Date().toTimeString().slice(0,8)}${' '.repeat(26)}║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const state = {
    newsItems:        [] as NewsItem[],
    dataUpdates:      [] as DataUpdate[],
    cityDataUpdates:  [] as CityDataUpdate[],
    macroUpdate:      null as MacroUpdate | null,
    activityLog:      [] as AgentLogEntry[],
    finished:         false,
    summary:          '',
  };

  // Начальный контекст с текущими данными
  let existingData = '{}';
  try {
    if (existsSync(OUTPUT_PATH)) {
      const prev = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as AgentOutput;
      existingData = `Предыдущие данные (для понимания контекста):
        - Макро: ${JSON.stringify(prev.macroUpdate ?? {})}
        - Последнее обновление: ${prev.generatedAt}
        - Кол-во новостей в предыдущей сессии: ${prev.newsItems.length}`;
    }
  } catch { /* нет предыдущих данных */ }

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Запускаю ежедневный мониторинг данных. ${existingData}

Начни с макро-проверки (ЦБ, ДОМ.РФ), затем перейди к региональным новостям.
После сбора данных запиши все находки через инструменты и завершь через finish_report.`,
    },
  ];

  let iteration = 0;
  const MAX_ITERATIONS = 30; // защита от бесконечного цикла

  // ── Agentic Loop ─────────────────────────────────────────────────
  while (!state.finished && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n── Итерация ${iteration} ──────────────────────────────`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      system: buildSystemPrompt(today),
      tools: TOOLS,
      messages,
    });

    console.log(`  stop_reason: ${response.stop_reason}`);

    // Добавляем ответ ассистента в историю
    messages.push({ role: 'assistant', content: response.content });

    // Если нет вызовов инструментов — агент закончил
    if (response.stop_reason === 'end_turn') {
      console.log('  → Агент завершил работу (end_turn)');
      if (!state.finished) {
        state.summary = 'Сессия завершена без явного вызова finish_report.';
        state.finished = true;
      }
      break;
    }

    // Обрабатываем вызовы инструментов
    const toolUses = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use',
    );

    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        state,
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Добавляем результаты в историю
    messages.push({ role: 'user', content: toolResults });

    // Небольшая пауза чтобы не превышать лимиты rate limiting
    if (iteration < MAX_ITERATIONS - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const durationMs = Date.now() - startTime;
  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 1);
  nextRun.setHours(7, 0, 0, 0); // следующий запуск в 07:00

  const output: AgentOutput = {
    generatedAt:         new Date().toISOString(),
    agentVersion:        '2.0',
    model:               'claude-sonnet-4-6',
    status:              state.newsItems.length > 0 ? 'completed' : 'partial',
    nextScheduledRun:    nextRun.toISOString(),
    runDurationMs:       durationMs,
    newsItems:           state.newsItems,
    dataUpdates:         state.dataUpdates,
    cityDataUpdates:     state.cityDataUpdates,
    macroUpdate:         state.macroUpdate,
    agentActivity:       state.activityLog,
    summary:             state.summary,
  };

  console.log(`\n✅ Завершено за ${(durationMs / 1000).toFixed(1)}с`);
  console.log(`📰 Новостей: ${output.newsItems.length}`);
  console.log(`🏙️  Обновлений городов: ${output.cityDataUpdates.length}`);
  console.log(`📊 Обновлений данных: ${output.dataUpdates.length}`);
  console.log(`📋 Действий агента: ${output.agentActivity.length}\n`);

  return output;
}

// ── Точка входа ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    const output = await runAgent();
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`💾 Сохранено: ${OUTPUT_PATH}`);
    console.log(`\n📌 Резюме агента:\n${output.summary}`);
  } catch (err) {
    console.error('❌ Ошибка агента:', err);
    // Сохраняем error-output чтобы UI не сломался
    const errorOutput: AgentOutput = {
      generatedAt:      new Date().toISOString(),
      agentVersion:     '2.0',
      model:            'claude-sonnet-4-6',
      status:           'error',
      nextScheduledRun: new Date(Date.now() + 86400_000).toISOString(),
      runDurationMs:    0,
      newsItems:        [],
      dataUpdates:      [],
      cityDataUpdates:  [],
      macroUpdate:      null,
      agentActivity:    [{ ts: new Date().toISOString(), action: 'analyze', description: `Ошибка: ${(err as Error).message}` }],
      summary:          `Ошибка запуска агента: ${(err as Error).message}`,
    };
    writeFileSync(OUTPUT_PATH, JSON.stringify(errorOutput, null, 2), 'utf-8');
    process.exit(1);
  }
}

main();
