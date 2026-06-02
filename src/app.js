/**
 * LEVEL Platform — UI
 * Premium dark edition · бизнес-класс как LEVEL GROUP
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, ReferenceArea, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';

import { runFinancialModel, DEFAULT_FINANCING_PARAMS, buildCityRanking, calculateDistrictScore, calculateSiteScore, calculateCityScore, calculateMacroScore, calculateMarketCycle, calculateCityRiskProfile, calculateAffordability } from './engine/index.ts';
import { RUSSIA_MILLION_CITIES, ALL_CITY_KEYS, CITY_COORDINATES } from './data/cities.ts';
import agentOutputRaw from './data/agent-output.json';

// Вшитый при сборке Anthropic API-ключ (esbuild --define:process.env.ANTHROPIC_API_KEY)
const BUILD_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── Design tokens ─────────────────────────────────────────────────
const T = {
  bg:           '#07080B',
  surface:      '#0F1116',
  surfaceRaise: '#161A22',
  border:       'rgba(255,255,255,0.07)',
  borderGold:   'rgba(201,169,110,0.28)',
  gold:         '#C9A96E',
  goldDim:      'rgba(201,169,110,0.10)',
  text:         '#EDECEA',
  textSub:      '#7A7C86',
  textMuted:    '#3E4050',
  green:        '#5BBF8A',
  orange:       '#E8924A',
  yellow:       '#D4B84A',
  red:          '#D45B5B',
  greenDim:     'rgba(91,191,138,0.09)',
  orangeDim:    'rgba(232,146,74,0.09)',
  yellowDim:    'rgba(212,184,74,0.09)',
  redDim:       'rgba(212,91,91,0.09)',
};

const ZONE = {
  green:  { fg: T.green,  bg: T.greenDim,  label: 'Зелёная' },
  orange: { fg: T.orange, bg: T.orangeDim, label: 'Оранжевая' },
  yellow: { fg: T.yellow, bg: T.yellowDim, label: 'Жёлтая' },
  red:    { fg: T.red,    bg: T.redDim,    label: 'Красная' },
};

const SCENARIO_LABELS = { base: 'BASE', optimistic: 'OPT', stress: 'STRESS' };
const SCENARIO_COLORS = { base: T.gold, optimistic: T.green, stress: T.red };

const CYCLE_CONFIG = {
  recovery:   { color: T.green,  bg: T.greenDim,  icon: '↗', label: 'Дефицит предложения' },
  expansion:  { color: '#5BA0BF', bg: 'rgba(91,160,191,0.09)', icon: '→', label: 'Рост' },
  peak:       { color: T.yellow, bg: T.yellowDim, icon: '⚠', label: 'Перегрев' },
  slowdown:   { color: T.orange, bg: T.orangeDim, icon: '↘', label: 'Охлаждение / Коррекция' },
  oversupply: { color: T.red,    bg: T.redDim,    icon: '↓', label: 'Перенасыщение' },
};

const ENTRY_SIGNAL_CONFIG = {
  enter: { color: T.green,  bg: T.greenDim,  label: 'Входить' },
  watch: { color: T.yellow, bg: T.yellowDim, label: 'Наблюдать' },
  wait:  { color: T.red,    bg: T.redDim,    label: 'Ждать' },
};

// ── Recharts dark theme defaults ──────────────────────────────────
const CHART_GRID  = { stroke: 'rgba(255,255,255,0.05)', strokeDasharray: '4 4' };
const CHART_TICK  = { fontSize: 11, fill: T.textSub, fontFamily: 'Inter, sans-serif' };
const CHART_TIP   = {
  contentStyle: {
    background: T.surfaceRaise,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 12,
    fontFamily: 'Inter, sans-serif',
  },
  cursor: { stroke: 'rgba(255,255,255,0.05)' },
};

// ── Format utils ──────────────────────────────────────────────────
const fmtRub = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} млрд ₽`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} млн ₽`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)} тыс ₽`;
  return `${sign}${abs.toFixed(0)} ₽`;
};
const fmtPct = (n, d = 1) =>
  n === null || n === undefined || isNaN(n) ? '—' : `${n.toFixed(d)}%`;
const fmtNum = (n) => n.toLocaleString('ru-RU');

// ── Responsive hook ──────────────────────────────────────────────
function useIsMobile() {
  const [m, setM] = React.useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

// ── Utilities ─────────────────────────────────────────────────────
const debounce = (fn, wait) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
};

const downloadCSV = (rows, filename) => {
  const csv = rows.map(r =>
    r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
};

// History — localStorage
const HISTORY_KEY = 'level_history_v1';
const getHistory  = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
const saveToHistory = (entry) => {
  const h = getHistory().filter(e => e.id !== entry.id);
  h.unshift({ ...entry, id: Date.now(), savedAt: new Date().toLocaleString('ru-RU') });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 20)));
};
const clearHistory = () => localStorage.removeItem(HISTORY_KEY);

// Mock 12-month price trend derived from city's current price
const getMockTrends = (city) => {
  const base = city.inputs.housing.businessClassPricePerM2;
  const months = ['май','июн','июл','авг','сен','окт','ноя','дек','янв','фев','мар','апр'];
  const seed   = city.key.charCodeAt(0);
  return months.map((month, i) => {
    const trend = base * (0.92 + (i / 11) * 0.08);           // ~8% growth over year
    const noise = Math.sin(seed + i * 1.7) * base * 0.018;   // ±1.8% noise
    return { month, price: Math.round((trend + noise) / 1000) };
  });
};

// ── Hint content dictionary ───────────────────────────────────────
const HINTS = {
  keyRate: {
    title: 'Ключевая ставка ЦБ РФ',
    desc: 'Базовая процентная ставка ЦБ. Определяет стоимость проектного финансирования (эскроу), уровень ипотечных ставок и доходность альтернативных инструментов. Обновляется в дни заседаний Совета директоров.',
  },
  mortgageRate: {
    title: 'Рыночная ипотека',
    desc: 'Средневзвешенная ставка по рыночной ипотеке на первичном рынке среди топ-20 банков. Источник: banki.ru / sravni.ru. Обновляется агентом ежедневно.',
  },
  familyMortgage: {
    title: 'Семейная ипотека',
    desc: 'Льготная ставка по госпрограмме поддержки семей с детьми. Субсидируется из федерального бюджета, стимулирует спрос на первичном рынке.',
  },
  macroScore: {
    title: 'MacroScore',
    desc: 'Интегральная оценка макроэкономической среды (0–100). Высокий скор — благоприятная среда: доступное ПФ, активный ипотечный спрос, низкие страновые риски.',
    formula: 'Взвешено: ставка ЦБ + ипотека + инфляция + деловая активность',
  },
  cityScore: {
    title: 'CityScore',
    desc: 'Интегральный скор города (0–100) по 5 блокам: демография, экономика, рынок жилья, инфраструктура, риски. Главный фильтр при выборе города для девелопмента бизнес-класса.',
    formula: 'Демография×25 + Экономика×25 + Рынок×30 + Инфра×10 + Риски×10',
  },
  cityZone: {
    title: 'Инвестиционная зона',
    desc: 'Классификация по уровню привлекательности:\nЗелёная (≥75) — приоритетный рынок\nОранжевая (55–75) — перспективный\nЖёлтая (40–55) — осторожно\nКрасная (<40) — не рекомендован',
  },
  districtScore: {
    title: 'DistrictScore',
    desc: 'Интегральный скор района (0–100) с точки зрения покупателя бизнес-класса: транспорт, школы, качество среды, локальные цены, соответствие сегменту.',
    formula: 'Доступность×25 + Социнфра×25 + Среда×20 + Рынок×20 + Сегмент×10',
  },
  accessScore: {
    title: 'Транспортная доступность',
    desc: 'Время до центра города, наличие метро / МЦД / скоростного трамвая в пешей зоне (≤15 мин), загруженность дорог в часы пик.',
  },
  socialInfraScore: {
    title: 'Социальная инфраструктура',
    desc: 'Обеспеченность социальными объектами в радиусе 1 км: школы, детсады, поликлиники, спортивные объекты. Ключевой фактор для семейной аудитории бизнес-класса.',
  },
  urbanQualityScore: {
    title: 'Качество городской среды',
    desc: 'Благоустройство: набережные, парки, тротуары, архитектурный облик квартала, отсутствие деградирующей застройки. Влияет на ценовую премию.',
  },
  localMarketScore: {
    title: 'Локальный рынок',
    desc: 'Анализ локального спроса и предложения: уровень цен относительно города, темп продаж конкурентов, дефицит или избыток предложения в радиусе 1 км.',
  },
  alignmentScore: {
    title: 'Соответствие бизнес-классу',
    desc: 'Насколько район соответствует позиционированию бизнес-класса: социальное окружение, качество соседней застройки, репутация локации у целевой аудитории.',
  },
  siteScore: {
    title: 'SiteScore',
    desc: 'Интегральный скор участка (0–100) по 5 блокам. Итоговая оценка пригодности земельного участка для реализации проекта бизнес-класса.',
    formula: 'Юридика×30 + Технология×20 + Окружение×20 + Рынок×20 + Экономика×10',
  },
  legalScore: {
    title: 'Юридическая чистота',
    desc: 'Проверка документов: ВРИ, отсутствие обременений, история прав, риски оспаривания. Значение <40 автоматически переводит участок в статус NO-GO.',
  },
  techScore: {
    title: 'Технические ограничения',
    desc: 'Инженерная доступность: электричество, газ, водоснабжение. Близость к охранным зонам (ВЛЭП, ж/д, санитарные зоны). Влияет на CAPEX и сроки подготовки.',
  },
  surroundingsScore: {
    title: 'Окружение участка',
    desc: 'Качество непосредственного окружения: тип соседней застройки, наличие промзон, ЛЭП, свалок, шумовых источников. Определяет ценовое позиционирование проекта.',
  },
  marketFitScore: {
    title: 'Рыночное совпадение',
    desc: 'Соответствие участка рыночному спросу: размер позволяет реализовать бизнес-класс, ёмкость рынка поглотит объём, нет критического давления конкурентов.',
  },
  rawFinancialScore: {
    title: 'Предварительная экономика',
    desc: 'Экспресс-оценка финансовой привлекательности по первичным данным: потенциальная маржа, оценочный IRR, доля стоимости земли в выручке. Значение <20 — автоматический NO-GO.',
  },
  siteDecision: {
    title: 'Решение по участку',
    desc: 'GO — все показатели в норме, рекомендован к дальнейшей проработке.\nSOFT-GO — есть замечания, требует дополнительной проверки.\nNO-GO — не рекомендован. Автоматически: юридика <40 или экономика <20.',
  },
  revenue: {
    title: 'Выручка проекта',
    desc: 'Прогнозируемая совокупная выручка от реализации всех квартир. Рассчитывается как продаваемая площадь × базовая цена м² с учётом сценарного коэффициента.',
    formula: 'GBA × Кпродаж × Цена_м² × Сценарный_коэф',
  },
  capex: {
    title: 'CAPEX — Капитальные затраты',
    desc: 'Совокупные инвестиционные затраты: приобретение земли, строительство, инфраструктура, маркетинг и проценты по проектному финансированию за весь цикл.',
    formula: 'Земля + Стройка + Инфра + Маркетинг + %ПФ',
  },
  irr: {
    title: 'IRR — Внутренняя норма доходности',
    desc: 'Ставка дисконтирования, при которой NPV проекта = 0. Ключевой показатель для инвестиционного комитета. Целевой уровень бизнес-класс: ≥25%. Ниже 15% — неприемлемо.',
    formula: 'NPV = Σ CFₜ / (1+IRR)ᵗ = 0',
  },
  npv: {
    title: 'NPV — Чистая приведённая стоимость',
    desc: 'Сумма всех дисконтированных денежных потоков проекта. NPV > 0 означает, что проект создаёт стоимость сверх требуемой доходности инвестора.',
    formula: 'NPV = Σ CFₜ / (1+r)ᵗ − Инвестиции',
  },
  successProb: {
    title: 'P(успеха) — Вероятность успеха',
    desc: 'Оценочная вероятность достижения целевых финансовых показателей. Рассчитывается на основе скоров города, района, участка и уровня долговой нагрузки проекта.',
    formula: 'f(CityScore, DistrictScore, SiteScore, LTV)',
  },
  sellOut: {
    title: 'Срок продажи — Sell-out',
    desc: 'Расчётное время для реализации 100% жилого фонда с момента старта продаж. Определяется объёмом продаваемой площади и месячным темпом поглощения.',
    formula: 'GBA_продаваемая / Темп_продаж_в_мес',
  },
  netMargin: {
    title: 'Чистая маржа',
    desc: 'Отношение операционной прибыли к выручке. Целевой уровень для бизнес-класса: ≥25%. Показывает, сколько рублей прибыли на рубль выручки.',
    formula: '(Выручка − CAPEX) / Выручка × 100%',
  },
  pfInterest: {
    title: 'Проценты по ПФ',
    desc: 'Стоимость обслуживания проектного финансирования (эскроу-кредита) за весь срок строительства. Зависит от суммы долга, базовой ставки и скорости наполнения эскроу.',
    formula: '≈ КС × Коэф_наполнения_эскроу × Срок',
  },
  compositeScore: {
    title: 'Composite Score',
    desc: 'Взвешенная оценка инвестиционной привлекательности сделки по всем 4 уровням due diligence. Является основой для формирования вердикта INVEST / WATCH / PASS.',
    formula: 'Город×25% + Район×25% + Участок×20% + Финансы×30%',
  },
  finScore: {
    title: 'Finance Score',
    desc: 'Производная оценка финансовых показателей (0–100), рассчитанная из IRR базового сценария. Нормализует IRR в единую шкалу скоров для Composite Score.',
    formula: 'IRR≥30%→90 | ≥25%→78 | ≥20%→65 | ≥15%→48 | <15%→30',
  },

  // ── Метрики города ──────────────────────────────────────────────
  population: {
    title: 'Население города',
    desc: 'Численность постоянного населения, тысяч человек. Города-миллионники обеспечивают достаточный объём платёжеспособного спроса для проекта бизнес-класса.',
    formula: 'Источник: Росстат, актуализировано 2024–2025',
  },
  migration: {
    title: 'Миграционный баланс',
    desc: 'Разница между числом прибывших и убывших за год, тыс. чел. Положительный баланс — приток новых жителей и потенциальных покупателей. Отрицательный — сигнал оттока населения.',
    formula: 'Прибывшие − Убывшие (тыс. чел/год)',
  },
  youngAdults: {
    title: 'Доля 25–45 лет',
    desc: 'Доля населения в возрасте 25–45 лет — ключевая целевая аудитория покупателей бизнес-класса: работающие, с накоплениями и карьерными перспективами.',
    formula: 'Норма для активного рынка: ≥28–32%',
  },
  avgSalary: {
    title: 'Средняя зарплата',
    desc: 'Среднемесячная начисленная зарплата по городу. Соотношение зарплаты и цены метра определяет доступность без субсидированной ипотеки. Рост YoY — сигнал растущей покупательной способности.',
    formula: 'Источник: Росстат / HH.ru',
  },
  businessClassPrice: {
    title: 'Цена м² бизнес-класс',
    desc: 'Средняя цена квадратного метра в новостройках бизнес-класса. Ключевой параметр для финансовой модели: определяет выручку и рентабельность проекта.',
    formula: 'Источник: Дом.РФ, ЦИАН, NF Group',
  },
  absorptionRate: {
    title: 'Запас предложения (Absorption Rate)',
    desc: 'Число месяцев для реализации текущего объёма предложения при текущем темпе продаж.\n\n≤6 мес — дефицит (благоприятно)\n6–12 мес — норма\n12–18 мес — избыток\n>18 мес — серьёзный перегрев',
    formula: 'Остаток предложения ÷ Темп продаж в мес',
  },
  developers: {
    title: 'Количество девелоперов',
    desc: 'Число активных застройщиков в сегменте бизнес-класса. Высокая концентрация топ-5 (>70%) сигнализирует о барьерах входа. Низкая конкуренция — возможность для нового игрока.',
    formula: 'Топ-5 доля рынка по объёму выведенного предложения',
  },
  unemployment: {
    title: 'Уровень безработицы',
    desc: 'Официальная безработица по методологии МОТ. Низкий показатель (<4%) — признак сильного рынка труда, высокой занятости и устойчивого спроса на жильё.',
    formula: 'Норма для бизнес-класса: ≤4%',
  },
  krt: {
    title: 'КРТ-программы',
    desc: 'Площадь территорий комплексного развития (га), доступных для девелопмента. Наличие КРТ упрощает согласование, даёт доступ к крупным участкам в сложившейся городской среде и государственной поддержке.',
  },
  // ── Подскоры города ─────────────────────────────────────────────
  demographyScore: {
    title: 'Блок «Демография»',
    desc: 'Оценка демографического потенциала: прирост населения, миграционный баланс, доля трудоспособного населения 25–45 лет.',
    formula: 'Вес в CityScore: 25%',
  },
  economyScore: {
    title: 'Блок «Экономика»',
    desc: 'Уровень и динамика доходов: средняя зарплата, рост YoY, безработица, ВРП на душу населения. Определяет финансовую состоятельность покупателей.',
    formula: 'Вес в CityScore: 25%',
  },
  housingMarketScore: {
    title: 'Блок «Рынок жилья»',
    desc: 'Активность рынка первичной недвижимости: темп поглощения, объём продаж бизнес-класса, ценовой тренд, разрыв спроса и предложения.',
    formula: 'Вес в CityScore: 30%',
  },
  competitionScore: {
    title: 'Блок «Конкуренция»',
    desc: 'Уровень конкуренции среди застройщиков: количество активных игроков, концентрация рынка, барьеры входа.',
    formula: 'Вес в CityScore: 10%',
  },
  infrastructureScore: {
    title: 'Блок «Инфраструктура»',
    desc: 'Качество транспортной и инженерной инфраструктуры, наличие КРТ-программ, планы крупных проектов (метро, ТПУ, дороги).',
    formula: 'Вес в CityScore: 10%',
  },
};

// ── Small shared atoms ────────────────────────────────────────────
const Label = ({ children, style }) =>
  React.createElement('div', {
    style: {
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: T.textMuted,
      fontFamily: 'Inter, sans-serif',
      ...style,
    },
  }, children);

// ── Hint icon with floating tooltip ──────────────────────────────
function HintIcon({ id, content: customContent }) {
  const [pos, setPos] = React.useState(null);
  const info = customContent || HINTS[id];
  if (!info) return null;

  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left + r.width / 2, y: r.top - 6 });
  };

  const active = pos !== null;

  return React.createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', marginLeft: 5, verticalAlign: 'middle', position: 'relative' },
    onMouseEnter: show,
    onMouseLeave: () => setPos(null),
  },
    // ⓘ иконка — крупнее и отчётливее
    React.createElement('span', {
      style: {
        fontSize: 10,
        color:        active ? '#E2C98A' : '#6E7585',
        border:       `1.5px solid ${active ? '#C9A96E' : '#50586A'}`,
        borderRadius: '50%',
        width: 16, height: 16,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'help', userSelect: 'none', fontWeight: 800, lineHeight: 1,
        background: active ? 'rgba(201,169,110,0.12)' : 'rgba(255,255,255,0.05)',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      },
    }, 'i'),

    // Всплывающая подсказка — светлый фон, читаемый текст
    active && React.createElement('div', {
      style: {
        position:  'fixed',
        left:      Math.max(10, Math.min(pos.x - 140, (typeof window !== 'undefined' ? window.innerWidth : 800) - 300)),
        top:       pos.y - 8,
        transform: 'translateY(-100%)',
        background: '#1A2235',
        border:     '1.5px solid rgba(201,169,110,0.55)',
        borderRadius: 12,
        padding:   '15px 18px',
        width:     288,
        zIndex:    99999,
        pointerEvents: 'none',
        boxShadow: '0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(201,169,110,0.08)',
        fontFamily: 'Inter, sans-serif',
      },
    },
      // Заголовок
      React.createElement('div', {
        style: { fontSize: 13, fontWeight: 700, color: '#E2C98A', marginBottom: 9, letterSpacing: '0.02em' },
      }, info.title),
      // Описание — яркий читаемый текст
      React.createElement('div', {
        style: { fontSize: 12, color: '#C8CDD8', lineHeight: 1.72, whiteSpace: 'pre-line' },
      }, info.desc),
      // Формула / источник
      info.formula && React.createElement('div', {
        style: {
          fontSize: 11, color: '#94A3B8', marginTop: 10,
          padding: '6px 10px',
          background: 'rgba(255,255,255,0.07)',
          borderLeft: '2px solid rgba(201,169,110,0.4)',
          borderRadius: '0 5px 5px 0',
          fontFamily: "'Courier New', monospace",
          lineHeight: 1.6,
        },
      }, info.formula),
    ),
  );
}


// ── Checkbox field ────────────────────────────────────────────────
function CheckboxField({ label, checked, onChange, sub }) {
  return React.createElement('label', {
    style: { display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' },
  },
    React.createElement('input', {
      type: 'checkbox',
      checked,
      onChange: (e) => onChange(e.target.checked),
      style: { marginTop: 2, accentColor: T.gold, flexShrink: 0, width: 14, height: 14 },
    }),
    React.createElement('div', null,
      React.createElement('span', { style: { fontSize: 12, color: T.text } }, label),
      sub && React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 2 } }, sub),
    ),
  );
}

// ── Select field ──────────────────────────────────────────────────
function SelectField({ label, value, options, onChange }) {
  return React.createElement('label', { style: { display: 'block' } },
    React.createElement('span', {
      style: { fontSize: 11, color: T.textSub, letterSpacing: '0.03em', display: 'block', marginBottom: 5, fontFamily: 'Inter, sans-serif' },
    }, label),
    React.createElement('select', {
      value,
      onChange: (e) => onChange(e.target.value),
      style: {
        width: '100%', padding: '7px 10px', fontSize: 13,
        background: T.bg, border: `1px solid rgba(255,255,255,0.08)`,
        borderRadius: 6, color: T.text, fontFamily: 'Inter, sans-serif',
      },
    },
      options.map((o) => React.createElement('option', { key: o.value, value: o.value }, o.label)),
    ),
  );
}

// ── Score progress bar ────────────────────────────────────────────
function ScoreBar({ label, score, hint }) {
  const color = score >= 70 ? T.green : score >= 45 ? T.yellow : T.red;
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
    },
      React.createElement('span', { style: { display: 'flex', alignItems: 'center', fontSize: 11, color: T.textSub } },
        label,
        hint && React.createElement(HintIcon, { id: hint }),
      ),
      React.createElement('span', {
        style: { fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' },
      }, score.toFixed(0)),
    ),
    React.createElement('div', { style: { height: 3, borderRadius: 2, background: T.surfaceRaise } },
      React.createElement('div', {
        style: { height: '100%', borderRadius: 2, background: color, width: `${score}%`, transition: 'width 0.3s ease' },
      }),
    ),
  );
}


// ═════════════════════════════════════════════════════════════════
// ЭКРАН 1 — ГЛАВНАЯ
// ═════════════════════════════════════════════════════════════════

function MacroSnapshotBanner({ snapshot }) {
  const m = useIsMobile();
  return React.createElement(
    'div',
    {
      style: {
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${T.gold}`,
        borderRadius: 12,
        padding: '24px 28px',
      },
    },
    React.createElement(Label, { style: { marginBottom: 20 } }, 'Макроэкономика'),
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: m ? 16 : 24 } },
      React.createElement(MacroMetric, { label: 'Ключевая ставка',  value: fmtPct(snapshot.keyRateAnnual, 2),         gold: true, hint: 'keyRate', sub: snapshot.nextMeetingDate ? `Заседание: ${snapshot.nextMeetingDate}` : null }),
      React.createElement(MacroMetric, { label: 'Рыночная ипотека', value: fmtPct(snapshot.mortgageRateAnnual, 2),    hint: 'mortgageRate', sub: snapshot.mortgageRateSource ?? null }),
      React.createElement(MacroMetric, { label: 'Семейная ипотека', value: snapshot.preferentialMortgageRate ? fmtPct(snapshot.preferentialMortgageRate, 1) : '—', hint: 'familyMortgage' }),
      React.createElement(MacroMetric, { label: 'MacroScore',       value: `${snapshot.macroScore.toFixed(0)} / 100`, gold: true, hint: 'macroScore' }),
      React.createElement(MacroMetric, { label: 'Дата снимка',      value: snapshot.asOfDate }),
    ),
  );
}

function MacroMetric({ label, value, gold, hint, sub }) {
  const m = useIsMobile();
  return React.createElement(
    'div',
    null,
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
      React.createElement(Label, null, label),
      hint && React.createElement(HintIcon, { id: hint }),
    ),
    React.createElement('div', {
      style: {
        fontSize: m ? 17 : 22,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: gold ? T.gold : T.text,
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '-0.02em',
      },
    }, value),
    sub && React.createElement('div', {
      style: { fontSize: 10, color: T.textMuted, marginTop: 4, fontFamily: 'Inter, sans-serif' },
    }, sub),
  );
}

// ── UTC-офсеты городов ────────────────────────────────────────────
const CITY_UTC_OFFSET = {
  novosibirsk:   7,
  yekaterinburg: 5,
  kazan:         3,
  nizhny:        3,
  chelyabinsk:   5,
  samara:        4,
  ufa:           5,
  rostov:        3,
  omsk:          6,
  krasnodar:     3,
  voronezh:      3,
  volgograd:     3,
  perm:          5,
  krasnoyarsk:   7,
};

// ── Солнечный терминатор ──────────────────────────────────────────
function getSolarData(now) {
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86_400_000);
  const decl = -23.45 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10)) * Math.PI / 180;
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const subSolarLng = (12 - utcH) * 15;
  return { decl, subSolarLng };
}

function getSolarElevation(lat, lng, decl, subSolarLng) {
  const ha = (lng - subSolarLng) * Math.PI / 180;
  const latR = lat * Math.PI / 180;
  return Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
}

// hook — текущее время, обновляется каждые 30 сек
function useNow() {
  const [now, setNow] = React.useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmtLocalTime(now, utcOffset) {
  const ms = now.getTime() + (utcOffset * 3600_000) + (now.getTimezoneOffset() * 60_000);
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// Уральские горы (разделитель Европа/Азия)
const URAL_LINE = [[60.5,54],[59.5,57],[58.5,60],[58.0,62],[57.5,65],[56.5,67.5],[55.0,68.2]];

function RussiaMap({ cities, onCityClick }) {
  // Загружаем реальные данные Natural Earth 110m через TopoJSON
  const [geoPolys, setGeoPolys] = React.useState(null);
  const [loading,  setLoading]  = React.useState(true);
  const now = useNow();
  const { decl, subSolarLng } = getSolarData(now);

  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(topo => {
        // ── Мини-декодер TopoJSON ─────────────────────────────
        const [sx, sy] = topo.transform.scale;
        const [tx, ty] = topo.transform.translate;

        // Арки: дельта-кодированные квантованные координаты → [lng, lat]
        const arcs = topo.arcs.map(arc => {
          let px = 0, py = 0;
          return arc.map(([dx, dy]) => {
            px += dx; py += dy;
            return [px * sx + tx, py * sy + ty];
          });
        });

        const stitch = (indices) => {
          const pts = [];
          for (const idx of indices) {
            const arc = idx < 0 ? [...arcs[~idx]].reverse() : [...arcs[idx]];
            for (let j = pts.length ? 1 : 0; j < arc.length; j++) pts.push(arc[j]);
          }
          return pts;
        };

        // Россия: ISO 3166-1 numeric = 643
        const russia = topo.objects.countries.geometries.find(g => g.id === '643');
        if (!russia) return;

        const polys = russia.type === 'MultiPolygon'
          ? russia.arcs.map(p => p.map(stitch))
          : [russia.arcs.map(stitch)];

        setGeoPolys(polys);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const minLng = 17, maxLng = 172, minLat = 41, maxLat = 78;
  const W = 1400, H = 520;

  // Простая равнопромежуточная проекция (хорошо работает для России)
  const proj = (lng, lat) => [
    ((lng - minLng) / (maxLng - minLng)) * W,
    H - ((lat - minLat) / (maxLat - minLat)) * H,
  ];

  // Конвертировать кольцо координат в SVG-путь
  const ringToD = (ring) => {
    // Фильтруем точки с отрицательной долготой (Чукотка за 180°)
    const pts = ring
      .filter(([lng]) => lng > 0 && lng < 180)
      .map(([lng, lat]) => proj(lng, lat));
    if (pts.length < 3) return '';
    // Отбрасываем кольца полностью вне нашего вьюпорта
    const inView = pts.some(([x, y]) => x > -100 && x < W + 100 && y > -100 && y < H + 100);
    if (!inView) return '';
    return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z';
  };

  const LAT_LINES = [45, 50, 55, 60, 65, 70, 75];
  const LNG_LINES = [20, 40, 60, 80, 100, 120, 140, 160];

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    // Шапка карты
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement(Label, null, 'Карта городов'),
        loading && React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, '· загрузка карты...'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
        Object.entries(ZONE).map(([k, z]) =>
          React.createElement('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted } },
            React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: z.fg } }),
            z.label,
          ),
        ),
      ),
    ),

    React.createElement('svg', {
      viewBox: `0 0 ${W} ${H}`,
      style: { width: '100%', background: '#05080E', borderRadius: 8, display: 'block' },
    },
      // ── Координатная сетка ────────────────────────────────────
      ...LAT_LINES.map(lat => {
        const [, y] = proj(minLng, lat);
        return React.createElement('g', { key: `lat${lat}` },
          React.createElement('line', { x1: 0, y1: y, x2: W, y2: y, stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }),
          React.createElement('text', { x: 5, y: y - 3, fontSize: 9, fill: 'rgba(255,255,255,0.28)', fontFamily: 'Inter' }, `${lat}°N`),
        );
      }),
      ...LNG_LINES.map(lng => {
        const [x] = proj(lng, minLat);
        const [, yL] = proj(lng, minLat + 1.5);
        return React.createElement('g', { key: `lng${lng}` },
          React.createElement('line', { x1: x, y1: 0, x2: x, y2: H, stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }),
          React.createElement('text', { x, y: yL, textAnchor: 'middle', fontSize: 9, fill: 'rgba(255,255,255,0.28)', fontFamily: 'Inter' }, `${lng}°E`),
        );
      }),

      // ── Территория России (Natural Earth 110m) ────────────────
      ...(geoPolys
        ? geoPolys.flatMap((poly, pi) =>
            poly.map((ring, ri) => {
              const d = ringToD(ring);
              if (!d) return null;
              return React.createElement('path', {
                key: `p${pi}r${ri}`,
                d,
                fill: ri === 0 ? '#0D1825' : '#05080E',  // внешнее кольцо / дырки
                stroke: ri === 0 ? 'rgba(201,169,110,0.55)' : 'none',
                strokeWidth: 1.4,
                strokeLinejoin: 'round',
              });
            }).filter(Boolean)
          )
        : [React.createElement('text', {
            key: 'wait',
            x: W / 2, y: H / 2,
            textAnchor: 'middle', fontSize: 13,
            fill: T.textMuted, fontFamily: 'Inter',
          }, 'Загрузка данных карты...')]),

      // ── Уральский хребет ──────────────────────────────────────
      geoPolys && React.createElement('polyline', {
        points: URAL_LINE.map(([lng, lat]) => proj(lng, lat).join(',')).join(' '),
        fill: 'none', stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1.2, strokeDasharray: '5 4',
      }),
      geoPolys && (() => {
        const [x, y] = proj(60.5, 62.5);
        return React.createElement('text', { x, y, fontSize: 8, fill: 'rgba(255,255,255,0.3)', fontFamily: 'Inter', transform: `rotate(-80,${x},${y})` }, 'УРАЛ');
      })(),

      // ── Плавный ночной оверлей ────────────────────────────────
      (() => {
        // Строим горизонтальный градиент: для каждой долготы считаем
        // среднюю высоту солнца на широте 55°N (средняя широта России)
        const STEPS = 50;
        const stops = [];
        for (let i = 0; i <= STEPS; i++) {
          const lng = minLng + (i / STEPS) * (maxLng - minLng);
          const elev = getSolarElevation(55, lng, decl, subSolarLng);
          // Плавный переход: сумерки от elev=0.15 до полной ночи elev<-0.1
          const alpha = elev > 0.15 ? 0
            : elev < -0.12 ? 0.48
            : 0.48 * (0.15 - elev) / 0.27;
          stops.push({ pct: `${(i / STEPS * 100).toFixed(1)}%`, alpha: alpha.toFixed(3) });
        }
        const gradId = 'nightGradH';
        return [
          React.createElement('defs', { key: 'ndefs' },
            React.createElement('linearGradient', { id: gradId, x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
              stops.map((s, i) =>
                React.createElement('stop', { key: i, offset: s.pct, stopColor: '#000818', stopOpacity: s.alpha })
              ),
            ),
          ),
          React.createElement('rect', {
            key: 'nightRect',
            x: 0, y: 0, width: W, height: H,
            fill: `url(#${gradId})`,
          }),
        ];
      })().flat(),

      // ── Линия терминатора ─────────────────────────────────────
      (() => {
        // Для каждой долготы находим широту нулевой высоты солнца аналитически:
        // tan(lat) = -cos(decl)*cos(ha) / sin(decl)
        if (Math.abs(decl) < 0.001) return [];
        const pts = [];
        for (let lng = minLng; lng <= maxLng; lng += 0.8) {
          const ha = (lng - subSolarLng) * Math.PI / 180;
          const tanLat = -(Math.cos(decl) * Math.cos(ha)) / Math.sin(decl);
          const lat = Math.atan(tanLat) * 180 / Math.PI;
          if (lat < minLat || lat > maxLat) continue;
          const [x, y] = proj(lng, lat);
          pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        if (pts.length < 3) return [];
        return [React.createElement('polyline', {
          key: 'terminator',
          points: pts.join(' '),
          fill: 'none',
          stroke: 'rgba(255,215,80,0.35)',
          strokeWidth: 1.5,
          strokeDasharray: '5 3',
          strokeLinecap: 'round',
        })];
      })(),

      // ── Маркеры городов ───────────────────────────────────────
      ...cities.map((c, idx) => {
        const [x, y] = proj(c.coordinates.lng, c.coordinates.lat);
        const z = ZONE[c.zone];
        const r = 4 + (c.cityScore / 100) * 8;
        const delay = `${(idx * 0.18) % 2.5}s`;
        const utcOffset = CITY_UTC_OFFSET[c.key] ?? 3;
        const localTime = fmtLocalTime(now, utcOffset);
        const elev = getSolarElevation(c.coordinates.lat, c.coordinates.lng, decl, subSolarLng);
        const isNight    = elev < -0.05;
        const isTwilight = !isNight && elev < 0.14;
        // Unicode-символы (надёжно в SVG, в отличие от эмодзи)
        const dotColor = isNight ? '#8899FF' : isTwilight ? '#FFB84D' : '#FFE566';
        const timeLabel = `UTC+${utcOffset}  ${localTime}`;
        const phaseLabel = isNight ? 'Ночь' : isTwilight ? 'Сумерки' : 'День';

        return React.createElement('g', { key: c.key, onClick: () => onCityClick(c.key), style: { cursor: 'pointer' } },
          // Пульс 1 — широкое кольцо
          React.createElement('circle', {
            cx: x, cy: y, r: r + 16, fill: 'none', stroke: z.fg, strokeWidth: 1.5,
            className: 'city-pulse-ring',
            style: { animationDelay: delay, opacity: isNight ? 0.45 : 1 },
          }),
          // Пульс 2
          React.createElement('circle', {
            cx: x, cy: y, r: r + 10, fill: z.fg,
            className: 'city-pulse-glow',
            style: { animationDelay: `calc(${delay} + 0.4s)` },
          }),
          // Статичный ореол
          React.createElement('circle', { cx: x, cy: y, r: r + 4, fill: z.fg, opacity: isNight ? 0.05 : 0.12 }),
          // Основная точка
          React.createElement('circle', { cx: x, cy: y, r, fill: z.fg, opacity: isNight ? 0.50 : 0.92 }),
          React.createElement('circle', { cx: x, cy: y, r: r + 1.5, fill: 'none', stroke: z.fg, strokeWidth: 1, opacity: 0.45 }),
          // Название города
          React.createElement('text', {
            x, y: y + r + 13,
            textAnchor: 'middle', fontSize: 10, fontWeight: 500,
            fill: isNight ? 'rgba(180,190,230,0.55)' : 'rgba(237,236,234,0.90)',
            style: { pointerEvents: 'none', fontFamily: 'Inter, sans-serif' },
          }, c.name),
          // Время — маленький цветной кружок + цифры
          React.createElement('circle', { cx: x - 14, cy: y + r + 21, r: 2.5, fill: dotColor, opacity: 0.85 }),
          React.createElement('text', {
            x: x - 9, y: y + r + 24,
            textAnchor: 'start', fontSize: 8,
            fill: dotColor,
            style: { pointerEvents: 'none', fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums' },
          }, localTime),
          // Тултип при наведении
          React.createElement('title', null, `${c.name} · ${localTime} (UTC+${utcOffset}) · ${phaseLabel}`),
        );
      }),
    ),
  );
}

function ZoneFilter({ filter, onChange }) {
  const zones = [
    { key: 'all',    label: 'Все' },
    { key: 'green',  label: 'Зелёная',   fg: T.green },
    { key: 'orange', label: 'Оранжевая', fg: T.orange },
    { key: 'yellow', label: 'Жёлтая',    fg: T.yellow },
    { key: 'red',    label: 'Красная',   fg: T.red },
  ];
  return React.createElement(
    'div',
    { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
    zones.map((z) => {
      const active = filter === z.key;
      return React.createElement(
        'button',
        {
          key: z.key,
          onClick: () => onChange(z.key),
          style: {
            padding: '6px 14px',
            fontSize: 11,
            letterSpacing: '0.05em',
            borderRadius: 20,
            border: active
              ? `1px solid ${z.fg || T.gold}`
              : `1px solid ${T.border}`,
            background: active
              ? (z.fg ? `${z.fg}15` : T.goldDim)
              : 'transparent',
            color: active ? (z.fg || T.gold) : T.textMuted,
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          },
        },
        z.fg && React.createElement('span', {
          style: { width: 5, height: 5, borderRadius: '50%', background: z.fg, display: 'inline-block' },
        }),
        z.label,
      );
    }),
  );
}

function CityRow({ rank, city, onClick, compareMode, selected, onToggle, onTrends }) {
  const z = ZONE[city.zone];
  const thSub = (s) => s >= 70 ? T.green : s >= 45 ? T.textSub : T.red;
  return React.createElement(
    'tr',
    {
      className: 'l-row',
      style: {
        borderBottom: `1px solid rgba(255,255,255,0.04)`,
        cursor: 'pointer',
        background: selected ? `${T.gold}0A` : undefined,
      },
      onClick: () => compareMode ? onToggle(city.key) : onClick(city.key),
    },
    // rank / checkbox
    React.createElement('td', {
      style: { padding: '14px 16px', width: 48, fontSize: 12, color: T.textMuted, fontVariantNumeric: 'tabular-nums' },
    }, compareMode
      ? React.createElement('input', {
          type: 'checkbox', checked: selected,
          onChange: () => onToggle(city.key),
          onClick: e => e.stopPropagation(),
          style: { accentColor: T.gold, width: 15, height: 15 },
        })
      : rank
    ),
    // city
    React.createElement(
      'td',
      { style: { padding: '14px 8px' } },
      React.createElement('div', { style: { fontSize: 14, fontWeight: 500, color: T.text } }, city.name),
      React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 3 } }, city.region),
    ),
    // score
    React.createElement(
      'td',
      { style: { padding: '14px 16px' } },
      React.createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement('div', {
          style: { width: 3, height: 44, background: z.fg, borderRadius: 2, flexShrink: 0 },
        }),
        React.createElement(
          'div',
          null,
          React.createElement('div', {
            style: {
              fontSize: 26,
              fontWeight: 700,
              color: z.fg,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              fontFamily: 'Inter, sans-serif',
            },
          }, city.cityScore.toFixed(1)),
          React.createElement('div', {
            style: { fontSize: 10, color: z.fg, opacity: 0.6, marginTop: 4, letterSpacing: '0.07em', textTransform: 'uppercase' },
          }, z.label),
        ),
      ),
    ),
    // subscores
    ...[
      city.breakdown.demographyScore,
      city.breakdown.economyScore,
      city.breakdown.housingMarketScore,
      city.breakdown.competitionScore,
      city.breakdown.infrastructureScore,
    ].map((s, i) =>
      React.createElement('td', {
        key: i,
        style: {
          padding: '14px 8px',
          textAlign: 'center',
          fontSize: 14,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
          color: thSub(s),
        },
      }, s.toFixed(0)),
    ),
    // price + sparkline
    React.createElement(
      'td',
      { style: { padding: '14px 16px', textAlign: 'right' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' } },
        React.createElement(PriceSparkline, {
          currentPrice: city.inputs.housing.businessClassPricePerM2,
          growthYoY:    city.inputs.housing.priceGrowthYoY,
        }),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 14, fontVariantNumeric: 'tabular-nums', color: T.gold, fontWeight: 500 },
          }, fmtRub(city.inputs.housing.businessClassPricePerM2)),
          React.createElement('div', {
            style: { fontSize: 10, color: city.inputs.housing.priceGrowthYoY >= 0 ? T.green : T.red, marginTop: 2 },
          }, `${city.inputs.housing.priceGrowthYoY >= 0 ? '+' : ''}${city.inputs.housing.priceGrowthYoY.toFixed(1)}% YoY`),
        ),
      ),
    ),
    // entry signal badge
    (() => {
      const mc = city.marketCycle;
      const sig = mc ? ENTRY_SIGNAL_CONFIG[mc.entrySignal] : null;
      return mc ? React.createElement('td', { style: { padding: '14px 8px', textAlign: 'center' } },
        React.createElement('div', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 9px', borderRadius: 20,
            background: sig.bg, border: `1px solid ${sig.color}44`,
            fontSize: 10, fontWeight: 700, color: sig.color,
            letterSpacing: '0.06em', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif',
          },
        },
          CYCLE_CONFIG[mc.position].icon, ' ', mc.entrySignalRu,
        ),
      ) : React.createElement('td', null);
    })(),
    // actions
    React.createElement(
      'td',
      { style: { padding: '14px 16px', textAlign: 'right' } },
      React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' } },
        React.createElement('button', {
          onClick: e => { e.stopPropagation(); onTrends(city); },
          style: { background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: T.textSub, cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
        }, '📈 Тренд'),
        React.createElement('span', {
          style: { fontSize: 12, color: T.gold, letterSpacing: '0.04em', fontWeight: 500 },
        }, 'Открыть →'),
      ),
    ),
  );
}

function CityQuadrant({ cities, onCityClick }) {
  // Axes: X = CityScore, Y = businessClassPricePerM2
  // Quadrant split: X=65 (above avg score), Y=median price
  const prices = cities.map((c) => c.inputs.housing.businessClassPricePerM2);
  const medianPrice = [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const SCORE_SPLIT = 65;

  const data = cities.map((c) => ({
    x: c.cityScore,
    y: c.inputs.housing.businessClassPricePerM2 / 1000, // тыс ₽
    z: Math.sqrt(c.inputs.demography.populationThousands) * 1.4, // размер точки ~ население
    name: c.name,
    key: c.key,
    zone: c.zone,
  }));

  const QUADRANT_LABELS = [
    { x: 82, y: medianPrice / 1000 + 25, text: 'Дорого & перспективно',  anchor: 'middle', color: T.textMuted },
    { x: 45, y: medianPrice / 1000 + 25, text: 'Дорого & рискованно',    anchor: 'middle', color: T.textMuted },
    { x: 82, y: medianPrice / 1000 - 25, text: '★ Лучший вход',          anchor: 'middle', color: T.gold },
    { x: 45, y: medianPrice / 1000 - 25, text: 'Слабый рынок',           anchor: 'middle', color: T.textMuted },
  ];

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    const z = ZONE[payload.zone];
    const r = Math.max(6, Math.min(22, payload.z));
    return React.createElement('g', { key: payload.key, onClick: () => onCityClick(payload.key), style: { cursor: 'pointer' } },
      React.createElement('circle', { cx, cy, r: r + 5, fill: z.fg, opacity: 0.08 }),
      React.createElement('circle', { cx, cy, r, fill: z.fg, opacity: 0.85, stroke: z.fg, strokeWidth: 1 }),
      React.createElement('text', {
        x: cx, y: cy - r - 5,
        textAnchor: 'middle', fontSize: 10, fill: T.textSub,
        style: { pointerEvents: 'none', fontFamily: 'Inter, sans-serif' },
      }, payload.name),
    );
  };

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const z = ZONE[d.zone];
    return React.createElement('div', {
      style: {
        background: T.surfaceRaise, border: `1px solid ${T.border}`,
        borderRadius: 8, padding: '10px 14px', fontSize: 12, fontFamily: 'Inter, sans-serif',
      },
    },
      React.createElement('div', { style: { fontWeight: 600, color: z.fg, marginBottom: 4 } }, d.name),
      React.createElement('div', { style: { color: T.textSub } }, `CityScore: ${d.x.toFixed(1)}`),
      React.createElement('div', { style: { color: T.gold } }, `Цена м² БК: ${Math.round(d.y)} тыс ₽`),
    );
  };

  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    // header
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 } },
      React.createElement('div', null,
        React.createElement(Label, null, 'Квадрант городов'),
        React.createElement('div', { style: { fontSize: 12, color: T.textMuted, marginTop: 4 } },
          'Привлекательность vs. цена входа · размер точки — население · нажмите для анализа'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 14 } },
        Object.entries(ZONE).map(([k, z]) =>
          React.createElement('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.textMuted } },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: z.fg } }),
            z.label,
          ),
        ),
      ),
    ),
    React.createElement(
      ResponsiveContainer,
      { width: '100%', height: 340 },
      React.createElement(
        ScatterChart,
        { margin: { top: 20, right: 30, bottom: 20, left: 10 } },
        React.createElement(CartesianGrid, CHART_GRID),
        React.createElement(XAxis, {
          type: 'number', dataKey: 'x', name: 'CityScore',
          domain: [30, 100], tick: CHART_TICK,
          label: { value: 'CityScore', position: 'insideBottom', offset: -10, fill: T.textMuted, fontSize: 11 },
        }),
        React.createElement(YAxis, {
          type: 'number', dataKey: 'y', name: 'Цена м²',
          tick: CHART_TICK,
          label: { value: 'тыс ₽/м²', angle: -90, position: 'insideLeft', offset: 10, fill: T.textMuted, fontSize: 11 },
        }),
        React.createElement(ZAxis, { type: 'number', dataKey: 'z', range: [40, 500] }),
        React.createElement(Tooltip, { content: React.createElement(CustomTooltip) }),
        // Quadrant dividers
        React.createElement(ReferenceLine, { x: SCORE_SPLIT, stroke: T.gold, strokeDasharray: '6 4', strokeWidth: 1, strokeOpacity: 0.35 }),
        React.createElement(ReferenceLine, { y: medianPrice / 1000, stroke: T.gold, strokeDasharray: '6 4', strokeWidth: 1, strokeOpacity: 0.35 }),
        // Quadrant labels
        ...QUADRANT_LABELS.map((ql, i) =>
          React.createElement(ReferenceLine, {
            key: i, x: ql.x, stroke: 'none',
            label: { value: ql.text, position: 'insideTop', fill: ql.color, fontSize: 10, fontFamily: 'Inter, sans-serif' },
          }),
        ),
        // Data
        React.createElement(
          Scatter,
          { data, shape: React.createElement(CustomDot) },
        ),
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// КАРТА БАЛАНСА СПРОСА И ПРЕДЛОЖЕНИЯ (ЕИСЖС / ДОМ.РФ)
// ═════════════════════════════════════════════════════════════════

function SupplyDemandBalanceChart({ cities, onCityClick }) {
  const m = useIsMobile();

  const data = cities
    .filter(c => c.inputs.housing.sellReadinessRatioPct !== undefined)
    .map(c => ({
      x: c.inputs.housing.sellReadinessRatioPct,
      y: c.inputs.housing.unsoldYearsOfSupply ?? 4,
      z: c.inputs.housing.constructionVolumeMkdThousM2
        ? Math.sqrt(c.inputs.housing.constructionVolumeMkdThousM2) * 1.1
        : 14,
      name: c.name,
      key: c.key,
      zone: c.zone,
    }));

  const CustomDot = (props) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const z = ZONE[payload.zone];
    const r = Math.max(5, Math.min(18, payload.z));
    return React.createElement('g', {
      key: payload.key,
      onClick: () => onCityClick(payload.key),
      style: { cursor: 'pointer' },
    },
      React.createElement('circle', { cx, cy, r: r + 5, fill: z.fg, opacity: 0.1 }),
      React.createElement('circle', { cx, cy, r, fill: z.fg, opacity: 0.88, stroke: T.bg, strokeWidth: 1.5 }),
      React.createElement('text', {
        x: cx, y: cy - r - 5,
        textAnchor: 'middle', fontSize: 9.5, fontWeight: 500,
        fill: 'rgba(237,236,234,0.82)',
        style: { pointerEvents: 'none', fontFamily: 'Inter, sans-serif' },
      }, payload.name),
    );
  };

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const z = ZONE[d.zone];
    const zoneLabel =
      d.x < 60 ? '⚠ Дефицит спроса'
      : d.x < 80 ? '✓ Баланс'
      : '★ Дефицит предложения';
    return React.createElement('div', {
      style: {
        background: T.surfaceRaise, border: `1px solid ${T.border}`,
        borderRadius: 8, padding: '10px 14px',
        fontSize: 12, fontFamily: 'Inter, sans-serif', minWidth: 190,
      },
    },
      React.createElement('div', { style: { fontWeight: 700, color: z.fg, marginBottom: 6 } }, d.name),
      React.createElement('div', { style: { color: T.textSub, marginBottom: 2 } }, `Распроданность/стройготовность: ${d.x}%`),
      React.createElement('div', { style: { color: T.textSub, marginBottom: 6 } }, `Срок реализации: ${d.y.toFixed(1)} лет`),
      React.createElement('div', {
        style: {
          fontSize: 11, fontWeight: 600,
          color: d.x < 60 ? T.red : d.x < 80 ? T.green : T.yellow,
        },
      }, zoneLabel),
    );
  };

  const ZONE_LABELS = [
    { x: 50, y: 7.0, text: 'ДЕФИЦИТ СПРОСА', color: 'rgba(212,91,91,0.55)' },
    { x: 70, y: 7.0, text: 'БАЛАНС', color: 'rgba(91,191,138,0.55)' },
    { x: 93, y: 7.0, text: 'ДЕФИЦИТ ПРЕДЛОЖЕНИЯ', color: 'rgba(212,184,74,0.55)' },
  ];

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    // Header
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 } },
      React.createElement('div', null,
        React.createElement(Label, null, 'Баланс рынка новостроек'),
        React.createElement('div', { style: { fontSize: 12, color: T.textMuted, marginTop: 4 } },
          'Распроданность к стройготовности vs. срок реализации остатков · бизнес-класс'
        ),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 14, flexShrink: 0 } },
        [
          { label: 'Дефицит спроса', color: T.red },
          { label: 'Баланс', color: T.green },
          { label: 'Дефицит предложения', color: T.yellow },
        ].map(({ label, color }) =>
          React.createElement('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textMuted } },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.7 } }),
            label,
          ),
        ),
      ),
    ),

    React.createElement(ResponsiveContainer, { width: '100%', height: m ? 280 : 340 },
      React.createElement(ScatterChart, { margin: { top: 20, right: 30, bottom: 30, left: 10 } },
        // Цветные зоны
        React.createElement(ReferenceArea, { x1: 40, x2: 60, y1: 0, y2: 8.5, fill: 'rgba(212,91,91,0.07)', ifOverflow: 'hidden' }),
        React.createElement(ReferenceArea, { x1: 60, x2: 80, y1: 0, y2: 8.5, fill: 'rgba(91,191,138,0.05)', ifOverflow: 'hidden' }),
        React.createElement(ReferenceArea, { x1: 80, x2: 112, y1: 0, y2: 8.5, fill: 'rgba(212,184,74,0.06)', ifOverflow: 'hidden' }),

        React.createElement(CartesianGrid, CHART_GRID),
        React.createElement(XAxis, {
          type: 'number', dataKey: 'x',
          domain: [38, 112], ticks: [40, 50, 60, 70, 80, 90, 100, 110],
          tick: CHART_TICK,
          label: { value: 'Распроданность / Стройготовность, %', position: 'insideBottom', offset: -18, fill: T.textMuted, fontSize: 10 },
        }),
        React.createElement(YAxis, {
          type: 'number', dataKey: 'y',
          domain: [0, 8.5], ticks: [0, 2, 4, 6, 8],
          tick: CHART_TICK,
          label: { value: 'Срок реализации, лет', angle: -90, position: 'insideLeft', offset: 14, fill: T.textMuted, fontSize: 10 },
        }),
        React.createElement(ZAxis, { type: 'number', dataKey: 'z', range: [30, 420] }),
        React.createElement(Tooltip, { content: React.createElement(CustomTooltip) }),

        // Граничные линии зон
        React.createElement(ReferenceLine, { x: 60, stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '6 3', strokeWidth: 1.5 }),
        React.createElement(ReferenceLine, { x: 80, stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '6 3', strokeWidth: 1.5 }),
        // Линия равновесного темпа (~3.5 лет)
        React.createElement(ReferenceLine, {
          y: 3.5, stroke: 'rgba(201,169,110,0.3)', strokeDasharray: '8 4', strokeWidth: 1,
          label: { value: '≈ равновесие', position: 'right', fill: 'rgba(201,169,110,0.6)', fontSize: 9 },
        }),

        // Подписи зон (через ReferenceLine-label)
        ...ZONE_LABELS.map(({ x, y, text, color }) =>
          React.createElement(ReferenceLine, {
            key: text, x: x, stroke: 'none',
            label: {
              value: text, position: 'insideTop',
              fill: color, fontSize: 9.5,
              fontFamily: 'Inter, sans-serif',
              letterSpacing: '0.07em',
            },
          }),
        ),

        React.createElement(Scatter, { data, shape: React.createElement(CustomDot) }),
      ),
    ),

    // Подпись
    React.createElement('div', { style: { fontSize: 10, color: T.textMuted, marginTop: 6, textAlign: 'right' } },
      'Источник: ЕИСЖС, расчёты ДОМ.РФ · Размер пузыря = объём строительства МКД'
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// ИИ АГЕНТ — ЛЕНТА НОВОСТЕЙ
// ═════════════════════════════════════════════════════════════════

const AGENT_DATA = agentOutputRaw;

const CAT_CONFIG = {
  macro:       { label: 'Макро',       color: '#5BA0BF', icon: '📊' },
  housing:     { label: 'Жильё',       color: T.gold,    icon: '🏢' },
  mortgage:    { label: 'Ипотека',     color: T.yellow,  icon: '🏦' },
  city:        { label: 'Города',      color: T.green,   icon: '📍' },
  regulation:  { label: 'Регуляторика',color: T.orange,  icon: '⚖️' },
  krt:         { label: 'КРТ',         color: '#8B6FAF', icon: '🏗️' },
  forecast:    { label: 'Прогноз',     color: '#B06FAF', icon: '🔮' },
};

const IMPACT_CONFIG = {
  positive: { color: T.green,  icon: '↑', label: 'Позитивно' },
  negative: { color: T.red,    icon: '↓', label: 'Негативно' },
  neutral:  { color: T.textSub,icon: '→', label: 'Нейтрально' },
};

function timeAgo(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)   return 'только что';
  if (diff < 3600) return `${Math.floor(diff/60)} мин назад`;
  if (diff < 86400)return `${Math.floor(diff/3600)} ч назад`;
  return `${Math.floor(diff/86400)} дн назад`;
}

function NewsCard({ item, expanded, onToggle }) {
  const cat  = CAT_CONFIG[item.category] ?? CAT_CONFIG.macro;
  const imp  = IMPACT_CONFIG[item.impact];
  return React.createElement('div', {
    className: 'l-row',
    style: {
      background: T.surfaceRaise,
      border: `1px solid ${T.border}`,
      borderLeft: `3px solid ${cat.color}`,
      borderRadius: 10,
      overflow: 'hidden',
      cursor: 'pointer',
    },
    onClick: onToggle,
  },
    // Header row
    React.createElement('div', { style: { padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 } },
      // Category badge
      React.createElement('div', {
        style: {
          fontSize: 10, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap', flexShrink: 0,
          background: `${cat.color}18`, border: `1px solid ${cat.color}44`, color: cat.color,
          fontWeight: 700, letterSpacing: '0.05em', marginTop: 1,
        },
      }, cat.icon + ' ' + cat.label),
      // Title + summary
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.45, marginBottom: 4 } },
          item.title,
        ),
        !expanded && React.createElement('div', { style: { fontSize: 11, color: T.textMuted, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          item.summary,
        ),
      ),
      // Impact + time
      React.createElement('div', { style: { flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' } },
        React.createElement('div', {
          style: { fontSize: 11, fontWeight: 700, color: imp.color, display: 'flex', alignItems: 'center', gap: 3 },
        }, imp.icon, ' ', item.impactLevel === 'high' ? '●●●' : item.impactLevel === 'medium' ? '●●○' : '●○○'),
        React.createElement('div', { style: { fontSize: 9.5, color: T.textMuted } }, timeAgo(item.timestamp)),
        React.createElement('div', { style: { fontSize: 9, color: T.textMuted } }, expanded ? '▲' : '▼'),
      ),
    ),
    // Expanded: full summary + AI insight
    expanded && React.createElement('div', {
      style: { padding: '0 16px 14px', borderTop: `1px solid ${T.border}` },
    },
      React.createElement('div', { style: { paddingTop: 12, fontSize: 12, color: T.textSub, lineHeight: 1.7, marginBottom: 12 } },
        item.summary,
      ),
      // AI Insight box
      React.createElement('div', {
        style: {
          padding: '12px 14px',
          background: `${cat.color}0A`,
          borderLeft: `2px solid ${cat.color}60`,
          borderRadius: '0 8px 8px 0',
        },
      },
        React.createElement('div', { style: { fontSize: 9.5, color: cat.color, letterSpacing: '0.12em', fontWeight: 700, marginBottom: 6 } },
          '🤖 ИНСАЙТ ИИ-АНАЛИТИКА',
        ),
        React.createElement('div', { style: { fontSize: 12, color: T.text, lineHeight: 1.72 } },
          item.aiInsight,
        ),
      ),
      // Affected cities + sources
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 } },
        item.affectedCities.length > 0 && React.createElement('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, 'Города: '),
          item.affectedCities.map(c =>
            React.createElement('span', { key: c, style: { fontSize: 10, padding: '1px 7px', borderRadius: 10, background: T.bg, border: `1px solid ${T.border}`, color: T.textSub } }, c),
          ),
        ),
        item.sources.length > 0 && React.createElement('div', { style: { fontSize: 10, color: T.textMuted } },
          'Источники: ' + item.sources.slice(0, 2).join(', '),
        ),
      ),
    ),
  );
}

function NewsFeedPanel() {
  const m = useIsMobile();
  const [catFilter, setCatFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [collapsed, setCollapsed]   = useState(false);

  const data = AGENT_DATA;
  const newsItems = data?.newsItems ?? [];

  const filtered = catFilter === 'all'
    ? newsItems
    : newsItems.filter(n => n.category === catFilter);

  const lastRun  = data?.generatedAt ? new Date(data.generatedAt) : null;
  const status   = data?.status ?? 'unknown';
  const isActive = status === 'completed';

  const categories = ['all', ...Object.keys(CAT_CONFIG).filter(k => newsItems.some(n => n.category === k))];

  return React.createElement('div', {
    style: {
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderTop: `3px solid ${T.gold}`,
      borderRadius: 12,
      overflow: 'hidden',
    },
  },
    // ── Header ────────────────────────────────────────────────────
    React.createElement('div', {
      style: {
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        cursor: 'pointer',
        background: `linear-gradient(90deg, rgba(201,169,110,0.06) 0%, transparent 60%)`,
      },
      onClick: () => setCollapsed(c => !c),
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        // Пульсирующий индикатор агента
        React.createElement('div', { style: { position: 'relative', width: 10, height: 10 } },
          React.createElement('div', {
            style: {
              width: 10, height: 10, borderRadius: '50%',
              background: isActive ? T.green : T.textMuted,
              position: 'absolute',
            },
          }),
          isActive && React.createElement('div', {
            style: {
              width: 10, height: 10, borderRadius: '50%',
              background: T.green,
              position: 'absolute',
              animation: 'pulse-ring 2s ease-out infinite',
              transformBox: 'fill-box',
              transformOrigin: 'center',
            },
          }),
        ),
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif' },
          }, 'Лента новостей'),
          React.createElement('div', { style: { fontSize: 10, color: T.textMuted, marginTop: 2 } },
            lastRun ? `Обновлено ${timeAgo(data.generatedAt)}` : 'Загружается...',
          ),
        ),
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
        React.createElement('div', {
          style: {
            fontSize: 10, padding: '3px 10px', borderRadius: 20,
            background: isActive ? T.greenDim : T.redDim,
            border: `1px solid ${isActive ? T.green : T.red}44`,
            color: isActive ? T.green : T.red, fontWeight: 700,
          },
        }, isActive ? '● Активен' : '○ Ошибка'),
        React.createElement('span', { style: { fontSize: 16, color: T.textMuted } }, collapsed ? '▶' : '▼'),
      ),
    ),

    // ── Body ──────────────────────────────────────────────────────
    !collapsed && React.createElement('div', { style: { padding: '0 20px 16px' } },
      // Macro summary bar
      data?.macroUpdate && React.createElement('div', {
        style: {
          display: 'flex', gap: 20, padding: '10px 14px', marginBottom: 14,
          background: T.bg, borderRadius: 8, border: `1px solid ${T.border}`,
          flexWrap: 'wrap',
        },
      },
        [
          { label: 'КС ЦБ',   value: data.macroUpdate.keyRateAnnual + '%',      color: T.gold  },
          { label: 'Ипотека', value: data.macroUpdate.mortgageRateAnnual + '%', color: T.orange },
          { label: 'Инфляция',value: data.macroUpdate.inflationYoY?.toFixed(2) + '%', color: T.yellow },
          { label: 'Ипотека/сделок', value: Math.round((data.macroUpdate.mortgageShareOfDeals ?? 0.76) * 100) + '%', color: T.textSub },
        ].map(({ label, value, color }) =>
          React.createElement('div', { key: label, style: { display: 'flex', gap: 7, alignItems: 'baseline' } },
            React.createElement('span', { style: { fontSize: 10, color: T.textMuted, letterSpacing: '0.06em' } }, label),
            React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' } }, value),
          ),
        ),
      ),

      // Category filters
      React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 } },
        categories.map(cat => {
          const cfg = cat === 'all' ? { label: 'Все', color: T.gold } : CAT_CONFIG[cat];
          const active = catFilter === cat;
          return React.createElement('button', {
            key: cat,
            onClick: e => { e.stopPropagation(); setCatFilter(cat); },
            style: {
              padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              border: `1px solid ${active ? cfg.color : T.border}`,
              background: active ? `${cfg.color}18` : 'transparent',
              color: active ? cfg.color : T.textMuted,
              letterSpacing: '0.04em',
            },
          },
            cat === 'all' ? `Все (${newsItems.length})` : `${CAT_CONFIG[cat].icon} ${CAT_CONFIG[cat].label}`,
          );
        }),
      ),

      // News list
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        filtered.length === 0
          ? React.createElement('div', { style: { textAlign: 'center', padding: '20px', color: T.textMuted, fontSize: 12 } },
              'Нет новостей в этой категории',
            )
          : filtered.map(item =>
              React.createElement(NewsCard, {
                key: item.id,
                item,
                expanded: expandedId === item.id,
                onToggle: () => setExpandedId(expandedId === item.id ? null : item.id),
              }),
            ),
      ),


      // Summary
      data?.summary && React.createElement('div', {
        style: {
          marginTop: 14, padding: '10px 14px',
          background: 'rgba(201,169,110,0.05)', borderRadius: 8,
          border: `1px solid rgba(201,169,110,0.15)`,
          fontSize: 11, color: T.textSub, lineHeight: 1.7,
        },
      },
        React.createElement('span', { style: { color: T.gold, fontWeight: 700, marginRight: 6 } }, '📌 Резюме сессии:'),
        data.summary,
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// КС-СИМУЛЯТОР — пересчёт рейтинга при изменении ставки
// ═════════════════════════════════════════════════════════════════

const RU_MEDIAN_SALARY_SIM   = 64_000;
const RU_MEDIAN_PRICE_SIM    = 158_648;

function simulateRanking(baseRanking, simKS) {
  const macro = calculateMacroScore({
    keyRateAnnual:         simKS,
    mortgageRateAnnual:    simKS + 3.8,
    preferentialMortgageRate: 6,
    mortgageShareOfDeals:  0.72,
    inflationYoY:          4.8,
    realIncomeIndex3yr:    1.11,
    unemploymentRate:      3.2,
    medianMonthlyIncomeRu: RU_MEDIAN_SALARY_SIM,
    medianPricePerM2Ru:    RU_MEDIAN_PRICE_SIM,
  });

  return baseRanking.cities.map(c => {
    const entry = RUSSIA_MILLION_CITIES[c.key];
    if (!entry) return c;
    const score = calculateCityScore(entry.inputs, {
      macroMultiplier: macro.macroMultiplier,
      ruMedianSalary: RU_MEDIAN_SALARY_SIM,
    });
    return {
      ...c,
      cityScore: score.cityScore,
      zone:      score.zone,
      breakdown: score.breakdown,
      summary:   score.summary,
    };
  }).sort((a, b) => b.cityScore - a.cityScore);
}

// ── Мини-спарклайн цен ────────────────────────────────────────────
function PriceSparkline({ currentPrice, growthYoY, width = 60, height = 22 }) {
  const monthly = Math.pow(1 + (growthYoY || 0) / 100, 1 / 12) - 1;
  // 7 точек: -6 месяцев назад → сейчас
  const pts = Array.from({ length: 7 }, (_, i) => {
    const mAgo = 6 - i;
    return currentPrice / Math.pow(1 + monthly, mAgo);
  });
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const coords = pts.map((v, i) => {
    const x = (i / 6) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const isUp = growthYoY >= 0;
  const color = isUp ? T.green : T.red;
  return React.createElement('svg', { width, height, style: { overflow: 'visible', display: 'block' } },
    React.createElement('polyline', {
      points: coords,
      fill: 'none', stroke: color, strokeWidth: 1.5,
      strokeLinecap: 'round', strokeLinejoin: 'round',
      opacity: 0.8,
    }),
    // Последняя точка
    React.createElement('circle', {
      cx: width, cy: parseFloat((coords.split(' ').pop() || '0,0').split(',')[1] || '0'),
      r: 2.5, fill: color,
    }),
  );
}

// ── Intelligence Feed ─────────────────────────────────────────────
function IntelligenceFeed({ items }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!items?.length) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items?.length]);

  if (!items?.length) return null;
  const item = items[idx];
  const impactColor = item.impact === 'positive' ? T.green : item.impact === 'negative' ? T.red : T.textMuted;

  return React.createElement('div', {
    style: {
      background: 'rgba(201,169,110,0.04)',
      borderBottom: `1px solid rgba(201,169,110,0.1)`,
      padding: '7px 36px',
      display: 'flex', alignItems: 'center', gap: 14,
      overflow: 'hidden',
    },
  },
    React.createElement('div', {
      style: { fontSize: 9, color: T.gold, letterSpacing: '0.12em', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' },
    }, 'INTEL'),
    React.createElement('div', {
      style: { width: 1, height: 10, background: 'rgba(201,169,110,0.3)', flexShrink: 0 },
    }),
    React.createElement('div', {
      style: { fontSize: 9, color: impactColor, width: 6, height: 6, borderRadius: '50%', background: impactColor, flexShrink: 0 },
    }),
    React.createElement('div', {
      style: { fontSize: 11, color: T.textSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
    }, item.title),
    React.createElement('div', {
      style: { fontSize: 9, color: T.textMuted, flexShrink: 0 },
    }, `${idx + 1} / ${items.length}`),
  );
}

function MainScreen({ ranking, onCityClick }) {
  const [zoneFilter,    setZoneFilter]    = useState('all');
  const [minScore,      setMinScore]      = useState(0);
  const [maxPrice,      setMaxPrice]      = useState(Infinity);
  const [compareMode,   setCompareMode]   = useState(false);
  const [selectedKeys,  setSelectedKeys]  = useState(new Set());
  const [showCompare,   setShowCompare]   = useState(false);
  const [showTrendsFor, setShowTrendsFor] = useState(null);
  const [simKS,         setSimKS]         = useState(null); // null = реальные данные

  // Активные города — реальные или симулированные
  const activeCities = useMemo(() => {
    if (simKS === null) return ranking.cities;
    return simulateRanking(ranking, simKS);
  }, [simKS, ranking]);

  const filteredCities = activeCities.filter(c =>
    (zoneFilter === 'all' || c.zone === zoneFilter) &&
    c.cityScore >= minScore &&
    c.inputs.housing.businessClassPricePerM2 <= maxPrice,
  );

  const toggleCity = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else if (next.size < 4) next.add(key);
      return next;
    });
  };
  const selectedCities = activeCities.filter(c => selectedKeys.has(c.key));

  const thCell = (align = 'center') => ({
    padding: '12px 8px',
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: T.textMuted,
    fontWeight: 500,
    textAlign: align,
    fontFamily: 'Inter, sans-serif',
    whiteSpace: 'nowrap',
  });

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // Modals
    showCompare && selectedCities.length >= 2 &&
      React.createElement(ComparisonModal, { cities: selectedCities, onClose: () => setShowCompare(false) }),
    showTrendsFor &&
      React.createElement(TrendsModal, { city: showTrendsFor, onClose: () => setShowTrendsFor(null) }),

    React.createElement(MacroSnapshotBanner, { snapshot: ranking.macroSnapshot }),

    // ── КС-Симулятор ──────────────────────────────────────────────
    React.createElement('div', {
      style: {
        background: simKS !== null
          ? 'linear-gradient(135deg, rgba(91,191,138,0.07) 0%, rgba(91,191,138,0.02) 100%)'
          : T.surface,
        border: `1px solid ${simKS !== null ? T.green + '44' : T.border}`,
        borderRadius: 12, padding: '18px 24px',
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      },
    },
      React.createElement('div', { style: { flexShrink: 0 } },
        React.createElement('div', { style: { fontSize: 10, color: T.textMuted, letterSpacing: '0.1em', marginBottom: 4 } }, 'СЦЕНАРИЙ: КЛЮЧЕВАЯ СТАВКА'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
          React.createElement('span', {
            style: { fontSize: 28, fontWeight: 800, color: simKS !== null ? T.green : T.gold, fontFamily: 'Inter', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' },
          }, `${(simKS ?? ranking.macroSnapshot.keyRateAnnual).toFixed(1)}%`),
          simKS !== null && React.createElement('span', {
            style: { fontSize: 11, color: T.textMuted },
          }, `← было ${ranking.macroSnapshot.keyRateAnnual.toFixed(1)}%`),
        ),
      ),
      React.createElement('div', { style: { flex: 1, minWidth: 200 } },
        React.createElement('input', {
          type: 'range', min: 6, max: 21, step: 0.5,
          value: simKS ?? ranking.macroSnapshot.keyRateAnnual,
          onChange: e => {
            const v = parseFloat(e.target.value);
            setSimKS(Math.abs(v - ranking.macroSnapshot.keyRateAnnual) < 0.01 ? null : v);
          },
          style: { width: '100%', accentColor: T.green, cursor: 'pointer', height: 4 },
        }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.textMuted, marginTop: 4 } },
          React.createElement('span', null, '6% — нейтраль'),
          React.createElement('span', null, '14.5% — сейчас'),
          React.createElement('span', null, '21% — пик'),
        ),
      ),
      simKS !== null && React.createElement('button', {
        onClick: () => setSimKS(null),
        style: { padding: '7px 16px', borderRadius: 8, fontSize: 11, cursor: 'pointer', background: T.surfaceRaise, border: `1px solid ${T.border}`, color: T.textSub, fontFamily: 'Inter', flexShrink: 0 },
      }, '↩ Сбросить'),
      simKS !== null && React.createElement('div', {
        style: { padding: '6px 14px', borderRadius: 20, background: T.greenDim, border: `1px solid ${T.green}44`, fontSize: 10, fontWeight: 700, color: T.green, flexShrink: 0 },
      }, '● СИМ-РЕЖИМ'),
    ),

    React.createElement(RussiaMap, { cities: simKS !== null ? activeCities : ranking.cities, onCityClick }),
    React.createElement(TopEntryWidget, { cities: activeCities, onCityClick }),
    React.createElement(SupplyDemandBalanceChart, { cities: activeCities, onCityClick }),
    React.createElement(CityQuadrant, { cities: activeCities, onCityClick }),
    React.createElement(
      'div',
      { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' } },
      // header
      React.createElement(
        'div',
        {
          style: {
            padding: '20px 24px',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          },
        },
        React.createElement(
          'div',
          null,
          React.createElement('div', {
            style: {
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 18,
              fontWeight: 600,
              color: T.text,
              letterSpacing: '0.04em',
            },
          }, 'Рейтинг 14 городов-миллионников'),
          React.createElement('div', {
            style: { fontSize: 12, color: T.textMuted, marginTop: 4 },
          }, `${filteredCities.length} из ${activeCities.length} городов${simKS !== null ? ' · СИМ' : ''}`),
        ),

        // Controls row
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
          // Score filter
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            React.createElement('span', { style: { fontSize: 11, color: T.textMuted, whiteSpace: 'nowrap' } }, 'Score ≥'),
            React.createElement('input', {
              type: 'range', min: 0, max: 90, step: 5, value: minScore,
              onChange: e => setMinScore(+e.target.value),
              style: { width: 80, accentColor: T.gold },
            }),
            React.createElement('span', { style: { fontSize: 11, color: T.gold, minWidth: 24, fontVariantNumeric: 'tabular-nums' } }, minScore),
          ),
          // Price filter
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            React.createElement('span', { style: { fontSize: 11, color: T.textMuted, whiteSpace: 'nowrap' } }, 'Цена ≤'),
            React.createElement('select', {
              value: maxPrice === Infinity ? '' : maxPrice,
              onChange: e => setMaxPrice(e.target.value ? +e.target.value : Infinity),
              style: { background: T.bg, border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, color: T.text, fontSize: 11, padding: '3px 6px', fontFamily: 'Inter, sans-serif' },
            },
              React.createElement('option', { value: '' }, 'Любая'),
              React.createElement('option', { value: 150000 }, '150 тыс ₽/м²'),
              React.createElement('option', { value: 200000 }, '200 тыс ₽/м²'),
              React.createElement('option', { value: 300000 }, '300 тыс ₽/м²'),
              React.createElement('option', { value: 400000 }, '400 тыс ₽/м²'),
            ),
          ),
          React.createElement(ZoneFilter, { filter: zoneFilter, onChange: setZoneFilter }),

          // Compare toggle
          React.createElement('button', {
            onClick: () => { setCompareMode(m => !m); if (compareMode) setSelectedKeys(new Set()); },
            style: {
              padding: '5px 14px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              background: compareMode ? T.goldDim : T.surfaceRaise,
              border: `1px solid ${compareMode ? T.borderGold : T.border}`,
              color: compareMode ? T.gold : T.textSub,
            },
          }, compareMode ? `⊞ Выбрано ${selectedKeys.size}/4` : '⊞ Сравнить'),

          compareMode && selectedKeys.size >= 2 &&
            React.createElement('button', {
              onClick: () => setShowCompare(true),
              style: { padding: '5px 14px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: T.green, border: 'none', color: '#000', fontWeight: 700, fontFamily: 'Inter, sans-serif' },
            }, '→ Сравнить'),

          // CSV export
          React.createElement('button', {
            onClick: () => {
              const rows = [
                ['Город', 'CityScore', 'Зона', 'Цена м²', 'Население', 'Продажи м²/мес'],
                ...filteredCities.map(c => [
                  c.name, c.cityScore.toFixed(1), c.zone,
                  c.inputs.housing.businessClassPricePerM2,
                  c.inputs.demography.populationThousands,
                  c.inputs.housing.monthlySalesM2,
                ]),
              ];
              downloadCSV(rows, 'city_ranking.csv');
            },
            style: { padding: '5px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: T.surfaceRaise, border: `1px solid ${T.border}`, color: T.textSub, fontFamily: 'Inter, sans-serif' },
          }, '↓ CSV'),
        ),
      ),
      // table
      React.createElement(
        'div',
        { style: { overflowX: 'auto' } },
        React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              { style: { background: T.bg, borderBottom: `1px solid ${T.border}` } },
              React.createElement('th', { style: { ...thCell('left'), paddingLeft: 16 } }, '#'),
              React.createElement('th', { style: thCell('left') }, 'Город'),
              React.createElement('th', { style: { ...thCell('left'), whiteSpace: 'nowrap' } },
                'CityScore', React.createElement(HintIcon, { id: 'cityScore' }),
              ),
              React.createElement('th', { style: thCell() },
                'Демогр', React.createElement(HintIcon, { id: 'demographyScore' }),
              ),
              React.createElement('th', { style: thCell() },
                'Эконом', React.createElement(HintIcon, { id: 'economyScore' }),
              ),
              React.createElement('th', { style: thCell() },
                'Жильё', React.createElement(HintIcon, { id: 'housingMarketScore' }),
              ),
              React.createElement('th', { style: thCell() },
                'Конкур', React.createElement(HintIcon, { id: 'competitionScore' }),
              ),
              React.createElement('th', { style: thCell() },
                'Инфра', React.createElement(HintIcon, { id: 'infrastructureScore' }),
              ),
              React.createElement('th', { style: { ...thCell('right'), paddingRight: 16 } },
                'Цена м² БК', React.createElement(HintIcon, { id: 'businessClassPrice' }),
              ),
              React.createElement('th', { style: thCell() }, 'Вход'),
              React.createElement('th', { style: thCell() }),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            filteredCities.map((c) =>
              React.createElement(CityRow, {
                key:         c.key,
                rank:        ranking.cities.indexOf(c) + 1,
                city:        c,
                onClick:     onCityClick,
                compareMode,
                selected:    selectedKeys.has(c.key),
                onToggle:    toggleCity,
                onTrends:    (city) => setShowTrendsFor(city),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}


// ═════════════════════════════════════════════════════════════════
// КОМПОНЕНТЫ АНАЛИЗА (используются в карточке города)
// ═════════════════════════════════════════════════════════════════
// ИНВЕСТИЦИОННЫЙ ВЕРДИКТ — главная карточка решения
// ═════════════════════════════════════════════════════════════════

function buildVerdictReasons(city) {
  const h = city.inputs.housing;
  const e = city.inputs.economy;
  const d = city.inputs.demography;
  const inf = city.inputs.infrastructure;
  const comp = city.inputs.competition;
  const mc = city.marketCycle;
  const rp = city.riskProfile;

  const pros = [];
  const cons = [];

  // Демография
  if (d.migrationBalanceThousands > 5) pros.push(`Приток ${d.migrationBalanceThousands.toFixed(1)} тыс. чел/год — рынок растёт`);
  if (d.populationTrend5yPct > 3) pros.push(`Население растёт +${d.populationTrend5yPct.toFixed(1)}% за 5 лет`);
  if (d.migrationBalanceThousands < 0) cons.push(`Отток населения ${d.migrationBalanceThousands.toFixed(1)} тыс. чел/год`);

  // Экономика
  if (e.avgSalary > 80_000) pros.push(`Высокая ЗП ${fmtRub(e.avgSalary)}/мес — платёжеспособная аудитория`);
  if (e.highPaidIndustriesShare > 0.2) pros.push(`${Math.round(e.highPaidIndustriesShare*100)}% занятых в ИТ/ОПК/финансах`);
  if (e.unemploymentRate < 3) pros.push(`Безработица ${e.unemploymentRate.toFixed(1)}% — рынок труда напряжён, доходы растут`);
  if (e.unemploymentRate > 5) cons.push(`Безработица ${e.unemploymentRate.toFixed(1)}% — давление на доходы`);

  // Рынок жилья
  if (h.monthsOfSupply <= 8) pros.push(`Запас предложения ${h.monthsOfSupply} мес. — дефицит, цены под давлением роста`);
  if (h.sellReadinessRatioPct && h.sellReadinessRatioPct > 75) pros.push(`Распроданность ${h.sellReadinessRatioPct}% — спрос опережает стройку`);
  if (h.priceGrowthYoY > 8) pros.push(`Цены растут +${h.priceGrowthYoY.toFixed(1)}% YoY — рынок в тренде`);
  if (h.monthsOfSupply > 15) cons.push(`Перегрев предложения: ${h.monthsOfSupply} мес. запаса`);
  if (h.dealsGrowthYoY < -20) cons.push(`Сделки просели ${h.dealsGrowthYoY.toFixed(1)}% YoY — временное охлаждение`);

  // Конкуренция
  if (comp.hasWhiteSpaceBusinessClass) pros.push('Незанятые ниши бизнес-класса — окно для входа');
  if (!comp.hasFederalPlayers) pros.push('Нет федеральных конкурентов — лёгкий старт');
  if (comp.top5MarketShare > 0.7) cons.push(`Высокая концентрация: топ-5 держат ${Math.round(comp.top5MarketShare*100)}% рынка`);

  // КРТ
  if (inf.krtProgramsHa > 200) pros.push(`${inf.krtProgramsHa} га КРТ-программ — земля доступна`);
  if (inf.hasMajorInfraProjects) pros.push('Крупные инфраструктурные проекты повысят цены');

  // Рыночный цикл
  if (mc?.position === 'recovery') pros.push('Цикл: дефицит предложения — лучший момент для старта');
  if (mc?.position === 'expansion') pros.push('Цикл: фаза роста — цены и спрос набирают обороты');
  if (mc?.position === 'peak') cons.push('Цикл: перегрев — риск коррекции цен');
  if (mc?.position === 'oversupply') cons.push('Цикл: перенасыщение — высокая конкуренция за покупателя');

  return {
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 3),
  };
}

function InvestmentVerdictCard({ city, onReport }) {
  const mc = city.marketCycle;
  const sig = mc ? ENTRY_SIGNAL_CONFIG[mc.entrySignal] : ENTRY_SIGNAL_CONFIG['watch'];
  const { pros, cons } = buildVerdictReasons(city);

  const BIG_LABEL = {
    enter: { ru: 'ВХОДИТЬ', en: 'GO', glow: T.green },
    watch: { ru: 'НАБЛЮДАТЬ', en: 'WATCH', glow: T.yellow },
    wait:  { ru: 'ЖДАТЬ', en: 'WAIT', glow: T.red },
  }[mc?.entrySignal ?? 'watch'];

  return React.createElement('div', {
    style: {
      background: `linear-gradient(135deg, ${BIG_LABEL.glow}0A 0%, transparent 60%)`,
      border: `1px solid ${BIG_LABEL.glow}30`,
      borderLeft: `4px solid ${BIG_LABEL.glow}`,
      borderRadius: 12,
      padding: '28px 32px',
      position: 'relative',
      overflow: 'hidden',
    },
  },
    // Фоновый текст
    React.createElement('div', {
      style: {
        position: 'absolute', right: -10, top: -20,
        fontSize: 160, fontWeight: 900, color: `${BIG_LABEL.glow}06`,
        fontFamily: 'Inter, sans-serif', letterSpacing: '-0.05em',
        pointerEvents: 'none', userSelect: 'none', lineHeight: 1,
      },
    }, BIG_LABEL.en),

    // Заголовок
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 } },
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, color: BIG_LABEL.glow, letterSpacing: '0.15em', fontWeight: 700, marginBottom: 8, fontFamily: 'Inter, sans-serif' } },
          'ИНВЕСТИЦИОННОЕ РЕШЕНИЕ'
        ),
        React.createElement('div', {
          style: {
            fontSize: 48, fontWeight: 900, color: BIG_LABEL.glow,
            fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em',
            lineHeight: 1, textShadow: `0 0 40px ${BIG_LABEL.glow}40`,
          },
        }, BIG_LABEL.ru),
        mc?.timingScore && React.createElement('div', {
          style: { marginTop: 8, fontSize: 12, color: BIG_LABEL.glow, opacity: 0.7 },
        }, `Тайминг: ${mc.timingScore}/100 · ${CYCLE_CONFIG[mc.position]?.label ?? ''}`),
      ),

      // Кнопка отчёта
      React.createElement('button', {
        onClick: onReport,
        style: {
          padding: '12px 24px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
          fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '0.04em',
          background: `linear-gradient(135deg, ${T.gold} 0%, #E2C98A 100%)`,
          color: '#07080B', border: 'none',
          boxShadow: `0 4px 20px ${T.gold}40`,
          flexShrink: 0,
        },
      }, '⚡ ИИ-отчёт'),
    ),

    // Аргументы
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
      // Плюсы
      pros.length > 0 && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, color: T.green, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 10, fontFamily: 'Inter, sans-serif' } }, 'ПОЧЕМУ ВХОДИТЬ'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          pros.map((p, i) =>
            React.createElement('div', { key: i, style: { display: 'flex', gap: 8, fontSize: 12, color: T.textSub, lineHeight: 1.5 } },
              React.createElement('span', { style: { color: T.green, flexShrink: 0, fontWeight: 700 } }, '↑'),
              React.createElement('span', null, p),
            )
          ),
        ),
      ),

      // Риски
      cons.length > 0 && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, color: T.orange, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 10, fontFamily: 'Inter, sans-serif' } }, 'НА ЧТО СМОТРЕТЬ'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          cons.map((c, i) =>
            React.createElement('div', { key: i, style: { display: 'flex', gap: 8, fontSize: 12, color: T.textSub, lineHeight: 1.5 } },
              React.createElement('span', { style: { color: T.orange, flexShrink: 0, fontWeight: 700 } }, '→'),
              React.createElement('span', null, c),
            )
          ),
        ),
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// ТОП ГОРОДОВ ДЛЯ ВХОДА — виджет на главном экране
// ═════════════════════════════════════════════════════════════════

function TopEntryWidget({ cities, onCityClick }) {
  const topCities = cities
    .filter(c => c.marketCycle?.entrySignal === 'enter' || c.marketCycle?.entrySignal === 'watch')
    .sort((a, b) => {
      const aScore = (a.marketCycle?.timingScore ?? 0) + a.cityScore;
      const bScore = (b.marketCycle?.timingScore ?? 0) + b.cityScore;
      return bScore - aScore;
    })
    .slice(0, 3);

  if (topCities.length === 0) return null;

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 } },
      React.createElement('div', null,
        React.createElement(Label, null, 'Лучшие города для входа прямо сейчас'),
        React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 3 } }, 'По совокупности сигнала входа и городского скора'),
      ),
      React.createElement('div', {
        style: { fontSize: 10, color: T.green, letterSpacing: '0.08em', fontWeight: 700, padding: '4px 12px', background: T.greenDim, borderRadius: 20, border: `1px solid ${T.green}33` },
      }, '● LIVE'),
    ),

    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${topCities.length}, 1fr)`, gap: 12 } },
      topCities.map((city, rank) => {
        const sig = ENTRY_SIGNAL_CONFIG[city.marketCycle?.entrySignal ?? 'watch'];
        const z = ZONE[city.zone];
        const isTop = rank === 0;
        return React.createElement('div', {
          key: city.key,
          onClick: () => onCityClick(city.key),
          style: {
            background: isTop ? `linear-gradient(135deg, ${T.green}0D 0%, transparent 70%)` : T.surfaceRaise,
            border: `1px solid ${isTop ? T.green + '33' : T.border}`,
            borderRadius: 10, padding: '16px 18px', cursor: 'pointer',
            transition: 'all 0.15s ease',
            position: 'relative',
          },
        },
          isTop && React.createElement('div', {
            style: { position: 'absolute', top: 10, right: 12, fontSize: 9, color: T.green, letterSpacing: '0.08em', fontWeight: 700 },
          }, '★ №1'),
          React.createElement('div', { style: { fontSize: 16, fontWeight: 700, color: T.text, fontFamily: "'Cormorant Garamond', serif", marginBottom: 4 } }, city.name),
          React.createElement('div', { style: { fontSize: 10, color: T.textMuted, marginBottom: 12 } }, city.region.split(' ')[0]),

          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
              React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, 'CityScore'),
              React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: z.fg } }, city.cityScore.toFixed(1)),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
              React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, 'Тайминг'),
              React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: sig.color } }, `${city.marketCycle?.timingScore ?? '—'}/100`),
            ),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
              React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, 'Цена м²'),
              React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color: T.gold } }, fmtRub(city.inputs.housing.businessClassPricePerM2)),
            ),
          ),

          React.createElement('div', {
            style: {
              marginTop: 12, padding: '5px 12px', borderRadius: 20, textAlign: 'center',
              background: sig.bg, border: `1px solid ${sig.color}44`,
              fontSize: 11, fontWeight: 700, color: sig.color,
            },
          }, sig.label),
        );
      }),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// ПАНЕЛЬ ДОВЕРИЯ К ДАННЫМ
// ═════════════════════════════════════════════════════════════════

function DataTrustPanel({ city }) {
  const daysAgo = city.dataAsOfDate
    ? Math.floor((Date.now() - new Date(city.dataAsOfDate).getTime()) / 86400_000)
    : null;

  const freshColor = daysAgo === null ? T.textMuted
    : daysAgo <= 30 ? T.green
    : daysAgo <= 90 ? T.yellow
    : T.orange;

  const freshLabel = daysAgo === null ? 'неизвестно'
    : daysAgo <= 30 ? `${daysAgo} дн. назад — актуально`
    : daysAgo <= 90 ? `${daysAgo} дн. назад — умеренно свежие`
    : `${daysAgo} дн. назад — требует обновления`;

  return React.createElement('div', {
    style: {
      background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 20px',
    },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: city.sources?.length > 0 ? 10 : 0 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: freshColor, flexShrink: 0 } }),
        React.createElement(Label, null, 'Данные'),
        React.createElement('span', { style: { fontSize: 11, color: freshColor } }, freshLabel),
      ),
      city.needsVerification?.length > 0 && React.createElement('div', {
        style: { fontSize: 10, color: T.yellow },
      }, `⚠ Требует верификации: ${city.needsVerification.join(', ')}`),
    ),

    city.sources?.length > 0 && React.createElement('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: 6 },
    },
      city.sources.map((s, i) =>
        React.createElement('span', {
          key: i,
          style: {
            fontSize: 10, padding: '2px 10px', borderRadius: 20,
            background: T.surfaceRaise, color: T.textMuted,
            border: `1px solid ${T.border}`,
          },
        }, s),
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════

/** Карточка позиции рынка в цикле */
function MarketCycleCard({ city }) {
  const mc = city.marketCycle;
  if (!mc) return null;
  const cyc  = CYCLE_CONFIG[mc.position];
  const sig  = ENTRY_SIGNAL_CONFIG[mc.entrySignal];
  const segments = [
    { label: 'Восстановление', pos: 'recovery' },
    { label: 'Рост',           pos: 'expansion' },
    { label: 'Перегрев',       pos: 'peak' },
    { label: 'Охлаждение',     pos: 'slowdown' },
    { label: 'Перенасыщение',  pos: 'oversupply' },
  ];
  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 } },
      React.createElement('div', null,
        React.createElement(Label, { style: { marginBottom: 6 } }, 'Позиция рынка · Рыночный цикл'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('span', { style: { fontSize: 26, color: cyc.color } }, cyc.icon),
          React.createElement('div', {
            style: { fontSize: 20, fontWeight: 700, color: cyc.color, fontFamily: 'Inter, sans-serif' },
          }, cyc.label),
        ),
      ),
      React.createElement('div', {
        style: {
          padding: '8px 20px', borderRadius: 20,
          background: sig.bg, border: `1px solid ${sig.color}55`,
          textAlign: 'center',
        },
      },
        React.createElement('div', { style: { fontSize: 9, color: sig.color, letterSpacing: '0.12em', marginBottom: 3 } }, 'СИГНАЛ ВХОДА'),
        React.createElement('div', { style: { fontSize: 16, fontWeight: 800, color: sig.color, letterSpacing: '0.08em' } }, sig.label),
        React.createElement('div', { style: { fontSize: 9, color: sig.color, opacity: 0.6, marginTop: 2 } }, `Тайминг: ${mc.timingScore}/100`),
      ),
    ),

    // Progress bar показывает где мы в цикле
    React.createElement('div', { style: { display: 'flex', gap: 3, marginBottom: 14 } },
      segments.map(seg => {
        const active = seg.pos === mc.position;
        const cfg = CYCLE_CONFIG[seg.pos];
        return React.createElement('div', { key: seg.pos, style: { flex: 1 } },
          React.createElement('div', {
            style: {
              height: active ? 6 : 3,
              borderRadius: 3,
              background: active ? cfg.color : 'rgba(255,255,255,0.07)',
              transition: 'all 0.3s ease',
              marginBottom: 5,
            },
          }),
          React.createElement('div', {
            style: {
              fontSize: 8.5, textAlign: 'center', lineHeight: 1.3,
              color: active ? cfg.color : T.textMuted,
              fontWeight: active ? 700 : 400,
              fontFamily: 'Inter, sans-serif',
            },
          }, seg.label),
        );
      }),
    ),

    // Reasoning
    React.createElement('div', {
      style: {
        fontSize: 12, color: T.textSub, lineHeight: 1.65,
        padding: '10px 14px',
        background: `${cyc.color}0A`,
        borderLeft: `2px solid ${cyc.color}50`,
        borderRadius: '0 6px 6px 0',
      },
    }, mc.reasoning),
  );
}

