/**
 * LEVEL Platform — UI
 * Premium dark edition · бизнес-класс как LEVEL GROUP
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';

import { runFinancialModel, DEFAULT_FINANCING_PARAMS, buildCityRanking, calculateDistrictScore, calculateSiteScore } from './engine/index.ts';

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
    desc: 'Базовая процентная ставка Банка России. Определяет стоимость проектного финансирования (эскроу), уровень ипотечных ставок и доходность альтернативных инструментов.',
    formula: 'Источник: cbr.ru — обновляется автоматически',
  },
  mortgageRate: {
    title: 'Рыночная ипотека',
    desc: 'Средневзвешенная ставка по рыночной ипотеке на новостройки. Высокая ставка снижает платёжеспособный спрос и замедляет темп продаж бизнес-класса.\n\n🔄 Обновляется автоматически каждый понедельник в 10:00 МСК через GitHub Actions из открытых источников (Дом.РФ / ЦБ РФ).',
    formula: '≈ Ключевая ставка + 3–5 п.п. маржи банка',
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
  const m      = useIsMobile();
  const isAuto = snapshot.fetchMethod === 'automatic';
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
    // top row
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 } },
      React.createElement(
        'div',
        null,
        React.createElement(Label, { style: { marginBottom: 6 } }, 'Макро-снимок · ЦБ РФ'),
        React.createElement('div', { style: { fontSize: 12, color: T.textSub } }, snapshot.source),
      ),
      React.createElement(
        'div',
        {
          style: {
            fontSize: 11,
            padding: '4px 14px',
            borderRadius: 20,
            background: isAuto ? 'rgba(91,191,138,0.09)' : 'rgba(212,184,74,0.09)',
            color: isAuto ? T.green : T.yellow,
            border: `1px solid ${isAuto ? 'rgba(91,191,138,0.22)' : 'rgba(212,184,74,0.22)'}`,
            letterSpacing: '0.06em',
            fontFamily: 'Inter, sans-serif',
          },
        },
        isAuto ? '● Автоматически' : '● Снимок',
      ),
    ),
    // metrics grid
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: m ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: m ? 16 : 24 } },
      React.createElement(MacroMetric, { label: 'Ключевая ставка',  value: fmtPct(snapshot.keyRateAnnual, 2),         gold: true, hint: 'keyRate' }),
      React.createElement(MacroMetric, {
        label: 'Рыночная ипотека',
        value: fmtPct(snapshot.mortgageRateAnnual, 2),
        hint: 'mortgageRate',
        sub: snapshot.mortgageRateSource
          ? snapshot.mortgageRateSource.startsWith('расчётная')
            ? 'расчётная (КС + спред)'
            : snapshot.mortgageRateSource
          : null,
      }),
      React.createElement(MacroMetric, { label: 'Семейная ипотека', value: snapshot.preferentialMortgageRate ? fmtPct(snapshot.preferentialMortgageRate, 1) : '—', hint: 'familyMortgage' }),
      React.createElement(MacroMetric, { label: 'MacroScore',       value: `${snapshot.macroScore.toFixed(0)} / 100`,  gold: true, hint: 'macroScore' }),
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

// Уральские горы (разделитель Европа/Азия)
const URAL_LINE = [[60.5,54],[59.5,57],[58.5,60],[58.0,62],[57.5,65],[56.5,67.5],[55.0,68.2]];

function RussiaMap({ cities, onCityClick }) {
  // Загружаем реальные данные Natural Earth 110m через TopoJSON
  const [geoPolys, setGeoPolys] = React.useState(null);
  const [loading,  setLoading]  = React.useState(true);

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

      // ── Маркеры городов ───────────────────────────────────────
      ...cities.map((c, idx) => {
        const [x, y] = proj(c.coordinates.lng, c.coordinates.lat);
        const z = ZONE[c.zone];
        const r = 4 + (c.cityScore / 100) * 8;
        const delay = `${(idx * 0.18) % 2.5}s`;
        return React.createElement('g', { key: c.key, onClick: () => onCityClick(c.key), style: { cursor: 'pointer' } },
          // Пульсирующий ореол (animate через SVG тег)
          React.createElement('circle', {
            cx: x, cy: y, r: r + 10, fill: z.fg,
            style: { animation: 'pulse-glow 2.5s ease-in-out infinite', animationDelay: delay },
          }),
          // Статичные слои
          React.createElement('circle', { cx: x, cy: y, r: r + 3, fill: z.fg, opacity: 0.1 }),
          React.createElement('circle', { cx: x, cy: y, r, fill: z.fg, opacity: 0.9 }),
          React.createElement('circle', { cx: x, cy: y, r: r + 1.5, fill: 'none', stroke: z.fg, strokeWidth: 0.8, opacity: 0.35 }),
          React.createElement('text', {
            x, y: y + r + 13,
            textAnchor: 'middle', fontSize: 10, fontWeight: 500,
            fill: 'rgba(237,236,234,0.85)',
            style: { pointerEvents: 'none', fontFamily: 'Inter, sans-serif' },
          }, c.name),
          React.createElement('title', null, `${c.name}: ${c.cityScore.toFixed(1)}`),
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
    // price
    React.createElement(
      'td',
      { style: { padding: '14px 16px', textAlign: 'right' } },
      React.createElement('div', {
        style: { fontSize: 14, fontVariantNumeric: 'tabular-nums', color: T.gold, fontWeight: 500 },
      }, fmtRub(city.inputs.housing.businessClassPricePerM2)),
      React.createElement('div', { style: { fontSize: 10, color: T.textMuted, marginTop: 2 } }, '₽/м² БК'),
    ),
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
          'CityScore vs цена м² бизнес-класс · размер = население · нажмите на точку'),
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

function MainScreen({ ranking, onCityClick }) {
  const [zoneFilter,    setZoneFilter]    = useState('all');
  const [minScore,      setMinScore]      = useState(0);
  const [maxPrice,      setMaxPrice]      = useState(Infinity);
  const [compareMode,   setCompareMode]   = useState(false);
  const [selectedKeys,  setSelectedKeys]  = useState(new Set());
  const [showCompare,   setShowCompare]   = useState(false);
  const [showTrendsFor, setShowTrendsFor] = useState(null);

  const filteredCities = ranking.cities.filter(c =>
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
  const selectedCities = ranking.cities.filter(c => selectedKeys.has(c.key));

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
    React.createElement(RussiaMap, { cities: ranking.cities, onCityClick }),
    React.createElement(CityQuadrant, { cities: ranking.cities, onCityClick }),
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
          }, `${filteredCities.length} из ${ranking.cities.length} · расчёт ${ranking.durationMs} мс`),
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

function CityDetailScreen({ city, onBack, onGotoFinance, onGotoDistrict }) {
  const m = useIsMobile();
  const z = ZONE[city.zone];
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
      ),
    ),

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

    // ── Sources ────────────────────────────────────────────────
    React.createElement(
      'div',
      { style: { background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: '14px 20px' } },
      React.createElement(Label, { style: { marginBottom: 6 } }, 'Источники данных'),
      React.createElement('div', {
        style: { fontSize: 12, color: T.textSub },
      }, `Актуальность: ${city.dataAsOfDate} · ${city.sources.join(' · ')}`),
      city.needsVerification.length > 0 && React.createElement('div', {
        style: { fontSize: 12, color: T.yellow, marginTop: 8 },
      }, `⚠ Требует верификации: ${city.needsVerification.join(', ')}`),
    ),
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

// ── Deal Verdict Card ─────────────────────────────────────────────
function DealVerdictCard({ city, districtResult, siteResult, model }) {
  const m = useIsMobile();
  const cityScore     = city            ? city.cityScore                  : 70;
  const districtScore = districtResult  ? districtResult.districtScore    : 65;
  const siteScore     = siteResult      ? siteResult.siteScore            : 70;
  const baseIrr       = model.scenarios.base.irr ?? 0;
  const finScore      = baseIrr >= 30 ? 90 : baseIrr >= 25 ? 78 : baseIrr >= 20 ? 65 : baseIrr >= 15 ? 48 : 30;
  const overall       = Math.round(cityScore * 0.25 + districtScore * 0.25 + siteScore * 0.20 + finScore * 0.30);
  const verdict       = overall >= 75 ? { label: 'INVEST', color: T.green,  bg: T.greenDim  }
                      : overall >= 58 ? { label: 'WATCH',  color: T.yellow, bg: T.yellowDim }
                      :                 { label: 'PASS',   color: T.red,    bg: T.redDim    };

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
      display: 'flex',
      alignItems: 'center',
      justifyContent: m ? 'center' : undefined,
      gap: m ? 20 : 44,
      flexWrap: 'wrap',
    },
  },
    // Verdict badge
    React.createElement('div', {
      style: {
        background: verdict.bg,
        border: `2px solid ${verdict.color}66`,
        borderRadius: 14,
        padding: '20px 48px',
        textAlign: 'center',
        flexShrink: 0,
      },
    },
      React.createElement('div', {
        style: { fontSize: 9, color: verdict.color, letterSpacing: '0.22em', marginBottom: 8, fontFamily: 'Inter, sans-serif', textTransform: 'uppercase' },
      }, 'Решение комитета'),
      React.createElement('div', {
        style: { fontSize: m ? 28 : 40, fontWeight: 800, color: verdict.color, letterSpacing: '0.1em', fontFamily: 'Inter, sans-serif', lineHeight: 1 },
      }, verdict.label),
    ),

    // Level circular gauges
    React.createElement('div', { style: { display: 'flex', gap: 32, flex: 1, justifyContent: 'center' } },
      levels.map(({ label, score, hint }) => {
        const color = score >= 70 ? T.green : score >= 50 ? T.yellow : T.red;
        const R = 27, C = 2 * Math.PI * R;
        const dash = (score / 100) * C;
        return React.createElement('div', { key: label, style: { textAlign: 'center' } },
          React.createElement('svg', { width: 70, height: 70, viewBox: '0 0 70 70' },
            React.createElement('circle', { cx: 35, cy: 35, r: R, fill: 'none', stroke: 'rgba(255,255,255,0.06)', strokeWidth: 5 }),
            React.createElement('circle', {
              cx: 35, cy: 35, r: R, fill: 'none',
              stroke: color, strokeWidth: 5,
              strokeDasharray: `${dash} ${C}`,
              strokeLinecap: 'round',
              transform: 'rotate(-90 35 35)',
              style: { transition: 'stroke-dasharray 0.6s ease' },
            }),
            React.createElement('text', {
              x: 35, y: 40,
              textAnchor: 'middle',
              fontSize: 15,
              fontWeight: 700,
              fill: color,
              fontFamily: 'Inter, sans-serif',
            }, score),
          ),
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 9, color: T.textMuted, marginTop: 5, letterSpacing: '0.1em', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase' },
          }, label, React.createElement(HintIcon, { id: hint })),
        );
      }),
    ),

    // Composite score
    React.createElement('div', { style: { textAlign: 'center', flexShrink: 0 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 } },
        React.createElement(Label, null, 'Composite Score'),
        React.createElement(HintIcon, { id: 'compositeScore' }),
      ),
      React.createElement('div', {
        style: {
          fontSize: m ? 44 : 60,
          fontWeight: 800,
          color: verdict.color,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'Inter, sans-serif',
          lineHeight: 1,
        },
      }, overall),
      React.createElement('div', { style: { fontSize: 13, color: T.textSub, marginTop: 4, fontFamily: 'Inter, sans-serif' } }, '/ 100'),
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

    // History panel (slide-in)
    showHistory && React.createElement(HistoryPanel, {
      onLoad:  (entry) => { if (entry.inputs) setInputs(entry.inputs); },
      onClose: () => setShowHistory(false),
    }),
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
  const m = useIsMobile();

  const showToast = (message, type = 'info') => setToast({ message, type, id: Date.now() });

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
  if (loading) return React.createElement(
    'div',
    {
      style: {
        minHeight: '100vh',
        background: T.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    React.createElement(
      'div',
      { style: { textAlign: 'center' } },
      React.createElement('div', {
        className: 'l-spin',
        style: {
          width: 36, height: 36, margin: '0 auto',
          border: `2px solid rgba(201,169,110,0.15)`,
          borderTopColor: T.gold,
          borderRadius: '50%',
        },
      }),
      React.createElement('div', {
        style: { marginTop: 22, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: T.gold },
      }, 'Загрузка данных ЦБ РФ'),
      React.createElement('div', {
        style: { marginTop: 8, fontSize: 12, color: T.textMuted },
      }, 'Рассчитываю рейтинг 14 городов...'),
    ),
  );

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
  }

  return React.createElement(
    'div',
    { style: { minHeight: '100vh', background: T.bg } },

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
        // right: date
        React.createElement(
          'div',
          { style: { textAlign: 'right' } },
          React.createElement(Label, { style: { marginBottom: 2 } }, 'Данные на'),
          React.createElement('div', {
            style: {
              fontSize: 13,
              color: T.textSub,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'Inter, sans-serif',
            },
          }, ranking.macroSnapshot.asOfDate),
        ),
      ),
    ),

    // ── Content ──────────────────────────────────────────────
    React.createElement(
      'main',
      { style: { maxWidth: 1280, margin: '0 auto', padding: m ? '16px 16px 40px' : '32px 36px 60px' } },
      content,
    ),
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