/** Профиль рисков по 5 измерениям */
function RiskProfileCard({ city }) {
  const rp = city.riskProfile;
  if (!rp) return null;
  const m = useIsMobile();
  const riskColor = (v) => v >= 70 ? T.red : v >= 45 ? T.yellow : T.green;
  const dims = [
    { label: 'Демографический', value: rp.demographicRisk },
    { label: 'Ликвидность', value: rp.liquidityRisk },
    { label: 'Конкуренция', value: rp.competitionRisk },
    { label: 'Доступность', value: rp.affordabilityRisk },
    { label: 'Навес предложения', value: rp.supplyOverhang },
  ];
  const riskLabel = rp.overallRisk >= 70 ? 'Высокий' : rp.overallRisk >= 45 ? 'Умеренный' : 'Низкий';
  const riskFg = riskColor(rp.overallRisk);
  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
      React.createElement(Label, null, 'Профиль рисков'),
      React.createElement('div', {
        style: {
          padding: '4px 14px', borderRadius: 20,
          background: `${riskFg}14`, border: `1px solid ${riskFg}44`,
          fontSize: 11, fontWeight: 700, color: riskFg,
          fontFamily: 'Inter, sans-serif',
        },
      }, `${riskLabel} риск · ${rp.overallRisk}/100`),
    ),

    // Risk bars
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: rp.hardBlockers.length > 0 ? 16 : 0 } },
      dims.map(({ label, value }) => {
        const color = riskColor(value);
        return React.createElement('div', { key: label },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 } },
            React.createElement('span', { style: { fontSize: 11, color: T.textSub } }, label),
            React.createElement('span', { style: { fontSize: 12, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' } }, value),
          ),
          React.createElement('div', { style: { height: 3, borderRadius: 2, background: T.surfaceRaise } },
            React.createElement('div', {
              style: { height: '100%', borderRadius: 2, width: `${value}%`, background: color, transition: 'width 0.4s ease' },
            }),
          ),
        );
      }),
    ),

    // Hard blockers
    rp.hardBlockers.length > 0 && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      React.createElement(Label, { style: { marginBottom: 8 } }, '⛔ Жёсткие блокеры'),
      rp.hardBlockers.map((b, i) =>
        React.createElement('div', { key: i, style: {
          fontSize: 11, color: T.red, padding: '7px 12px',
          background: T.redDim, borderRadius: 6,
          border: `1px solid rgba(212,91,91,0.2)`, lineHeight: 1.5,
        }}, `• ${b}`),
      ),
    ),
  );
}

/** Доступность бизнес-класса */
function AffordabilityCard({ city }) {
  const af = city.affordability;
  if (!af) return null;
  const tierColor = { high: T.green, moderate: T.yellow, premium: T.orange, elite: T.red };
  const color = tierColor[af.tier];
  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement(Label, { style: { marginBottom: 14 } }, 'Индекс доступности бизнес-класса'),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 } },
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, color: T.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 } }, 'Месяцев ЗП на м²'),
        React.createElement('div', { style: { fontSize: 32, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1, fontFamily: 'Inter, sans-serif' } },
          af.monthsPerM2,
        ),
        React.createElement('div', {
          style: {
            display: 'inline-block', marginTop: 6, padding: '3px 12px', borderRadius: 20,
            background: `${color}14`, border: `1px solid ${color}44`,
            fontSize: 10, color, fontWeight: 700, letterSpacing: '0.06em',
          },
        }, af.tierRu),
      ),
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, color: T.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 } }, 'Ипотека 30 лет, 14.5%'),
        React.createElement('div', { style: { fontSize: 11, color: T.textSub, marginBottom: 6 } },
          `Платёж: `, React.createElement('span', { style: { color: T.text, fontWeight: 600 } }, fmtRub(city.inputs.housing.businessClassPricePerM2 * 65 * 0.8 * (0.145 / 12) / (1 - Math.pow(1 + 0.145 / 12, -360)))),
        ),
        React.createElement('div', { style: { fontSize: 11, color: T.textSub, marginBottom: 6 } },
          `${af.mortgagePaymentSharePct}% от ср. ЗП`,
          af.mortgagePaymentSharePct > 80 && React.createElement('span', { style: { color: T.red, marginLeft: 5 } }, '⚠'),
        ),
        React.createElement('div', { style: { fontSize: 11, color: T.textSub } },
          `Нужен доход: `, React.createElement('span', { style: { color: T.text, fontWeight: 600 } }, fmtRub(af.recommendedMonthlyIncome) + '/мес'),
        ),
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// ЭКРАН 2 — КАРТОЧКА ГОРОДА
// ═════════════════════════════════════════════════════════════════

function MetricCard({ label, value, sub, accent, gold, hint }) {
  const valueColor = gold
    ? T.gold
    : accent === 'good' ? T.green
    : accent === 'bad'  ? T.red
    : T.text;
  return React.createElement(
    'div',
    {
      style: {
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: '16px 18px',
      },
    },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
      React.createElement(Label, null, label),
      hint && React.createElement(HintIcon, { id: hint }),
    ),
    React.createElement('div', {
      style: {
        fontSize: 20,
        fontWeight: 600,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '-0.01em',
      },
    }, value),
    sub && React.createElement('div', {
      style: { fontSize: 11, color: T.textMuted, marginTop: 5 },
    }, sub),
  );
}

// ═════════════════════════════════════════════════════════════════
// ИИ-ОТЧЁТ ПО ГОРОДУ
// ═════════════════════════════════════════════════════════════════

function buildCityReportPrompt(city) {
  const inp = city.inputs;
  const mc  = city.marketCycle;
  const z   = ZONE[city.zone];
  return [
    'Ты — старший аналитик девелопера жилья бизнес-класса. Напиши сжатый инвестиционный обзор для принятия решения о выходе в город.',
    '',
    `ГОРОД: ${city.name} (${city.region})`,
    `CityScore: ${city.cityScore.toFixed(1)}/100 · Зона: ${z.label}`,
    `Рыночный цикл: ${mc?.position ?? '—'} · Сигнал входа: ${mc?.entrySignal ?? '—'}`,
    '',
    'ДЕМОГРАФИЯ',
    `  Население: ${inp.demography.populationThousands.toLocaleString('ru-RU')} тыс. | Тренд 5 лет: ${inp.demography.populationTrend5yPct >= 0 ? '+' : ''}${inp.demography.populationTrend5yPct}%`,
    `  Миграционный приток: +${inp.demography.migrationBalanceThousands} тыс./год | Возраст 25–45: ${Math.round(inp.demography.shareAge25to45 * 100)}%`,
    '',
    'ЭКОНОМИКА',
    `  Средняя з/п: ${inp.economy.avgSalary.toLocaleString('ru-RU')} ₽/мес (+${inp.economy.salaryGrowthYoY}% YoY)`,
    `  Безработица: ${inp.economy.unemploymentRate}% | Высокооплачиваемые отрасли: ${Math.round(inp.economy.highPaidIndustriesShare * 100)}%`,
    '',
    'РЫНОК ЖИЛЬЯ (только бизнес-класс)',
    `  Цена м²: ${inp.housing.businessClassPricePerM2.toLocaleString('ru-RU')} ₽ | Рост цен: +${inp.housing.priceGrowthYoY}% YoY`,
    `  Динамика сделок: ${inp.housing.dealsGrowthYoY >= 0 ? '+' : ''}${inp.housing.dealsGrowthYoY}% YoY | Продажи: ${Math.round(inp.housing.monthlySalesM2 / 1000)} тыс. м²/мес`,
    `  Срок реализации: ${inp.housing.monthsOfSupply} мес. | Распроданность/стройготовность: ${inp.housing.sellReadinessRatioPct ?? '—'}%`,
    '',
    'КОНКУРЕНЦИЯ',
    `  Застройщиков: ${inp.competition.activeDevelopers} | Доля топ-5: ${Math.round(inp.competition.top5MarketShare * 100)}%`,
    `  Белое пятно БК: ${inp.competition.hasWhiteSpaceBusinessClass ? 'Да ✓' : 'Нет'} | Федеральные игроки: ${inp.competition.hasFederalPlayers ? 'Есть' : 'Нет'}`,
    '',
    'КРТ / ИНФРАСТРУКТУРА',
    `  КРТ: ${inp.infrastructure.krtProgramsHa ? inp.infrastructure.krtProgramsHa + ' га' : 'нет данных'}${inp.infrastructure.krtProjectsCount ? ' · ' + inp.infrastructure.krtProjectsCount + ' проектов' : ''}`,
    `  Крупные инфраструктурные проекты: ${inp.infrastructure.hasMajorInfraProjects ? 'Да' : 'Нет'} | Университеты/технопарки: ${inp.infrastructure.hasUniversitiesOrTechparks ? 'Да' : 'Нет'}`,
    '',
    `ПОДСКОРЫ: Демография ${city.breakdown.demographyScore.toFixed(0)} | Экономика ${city.breakdown.economyScore.toFixed(0)} | Рынок жилья ${city.breakdown.housingMarketScore.toFixed(0)} | Конкуренция ${city.breakdown.competitionScore.toFixed(0)} | Инфраструктура ${city.breakdown.infrastructureScore.toFixed(0)}`,
    '',
    'Напиши отчёт строго по структуре ниже. Без вводных слов, только факты с конкретными цифрами. Максимум 380 слов.',
    '',
    '## Позиционирование',
    '[Где рынок в цикле и что это значит для девелопера БК прямо сейчас — 2–3 предложения]',
    '',
    '## Возможности',
    '• [Конкретная возможность с цифрами]',
    '• [Конкретная возможность с цифрами]',
    '• [Конкретная возможность с цифрами]',
    '',
    '## Риски',
    '• [Конкретный риск с цифрами]',
    '• [Конкретный риск с цифрами]',
    '• [Конкретный риск с цифрами]',
    '',
    '## Неочевидные драйверы',
    '• [То, что не видно в цифрах, но важно для принятия решения]',
    '• [Структурный тренд или локальная особенность рынка]',
    '',
    '## Рекомендация',
    '**[ВХОДИТЬ / НАБЛЮДАТЬ / ЖДАТЬ]** — [1–2 предложения: при каких условиях, какой формат проекта, ключевая метрика контроля]',
  ].join('\n');
}

async function* streamCityReport(city, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      stream: true,
      messages: [{ role: 'user', content: buildCityReportPrompt(city) }],
    }),
  });
  if (!resp.ok) {
    let msg = `Ошибка API ${resp.status}`;
    try { const e = await resp.json(); msg = e.error?.message ?? msg; } catch {}
    throw new Error(msg);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') yield evt.delta.text;
      } catch {}
    }
  }
}

function renderReportMarkdown(raw) {
  return raw.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return React.createElement('div', {
        key: i,
        style: { fontSize: 10, fontWeight: 700, color: T.gold, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 22, marginBottom: 10, borderBottom: `1px solid ${T.border}`, paddingBottom: 5 },
      }, line.slice(3));
    }
    if (line.startsWith('• ') || line.startsWith('- ')) {
      const parts = line.slice(2).split(/(\*\*.*?\*\*)/);
      return React.createElement('div', { key: i, style: { display: 'flex', gap: 8, marginBottom: 7 } },
        React.createElement('span', { style: { color: T.gold, flexShrink: 0, fontSize: 14, lineHeight: '1.6' } }, '·'),
        React.createElement('span', { style: { fontSize: 13, color: T.text, lineHeight: 1.65 } },
          parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
            ? React.createElement('strong', { key: j, style: { color: T.gold, fontWeight: 600 } }, p.slice(2, -2))
            : p,
          ),
        ),
      );
    }
    if (line.trim() === '') return React.createElement('div', { key: i, style: { height: 4 } });
    const parts = line.split(/(\*\*.*?\*\*)/);
    return React.createElement('div', { key: i, style: { fontSize: 13, color: T.textSub, lineHeight: 1.7, marginBottom: 3 } },
      parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
        ? React.createElement('strong', { key: j, style: { color: T.text, fontWeight: 600 } }, p.slice(2, -2))
        : p,
      ),
    );
  });
}

function CityReportModal({ city, onClose }) {
  const [apiKey,  setApiKey]  = useState(() => localStorage.getItem('level_anthro_key') ?? '');
  const [phase,   setPhase]   = useState('idle');
  const [text,    setText]    = useState('');
  const [err,     setErr]     = useState('');
  const textRef     = React.useRef('');
  const cancelledRef = React.useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    // Приоритет: вшитый при сборке ключ → localStorage → промпт
    const key = BUILD_API_KEY || localStorage.getItem('level_anthro_key');
    if (key) startRun(key); else setPhase('key');
    return () => { cancelledRef.current = true; };
  }, []);

  function startRun(key) {
    setPhase('generating');
    textRef.current = '';
    setText('');
    setErr('');
    (async () => {
      try {
        for await (const chunk of streamCityReport(city, key)) {
          if (cancelledRef.current) return;
          textRef.current += chunk;
          setText(textRef.current);
        }
        if (!cancelledRef.current) setPhase('done');
      } catch (e) {
        if (!cancelledRef.current) { setErr(e.message); setPhase('error'); }
      }
    })();
  }

  const handleKeySubmit = () => {
    const k = apiKey.trim();
    if (!k) return;
    localStorage.setItem('level_anthro_key', k);
    startRun(k);
  };

  const effectiveKey = BUILD_API_KEY || apiKey;

  const handleDownload = () => {
    const content = `ИНВЕСТИЦИОННЫЙ ОТЧЁТ: ${city.name}\nСоставлен: ${new Date().toLocaleDateString('ru-RU')}\nLEVEL Platform AI\n\n${text}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `LEVEL_${city.key}_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(7,8,11,0.90)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(10px)', padding: 20,
    },
    onClick: e => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: T.surface, border: `1px solid ${T.borderGold}`, borderRadius: 16,
        width: '100%', maxWidth: 700, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,169,110,0.12)',
      },
    },
      // Modal header
      React.createElement('div', {
        style: {
          padding: '20px 24px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(90deg, rgba(201,169,110,0.07) 0%, transparent 50%)',
          flexShrink: 0,
        },
      },
        React.createElement('div', null,
          React.createElement('div', {
            style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 21, fontWeight: 600, color: T.text, letterSpacing: '0.03em' },
          }, `${city.name} · Инвестиционный отчёт`),
          React.createElement('div', { style: { fontSize: 10, color: T.textMuted, marginTop: 3, letterSpacing: '0.06em' } },
            phase === 'generating' ? '● Агент формирует отчёт...' :
            phase === 'done'       ? `● Готово · LEVEL Platform AI · ${new Date().toLocaleDateString('ru-RU')}` :
            phase === 'error'      ? '○ Ошибка генерации' : '○ Доступ закрыт',
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
          phase === 'done' && React.createElement('button', {
            onClick: handleDownload,
            style: { padding: '7px 16px', borderRadius: 7, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif', background: T.surfaceRaise, border: `1px solid ${T.border}`, color: T.textSub },
          }, '↓ Скачать'),
          React.createElement('button', {
            onClick: onClose,
            style: { width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer', background: 'none', border: `1px solid ${T.border}`, color: T.textMuted, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' },
          }, '×'),
        ),
      ),

      // Modal body
      React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '24px 28px' } },
        // Key input
        phase === 'key' && React.createElement('div', { style: { textAlign: 'center', padding: '40px 20px' } },
          React.createElement('div', {
            style: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(201,169,110,0.08)', border: `1px solid ${T.borderGold}`, margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
          }, '🔐'),
          React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 8, fontFamily: "'Cormorant Garamond', serif", letterSpacing: '0.02em' } },
            'Введите пароль доступа',
          ),
          React.createElement('div', { style: { fontSize: 12, color: T.textMuted, marginBottom: 24 } },
            'Пароль сохраняется локально, повторный ввод не требуется',
          ),
          React.createElement('div', { style: { display: 'flex', gap: 10, maxWidth: 420, margin: '0 auto' } },
            React.createElement('input', {
              type: 'password', placeholder: '••••••••••••',
              value: apiKey, onChange: e => setApiKey(e.target.value),
              onKeyDown: e => e.key === 'Enter' && handleKeySubmit(),
              autoFocus: true,
              className: 'l-input',
              style: { flex: 1, padding: '12px 16px', borderRadius: 8, fontSize: 15, background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: 'Inter, sans-serif', letterSpacing: '0.12em' },
            }),
            React.createElement('button', {
              onClick: handleKeySubmit,
              style: { padding: '12px 22px', borderRadius: 8, fontSize: 14, cursor: 'pointer', background: T.gold, border: 'none', color: '#07080B', fontWeight: 700, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' },
            }, 'Войти'),
          ),
        ),

        // Spinner (before first chunk arrives)
        (phase === 'generating' && text === '') && React.createElement('div', { style: { padding: '48px 0', textAlign: 'center' } },
          React.createElement('div', { className: 'l-spin', style: { width: 30, height: 30, margin: '0 auto', border: `2px solid rgba(201,169,110,0.15)`, borderTopColor: T.gold, borderRadius: '50%' } }),
          React.createElement('div', { style: { marginTop: 18, fontSize: 12, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' } }, 'Анализирую рынок...'),
        ),

        // Streaming / done text
        (phase === 'generating' || phase === 'done') && text.length > 0 &&
          React.createElement('div', null, ...renderReportMarkdown(text)),

        // Error
        phase === 'error' && React.createElement('div', { style: { padding: '32px 0', textAlign: 'center' } },
          React.createElement('div', { style: { fontSize: 13, color: T.red, marginBottom: 16, lineHeight: 1.6 } }, err),
          React.createElement('button', {
            onClick: () => startRun(apiKey),
            style: { padding: '9px 22px', borderRadius: 8, fontSize: 12, cursor: 'pointer', background: T.surfaceRaise, border: `1px solid ${T.border}`, color: T.textSub, fontFamily: 'Inter, sans-serif' },
          }, 'Попробовать ещё раз'),
        ),
      ),
    ),
  );
}

function CityDetailScreen({ city, onBack, onGotoFinance, onGotoDistrict }) {
  const m = useIsMobile();
  const z = ZONE[city.zone];
  const [showReport, setShowReport] = useState(false);
  const radarData = [
    { name: 'Демография',    score: city.breakdown.demographyScore },
    { name: 'Экономика',     score: city.breakdown.economyScore },
    { name: 'Рынок жилья',   score: city.breakdown.housingMarketScore },
    { name: 'Конкуренция',   score: city.breakdown.competitionScore },
    { name: 'Инфраструктура',score: city.breakdown.infrastructureScore },
  ];

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // ── Report modal ───────────────────────────────────────────
    showReport && React.createElement(CityReportModal, { city, onClose: () => setShowReport(false) }),

    // ── Investment Verdict ─────────────────────────────────────
    React.createElement(InvestmentVerdictCard, { city, onReport: () => setShowReport(true) }),

    // ── City header ────────────────────────────────────────────
    React.createElement(
      'div',
      { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '28px 32px' } },
      React.createElement(
        'button',
        {
          onClick: onBack,
          style: {
            fontSize: 12, color: T.textMuted, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, marginBottom: 20, letterSpacing: '0.04em',
            fontFamily: 'Inter, sans-serif',
          },
        },
        '← К рейтингу',
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 } },
        React.createElement(
          'div',
          null,
          React.createElement('h1', {
            style: {
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 48,
              fontWeight: 600,
              color: T.text,
              letterSpacing: '0.02em',
              lineHeight: 1,
            },
          }, city.name),
          React.createElement('div', { style: { fontSize: 13, color: T.textMuted, marginTop: 10 } }, city.region),
        ),
        React.createElement(
          'div',
          { style: { textAlign: 'right' } },
          React.createElement(Label, { style: { marginBottom: 6 } }, 'CityScore'),
          React.createElement('div', {
            style: {
              fontSize: 68,
              fontWeight: 700,
              color: z.fg,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              fontFamily: 'Inter, sans-serif',
              letterSpacing: '-0.03em',
            },
          }, city.cityScore.toFixed(1)),
          React.createElement('div', {
            style: {
              fontSize: 11,
              color: z.fg,
              opacity: 0.65,
              marginTop: 5,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            },
          }, z.label + ' зона'),
        ),
      ),
      // summary
      React.createElement('div', {
        style: {
          marginTop: 20,
          padding: '14px 18px',
          borderRadius: 8,
          background: z.bg,
          border: `1px solid ${z.fg}28`,
        },
      },
      React.createElement('p', {
        style: { fontSize: 13, color: z.fg, margin: 0, lineHeight: 1.65, opacity: 0.9 },
      }, city.summary),
      ),
    ),

    // ── Radar + KPIs ───────────────────────────────────────────
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 2fr', gap: 20 } },
      // radar
      React.createElement(
        'div',
        { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
        React.createElement(Label, { style: { marginBottom: 16 } }, 'Подскоры'),
        React.createElement(
          ResponsiveContainer,
          { width: '100%', height: 280 },
          React.createElement(
            RadarChart,
            { data: radarData },
            React.createElement(PolarGrid, { stroke: 'rgba(255,255,255,0.07)' }),
            React.createElement(PolarAngleAxis, {
              dataKey: 'name',
              tick: { fontSize: 11, fill: T.textSub, fontFamily: 'Inter, sans-serif' },
            }),
            React.createElement(PolarRadiusAxis, {
              domain: [0, 100],
              tick: { fontSize: 9, fill: T.textMuted },
              axisLine: false,
            }),
            React.createElement(Radar, {
              name: city.name,
              dataKey: 'score',
              stroke: T.gold,
              fill: T.gold,
              fillOpacity: 0.14,
              strokeWidth: 1.5,
            }),
          ),
        ),
      ),
      // KPI grid 3×3
      React.createElement(
        'div',
        { style: { display: 'grid', gridTemplateColumns: m ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 12, alignContent: 'start' } },
        React.createElement(MetricCard, {
          label: 'Население',
          value: `${city.inputs.demography.populationThousands.toLocaleString('ru-RU')} тыс.`,
          sub: `${city.inputs.demography.populationTrend5yPct >= 0 ? '+' : ''}${city.inputs.demography.populationTrend5yPct.toFixed(1)}% за 5 лет`,
          accent: city.inputs.demography.populationTrend5yPct >= 0 ? 'good' : 'bad',
          hint: 'population',
        }),
        React.createElement(MetricCard, {
          label: 'Миграция',
          value: `${city.inputs.demography.migrationBalanceThousands >= 0 ? '+' : ''}${city.inputs.demography.migrationBalanceThousands.toFixed(1)} тыс.`,
          sub: 'чел/год',
          accent: city.inputs.demography.migrationBalanceThousands >= 0 ? 'good' : 'bad',
          hint: 'migration',
        }),
        React.createElement(MetricCard, {
          label: '25–45 лет',
          value: fmtPct(city.inputs.demography.shareAge25to45 * 100, 0),
          sub: 'доля группы',
          hint: 'youngAdults',
        }),
        React.createElement(MetricCard, {
          label: 'Средняя зарплата',
          value: fmtRub(city.inputs.economy.avgSalary),
          sub: `+${city.inputs.economy.salaryGrowthYoY.toFixed(1)}% YoY`,
          accent: 'good',
          hint: 'avgSalary',
        }),
        React.createElement(MetricCard, {
          label: 'Цена м² бизнес-класс',
          value: fmtRub(city.inputs.housing.businessClassPricePerM2),
          sub: `+${city.inputs.housing.priceGrowthYoY.toFixed(1)}% YoY`,
          gold: true,
          hint: 'businessClassPrice',
        }),
        React.createElement(MetricCard, {
          label: 'Темп поглощения',
          value: `${city.inputs.housing.monthsOfSupply} мес.`,
          sub: 'запас предложения',
          accent: city.inputs.housing.monthsOfSupply <= 9 ? 'good'
                : city.inputs.housing.monthsOfSupply >= 15 ? 'bad' : null,
          hint: 'absorptionRate',
        }),
        React.createElement(MetricCard, {
          label: 'Девелоперов',
          value: city.inputs.competition.activeDevelopers,
          sub: `топ-5: ${fmtPct(city.inputs.competition.top5MarketShare * 100, 0)}`,
          hint: 'developers',
        }),
        React.createElement(MetricCard, {
          label: 'Безработица',
          value: fmtPct(city.inputs.economy.unemploymentRate, 1),
          accent: city.inputs.economy.unemploymentRate <= 3 ? 'good'
                : city.inputs.economy.unemploymentRate >= 5 ? 'bad' : null,
          hint: 'unemployment',
        }),
        React.createElement(MetricCard, {
          label: 'КРТ-программы',
          value: `${city.inputs.infrastructure.krtProgramsHa} га`,
          sub: city.inputs.infrastructure.hasMajorInfraProjects ? '✓ крупные проекты' : '',
          accent: city.inputs.infrastructure.hasMajorInfraProjects ? 'good' : null,
          hint: 'krt',
        }),
        // Второй ряд — расширенные данные
        React.createElement(MetricCard, {
          label: 'Рост сделок',
          value: `${city.inputs.housing.dealsGrowthYoY >= 0 ? '+' : ''}${city.inputs.housing.dealsGrowthYoY.toFixed(1)}%`,
          sub: 'новостройки YoY',
          accent: city.inputs.housing.dealsGrowthYoY >= 5 ? 'good' : city.inputs.housing.dealsGrowthYoY < -5 ? 'bad' : null,
        }),
        React.createElement(MetricCard, {
          label: 'Высокодоход. отрасли',
          value: fmtPct(city.inputs.economy.highPaidIndustriesShare * 100, 0),
          sub: 'IT / ОПК / финансы',
          accent: city.inputs.economy.highPaidIndustriesShare >= 0.25 ? 'good' : null,
        }),
        React.createElement(MetricCard, {
          label: 'Объём строительства',
          value: city.inputs.housing.constructionVolumeMkdThousM2
            ? `${city.inputs.housing.constructionVolumeMkdThousM2.toFixed(0)} тыс м²`
            : '—',
          sub: 'активное МКД',
        }),
        React.createElement(MetricCard, {
          label: 'Объём продаж/мес',
          value: city.inputs.housing.monthlySalesM2
            ? `${(city.inputs.housing.monthlySalesM2 / 1000).toFixed(1)} тыс м²`
            : '—',
          sub: 'первичный рынок',
          accent: 'good',
        }),
        React.createElement(MetricCard, {
          label: 'Пробел в БК',
          value: city.inputs.competition.hasWhiteSpaceBusinessClass ? 'Есть' : 'Нет',
          sub: 'ниши бизнес-класса',
          accent: city.inputs.competition.hasWhiteSpaceBusinessClass ? 'good' : null,
        }),
        React.createElement(MetricCard, {
          label: 'Унив. / технопарки',
          value: city.inputs.infrastructure.hasUniversitiesOrTechparks ? 'Есть' : 'Нет',
          sub: 'образоват. среда',
          accent: city.inputs.infrastructure.hasUniversitiesOrTechparks ? 'good' : null,
        }),
      ),
    ),

    // ── Market Cycle + Risk + Affordability ────────────────────
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 20 } },
      React.createElement(MarketCycleCard, { city }),
      React.createElement(RiskProfileCard, { city }),
    ),
    React.createElement(AffordabilityCard, { city }),
    React.createElement(PriceForecastChart, { city, macroSnapshot: null }),

    // ── District CTA ────────────────────────────────────────────
    React.createElement(
      'div',
      {
        style: {
          background: 'rgba(91,191,138,0.04)',
          border: `1px solid rgba(91,191,138,0.18)`,
          borderRadius: 12,
          padding: '24px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20,
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement('div', {
          style: {
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 22,
            fontWeight: 600,
            color: T.text,
            marginBottom: 6,
            letterSpacing: '0.02em',
          },
        }, 'Оценить район для застройки'),
        React.createElement('div', {
          style: { fontSize: 13, color: T.textSub },
        }, 'Скоринг района: доступность, среда, локальный рынок и совпадение сегмента'),
      ),
      React.createElement(
        'button',
        {
          onClick: () => onGotoDistrict(city),
          style: {
            padding: '13px 28px',
            background: 'transparent',
            color: T.green,
            border: `1px solid rgba(91,191,138,0.4)`,
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            fontFamily: 'Inter, sans-serif',
          },
        },
        'Скоринг района →',
      ),
    ),

    // ── Finance CTA ────────────────────────────────────────────
    React.createElement(
      'div',
      {
        style: {
          background: `linear-gradient(135deg, rgba(201,169,110,0.07) 0%, rgba(201,169,110,0.02) 100%)`,
          border: `1px solid ${T.borderGold}`,
          borderRadius: 12,
          padding: '24px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20,
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement('div', {
          style: {
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 22,
            fontWeight: 600,
            color: T.text,
            marginBottom: 6,
            letterSpacing: '0.02em',
          },
        }, 'Посчитать проект в этом городе'),
        React.createElement('div', {
          style: { fontSize: 13, color: T.textSub },
        }, `Цена м² бизнес-класс ${fmtRub(city.inputs.housing.businessClassPricePerM2)} подставится автоматически`),
      ),
      React.createElement(
        'button',
        {
          onClick: () => onGotoFinance(city),
          style: {
            padding: '13px 28px',
            background: T.gold,
            color: '#07080B',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.04em',
            fontFamily: 'Inter, sans-serif',
          },
        },
        'Открыть финмодель →',
      ),
    ),


    // ── Data Trust ─────────────────────────────────────────────
    React.createElement(DataTrustPanel, { city }),
  );
}


// ═════════════════════════════════════════════════════════════════
// ЭКРАН 3 — СКОРИНГ РАЙОНА
// ═════════════════════════════════════════════════════════════════

function DistrictScreen({ city, onBack, onGotoSite }) {
  const m = useIsMobile();
  const [inputs, setInputs] = useState({
    name: 'Район',
    cityName: city.name,
    travelTimeToCenterMin: 20,
    hasMetro: false,
    socialFacilitiesPer1000: 1.5,
    hasParksOrWaterfront: false,
    walkabilityIndex: 50,
    localPricePerM2: city.inputs.housing.businessClassPricePerM2,
    localPriceGrowthYoY: city.inputs.housing.priceGrowthYoY,
    directCompetitorsCount: 3,
    segmentAlignment: 0.7,
  });

  const set = (key) => (v) => setInputs((prev) => ({ ...prev, [key]: v }));

  const result = useMemo(
    () => calculateDistrictScore(inputs, { cityAvgPricePerM2: city.inputs.housing.businessClassPricePerM2 }),
    [inputs, city],
  );

  const z = ZONE[result.zone];

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // ── Header ───────────────────────────────────────────────
    React.createElement(
      'div',
      { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 28px' } },
      React.createElement('button', {
        onClick: onBack,
        style: { fontSize: 12, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12, fontFamily: 'Inter, sans-serif' },
      }, `← К городу ${city.name}`),
      React.createElement('h1', {
        style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 32, fontWeight: 600, color: T.text, letterSpacing: '0.02em' },
      }, `Скоринг района — ${city.name}`),
      React.createElement('div', { style: { fontSize: 13, color: T.textMuted, marginTop: 6 } },
        'Уровень 3: оцените инвестиционную привлекательность конкретного района',
      ),
    ),

    // ── Inputs + Results ─────────────────────────────────────
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 20 } },

      // Left: inputs
      React.createElement(
        'div',
        { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
        React.createElement(Label, { style: { marginBottom: 16 } }, 'Параметры района'),
        React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          React.createElement(InputField, { label: 'Время до центра, мин', value: inputs.travelTimeToCenterMin, step: 5, min: 0, max: 90, onChange: set('travelTimeToCenterMin') }),
          React.createElement(InputField, { label: 'Социнфраструктура на 1 000 жит.', value: inputs.socialFacilitiesPer1000, step: 0.5, min: 0, max: 10, onChange: set('socialFacilitiesPer1000') }),
          React.createElement(InputField, { label: 'Walkability (0–100)', value: inputs.walkabilityIndex, step: 5, min: 0, max: 100, onChange: set('walkabilityIndex') }),
          React.createElement(InputField, { label: 'Локальная цена м², ₽', value: inputs.localPricePerM2, step: 10000, min: 0, onChange: set('localPricePerM2') }),
          React.createElement(InputField, { label: 'Рост цены YoY, %', value: inputs.localPriceGrowthYoY, step: 1, onChange: set('localPriceGrowthYoY') }),
          React.createElement(InputField, { label: 'Прямые конкуренты, шт', value: inputs.directCompetitorsCount, step: 1, min: 0, onChange: set('directCompetitorsCount') }),
          React.createElement(InputField, { label: 'Совпадение сегмента (0–1)', value: inputs.segmentAlignment, step: 0.1, min: 0, max: 1, onChange: set('segmentAlignment') }),
          React.createElement('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 } },
            React.createElement(CheckboxField, { label: 'Есть метро / МЦД / трамвай', checked: inputs.hasMetro, onChange: set('hasMetro') }),
            React.createElement(CheckboxField, { label: 'Парки или набережная рядом', checked: inputs.hasParksOrWaterfront, onChange: set('hasParksOrWaterfront') }),
          ),
        ),
      ),

      // Right: results
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        // Big score
        React.createElement(
          'div',
          {
            style: {
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: '28px 24px', textAlign: 'center',
            },
          },
          React.createElement(Label, { style: { marginBottom: 12 } }, 'DistrictScore'),
          React.createElement('div', {
            style: {
              fontSize: 80, fontWeight: 700, color: z.fg,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              fontFamily: 'Inter, sans-serif', letterSpacing: '-0.03em',
            },
          }, result.districtScore.toFixed(1)),
          React.createElement('div', {
            style: {
              display: 'inline-block', marginTop: 14, padding: '6px 20px', borderRadius: 20,
              background: z.bg, border: `1px solid ${z.fg}30`,
              fontSize: 11, color: z.fg, letterSpacing: '0.1em', textTransform: 'uppercase',
            },
          }, z.label + ' зона'),
        ),
        // Sub-scores
        React.createElement(
          'div',
          { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
          React.createElement(Label, { style: { marginBottom: 14 } }, 'Подскоры'),
          React.createElement(ScoreBar, { label: 'Доступность',          score: result.breakdown.accessScore,        hint: 'accessScore' }),
          React.createElement(ScoreBar, { label: 'Социнфраструктура',    score: result.breakdown.socialInfraScore,   hint: 'socialInfraScore' }),
          React.createElement(ScoreBar, { label: 'Качество среды',       score: result.breakdown.urbanQualityScore,  hint: 'urbanQualityScore' }),
          React.createElement(ScoreBar, { label: 'Локальный рынок',      score: result.breakdown.localMarketScore,   hint: 'localMarketScore' }),
          React.createElement(ScoreBar, { label: 'Совпадение сегмента',  score: result.breakdown.alignmentScore,     hint: 'alignmentScore' }),
        ),
      ),
    ),

    // ── CTA → Site ───────────────────────────────────────────
    React.createElement(
      'div',
      {
        style: {
          background: 'rgba(91,191,138,0.04)',
          border: '1px solid rgba(91,191,138,0.18)',
          borderRadius: 12, padding: '24px 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20,
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement('div', {
          style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 600, color: T.text, marginBottom: 6 },
        }, 'Перейти к скорингу участка'),
        React.createElement('div', { style: { fontSize: 13, color: T.textSub } },
          `DistrictScore ${result.districtScore.toFixed(1)} учтётся при расчёте вероятности успеха`),
      ),
      React.createElement(
        'button',
        {
          onClick: () => onGotoSite(result, inputs),
          style: {
            padding: '13px 28px', background: T.green, color: '#07080B',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
            cursor: 'pointer', letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif',
          },
        },
        'Скоринг участка →',
      ),
    ),
  );
}


// ═════════════════════════════════════════════════════════════════
// ЭКРАН 4 — СКОРИНГ УЧАСТКА
// ═════════════════════════════════════════════════════════════════

function SiteScreen({ city, districtResult, districtInputs, onBack, onGotoFinance }) {
  const m = useIsMobile();
  const [inputs, setInputs] = useState({
    name: 'Участок',
    districtName: districtResult?.districtName ?? 'Район',
    areaHa: 2.5,
    ownershipStatus: 'clean',
    hasLegalDisputes: false,
    electricityCapacityMw: 2.0,
    electricityRequiredMw: 1.5,
    distanceToUtilitiesMeters: 200,
    hasPowerLineRestriction: false,
    hasSanitaryZoneRestriction: false,
    hasProtectedAreaRestriction: false,
    distanceToMetroMeters: districtInputs?.hasMetro ? 400 : 2500,
    distanceToSchoolMeters: 500,
    distanceToParkMeters: districtInputs?.hasParksOrWaterfront ? 250 : 1200,
    hasViewAdvantage: false,
    expectedRevenue: city ? city.inputs.housing.businessClassPricePerM2 * 2.5 * 20000 * 0.8 : 2_500_000_000,
    expectedCapex:   city ? city.inputs.housing.businessClassPricePerM2 * 2.5 * 20000 * 0.8 * 0.65 : 1_600_000_000,
    directCompetitorsNearby: 2,
  });

  const set = (key) => (v) => setInputs((prev) => ({ ...prev, [key]: v }));

  const result = useMemo(() => calculateSiteScore(inputs), [inputs]);

  const z = ZONE[result.zone];

  const DECISION = {
    'go':      { label: 'GO',      emoji: '✓', color: T.green,  bg: 'rgba(91,191,138,0.09)',   border: 'rgba(91,191,138,0.28)' },
    'soft-go': { label: 'SOFT-GO', emoji: '⚡', color: T.yellow, bg: 'rgba(212,184,74,0.09)',  border: 'rgba(212,184,74,0.28)' },
    'no-go':   { label: 'NO-GO',   emoji: '✕', color: T.red,    bg: 'rgba(212,91,91,0.09)',   border: 'rgba(212,91,91,0.28)' },
  };
  const dec = DECISION[result.decision];

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // ── Header ───────────────────────────────────────────────
    React.createElement(
      'div',
      { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 28px' } },
      React.createElement('button', {
        onClick: onBack,
        style: { fontSize: 12, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12, fontFamily: 'Inter, sans-serif' },
      }, `← К скорингу района`),
      React.createElement('h1', {
        style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 32, fontWeight: 600, color: T.text },
      }, `Скоринг участка — ${city?.name ?? ''}`),
      React.createElement('div', { style: { fontSize: 13, color: T.textMuted, marginTop: 6 } },
        'Уровень 4: юридика, технология, окружение, рынок и черновая финансика',
      ),
    ),

    // ── Inputs + Results ─────────────────────────────────────
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 20 } },

      // Left: inputs (two columns inside)
      React.createElement(
        'div',
        { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
        React.createElement(Label, { style: { marginBottom: 16 } }, 'Параметры участка'),
        React.createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          React.createElement(InputField, { label: 'Площадь, га', value: inputs.areaHa, step: 0.5, min: 0.1, onChange: set('areaHa') }),
          React.createElement(SelectField, {
            label: 'Право собственности',
            value: inputs.ownershipStatus,
            options: [{ value: 'clean', label: 'Чистое' }, { value: 'encumbered', label: 'С обременениями' }],
            onChange: set('ownershipStatus'),
          }),
          React.createElement(InputField, { label: 'Электромощность доступная, МВт', value: inputs.electricityCapacityMw, step: 0.5, min: 0, onChange: set('electricityCapacityMw') }),
          React.createElement(InputField, { label: 'Электромощность требуемая, МВт', value: inputs.electricityRequiredMw, step: 0.5, min: 0, onChange: set('electricityRequiredMw') }),
          React.createElement(InputField, { label: 'До сетей, м', value: inputs.distanceToUtilitiesMeters, step: 100, min: 0, onChange: set('distanceToUtilitiesMeters') }),
          React.createElement(InputField, { label: 'До метро, м', value: inputs.distanceToMetroMeters, step: 100, min: 0, onChange: set('distanceToMetroMeters') }),
          React.createElement(InputField, { label: 'До школы, м', value: inputs.distanceToSchoolMeters, step: 100, min: 0, onChange: set('distanceToSchoolMeters') }),
          React.createElement(InputField, { label: 'До парка, м', value: inputs.distanceToParkMeters, step: 100, min: 0, onChange: set('distanceToParkMeters') }),
          React.createElement(InputField, { label: 'Ожидаемая выручка, ₽', value: inputs.expectedRevenue, step: 100_000_000, onChange: set('expectedRevenue') }),
          React.createElement(InputField, { label: 'Ожидаемый CAPEX, ₽', value: inputs.expectedCapex, step: 100_000_000, onChange: set('expectedCapex') }),
          React.createElement(InputField, { label: 'Конкуренты в 1 км, шт', value: inputs.directCompetitorsNearby, step: 1, min: 0, onChange: set('directCompetitorsNearby') }),
        ),
        React.createElement(
          'div',
          { style: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 } },
          React.createElement(CheckboxField, { label: 'Видовые характеристики', checked: inputs.hasViewAdvantage, onChange: set('hasViewAdvantage') }),
          React.createElement(CheckboxField, { label: 'Юридические споры по участку', checked: inputs.hasLegalDisputes, onChange: set('hasLegalDisputes'), sub: 'Минус 50 баллов к юридике' }),
          React.createElement(CheckboxField, { label: 'Ограничение ЛЭП', checked: inputs.hasPowerLineRestriction, onChange: set('hasPowerLineRestriction') }),
          React.createElement(CheckboxField, { label: 'Санитарная зона', checked: inputs.hasSanitaryZoneRestriction, onChange: set('hasSanitaryZoneRestriction') }),
          React.createElement(CheckboxField, { label: 'Охраняемая зона', checked: inputs.hasProtectedAreaRestriction, onChange: set('hasProtectedAreaRestriction') }),
        ),
      ),

      // Right: results
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        // Decision badge + score
        React.createElement(
          'div',
          {
            style: {
              background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
              padding: '28px 24px', textAlign: 'center',
            },
          },
          // Decision
          React.createElement('div', {
            style: {
              display: 'inline-block', padding: '8px 24px', borderRadius: 8,
              background: dec.bg, border: `1px solid ${dec.border}`,
              fontSize: 22, fontWeight: 800, color: dec.color,
              letterSpacing: '0.12em', fontFamily: 'Inter, sans-serif',
              marginBottom: 16,
            },
          }, `${dec.emoji} ${dec.label}`),
          // Score
          React.createElement(Label, { style: { marginBottom: 8 } }, 'SiteScore'),
          React.createElement('div', {
            style: {
              fontSize: 72, fontWeight: 700, color: z.fg,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              fontFamily: 'Inter, sans-serif', letterSpacing: '-0.03em',
            },
          }, result.siteScore.toFixed(1)),
          React.createElement('div', {
            style: {
              display: 'inline-block', marginTop: 12, padding: '5px 18px', borderRadius: 20,
              background: z.bg, border: `1px solid ${z.fg}30`,
              fontSize: 11, color: z.fg, letterSpacing: '0.1em', textTransform: 'uppercase',
            },
          }, z.label + ' зона'),
        ),
        // Sub-scores
        React.createElement(
          'div',
          { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
          React.createElement(Label, { style: { marginBottom: 14 } }, 'Подскоры участка'),
          React.createElement(ScoreBar, { label: 'Юридика',             score: result.breakdown.legalScore,          hint: 'legalScore' }),
          React.createElement(ScoreBar, { label: 'Технология',          score: result.breakdown.techScore,           hint: 'techScore' }),
          React.createElement(ScoreBar, { label: 'Окружение',           score: result.breakdown.surroundingsScore,   hint: 'surroundingsScore' }),
          React.createElement(ScoreBar, { label: 'Рыночное совпадение', score: result.breakdown.marketFitScore,      hint: 'marketFitScore' }),
          React.createElement(ScoreBar, { label: 'Финансика',           score: result.breakdown.rawFinancialScore,   hint: 'rawFinancialScore' }),
        ),
        // District score context
        districtResult && React.createElement(
          'div',
          { style: { background: T.surfaceRaise, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 18px' } },
          React.createElement(Label, { style: { marginBottom: 8 } }, 'Контекст района'),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
            React.createElement('span', { style: { fontSize: 12, color: T.textSub } }, 'DistrictScore'),
            React.createElement('span', { style: { fontSize: 14, fontWeight: 700, color: ZONE[districtResult.zone].fg } },
              districtResult.districtScore.toFixed(1),
            ),
          ),
        ),
      ),
    ),

    // ── CTA → Finance ────────────────────────────────────────
    result.decision !== 'no-go' && React.createElement(
      'div',
      {
        style: {
          background: `linear-gradient(135deg, rgba(201,169,110,0.07) 0%, rgba(201,169,110,0.02) 100%)`,
          border: `1px solid ${T.borderGold}`,
          borderRadius: 12, padding: '24px 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20,
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement('div', {
          style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 600, color: T.text, marginBottom: 6 },
        }, 'Перейти к финансовой модели'),
        React.createElement('div', { style: { fontSize: 13, color: T.textSub } },
          `SiteScore ${result.siteScore.toFixed(1)} и DistrictScore ${districtResult ? districtResult.districtScore.toFixed(1) : '—'} войдут в расчёт P(успеха)`),
      ),
      React.createElement('button', {
        onClick: () => onGotoFinance(city, districtResult, result),
        style: {
          padding: '13px 28px', background: T.gold, color: '#07080B',
          border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif',
        },
      }, 'Открыть финмодель →'),
    ),

    result.decision === 'no-go' && React.createElement(
      'div',
      {
        style: {
          background: 'rgba(212,91,91,0.05)', border: '1px solid rgba(212,91,91,0.2)',
          borderRadius: 12, padding: '20px 28px',
        },
      },
      React.createElement('div', { style: { fontSize: 14, color: T.red, fontWeight: 600, marginBottom: 6 } },
        '✕ NO-GO — участок не прошёл минимальный порог'),
      React.createElement('div', { style: { fontSize: 13, color: T.textSub } },
        'Юридика < 40 или финансика < 20 — это жёсткие блокеры. Исправьте вводные или рассмотрите другой участок.'),
    ),
  );
}


// ═════════════════════════════════════════════════════════════════
// ЭКРАН 5 — ФИНАНСОВАЯ МОДЕЛЬ
// ═════════════════════════════════════════════════════════════════

function KpiCard({ label, value, sub, color, hint }) {
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 20px' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 8 } },
      React.createElement(Label, null, label),
      hint && React.createElement(HintIcon, { id: hint }),
    ),
    React.createElement('div', {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: color || T.text,
        fontVariantNumeric: 'tabular-nums',
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '-0.01em',
      },
    }, value),
    sub && React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 4 } }, sub),
  );
}

function InputField({ label, value, onChange, step, min, max }) {
  return React.createElement(
    'label',
    { style: { display: 'block' } },
    React.createElement('span', {
      style: {
        fontSize: 11,
        color: T.textSub,
        letterSpacing: '0.03em',
        display: 'block',
        marginBottom: 5,
        fontFamily: 'Inter, sans-serif',
      },
    }, label),
    React.createElement('input', {
      type: 'number',
      value,
      step: step || 1,
      min,
      max,
      className: 'l-input',
      onChange: (e) => onChange(Number(e.target.value)),
      style: {
        width: '100%',
        padding: '7px 10px',
        fontSize: 13,
        background: T.bg,
        border: `1px solid rgba(255,255,255,0.08)`,
        borderRadius: 6,
        color: T.text,
        fontFamily: 'Inter, sans-serif',
        fontVariantNumeric: 'tabular-nums',
      },
    }),
  );
}

function InputPanel({ inputs, onChange }) {
  const m = useIsMobile();
  const set    = (key) => (v) => onChange({ ...inputs, [key]: v });
  const setFin = (key) => (v) => onChange({ ...inputs, financing: { ...inputs.financing, [key]: v } });
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    React.createElement(Label, { style: { marginBottom: 16 } }, 'Параметры проекта'),
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 12 } },
      React.createElement(InputField, { label: 'Площадь, га',             value: inputs.landAreaHa,                  step: 0.1,         onChange: set('landAreaHa') }),
      React.createElement(InputField, { label: 'Плотность, м²/га',        value: inputs.allowedDensityM2PerHa,       step: 1000,        onChange: set('allowedDensityM2PerHa') }),
      React.createElement(InputField, { label: 'Цена м² бизнес-класс, ₽', value: inputs.basePricePerM2,              step: 5000,        onChange: set('basePricePerM2') }),
      React.createElement(InputField, { label: 'Себестоимость м², ₽',     value: inputs.constructionCostPerM2,       step: 5000,        onChange: set('constructionCostPerM2') }),
      React.createElement(InputField, { label: 'Стоимость участка, ₽',    value: inputs.landCost,                    step: 50_000_000,  onChange: set('landCost') }),
      React.createElement(InputField, { label: 'Инфраструктура, ₽',       value: inputs.infrastructureCost,          step: 50_000_000,  onChange: set('infrastructureCost') }),
      React.createElement(InputField, { label: 'Срок стройки, мес.',      value: inputs.constructionMonths,          step: 1, min: 6,   onChange: set('constructionMonths') }),
      React.createElement(InputField, { label: 'Темп продаж, м²/мес',     value: inputs.salesVelocityM2PerMonth,     step: 100,         onChange: set('salesVelocityM2PerMonth') }),
      React.createElement(InputField, { label: 'Equity, доля',            value: inputs.financing.equityShare,       step: 0.05, min: 0, max: 1, onChange: setFin('equityShare') }),
      React.createElement(InputField, { label: 'Ставка ПФ база, %',       value: inputs.financing.pfBaseRateAnnual,  step: 0.5,         onChange: setFin('pfBaseRateAnnual') }),
    ),
  );
}

function CashflowChart({ monthlyCashFlow }) {
  const data = monthlyCashFlow.map((f) => ({
    month: f.month,
    'ПФ долг':      Math.round(f.pfBalanceEnd / 1e6),
    'Эскроу':       Math.round(f.escrowBalance / 1e6),
    'Накоп. devCF': Math.round(f.cumulativeDeveloperCashFlow / 1e6),
  }));
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    React.createElement(Label, { style: { marginBottom: 16 } }, 'Помесячный денежный поток, млн ₽'),
    React.createElement(
      ResponsiveContainer,
      { width: '100%', height: 260 },
      React.createElement(
        LineChart,
        { data, margin: { top: 5, right: 20, bottom: 5, left: 0 } },
        React.createElement(CartesianGrid, CHART_GRID),
        React.createElement(XAxis, { dataKey: 'month', tick: CHART_TICK }),
        React.createElement(YAxis, { tick: CHART_TICK }),
        React.createElement(Tooltip, { ...CHART_TIP, formatter: (v) => `${fmtNum(v)} млн ₽` }),
        React.createElement(Legend, { wrapperStyle: { fontSize: 11 } }),
        React.createElement(ReferenceLine, { y: 0, stroke: 'rgba(255,255,255,0.1)' }),
        React.createElement(Line, { type: 'monotone', dataKey: 'Эскроу',       stroke: T.green,  strokeWidth: 2,   dot: false }),
        React.createElement(Line, { type: 'monotone', dataKey: 'ПФ долг',      stroke: T.red,    strokeWidth: 2,   dot: false }),
        React.createElement(Line, { type: 'monotone', dataKey: 'Накоп. devCF', stroke: T.gold,   strokeWidth: 2.5, dot: false }),
      ),
    ),
  );
}

function CapexBars({ capex, totalPfInterest }) {
  const data = [
    { name: 'Земля',     value: capex.land / 1e6,            fill: T.textSub },
    { name: 'Стройка',   value: capex.construction / 1e6,    fill: '#5B8FBF' },
    { name: 'Инфра',     value: capex.infrastructure / 1e6,  fill: '#8B6FAF' },
    { name: 'Маркетинг', value: capex.marketing / 1e6,       fill: T.gold },
    { name: '% ПФ',      value: totalPfInterest / 1e6,       fill: T.red },
  ];
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    React.createElement(Label, { style: { marginBottom: 16 } }, 'Структура затрат, млн ₽'),
    React.createElement(
      ResponsiveContainer,
      { width: '100%', height: 220 },
      React.createElement(
        BarChart,
        { data, margin: { top: 5, right: 10, bottom: 5, left: 0 } },
        React.createElement(CartesianGrid, CHART_GRID),
        React.createElement(XAxis, { dataKey: 'name', tick: CHART_TICK }),
        React.createElement(YAxis, { tick: CHART_TICK }),
        React.createElement(Tooltip, { ...CHART_TIP, formatter: (v) => `${fmtNum(Math.round(v))} млн ₽` }),
        React.createElement(Bar, { dataKey: 'value', radius: [4, 4, 0, 0] },
          data.map((d, i) => React.createElement(Cell, { key: i, fill: d.fill })),
        ),
      ),
    ),
  );
}

function ScenarioCompare({ scenarios }) {
  const rows = [
    ['Выручка',    (s) => fmtRub(s.revenue.totalRevenue)],
    ['CAPEX',      (s) => fmtRub(s.capex.total)],
    ['% по ПФ',   (s) => fmtRub(s.totalPfInterest)],
    ['NPV',        (s) => fmtRub(s.npv)],
    ['IRR',        (s) => fmtPct(s.irr)],
    ['Net margin', (s) => fmtPct(s.netMargin)],
  ];
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    React.createElement(Label, { style: { marginBottom: 16 } }, 'Сравнение сценариев'),
    React.createElement(
      'table',
      { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Inter, sans-serif' } },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          { style: { borderBottom: `1px solid ${T.border}` } },
          React.createElement('th', { style: { textAlign: 'left', paddingBottom: 10, color: T.textMuted, fontWeight: 400, fontSize: 11 } }, ''),
          ['base', 'optimistic', 'stress'].map((s) =>
            React.createElement('th', {
              key: s,
              style: { textAlign: 'right', paddingBottom: 10, fontWeight: 700, color: SCENARIO_COLORS[s], fontSize: 11, letterSpacing: '0.08em' },
            }, SCENARIO_LABELS[s]),
          ),
        ),
      ),
      React.createElement(
        'tbody',
        null,
        rows.map(([label, fn]) =>
          React.createElement(
            'tr',
            { key: label, style: { borderBottom: `1px solid rgba(255,255,255,0.04)` } },
            React.createElement('td', { style: { padding: '9px 0', color: T.textSub, fontSize: 12 } }, label),
            ['base', 'optimistic', 'stress'].map((s) =>
              React.createElement('td', {
                key: s,
                style: { textAlign: 'right', padding: '9px 0', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: T.text },
              }, fn(scenarios[s])),
            ),
          ),
        ),
      ),
    ),
  );
}

function WarningsPanel({ warnings }) {
  return React.createElement(
    'div',
    {
      style: {
        background: 'rgba(212,184,74,0.05)',
        border: `1px solid rgba(212,184,74,0.18)`,
        borderRadius: 10,
        padding: '14px 20px',
      },
    },
    React.createElement('div', {
      style: { fontSize: 12, fontWeight: 600, color: T.yellow, marginBottom: 8, letterSpacing: '0.04em' },
    }, '⚠ Предупреждения'),
    React.createElement(
      'ul',
      { style: { fontSize: 12, color: T.yellow, opacity: 0.75, paddingLeft: 16, margin: 0, lineHeight: 2 } },
      warnings.map((w, i) => React.createElement('li', { key: i }, w)),
    ),
  );
}

// ── Deal Verdict Card v2 ────────────────────────────────────────────
function DealVerdictCard({ city, districtResult, siteResult, model }) {
  const m = useIsMobile();
  const cityScore     = city           ? city.cityScore               : 70;
  const districtScore = districtResult ? districtResult.districtScore : 65;
  const siteScore     = siteResult     ? siteResult.siteScore         : 70;
  const baseIrr       = model.scenarios.base.irr ?? 0;
  const finScore      = baseIrr >= 30 ? 90 : baseIrr >= 25 ? 78 : baseIrr >= 20 ? 65 : baseIrr >= 15 ? 48 : 30;

  // Risk & timing from city object
  const rp = city?.riskProfile;
  const mc = city?.marketCycle;

  // ── Hard blockers: auto-PASS ────────────────────────────────────
  const blockers = rp?.hardBlockers ?? [];
  const hasBlockers = blockers.length > 0;

  // ── Risk-adjusted composite ────────────────────────────────────
  const rawComposite = cityScore * 0.25 + districtScore * 0.25 + siteScore * 0.20 + finScore * 0.30;
  const riskDiscount = rp ? Math.max(0, (rp.overallRisk - 40) / 100 * 0.18) : 0;
  const timingBonus  = mc ? (mc.entrySignal === 'enter' ? 0.04 : mc.entrySignal === 'wait' ? -0.07 : 0) : 0;
  const adjustedScore = hasBlockers ? 25 : Math.round(rawComposite * (1 - riskDiscount + timingBonus));
  const overall       = Math.min(100, Math.max(0, adjustedScore));

  // ── Verdict ────────────────────────────────────────────────────
  const verdict = hasBlockers
    ? { label: 'PASS',   color: T.red,    bg: T.redDim,    sub: 'Блокеры' }
    : overall >= 75
      ? { label: 'INVEST', color: T.green,  bg: T.greenDim,  sub: 'К финансированию' }
      : overall >= 58
        ? { label: 'WATCH',  color: T.yellow, bg: T.yellowDim, sub: 'Под наблюдением' }
        : { label: 'PASS',   color: T.red,    bg: T.redDim,    sub: 'Не рекомендован' };

  // ── Reasoning: weakest link ────────────────────────────────────
  const scores = { 'Город': cityScore, 'Район': districtScore, 'Участок': siteScore, 'Финансы': finScore };
  const weakLink = Object.entries(scores).sort(([,a],[,b]) => a - b)[0];
  const reasonText = hasBlockers
    ? `Автоматический PASS: ${blockers[0]}`
    : overall >= 75
      ? `Все ключевые параметры в норме. Рекомендован к детальной проработке.`
      : overall >= 58
        ? `Слабое место: ${weakLink[0]} (${Math.round(weakLink[1])}/100). Усильте эту позицию для перехода в INVEST.`
        : `Слабое место: ${weakLink[0]} (${Math.round(weakLink[1])}/100). ${hasBlockers ? '' : 'Требует существенной доработки.'}`;

  const levels = [
    { label: 'Город',   score: Math.round(cityScore),     hint: 'cityScore' },
    { label: 'Район',   score: Math.round(districtScore), hint: 'districtScore' },
    { label: 'Участок', score: Math.round(siteScore),     hint: 'siteScore' },
    { label: 'Финансы', score: Math.round(finScore),      hint: 'finScore' },
  ];

  return React.createElement('div', {
    style: {
      background: T.surface,
      border: `1px solid ${verdict.color}55`,
      borderRadius: 12,
      padding: m ? '20px 16px' : '28px 32px',
      display: 'flex', flexDirection: 'column', gap: 20,
    },
  },
    // ── Row 1: Verdict + Gauges + Score ───────────────────────────
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: m ? 16 : 36, flexWrap: 'wrap', justifyContent: m ? 'center' : undefined },
    },
      // Verdict badge
      React.createElement('div', {
        style: { background: verdict.bg, border: `2px solid ${verdict.color}66`, borderRadius: 14, padding: '18px 36px', textAlign: 'center', flexShrink: 0 },
      },
        React.createElement('div', { style: { fontSize: 9, color: verdict.color, letterSpacing: '0.22em', marginBottom: 6, fontFamily: 'Inter, sans-serif' } }, 'РЕШЕНИЕ КОМИТЕТА'),
        React.createElement('div', { style: { fontSize: m ? 26 : 36, fontWeight: 800, color: verdict.color, letterSpacing: '0.1em', fontFamily: 'Inter, sans-serif', lineHeight: 1 } }, verdict.label),
        React.createElement('div', { style: { fontSize: 10, color: verdict.color, opacity: 0.65, marginTop: 5, letterSpacing: '0.06em' } }, verdict.sub),
      ),

      // Gauges
      React.createElement('div', { style: { display: 'flex', gap: m ? 18 : 28, flex: 1, justifyContent: 'center', flexWrap: 'wrap' } },
        levels.map(({ label, score, hint }) => {
          const color = score >= 70 ? T.green : score >= 50 ? T.yellow : T.red;
          const isWeak = !hasBlockers && label === weakLink[0] && overall < 75;
          const R = 26, C = 2 * Math.PI * R, dash = (score / 100) * C;
          return React.createElement('div', { key: label, style: { textAlign: 'center' } },
            React.createElement('svg', { width: 66, height: 66, viewBox: '0 0 66 66' },
              isWeak && React.createElement('circle', { cx: 33, cy: 33, r: R + 4, fill: 'none', stroke: T.red, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.5 }),
              React.createElement('circle', { cx: 33, cy: 33, r: R, fill: 'none', stroke: 'rgba(255,255,255,0.06)', strokeWidth: 5 }),
              React.createElement('circle', { cx: 33, cy: 33, r: R, fill: 'none', stroke: color, strokeWidth: 5, strokeDasharray: `${dash} ${C}`, strokeLinecap: 'round', transform: 'rotate(-90 33 33)', style: { transition: 'stroke-dasharray 0.6s ease' } }),
              React.createElement('text', { x: 33, y: 38, textAnchor: 'middle', fontSize: 15, fontWeight: 700, fill: color, fontFamily: 'Inter, sans-serif' }, score),
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 8.5, color: isWeak ? T.red : T.textMuted, marginTop: 4, letterSpacing: '0.1em', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase' } },
              isWeak && '▼ ', label, ' ', React.createElement(HintIcon, { id: hint }),
            ),
          );
        }),
      ),

      // Composite score
      React.createElement('div', { style: { textAlign: 'center', flexShrink: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 } },
          React.createElement(Label, null, 'Composite'),
          React.createElement(HintIcon, { id: 'compositeScore' }),
        ),
        React.createElement('div', { style: { fontSize: m ? 42 : 56, fontWeight: 800, color: verdict.color, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', fontFamily: 'Inter, sans-serif', lineHeight: 1 } }, overall),
        React.createElement('div', { style: { fontSize: 11, color: T.textSub, marginTop: 2 } }, '/ 100'),
        rp && React.createElement('div', { style: { marginTop: 8, fontSize: 10, padding: '3px 10px', borderRadius: 12, background: `${rp.overallRisk >= 70 ? T.red : rp.overallRisk >= 45 ? T.yellow : T.green}15`, color: rp.overallRisk >= 70 ? T.red : rp.overallRisk >= 45 ? T.yellow : T.green, fontWeight: 600 } },
          `Риск: ${rp.overallRisk}/100`,
        ),
      ),
    ),

    // ── Row 2: Reasoning + Timing + Blockers ──────────────────────
    React.createElement('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
      // Reasoning text
      React.createElement('div', {
        style: { flex: 2, fontSize: 12, color: T.textSub, lineHeight: 1.65, padding: '10px 14px', background: `${verdict.color}09`, borderLeft: `2px solid ${verdict.color}44`, borderRadius: '0 6px 6px 0', minWidth: 200 },
      }, reasonText),

      // Timing signal
      mc && React.createElement('div', {
        style: { flex: 1, padding: '10px 14px', borderRadius: 8, background: ENTRY_SIGNAL_CONFIG[mc.entrySignal].bg, border: `1px solid ${ENTRY_SIGNAL_CONFIG[mc.entrySignal].color}33`, minWidth: 140 },
      },
        React.createElement('div', { style: { fontSize: 9, color: T.textMuted, letterSpacing: '0.1em', marginBottom: 5 } }, 'ТАЙМИНГ ВХОДА'),
        React.createElement('div', { style: { fontSize: 14, fontWeight: 800, color: ENTRY_SIGNAL_CONFIG[mc.entrySignal].color, marginBottom: 3 } },
          CYCLE_CONFIG[mc.position].icon, ' ', mc.entrySignalRu,
        ),
        React.createElement('div', { style: { fontSize: 10, color: T.textMuted } }, mc.labelRu + ' · ' + mc.timingScore + '/100'),
      ),
    ),

    // ── Blockers ───────────────────────────────────────────────────
    hasBlockers && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      React.createElement('div', { style: { fontSize: 10, color: T.red, letterSpacing: '0.1em', fontWeight: 700, marginBottom: 2 } }, '⛔ АВТОМАТИЧЕСКИЕ БЛОКЕРЫ:'),
      blockers.map((b, i) =>
        React.createElement('div', { key: i, style: { fontSize: 11, color: T.red, padding: '6px 12px', background: T.redDim, borderRadius: 6, border: `1px solid rgba(212,91,91,0.2)` } }, `• ${b}`),
      ),
    ),
  );
}

// ── Tornado Sensitivity Chart ─────────────────────────────────────
function TornadoChart({ inputs, baseIrr, successProbContext }) {
  const m = useIsMobile();
  const VARS = [
    { key: 'basePricePerM2',          label: 'Цена продажи, ₽/м²',   delta: 0.15 },
    { key: 'constructionCostPerM2',   label: 'Себестоимость стройки', delta: 0.15 },
    { key: 'salesVelocityM2PerMonth', label: 'Темп продаж, м²/мес',  delta: 0.20 },
    { key: 'landCost',                label: 'Стоимость земли',       delta: 0.20 },
    { key: 'constructionMonths',      label: 'Срок строительства',    delta: 0.20 },
    { key: 'infrastructureCost',      label: 'Инфраструктура',        delta: 0.25 },
  ];

  const rows = useMemo(() => {
    const ctx = { successProbContext };
    return VARS.map(({ key, label, delta }) => {
      const upI   = { ...inputs, [key]: inputs[key] * (1 + delta) };
      const downI = { ...inputs, [key]: inputs[key] * (1 - delta) };
      const upIrr   = runFinancialModel(upI,   ctx).scenarios.base.irr ?? 0;
      const downIrr = runFinancialModel(downI, ctx).scenarios.base.irr ?? 0;
      const posIrr = Math.max(upIrr, downIrr);
      const negIrr = Math.min(upIrr, downIrr);
      return {
        label,
        posDelta: posIrr - baseIrr,
        negDelta: negIrr - baseIrr,
        range: posIrr - negIrr,
      };
    }).sort((a, b) => b.range - a.range);
  }, [inputs, baseIrr, successProbContext]);

  const maxAbs = Math.max(...rows.map(r => r.posDelta), 0.1);
  const W = m ? 110 : 195;

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement(Label, { style: { marginBottom: 4 } }, 'Анализ чувствительности · Tornado'),
    React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginBottom: 22 } },
      `Влияние ±15–25% изменения параметра на IRR. База: ${baseIrr != null ? baseIrr.toFixed(1) : '—'}%`
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      rows.map(({ label, posDelta, negDelta }) => {
        const posW = (posDelta / maxAbs) * W;
        const negW = (Math.abs(negDelta) / maxAbs) * W;
        return React.createElement('div', { key: label },
          React.createElement('div', { style: { fontSize: 10, color: T.textSub, marginBottom: 4, letterSpacing: '0.02em' } }, label),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center' } },
            // Left bar (negative effect)
            React.createElement('div', { style: { width: W, display: 'flex', justifyContent: 'flex-end' } },
              React.createElement('div', {
                style: {
                  width: negW, height: 20,
                  background: T.red, opacity: 0.76,
                  borderRadius: '3px 0 0 3px',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                  paddingRight: 5, overflow: 'hidden',
                  transition: 'width 0.4s ease',
                },
              }, negW > 38 && React.createElement('span', { style: { fontSize: 9, color: '#fff', fontWeight: 700 } }, `${negDelta.toFixed(1)}%`)),
            ),
            // Center spine
            React.createElement('div', { style: { width: 1, height: 26, background: 'rgba(255,255,255,0.2)', flexShrink: 0 } }),
            // Right bar (positive effect)
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', {
                style: {
                  width: posW, height: 20,
                  background: T.green, opacity: 0.76,
                  borderRadius: '0 3px 3px 0',
                  display: 'flex', alignItems: 'center',
                  paddingLeft: 5, overflow: 'hidden',
                  transition: 'width 0.4s ease',
                },
              }, posW > 38 && React.createElement('span', { style: { fontSize: 9, color: '#fff', fontWeight: 700 } }, `+${posDelta.toFixed(1)}%`)),
            ),
          ),
        );
      }),
    ),
    React.createElement('div', { style: { display: 'flex', gap: 24, marginTop: 16, justifyContent: 'center' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted } },
        React.createElement('div', { style: { width: 14, height: 3, background: T.red, opacity: 0.7, borderRadius: 2 } }),
        'Негативный эффект',
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted } },
        React.createElement('div', { style: { width: 14, height: 3, background: T.green, opacity: 0.7, borderRadius: 2 } }),
        'Позитивный эффект',
      ),
    ),
  );
}

// ── IRR Sensitivity Matrix (Price × Cost heatmap) ──────────────────
function IrrSensitivityMatrix({ inputs, successProbContext }) {
  const m = useIsMobile();
  const PRICE_DELTAS = [-0.20, -0.10, 0, +0.10, +0.20];
  const COST_DELTAS  = [+0.20, +0.10, 0, -0.10, -0.20]; // reversed: top row = worst case

  const matrix = useMemo(() => {
    return COST_DELTAS.map(cd =>
      PRICE_DELTAS.map(pd => {
        const modInputs = {
          ...inputs,
          basePricePerM2: Math.round(inputs.basePricePerM2 * (1 + pd)),
          constructionCostPerM2: Math.round(inputs.constructionCostPerM2 * (1 + cd)),
        };
        const result = runFinancialModel(modInputs, { successProbContext });
        return result.scenarios.base.irr;
      })
    );
  }, [inputs, successProbContext]);

  const irrColor = (irr) => {
    if (irr === null) return { bg: 'rgba(212,91,91,0.18)', fg: T.red };
    if (irr >= 30) return { bg: 'rgba(91,191,138,0.22)', fg: T.green };
    if (irr >= 20) return { bg: 'rgba(91,191,138,0.11)', fg: '#7EC89A' };
    if (irr >= 15) return { bg: 'rgba(212,184,74,0.18)', fg: T.yellow };
    return { bg: 'rgba(212,91,91,0.18)', fg: T.red };
  };

  const pLabel = (d) => d === 0 ? 'Б/У' : d > 0 ? `+${d*100|0}%` : `${d*100|0}%`;
  const cLabel = (d) => d === 0 ? 'Б/У' : d > 0 ? `+${d*100|0}%` : `${d*100|0}%`;

  const cellSize = m ? 42 : 56;
  const fontSize = m ? 9.5 : 11;

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement(Label, { style: { marginBottom: 4 } }, 'Матрица чувствительности · IRR %'),
    React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginBottom: 16 } },
      'Влияние изменения цены продажи (по горизонтали) и себестоимости (по вертикали) на IRR',
    ),

    React.createElement('div', { style: { overflowX: 'auto' } },
      React.createElement('table', { style: { borderCollapse: 'separate', borderSpacing: 3, margin: '0 auto' } },
        // Header row: price deltas
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('td', { style: { width: 60 } }),
            React.createElement('td', {
              colSpan: 5,
              style: { textAlign: 'center', fontSize: 9.5, color: T.textMuted, letterSpacing: '0.1em', paddingBottom: 6 },
            }, '← ЦЕНА ПРОДАЖИ →'),
          ),
          React.createElement('tr', null,
            React.createElement('td', { style: { fontSize: 9, color: T.textMuted, textAlign: 'right', paddingRight: 8, paddingBottom: 4, verticalAlign: 'bottom', whiteSpace: 'nowrap' } }, '↕ СЕБЕСТ.'),
            ...PRICE_DELTAS.map(pd =>
              React.createElement('td', { key: pd, style: { textAlign: 'center', fontSize: 9.5, color: pd === 0 ? T.gold : T.textMuted, fontWeight: pd === 0 ? 700 : 400, paddingBottom: 4, width: cellSize } },
                pLabel(pd),
              ),
            ),
          ),
        ),
        // Body rows
        React.createElement('tbody', null,
          matrix.map((row, ri) =>
            React.createElement('tr', { key: ri },
              React.createElement('td', {
                style: { textAlign: 'right', paddingRight: 8, fontSize: 9.5, color: COST_DELTAS[ri] === 0 ? T.gold : T.textMuted, fontWeight: COST_DELTAS[ri] === 0 ? 700 : 400, whiteSpace: 'nowrap' },
              }, cLabel(COST_DELTAS[ri])),
              ...row.map((irr, ci) => {
                const { bg, fg } = irrColor(irr);
                const isBase = PRICE_DELTAS[ci] === 0 && COST_DELTAS[ri] === 0;
                return React.createElement('td', {
                  key: ci,
                  style: {
                    width: cellSize, height: cellSize,
                    textAlign: 'center', verticalAlign: 'middle',
                    background: bg,
                    borderRadius: 6,
                    fontSize,
                    fontWeight: isBase ? 800 : 600,
                    color: fg,
                    fontVariantNumeric: 'tabular-nums',
                    fontFamily: 'Inter, sans-serif',
                    border: isBase ? `2px solid ${T.gold}66` : 'none',
                  },
                }, irr != null ? irr.toFixed(1) + '%' : 'N/A');
              }),
            ),
          ),
        ),
      ),
    ),

    // Legend
    React.createElement('div', { style: { display: 'flex', gap: 16, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' } },
      [
        { color: T.green,  bg: 'rgba(91,191,138,0.22)',  label: '≥ 30% — Отлично' },
        { color: '#7EC89A',bg: 'rgba(91,191,138,0.11)',  label: '20–30% — Хорошо' },
        { color: T.yellow, bg: 'rgba(212,184,74,0.18)',  label: '15–20% — Приемлемо' },
        { color: T.red,    bg: 'rgba(212,91,91,0.18)',   label: '< 15% — Не рентабельно' },
      ].map(({ color, bg, label }) =>
        React.createElement('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: T.textMuted } },
          React.createElement('div', { style: { width: 14, height: 14, background: bg, border: `1px solid ${color}55`, borderRadius: 3 } }),
          label,
        ),
      ),
    ),
  );
}

// ── IRR Benchmark Card ────────────────────────────────────────────
function IRRBenchmarkCard({ irr, npv, netMargin }) {
  const m = useIsMobile();
  const MAX = 40;
  const pct  = (v) => Math.min(97, Math.max(1, (v / MAX) * 100));
  const irrColor = !irr ? T.textSub
                 : irr >= 25 ? T.green
                 : irr >= 15 ? T.yellow
                 : T.red;
  const benchmarks = [
    { label: 'Мин. порог', value: 15, color: T.red },
    { label: 'Ср. рынок',  value: 22, color: T.yellow },
    { label: 'Топ-25%',    value: 30, color: T.green },
  ];

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement(Label, { style: { marginBottom: 4 } }, 'IRR vs. отраслевые бенчмарки'),
    React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginBottom: 32 } }, 'Бизнес-класс · Россия · 2024–25'),

    // Benchmark track
    React.createElement('div', { style: { position: 'relative', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, margin: '0 10px 52px' } },
      // Gradient fill to project IRR
      irr && React.createElement('div', {
        style: {
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct(irr)}%`,
          background: `linear-gradient(90deg, rgba(212,91,91,0.35), ${irrColor}77)`,
          borderRadius: 3,
          transition: 'width 0.5s ease',
        },
      }),
      // Benchmark ticks
      benchmarks.map(({ label, value, color }) =>
        React.createElement('div', { key: label, style: { position: 'absolute', left: `${pct(value)}%`, top: -3, transform: 'translateX(-50%)' } },
          React.createElement('div', { style: { width: 2, height: 12, background: color, borderRadius: 1 } }),
          React.createElement('div', {
            style: { position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' },
          },
            React.createElement('div', { style: { fontSize: 11, fontWeight: 700, color } }, `${value}%`),
            React.createElement('div', { style: { fontSize: 9, color: T.textMuted, marginTop: 1 } }, label),
          ),
        ),
      ),
      // Project IRR dot
      irr && React.createElement('div', {
        style: { position: 'absolute', left: `${pct(irr)}%`, top: '50%', transform: 'translate(-50%, -50%)' },
      },
        React.createElement('div', {
          style: {
            width: 16, height: 16, borderRadius: '50%',
            background: irrColor,
            border: `3px solid ${T.bg}`,
            boxShadow: `0 0 12px ${irrColor}88`,
          },
        }),
        React.createElement('div', {
          style: { position: 'absolute', top: 18, left: '50%', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' },
        },
          React.createElement('div', { style: { fontSize: 15, fontWeight: 800, color: irrColor, fontVariantNumeric: 'tabular-nums' } }, `${irr.toFixed(1)}%`),
          React.createElement('div', { style: { fontSize: 9, color: T.textMuted, marginTop: 1 } }, 'Проект'),
        ),
      ),
    ),

    // NPV + Margin stats
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 16 } },
      React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 7 } },
          React.createElement(Label, null, 'NPV проекта'),
          React.createElement(HintIcon, { id: 'npv' }),
        ),
        React.createElement('div', {
          style: { fontSize: 22, fontWeight: 700, color: npv >= 0 ? T.green : T.red, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
        }, fmtRub(npv)),
      ),
      React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 7 } },
          React.createElement(Label, null, 'Чистая маржа'),
          React.createElement(HintIcon, { id: 'netMargin' }),
        ),
        React.createElement('div', {
          style: { fontSize: 22, fontWeight: 700, color: netMargin >= 25 ? T.green : netMargin >= 15 ? T.yellow : T.red, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
        }, fmtPct(netMargin)),
      ),
    ),
  );
}

// ══════════════════════════════════════════════════════════════════
// FEATURE: TOAST NOTIFICATION
// ══════════════════════════════════════════════════════════════════

function Toast({ message, type = 'info', onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 6000); return () => clearTimeout(t); }, []);
  const color = { info: T.gold, success: T.green, warning: T.yellow, error: T.red }[type] || T.gold;
  const icon  = { info: 'ℹ', success: '✓', warning: '⚠', error: '⛔' }[type];
  return React.createElement('div', {
    style: {
      position: 'fixed', top: 20, right: 20, zIndex: 100000,
      background: T.surfaceRaise, border: `1px solid ${color}44`,
      borderLeft: `3px solid ${color}`, borderRadius: 10,
      padding: '12px 18px', maxWidth: 360, minWidth: 260,
      boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
      fontFamily: 'Inter, sans-serif',
      display: 'flex', alignItems: 'flex-start', gap: 10,
      animation: 'fadeIn 0.2s ease',
    },
  },
    React.createElement('span', { style: { fontSize: 15, marginTop: 1, flexShrink: 0 } }, icon),
    React.createElement('div', { style: { flex: 1 } },
      React.createElement('div', { style: { fontSize: 12, color, fontWeight: 600, marginBottom: 3 } },
        type === 'warning' ? 'Обновление ЦБ РФ' : type === 'success' ? 'Готово' : 'Уведомление',
      ),
      React.createElement('div', { style: { fontSize: 11, color: T.textSub, lineHeight: 1.55 } }, message),
    ),
    React.createElement('button', {
      onClick: onClose,
      style: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1, marginTop: -1 },
    }, '×'),
  );
}

// ══════════════════════════════════════════════════════════════════
// FEATURE 1: СРАВНЕНИЕ ГОРОДОВ
// ══════════════════════════════════════════════════════════════════

function ComparisonModal({ cities, onClose }) {
  const m      = useIsMobile();
  const COLORS = [T.gold, T.green, '#5B8FBF', '#B06FAF'];

  // Build radar data from known metrics
  const allCities = cities;
  const maxPop  = Math.max(...allCities.map(c => c.inputs.demography.populationThousands));
  const maxSales = Math.max(...allCities.map(c => c.inputs.housing.monthlySalesM2));
  const maxPrice = Math.max(...allCities.map(c => c.inputs.housing.businessClassPricePerM2));

  const radarKeys = [
    { key: 'CityScore',    fn: c => c.cityScore },
    { key: 'Демография',   fn: c => Math.min(100, (c.inputs.demography.populationThousands / maxPop) * 100 * 1.4) },
    { key: 'Рост населения',fn: c => Math.min(100, 40 + (c.inputs.demography.populationTrend5yPct || 0) * 3) },
    { key: 'Спрос м²/мес', fn: c => Math.min(100, (c.inputs.housing.monthlySalesM2 / maxSales) * 100) },
    { key: 'Цена vs рынок',fn: c => Math.min(100, (1 - c.inputs.housing.businessClassPricePerM2 / maxPrice) * 80 + 20) },
  ];

  const radarData = radarKeys.map(({ key, fn }) => {
    const entry = { subject: key };
    allCities.forEach(c => { entry[c.name] = Math.round(fn(c)); });
    return entry;
  });

  const metricRows = [
    ['CityScore',              c => c.cityScore.toFixed(1)],
    ['Зона',                   c => ZONE[c.zone]?.label],
    ['Цена м² бизнес-класс',  c => fmtRub(c.inputs.housing.businessClassPricePerM2)],
    ['Население',              c => fmtNum(Math.round(c.inputs.demography.populationThousands)) + ' тыс.'],
    ['Тренд населения 5 лет',  c => fmtPct(c.inputs.demography.populationTrend5yPct, 1)],
    ['Продажи м²/мес',        c => fmtNum(c.inputs.housing.monthlySalesM2)],
  ];

  return React.createElement('div', {
    onClick: onClose,
    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  },
    React.createElement('div', {
      onClick: e => e.stopPropagation(),
      style: { background: T.surface, border: m ? 'none' : `1px solid ${T.border}`, borderRadius: m ? 0 : 16, padding: m ? '20px 16px' : 32, width: '100%', maxWidth: m ? '100%' : 920, maxHeight: m ? '100dvh' : '90vh', height: m ? '100dvh' : undefined, overflow: 'auto' },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 } },
        React.createElement('div', null,
          React.createElement('div', { style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, fontWeight: 600, color: T.text } }, 'Сравнение городов'),
          React.createElement('div', { style: { fontSize: 12, color: T.textMuted, marginTop: 4 } }, cities.map(c => c.name).join(' · ')),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 24 } }, '×'),
      ),

      // Radar
      React.createElement(Label, { style: { marginBottom: 14 } }, 'Профиль города — паутинная диаграмма'),
      React.createElement(ResponsiveContainer, { width: '100%', height: 300 },
        React.createElement(RadarChart, { data: radarData },
          React.createElement(PolarGrid, { stroke: T.border }),
          React.createElement(PolarAngleAxis, { dataKey: 'subject', tick: { fill: T.textSub, fontSize: 11, fontFamily: 'Inter' } }),
          React.createElement(PolarRadiusAxis, { angle: 18, domain: [0, 100], tick: { fill: T.textMuted, fontSize: 9 } }),
          ...cities.map((c, i) =>
            React.createElement(Radar, { key: c.key, name: c.name, dataKey: c.name, stroke: COLORS[i], fill: COLORS[i], fillOpacity: 0.13, strokeWidth: 2 })
          ),
          React.createElement(Legend, { wrapperStyle: { fontSize: 11, fontFamily: 'Inter' } }),
        ),
      ),

      // Metrics table
      React.createElement('div', { style: { marginTop: 24 } },
        React.createElement(Label, { style: { marginBottom: 14 } }, 'Ключевые показатели'),
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Inter, sans-serif' } },
          React.createElement('thead', null,
            React.createElement('tr', { style: { borderBottom: `1px solid ${T.border}` } },
              React.createElement('th', { style: { textAlign: 'left', padding: '10px 8px', color: T.textMuted, fontWeight: 400, fontSize: 11 } }, 'Показатель'),
              ...cities.map((c, i) =>
                React.createElement('th', { key: c.key, style: { textAlign: 'right', padding: '10px 8px', fontWeight: 700, color: COLORS[i], fontSize: 12 } }, c.name),
              ),
            ),
          ),
          React.createElement('tbody', null,
            metricRows.map(([label, fn]) =>
              React.createElement('tr', { key: label, style: { borderBottom: `1px solid rgba(255,255,255,0.04)` } },
                React.createElement('td', { style: { padding: '10px 8px', color: T.textSub, fontSize: 12 } }, label),
                ...cities.map(c =>
                  React.createElement('td', { key: c.key, style: { textAlign: 'right', padding: '10px 8px', fontWeight: 600, color: T.text, fontVariantNumeric: 'tabular-nums' } }, fn(c)),
                ),
              ),
            ),
          ),
        ),
      ),

      // Export button
      React.createElement('div', { style: { marginTop: 20, display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: () => {
            const header = ['Показатель', ...cities.map(c => c.name)];
            const rows   = metricRows.map(([label, fn]) => [label, ...cities.map(fn)]);
            downloadCSV([header, ...rows], 'comparison.csv');
          },
          style: {
            padding: '9px 22px', background: T.goldDim, border: `1px solid ${T.borderGold}`,
            borderRadius: 8, color: T.gold, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          },
        }, '↓ Скачать CSV'),
      ),
    ),
  );
}

// ══════════════════════════════════════════════════════════════════
// FEATURE 5: ИСТОРИЯ РАСЧЁТОВ
// ══════════════════════════════════════════════════════════════════

function HistoryPanel({ onLoad, onClose }) {
  const m = useIsMobile();
  const [history, setHistory] = React.useState(getHistory);

  const handleClear = () => { clearHistory(); setHistory([]); };

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, right: 0, bottom: 0, width: m ? '100%' : 360, zIndex: 40000,
      background: T.surface, borderLeft: `1px solid ${T.border}`,
      boxShadow: '-12px 0 40px rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column',
    },
  },
    React.createElement('div', { style: { padding: '20px 24px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      React.createElement('div', null,
        React.createElement('div', { style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 600, color: T.text } }, 'История расчётов'),
        React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 3 } }, `${history.length} / 20 записей`),
      ),
      React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 22 } }, '×'),
    ),

    React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '12px 16px' } },
      history.length === 0
        ? React.createElement('div', { style: { textAlign: 'center', padding: '60px 20px', color: T.textMuted, fontSize: 12 } },
            React.createElement('div', { style: { fontSize: 32, marginBottom: 12 } }, '📊'),
            'Нет сохранённых расчётов.',
            React.createElement('br'),
            'Откройте финмодель и нажмите «Сохранить».',
          )
        : history.map(entry =>
          React.createElement('div', {
            key: entry.id,
            onClick: () => { onLoad(entry); onClose(); },
            className: 'l-row',
            style: { padding: '14px 16px', borderRadius: 10, border: `1px solid ${T.border}`, marginBottom: 10, cursor: 'pointer', background: T.surfaceRaise },
          },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
              React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, entry.cityName || 'Проект'),
              React.createElement('span', { style: { fontSize: 10, color: T.textMuted } }, entry.savedAt),
            ),
            React.createElement('div', { style: { display: 'flex', gap: 20 } },
              entry.irr != null && React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 } }, 'IRR'),
                React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: entry.irr >= 25 ? T.green : entry.irr >= 15 ? T.yellow : T.red } }, fmtPct(entry.irr)),
              ),
              entry.npv != null && React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 } }, 'NPV'),
                React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: entry.npv >= 0 ? T.green : T.red } }, fmtRub(entry.npv)),
              ),
              entry.netMargin != null && React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 } }, 'МАРЖА'),
                React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: T.text } }, fmtPct(entry.netMargin)),
              ),
            ),
          ),
        ),
    ),

    history.length > 0 && React.createElement('div', { style: { padding: '16px 20px', borderTop: `1px solid ${T.border}` } },
      React.createElement('button', {
        onClick: handleClear,
        style: { width: '100%', padding: '9px', background: T.redDim, border: `1px solid rgba(212,91,91,0.25)`, borderRadius: 8, color: T.red, fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
      }, 'Очистить историю'),
    ),
  );
}

// ══════════════════════════════════════════════════════════════════
// FEATURE 8: ТРЕНД ЦЕН
// ══════════════════════════════════════════════════════════════════

function TrendsModal({ city, onClose }) {
  const m       = useIsMobile();
  const data    = getMockTrends(city);
  const current = city.inputs.housing.businessClassPricePerM2;
  const firstP  = data[0].price * 1000;
  const growth  = ((current - firstP) / firstP * 100);
  const minP    = Math.min(...data.map(d => d.price));
  const maxP    = Math.max(...data.map(d => d.price));

  return React.createElement('div', {
    onClick: onClose,
    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 50000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  },
    React.createElement('div', {
      onClick: e => e.stopPropagation(),
      style: { background: T.surface, border: m ? 'none' : `1px solid ${T.border}`, borderRadius: m ? 0 : 16, padding: m ? '20px 16px' : 32, width: '100%', maxWidth: m ? '100%' : 700, height: m ? '100dvh' : undefined, overflow: m ? 'auto' : undefined },
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 } },
        React.createElement('div', null,
          React.createElement('div', { style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 600, color: T.text } }, `Тренд цен · ${city.name}`),
          React.createElement('div', { style: { fontSize: 12, color: T.textMuted, marginTop: 4 } }, 'Бизнес-класс · 12 месяцев · тыс ₽/м²'),
        ),
        React.createElement('button', { onClick: onClose, style: { background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 24 } }, '×'),
      ),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: m ? 'repeat(2,1fr)' : 'repeat(3,1fr)', gap: 14, marginBottom: 24 } },
        React.createElement('div', { style: { background: T.surfaceRaise, borderRadius: 8, padding: '12px 16px' } },
          React.createElement(Label, { style: { marginBottom: 6 } }, 'Рост за 12 мес.'),
          React.createElement('div', { style: { fontSize: 22, fontWeight: 700, color: growth >= 0 ? T.green : T.red } }, `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`),
        ),
        React.createElement('div', { style: { background: T.surfaceRaise, borderRadius: 8, padding: '12px 16px' } },
          React.createElement(Label, { style: { marginBottom: 6 } }, 'Мин. / Макс.'),
          React.createElement('div', { style: { fontSize: 15, fontWeight: 700, color: T.text, fontVariantNumeric: 'tabular-nums' } }, `${minP} / ${maxP} тыс`),
        ),
        React.createElement('div', { style: { background: T.surfaceRaise, borderRadius: 8, padding: '12px 16px' } },
          React.createElement(Label, { style: { marginBottom: 6 } }, 'Текущая цена'),
          React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: T.gold, fontVariantNumeric: 'tabular-nums' } }, fmtRub(current) + '/м²'),
        ),
      ),

      React.createElement(ResponsiveContainer, { width: '100%', height: 280 },
        React.createElement(AreaChart, { data, margin: { top: 15, right: 20, bottom: 5, left: -25 } },
          React.createElement('defs', null,
            React.createElement('linearGradient', { id: 'priceGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
              React.createElement('stop', { offset: '0%', stopColor: T.green, stopOpacity: 0.3 }),
              React.createElement('stop', { offset: '100%', stopColor: T.green, stopOpacity: 0.01 }),
            ),
          ),
          React.createElement(CartesianGrid, CHART_GRID),
          React.createElement(XAxis, {
            dataKey: 'month',
            tick: { fontSize: 11, fill: T.textMuted, fontFamily: 'Inter, sans-serif' },
            axisLine: { stroke: T.border }, tickLine: { stroke: T.border },
          }),
          React.createElement(YAxis, {
            domain: [Math.max(0, minP - (maxP - minP) * 0.15), maxP + (maxP - minP) * 0.15],
            tick: { fontSize: 11, fill: T.textMuted, fontFamily: 'Inter, sans-serif' },
            axisLine: { stroke: T.border }, tickLine: { stroke: T.border },
            unit: ' тыс', width: 52,
          }),
          React.createElement(Tooltip, { ...CHART_TIP, formatter: v => [`${v} тыс ₽/м²`, 'Цена'] }),
          React.createElement(ReferenceLine, {
            y: Math.round(current / 1000), stroke: T.gold, strokeDasharray: '5 4', strokeWidth: 1.5,
            label: { value: 'текущая', position: 'right', fill: T.gold, fontSize: 10 },
          }),
          React.createElement(Area, {
            type: 'monotone', dataKey: 'price',
            stroke: T.green, strokeWidth: 2.8,
            fill: 'url(#priceGrad)',
            dot: { fill: T.green, r: 4, stroke: T.bg, strokeWidth: 2 },
            activeDot: { r: 6, stroke: T.gold, strokeWidth: 2 },
          }),
        ),
      ),
    ),
  );
}

// ══════════════════════════════════════════════════════════════════
// FEATURE 10: УМНЫЕ ПОДСКАЗКИ (SMART VALIDATION)
// ══════════════════════════════════════════════════════════════════

function SmartHintsPanel({ inputs }) {
  const warnings = useMemo(() => {
    const list = [];
    const {
      basePricePerM2, constructionCostPerM2,
      landCost, constructionMonths, salesVelocityM2PerMonth,
      landAreaHa, allowedDensityM2PerHa, sellableRatio,
    } = inputs;
    const totalArea = landAreaHa * allowedDensityM2PerHa * (sellableRatio || 0.8);
    const revenue   = totalArea * basePricePerM2;
    const margin    = (basePricePerM2 / constructionCostPerM2 - 1) * 100;

    if (margin < 40)
      list.push({ text: `Цена продажи лишь +${margin.toFixed(0)}% выше себестоимости — критический риск убытка`, sev: 'error' });
    else if (margin < 70)
      list.push({ text: `Маржа к себестоимости ${margin.toFixed(0)}% — рекомендуется ≥70% для бизнес-класса`, sev: 'warn' });

    if (revenue > 0 && landCost / revenue > 0.30)
      list.push({ text: `Стоимость земли ${(landCost / revenue * 100).toFixed(0)}% от выручки — норма ≤20%`, sev: 'warn' });

    if (constructionMonths < 18)
      list.push({ text: 'Срок стройки <18 мес. нереалистичен для бизнес-класса', sev: 'warn' });
    else if (constructionMonths > 48)
      list.push({ text: 'Срок стройки >48 мес. существенно увеличивает % по ПФ', sev: 'info' });

    if (totalArea > 0 && salesVelocityM2PerMonth > totalArea / 8)
      list.push({ text: `Темп продаж очень высокий — проект продастся за ${(totalArea / salesVelocityM2PerMonth).toFixed(0)} мес.`, sev: 'info' });

    return list;
  }, [inputs]);

  if (warnings.length === 0) return null;
  const col = { error: T.red, warn: T.yellow, info: T.gold };
  const ico = { error: '⛔', warn: '⚠️', info: 'ℹ️' };

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    warnings.map((w, i) =>
      React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 7, background: `${col[w.sev]}11`, border: `1px solid ${col[w.sev]}33`, fontSize: 11, color: col[w.sev], lineHeight: 1.55 } },
        React.createElement('span', { style: { flexShrink: 0 } }, ico[w.sev]),
        w.text,
      ),
    ),
  );
}

function FinanceScreen({ city, districtResult, siteResult, onBack }) {
  const initialInputs = useMemo(() => ({
    landAreaHa: 2.5,
    allowedDensityM2PerHa: 20000,
    sellableRatio: 0.80,
    averageUnitSizeM2: 50,
    housingClass: 'comfort',
    basePricePerM2:          city ? city.inputs.housing.businessClassPricePerM2 : 220000,
    landCost:                450_000_000,
    constructionCostPerM2:   105000,
    infrastructureCost:      300_000_000,
    marketingShare:          0.04,
    constructionMonths:      30,
    discountRateAnnual:      20,
    salesVelocityM2PerMonth: city ? Math.round(city.inputs.housing.monthlySalesM2 * 0.025) : 1500,
    salesStartMonth:         3,
    financing: { ...DEFAULT_FINANCING_PARAMS },
  }), [city]);

  const [inputs,      setInputs]      = useState(initialInputs);
  const [scenario,    setScenario]    = useState('base');
  const [showHistory, setShowHistory] = useState(false);
  const m = useIsMobile();
  useEffect(() => { setInputs(initialInputs); }, [initialInputs]);

  const successProbContext = useMemo(() => ({
    cityScore:       city           ? city.cityScore                : 70,
    districtScore:   districtResult ? districtResult.districtScore  : 65,
    siteScore:       siteResult     ? siteResult.siteScore          : 70,
    redRiskCount:    0,
    confidenceScore: 80,
  }), [city, districtResult, siteResult]);

  const model = useMemo(() =>
    runFinancialModel(inputs, { successProbContext }),
  [inputs, successProbContext]);

  const cur = model.scenarios[scenario];
  const irrColor = cur.irr === null ? T.textSub
    : cur.irr >= 25 ? T.green
    : cur.irr >= 15 ? T.yellow
    : T.red;

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

    // Deal Verdict Card — always first
    React.createElement(DealVerdictCard, { city, districtResult, siteResult, model }),

    // header
    React.createElement(
      'div',
      {
        style: {
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: '20px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        },
      },
      React.createElement(
        'div',
        null,
        React.createElement('button', {
          onClick: onBack,
          style: {
            fontSize: 12, color: T.textMuted, background: 'none', border: 'none',
            cursor: 'pointer', padding: 0, marginBottom: 8, letterSpacing: '0.04em',
            fontFamily: 'Inter, sans-serif', display: 'block',
          },
        }, siteResult ? `← К участку` : city ? `← К городу ${city.name}` : '← К рейтингу'),
        React.createElement('h1', {
          style: {
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: '0.02em',
          },
        }, city ? `Финмодель — ${city.name}` : 'Финансовая модель проекта'),
      ),
      // action buttons + scenario tabs
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        React.createElement('button', {
          onClick: () => {
            saveToHistory({ cityName: city?.name || 'Проект', irr: cur.irr, npv: cur.npv, netMargin: cur.netMargin, inputs });
            setShowHistory(true);
          },
          style: { padding: '7px 16px', background: T.goldDim, border: `1px solid ${T.borderGold}`, borderRadius: 7, color: T.gold, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
        }, '💾 Сохранить'),
        React.createElement('button', {
          onClick: () => {
            const rows = [
              ['Параметр', 'BASE', 'OPT', 'STRESS'],
              ['Выручка', ...['base','optimistic','stress'].map(s => fmtRub(model.scenarios[s].revenue.totalRevenue))],
              ['CAPEX',   ...['base','optimistic','stress'].map(s => fmtRub(model.scenarios[s].capex.total))],
              ['IRR',     ...['base','optimistic','stress'].map(s => fmtPct(model.scenarios[s].irr))],
              ['NPV',     ...['base','optimistic','stress'].map(s => fmtRub(model.scenarios[s].npv))],
              ['Маржа',   ...['base','optimistic','stress'].map(s => fmtPct(model.scenarios[s].netMargin))],
            ];
            downloadCSV(rows, `finmodel_${city?.name || 'project'}.csv`);
          },
          style: { padding: '7px 16px', background: T.surfaceRaise, border: `1px solid ${T.border}`, borderRadius: 7, color: T.textSub, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
        }, '↓ CSV'),
        React.createElement('button', {
          onClick: () => setShowHistory(s => !s),
          style: { padding: '7px 16px', background: showHistory ? T.goldDim : T.surfaceRaise, border: `1px solid ${showHistory ? T.borderGold : T.border}`, borderRadius: 7, color: showHistory ? T.gold : T.textSub, fontSize: 11, cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
        }, '📋 История'),

      // scenario tabs
      React.createElement(
        'div',
        {
          style: {
            display: 'inline-flex',
            background: T.bg,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: 3,
          },
        },
        ['base', 'optimistic', 'stress'].map((s) =>
          React.createElement('button', {
            key: s,
            onClick: () => setScenario(s),
            style: {
              padding: '7px 18px',
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              fontFamily: 'Inter, sans-serif',
              background:  scenario === s ? T.surfaceRaise : 'transparent',
              color:       scenario === s ? SCENARIO_COLORS[s] : T.textMuted,
            },
          }, SCENARIO_LABELS[s]),
        ),
      ),
      ), // close action buttons wrapper
    ),

    // KPIs
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 12 } },
      React.createElement(KpiCard, { label: 'Выручка',   value: fmtRub(cur.revenue.totalRevenue),                              hint: 'revenue' }),
      React.createElement(KpiCard, { label: 'CAPEX',     value: fmtRub(cur.capex.total),                                       hint: 'capex' }),
      React.createElement(KpiCard, { label: 'IRR',       value: fmtPct(cur.irr),   color: irrColor,                            hint: 'irr' }),
      React.createElement(KpiCard, { label: 'NPV',       value: fmtRub(cur.npv),   color: cur.npv >= 0 ? T.green : T.red,     hint: 'npv' }),
      React.createElement(KpiCard, { label: 'P(успеха)', value: fmtPct(model.successProb, 0),                                  hint: 'successProb' }),
      React.createElement(KpiCard, { label: 'Sell-out',  value: `${cur.sellOutMonths.toFixed(0)} мес.`, sub: `проект ${cur.totalProjectMonths} мес.`, hint: 'sellOut' }),
    ),

    // charts + inputs
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 2fr', gap: 20 } },
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        React.createElement(InputPanel, { inputs, onChange: setInputs }),
        React.createElement(SmartHintsPanel, { inputs }),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
        React.createElement(CashflowChart, { monthlyCashFlow: cur.monthlyCashFlow }),
        React.createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 20 } },
          React.createElement(CapexBars, { capex: cur.capex, totalPfInterest: cur.totalPfInterest }),
          React.createElement(ScenarioCompare, { scenarios: model.scenarios }),
        ),
      ),
    ),

    model.warnings.length > 0 && React.createElement(WarningsPanel, { warnings: model.warnings }),

    // Tornado + Benchmark row
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? '1fr' : '1fr 1fr', gap: 20 } },
      React.createElement(TornadoChart, {
        inputs,
        baseIrr: model.scenarios.base.irr,
        successProbContext,
      }),
      React.createElement(IRRBenchmarkCard, {
        irr:       cur.irr,
        npv:       cur.npv,
        netMargin: cur.netMargin,
      }),
    ),

    // IRR Sensitivity Matrix (Price × Cost)
    React.createElement(IrrSensitivityMatrix, { inputs, successProbContext }),

    // History panel (slide-in)
    showHistory && React.createElement(HistoryPanel, {
      onLoad:  (entry) => { if (entry.inputs) setInputs(entry.inputs); },
      onClose: () => setShowHistory(false),
    }),
  );
}


// ═════════════════════════════════════════════════════════════════
// ЭКРАН — ЛЕНТА МОНИТОРИНГА
// ═════════════════════════════════════════════════════════════════

function NewsScreen({ onBack }) {
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
    // back
    React.createElement('button', {
      onClick: onBack,
      style: {
        alignSelf: 'flex-start',
        fontSize: 12, color: T.textMuted, background: 'none', border: 'none',
        cursor: 'pointer', padding: 0, letterSpacing: '0.04em', fontFamily: 'Inter, sans-serif',
      },
    }, '← К аналитике'),
    // header
    React.createElement('div', {
      style: {
        background: T.surface, border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${T.gold}`, borderRadius: 12, padding: '24px 28px',
      },
    },
      React.createElement('div', {
        style: { fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: '0.03em', marginBottom: 6 },
      }, 'Лента мониторинга'),
      React.createElement('div', { style: { fontSize: 13, color: T.textMuted } },
        'Ежедневный мониторинг рынка бизнес-класса — новости, макро, регуляторика',
      ),
    ),
    React.createElement(NewsFeedPanel),
  );
}

// ═════════════════════════════════════════════════════════════════
// LIVE NEWS TICKER
// ═════════════════════════════════════════════════════════════════

function NewsTicker() {
  const items = (AGENT_DATA?.newsItems ?? []).slice(0, 12);
  if (items.length === 0) return null;
  const text = items.map(n => n.title).join('   ·   ');
  return React.createElement('div', {
    style: {
      background: 'rgba(201,169,110,0.04)',
      borderTop: `1px solid rgba(201,169,110,0.12)`,
      overflow: 'hidden',
      height: 32,
      display: 'flex',
      alignItems: 'center',
    },
  },
    React.createElement('div', {
      style: {
        fontSize: 10,
        letterSpacing: '0.05em',
        padding: '0 18px',
        flexShrink: 0,
        borderRight: `1px solid rgba(255,255,255,0.06)`,
        marginRight: 18,
        whiteSpace: 'nowrap',
        fontWeight: 600,
        color: T.gold,
      },
    }, 'МОНИТОРИНГ'),
    React.createElement('div', { style: { overflow: 'hidden', flex: 1 } },
      React.createElement('div', {
        style: {
          display: 'inline-block',
          whiteSpace: 'nowrap',
          animation: 'ticker-scroll 60s linear infinite',
          fontSize: 10,
          color: T.textSub,
          letterSpacing: '0.03em',
        },
      }, text + '   ·   ' + text),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═════════════════════════════════════════════════════════════════

const LOAD_STEPS = [
  { text: 'Подключение к ЦБ РФ — ключевая ставка', src: 'cbr.ru' },
  { text: 'Ипотечные ставки — banki.ru / sravni.ru', src: 'live' },
  { text: 'Скоринг 14 городов-миллионников', src: 'engine' },
  { text: 'Анализ баланса рынка новостроек', src: 'еисжс' },
  { text: 'Построение инвестиционного рейтинга', src: 'ai' },
];

// ═════════════════════════════════════════════════════════════════
// ⌘K КОМАНДНАЯ ПАЛИТРА
// ═════════════════════════════════════════════════════════════════

function CommandPalette({ cities, onSelect, onClose }) {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = query.trim() === ''
    ? cities.slice(0, 8)
    : cities.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.region.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(7,8,11,0.85)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh',
    },
    onClick: onClose,
  },
    React.createElement('div', {
      onClick: e => e.stopPropagation(),
      style: {
        width: '100%', maxWidth: 560,
        background: T.surface,
        border: `1px solid ${T.borderGold}`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,169,110,0.08)',
      },
    },
      // Input
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: `1px solid ${T.border}`,
        },
      },
        React.createElement('span', { style: { fontSize: 16, color: T.textMuted } }, '⌕'),
        React.createElement('input', {
          ref: inputRef,
          value: query,
          onChange: e => setQuery(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && results.length > 0) { onSelect(results[0].key); onClose(); }
          },
          placeholder: 'Найти город…',
          style: {
            flex: 1, background: 'none', border: 'none', outline: 'none',
            fontSize: 16, color: T.text, fontFamily: 'Inter, sans-serif',
          },
        }),
        React.createElement('span', { style: { fontSize: 10, color: T.textMuted, background: T.surfaceRaise, padding: '2px 6px', borderRadius: 4 } }, 'ESC'),
      ),

      // Results
      React.createElement('div', { style: { maxHeight: 360, overflowY: 'auto' } },
        results.length === 0
          ? React.createElement('div', { style: { padding: '24px', textAlign: 'center', color: T.textMuted, fontSize: 13 } }, 'Не найдено')
          : results.map((c, i) => {
              const z = ZONE[c.zone];
              const sig = c.marketCycle ? ENTRY_SIGNAL_CONFIG[c.marketCycle.entrySignal] : null;
              return React.createElement('div', {
                key: c.key,
                onClick: () => { onSelect(c.key); onClose(); },
                style: {
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 18px',
                  cursor: 'pointer',
                  borderBottom: i < results.length - 1 ? `1px solid ${T.border}` : 'none',
                  background: i === 0 ? 'rgba(201,169,110,0.04)' : 'transparent',
                  transition: 'background 0.1s',
                },
                onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)',
                onMouseLeave: e => e.currentTarget.style.background = i === 0 ? 'rgba(201,169,110,0.04)' : 'transparent',
              },
                React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: z.fg, flexShrink: 0 } }),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('div', { style: { fontSize: 14, color: T.text, fontWeight: 500 } }, c.name),
                  React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 1 } }, c.region),
                ),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  React.createElement('span', { style: { fontSize: 11, color: z.fg, fontWeight: 700 } }, c.cityScore.toFixed(1)),
                  sig && React.createElement('span', {
                    style: { fontSize: 10, color: sig.color, background: sig.bg, padding: '2px 8px', borderRadius: 20, border: `1px solid ${sig.color}44` },
                  }, sig.label),
                  i === 0 && React.createElement('span', { style: { fontSize: 9, color: T.textMuted } }, '↵'),
                ),
              );
            }),
      ),

      // Footer
      React.createElement('div', {
        style: { padding: '8px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 16 },
      },
        ['↑↓ навигация', '↵ открыть', 'ESC закрыть'].map(h =>
          React.createElement('span', { key: h, style: { fontSize: 9, color: T.textMuted } }, h),
        ),
      ),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════
// 18-МЕСЯЧНЫЙ ПРОГНОЗ ЦЕН
// ═════════════════════════════════════════════════════════════════

function PriceForecastChart({ city, macroSnapshot }) {
  const m = useIsMobile();
  const basePrice = city.inputs.housing.businessClassPricePerM2;
  const baseGrowth = city.inputs.housing.priceGrowthYoY / 100;
  const ks = macroSnapshot?.keyRateAnnual ?? 14.5;

  // Сценарный прогноз на 18 месяцев
  // Базовый: текущий тренд сохраняется
  // Оптимистичный: КС падает до 8% → +3-5% к YoY
  // Стрессовый: КС растёт → тренд замедляется

  const months = Array.from({ length: 19 }, (_, i) => i);
  const today = new Date();

  const scenarios = {
    base:       { growth: baseGrowth * 0.9,  color: T.gold,   label: 'Базовый' },
    optimistic: { growth: baseGrowth + 0.04, color: T.green,  label: 'КС→8%' },
    stress:     { growth: Math.max(0, baseGrowth - 0.06), color: T.red, label: 'Стресс' },
  };

  // Рассчитываем цены
  const series = Object.entries(scenarios).map(([key, s]) => ({
    key, ...s,
    prices: months.map(i => Math.round(basePrice * Math.pow(1 + s.growth / 12, i))),
  }));

  const allPrices = series.flatMap(s => s.prices);
  const minP = Math.min(...allPrices) * 0.98;
  const maxP = Math.max(...allPrices) * 1.02;
  const W = 500, H = 120;

  const toXY = (i, price) => [
    (i / 18) * W,
    H - ((price - minP) / (maxP - minP)) * H,
  ];

  const monthLabel = (i) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + i);
    return i % 3 === 0 ? `${d.toLocaleString('ru', { month: 'short' })} '${String(d.getFullYear()).slice(2)}` : '';
  };

  return React.createElement('div', {
    style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' },
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 } },
      React.createElement('div', null,
        React.createElement(Label, null, 'Прогноз цены м² · 18 месяцев'),
        React.createElement('div', { style: { fontSize: 11, color: T.textMuted, marginTop: 3 } }, 'Три сценария на основе траектории КС ЦБ РФ'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 14 } },
        series.map(s =>
          React.createElement('div', { key: s.key, style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: T.textMuted } },
            React.createElement('div', { style: { width: 20, height: 2, background: s.color, borderRadius: 1 } }),
            s.label,
          ),
        ),
      ),
    ),

    React.createElement('svg', { viewBox: `0 0 ${W} ${H + 20}`, style: { width: '100%', overflow: 'visible' } },
      // Сетка
      [0, 33, 67, 100].map(pct =>
        React.createElement('line', {
          key: pct,
          x1: 0, y1: (H * (1 - pct / 100)).toFixed(1),
          x2: W, y2: (H * (1 - pct / 100)).toFixed(1),
          stroke: 'rgba(255,255,255,0.04)', strokeWidth: 1,
        }),
      ),

      // Вертикаль "сейчас"
      React.createElement('line', { x1: 0, y1: 0, x2: 0, y2: H, stroke: T.gold, strokeWidth: 1.5, strokeDasharray: '4 3', opacity: 0.4 }),

      // Линии сценариев
      series.map(s =>
        React.createElement('polyline', {
          key: s.key,
          points: months.map(i => toXY(i, s.prices[i]).join(',')).join(' '),
          fill: 'none', stroke: s.color, strokeWidth: s.key === 'base' ? 2 : 1.5,
          strokeDasharray: s.key === 'stress' ? '5 3' : s.key === 'optimistic' ? '0' : '0',
          opacity: s.key === 'base' ? 0.9 : 0.6,
        }),
      ),

      // Последние цены (маркеры)
      series.map(s => {
        const [x, y] = toXY(18, s.prices[18]);
        return React.createElement('g', { key: `end-${s.key}` },
          React.createElement('circle', { cx: x, cy: y, r: 3, fill: s.color }),
          React.createElement('text', {
            x: x + 6, y: y + 4,
            fontSize: 9, fill: s.color, fontFamily: 'Inter',
            style: { fontVariantNumeric: 'tabular-nums' },
          }, `${Math.round(s.prices[18] / 1000)}тыс`),
        );
      }),

      // Подписи месяцев
      months.filter(i => i % 3 === 0).map(i => {
        const [x] = toXY(i, minP);
        return React.createElement('text', {
          key: `lbl-${i}`, x, y: H + 16,
          fontSize: 8.5, fill: T.textMuted, textAnchor: 'middle', fontFamily: 'Inter',
        }, monthLabel(i));
      }),
    ),
  );
}

function LoadingScreen() {
  const [doneCount, setDoneCount] = useState(0);
  useEffect(() => {
    if (doneCount >= LOAD_STEPS.length) return;
    const t = setTimeout(() => setDoneCount(d => d + 1), 280 + doneCount * 60);
    return () => clearTimeout(t);
  }, [doneCount]);

  return React.createElement('div', {
    style: {
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column',
    },
  },
    // Logo
    React.createElement('div', {
      style: {
        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700,
        letterSpacing: '0.18em', color: T.text, marginBottom: 52,
        display: 'flex', alignItems: 'center', gap: 10,
      },
    },
      React.createElement('span', null, 'LEVEL'),
      React.createElement('span', { style: { color: T.gold, fontWeight: 400, letterSpacing: '0.12em' } }, 'PLATFORM'),
    ),

    // Steps
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, width: 340 } },
      LOAD_STEPS.map((step, i) => {
        const done = i < doneCount;
        const active = i === doneCount;
        return React.createElement('div', {
          key: i,
          style: {
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: done ? 0.55 : active ? 1 : 0.2,
            transition: 'opacity 0.3s ease',
          },
        },
          React.createElement('div', {
            style: {
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: done ? T.greenDim : active ? 'rgba(201,169,110,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${done ? T.green + '55' : active ? T.gold + '44' : 'rgba(255,255,255,0.06)'}`,
              fontSize: 10,
            },
          },
            done
              ? React.createElement('span', { style: { color: T.green, fontSize: 9 } }, '✓')
              : active
                ? React.createElement('div', { className: 'l-spin', style: { width: 8, height: 8, border: `1.5px solid rgba(201,169,110,0.2)`, borderTopColor: T.gold, borderRadius: '50%' } })
                : null,
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 11.5, color: done ? T.textMuted : active ? T.text : T.textMuted, fontFamily: 'Inter, sans-serif' } }, step.text),
            React.createElement('div', { style: { fontSize: 9, color: T.textMuted, marginTop: 1, letterSpacing: '0.05em', textTransform: 'uppercase' } }, step.src),
          ),
        );
      }),
    ),

    // Subtitle
    React.createElement('div', {
      style: { marginTop: 44, fontSize: 10, color: T.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' },
    }, 'Аналитика бизнес-класса · LEVEL GROUP'),
  );
}

// ═════════════════════════════════════════════════════════════════
// ROOT APP
// ═════════════════════════════════════════════════════════════════

function App() {
  const [ranking,  setRanking]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [screen,   setScreen]   = useState({ name: 'main' });
  const [toast,    setToast]    = useState(null);
  const [cmdOpen,  setCmdOpen]  = useState(false);
  const m = useIsMobile();

  const showToast = (message, type = 'info') => setToast({ message, type, id: Date.now() });

  // ⌘K / Ctrl+K — открыть командную палитру
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    buildCityRanking()
      .then((r) => { setRanking(r); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // ── FEATURE 6: Мониторинг ставки ЦБ каждые 5 мин ──────────────
  useEffect(() => {
    if (!ranking) return;
    let lastRate = ranking.macroSnapshot.keyRateAnnual;
    const timer = setInterval(async () => {
      try {
        const fresh = await buildCityRanking();
        const newRate = fresh.macroSnapshot.keyRateAnnual;
        if (Math.abs(newRate - lastRate) >= 0.25) {
          lastRate = newRate;
          setRanking(fresh);
          showToast(
            `Ключевая ставка ЦБ изменилась: ${newRate.toFixed(2)}% — рейтинг городов пересчитан`,
            'warning',
          );
        }
      } catch { /* silent */ }
    }, 5 * 60 * 1000); // 5 min
    return () => clearInterval(timer);
  }, [ranking?.macroSnapshot?.keyRateAnnual]);

  // ── Loading ─────────────────────────────────────────────────
  if (loading) return React.createElement(LoadingScreen);

  if (error) return React.createElement(
    'div',
    { style: { padding: 40, color: T.red, background: T.bg, minHeight: '100vh', fontFamily: 'Inter, sans-serif' } },
    `Ошибка: ${error}`,
  );

  // ── Screen routing ───────────────────────────────────────────
  let content;
  if (screen.name === 'main') {
    content = React.createElement(MainScreen, {
      ranking,
      onCityClick: (key) => setScreen({ name: 'city', cityKey: key }),
    });
  } else if (screen.name === 'city') {
    const city = ranking.cities.find((c) => c.key === screen.cityKey);
    content = React.createElement(CityDetailScreen, {
      city,
      onBack:          () => setScreen({ name: 'main' }),
      onGotoDistrict:  (c) => setScreen({ name: 'district', cityKey: c.key }),
      onGotoFinance:   (c) => setScreen({ name: 'finance', cityKey: c.key }),
    });
  } else if (screen.name === 'district') {
    const city = ranking.cities.find((c) => c.key === screen.cityKey);
    content = React.createElement(DistrictScreen, {
      city,
      onBack:      () => setScreen({ name: 'city', cityKey: city.key }),
      onGotoSite:  (districtResult, districtInputs) =>
        setScreen({ name: 'site', cityKey: city.key, districtResult, districtInputs }),
    });
  } else if (screen.name === 'site') {
    const city = ranking.cities.find((c) => c.key === screen.cityKey);
    content = React.createElement(SiteScreen, {
      city,
      districtResult: screen.districtResult,
      districtInputs: screen.districtInputs,
      onBack:         () => setScreen({ name: 'district', cityKey: city.key }),
      onGotoFinance:  (c, dResult, sResult) =>
        setScreen({ name: 'finance', cityKey: c.key, districtResult: dResult, siteResult: sResult }),
    });
  } else if (screen.name === 'finance') {
    const city = ranking.cities.find((c) => c.key === screen.cityKey);
    content = React.createElement(FinanceScreen, {
      city,
      districtResult: screen.districtResult,
      siteResult:     screen.siteResult,
      onBack: screen.siteResult
        ? () => setScreen({ name: 'site', cityKey: city.key, districtResult: screen.districtResult, districtInputs: screen.districtInputs })
        : () => setScreen({ name: 'city', cityKey: city.key }),
    });
  } else if (screen.name === 'news') {
    content = React.createElement(NewsScreen, { onBack: () => setScreen({ name: 'main' }) });
  }

  return React.createElement(
    'div',
    { style: { minHeight: '100vh', background: T.bg } },

    // Командная палитра
    cmdOpen && ranking && React.createElement(CommandPalette, {
      cities: ranking.cities,
      onSelect: (key) => setScreen({ name: 'city', cityKey: key }),
      onClose: () => setCmdOpen(false),
    }),

    // Global Toast notification
    toast && React.createElement(Toast, { key: toast.id, message: toast.message, type: toast.type, onClose: () => setToast(null) }),

    // ── Header ───────────────────────────────────────────────
    React.createElement(
      'header',
      {
        style: {
          background: T.surface,
          borderBottom: `1px solid ${T.border}`,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        },
      },
      React.createElement(
        'div',
        {
          style: {
            maxWidth: 1280,
            margin: '0 auto',
            padding: m ? '0 16px' : '0 36px',
            height: 58,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
        // logo
        React.createElement(
          'div',
          {
            onClick: () => setScreen({ name: 'main' }),
            style: { cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 2 },
          },
          React.createElement('span', {
            style: {
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22,
              fontWeight: 700,
              color: T.text,
              letterSpacing: '0.12em',
            },
          }, 'LEVEL'),
          React.createElement('span', {
            style: {
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 22,
              fontWeight: 400,
              color: T.gold,
              letterSpacing: '0.12em',
              marginLeft: 8,
            },
          }, 'PLATFORM'),
          React.createElement('span', {
            style: {
              fontSize: 10,
              letterSpacing: '0.1em',
              color: T.textMuted,
              marginLeft: 16,
              textTransform: 'uppercase',
              fontFamily: 'Inter, sans-serif',
              alignSelf: 'center',
            },
          }, '· Аналитика бизнес-класс'),
        ),
        // right: nav + agent live indicator + date
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: m ? 12 : 20 } },
          !m && React.createElement('button', {
            onClick: () => setScreen({ name: 'news' }),
            style: {
              fontSize: 11, color: screen.name === 'news' ? T.gold : T.textSub,
              border: 'none', cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', letterSpacing: '0.06em',
              padding: '5px 12px', borderRadius: 20,
              background: screen.name === 'news' ? 'rgba(201,169,110,0.08)' : 'transparent',
              transition: 'color 0.15s',
            },
          }, 'Мониторинг'),
          !m && React.createElement('button', {
            onClick: () => setCmdOpen(true),
            style: {
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: T.textMuted, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              padding: '5px 12px', borderRadius: 20,
              background: T.surfaceRaise, border: `1px solid ${T.border}`,
              transition: 'all 0.15s',
            },
          },
            React.createElement('span', null, 'Поиск'),
            React.createElement('span', {
              style: { fontSize: 9, background: T.bg, padding: '1px 5px', borderRadius: 4, color: T.textMuted },
            }, '⌘K'),
          ),
          !m && React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 20, background: 'rgba(91,191,138,0.07)', border: '1px solid rgba(91,191,138,0.18)' },
          },
            React.createElement('div', { style: { position: 'relative', width: 8, height: 8, flexShrink: 0 } },
              React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: T.green, position: 'absolute' } }),
              React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: T.green, position: 'absolute', animation: 'pulse-ring 2s ease-out infinite', transformBox: 'fill-box', transformOrigin: 'center' } }),
            ),
            React.createElement('div', { style: { fontSize: 10, color: T.green, letterSpacing: '0.06em', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' } },
              AGENT_DATA?.generatedAt
                ? `Агент · ${timeAgo(AGENT_DATA.generatedAt)}`
                : 'Агент активен',
            ),
          ),
          React.createElement('div', { style: { textAlign: 'right' } },
            React.createElement(Label, { style: { marginBottom: 2 } }, 'Данные на'),
            React.createElement('div', {
              style: { fontSize: 13, color: T.textSub, fontVariantNumeric: 'tabular-nums', fontFamily: 'Inter, sans-serif' },
            }, ranking.macroSnapshot.asOfDate),
          ),
        ),
      ),
    ),

    // ── Intelligence Feed ─────────────────────────────────────
    AGENT_DATA?.newsItems?.length > 0 &&
      React.createElement(IntelligenceFeed, { items: AGENT_DATA.newsItems }),

    // ── Content ──────────────────────────────────────────────
    React.createElement(
      'main',
      { style: { maxWidth: 1280, margin: '0 auto', padding: m ? '16px 16px 40px' : '32px 36px 60px' } },
      content,
    ),

    // ── News Ticker ──────────────────────────────────────────
    React.createElement(NewsTicker),
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
