/**
 * LEVEL Platform — UI приложение.
 * Три экрана:
 *   1. Главная: рейтинг 14 городов миллионников + макро-снимок ЦБ
 *   2. Карточка города: подскоры, динамика, summary, переход в финмодель
 *   3. Финансовая модель проекта: то что было в v0.3
 */

import React, { useState, useMemo, useEffect } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import {
  LineChart, Line, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'https://esm.sh/recharts@2.12.7?deps=react@18.3.1';

import {
  runFinancialModel,
  DEFAULT_FINANCING_PARAMS,
  buildCityRanking,
} from './engine.js';

// ─── Утилиты форматирования ──────────────────────────────────
const fmtRub = (n) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} млрд ₽`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} млн ₽`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)} тыс ₽`;
  return `${sign}${abs.toFixed(0)} ₽`;
};
const fmtPct = (n, digits = 1) =>
  n === null || n === undefined || isNaN(n) ? '—' : `${n.toFixed(digits)}%`;
const fmtNum = (n) => n.toLocaleString('ru-RU');

const ZONE_COLORS = {
  green: { bg: '#10b981', light: '#d1fae5', text: '#047857', label: 'Зелёная' },
  orange: { bg: '#f59e0b', light: '#fef3c7', text: '#b45309', label: 'Оранжевая' },
  yellow: { bg: '#eab308', light: '#fef9c3', text: '#854d0e', label: 'Жёлтая' },
  red: { bg: '#ef4444', light: '#fee2e2', text: '#b91c1c', label: 'Красная' },
};

const SCENARIO_LABELS = { base: 'BASE', optimistic: 'OPT', stress: 'STRESS' };
const SCENARIO_COLORS = { base: '#3b82f6', optimistic: '#10b981', stress: '#ef4444' };

// ═══════════════════════════════════════════════════════════════
// ЭКРАН 1: ГЛАВНАЯ — рейтинг городов
// ═══════════════════════════════════════════════════════════════

function MacroSnapshotBanner({ snapshot }) {
  const fetchBadge = snapshot.fetchMethod === 'automatic'
    ? { text: '🟢 Автоматически', color: '#10b981' }
    : { text: '🟡 Снимок', color: '#f59e0b' };

  return React.createElement(
    'div',
    { className: 'bg-slate-900 text-white rounded-lg p-5' },
    React.createElement(
      'div',
      { className: 'flex items-start justify-between mb-3' },
      React.createElement(
        'div',
        null,
        React.createElement('div', { className: 'text-xs uppercase tracking-wider text-slate-400 mb-1' }, 'Макро-снимок'),
        React.createElement('div', { className: 'text-sm text-slate-300' }, snapshot.source),
      ),
      React.createElement(
        'div',
        { className: 'text-xs rounded-full px-3 py-1', style: { background: fetchBadge.color + '30', color: fetchBadge.color } },
        fetchBadge.text,
      ),
    ),
    React.createElement(
      'div',
      { className: 'grid grid-cols-2 md:grid-cols-5 gap-4' },
      React.createElement(MacroMetric, { label: 'Ключевая ставка', value: fmtPct(snapshot.keyRateAnnual, 2) }),
      React.createElement(MacroMetric, { label: 'Рыночная ипотека', value: fmtPct(snapshot.mortgageRateAnnual, 2) }),
      React.createElement(MacroMetric, { label: 'Семейная ипотека', value: snapshot.preferentialMortgageRate ? fmtPct(snapshot.preferentialMortgageRate, 1) : '—' }),
      React.createElement(MacroMetric, { label: 'MacroScore', value: snapshot.macroScore.toFixed(0) + '/100' }),
      React.createElement(MacroMetric, { label: 'На дату', value: snapshot.asOfDate }),
    ),
  );
}

function MacroMetric({ label, value }) {
  return React.createElement(
    'div',
    null,
    React.createElement('div', { className: 'text-xs text-slate-400 mb-1' }, label),
    React.createElement('div', { className: 'text-xl font-semibold tabular-nums' }, value),
  );
}

function CityRow({ rank, city, onClick }) {
  const z = ZONE_COLORS[city.zone];
  return React.createElement(
    'tr',
    {
      className: 'border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition',
      onClick: () => onClick(city.key),
    },
    React.createElement('td', { className: 'py-3 px-4 text-slate-500 font-medium' }, rank),
    React.createElement(
      'td',
      { className: 'py-3 px-4' },
      React.createElement('div', { className: 'font-medium text-slate-900' }, city.name),
      React.createElement('div', { className: 'text-xs text-slate-500' }, city.region),
    ),
    React.createElement(
      'td',
      { className: 'py-3 px-4' },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement(
          'div',
          {
            className: 'w-2 h-12 rounded-full',
            style: { background: z.bg },
          },
        ),
        React.createElement(
          'div',
          null,
          React.createElement('div', { className: 'text-2xl font-bold tabular-nums', style: { color: z.text } }, city.cityScore.toFixed(1)),
          React.createElement('div', { className: 'text-xs text-slate-500' }, z.label, ' зона'),
        ),
      ),
    ),
    React.createElement('td', { className: 'py-3 px-2 text-center tabular-nums text-sm' }, city.breakdown.demographyScore.toFixed(0)),
    React.createElement('td', { className: 'py-3 px-2 text-center tabular-nums text-sm' }, city.breakdown.economyScore.toFixed(0)),
    React.createElement('td', { className: 'py-3 px-2 text-center tabular-nums text-sm' }, city.breakdown.housingMarketScore.toFixed(0)),
    React.createElement('td', { className: 'py-3 px-2 text-center tabular-nums text-sm' }, city.breakdown.competitionScore.toFixed(0)),
    React.createElement('td', { className: 'py-3 px-2 text-center tabular-nums text-sm' }, city.breakdown.infrastructureScore.toFixed(0)),
    React.createElement(
      'td',
      { className: 'py-3 px-4 text-right' },
      React.createElement('div', { className: 'text-sm tabular-nums text-slate-900' }, fmtRub(city.inputs.housing.businessClassPricePerM2)),
      React.createElement('div', { className: 'text-xs text-slate-500' }, '₽/м²'),
    ),
    React.createElement(
      'td',
      { className: 'py-3 px-4 text-right' },
      React.createElement('span', { className: 'text-blue-600 text-sm font-medium hover:underline' }, 'Открыть →'),
    ),
  );
}

function RussiaMap({ cities, onCityClick }) {
  // Простая SVG-карта России с точками. Координаты переведены в проекцию.
  // Bounding box: lng 20..180, lat 41..78 (для миллионников: 38..93, 45..58)
  const minLng = 35, maxLng = 95;
  const minLat = 43, maxLat = 60;
  const width = 800;
  const height = 320;
  const project = (lng, lat) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * width,
    y: height - ((lat - minLat) / (maxLat - minLat)) * height,
  });

  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-4' },
    React.createElement(
      'div',
      { className: 'flex items-center justify-between mb-3' },
      React.createElement('h3', { className: 'text-sm font-semibold text-slate-900' }, 'Карта городов'),
      React.createElement(
        'div',
        { className: 'flex items-center gap-3 text-xs text-slate-500' },
        Object.entries(ZONE_COLORS).map(([k, z]) =>
          React.createElement(
            'div',
            { key: k, className: 'flex items-center gap-1' },
            React.createElement('div', { className: 'w-2 h-2 rounded-full', style: { background: z.bg } }),
            z.label,
          ),
        ),
      ),
    ),
    React.createElement(
      'svg',
      { viewBox: `0 0 ${width} ${height}`, className: 'w-full', style: { background: '#f8fafc' } },
      // Упрощённый контур России (схематичный)
      React.createElement('rect', { x: 0, y: 0, width, height, fill: '#f1f5f9' }),
      // Точки городов
      cities.map((c) => {
        const { x, y } = project(c.coordinates.lng, c.coordinates.lat);
        const z = ZONE_COLORS[c.zone];
        const radius = 6 + (c.cityScore / 100) * 10;
        return React.createElement(
          'g',
          {
            key: c.key,
            onClick: () => onCityClick(c.key),
            style: { cursor: 'pointer' },
          },
          React.createElement('circle', {
            cx: x, cy: y, r: radius,
            fill: z.bg, fillOpacity: 0.7,
            stroke: z.bg, strokeWidth: 2,
          }),
          React.createElement('text', {
            x, y: y + radius + 12,
            textAnchor: 'middle',
            fontSize: 11,
            fill: '#475569',
            style: { pointerEvents: 'none', fontWeight: 500 },
          }, c.name),
          React.createElement('title', null, `${c.name}: CityScore ${c.cityScore.toFixed(1)}`),
        );
      }),
    ),
  );
}

function ZoneFilter({ filter, onChange }) {
  const zones = [
    { key: 'all', label: 'Все', color: '#64748b' },
    { key: 'green', label: 'Зелёная', color: ZONE_COLORS.green.bg },
    { key: 'orange', label: 'Оранжевая', color: ZONE_COLORS.orange.bg },
    { key: 'yellow', label: 'Жёлтая', color: ZONE_COLORS.yellow.bg },
    { key: 'red', label: 'Красная', color: ZONE_COLORS.red.bg },
  ];
  return React.createElement(
    'div',
    { className: 'flex gap-2' },
    zones.map((z) =>
      React.createElement(
        'button',
        {
          key: z.key,
          onClick: () => onChange(z.key),
          className: `px-3 py-1.5 text-sm rounded-md border transition ${
            filter === z.key
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`,
        },
        React.createElement('span', { className: 'inline-block w-2 h-2 rounded-full mr-2', style: { background: z.color } }),
        z.label,
      ),
    ),
  );
}

function MainScreen({ ranking, onCityClick }) {
  const [zoneFilter, setZoneFilter] = useState('all');
  const filteredCities = zoneFilter === 'all'
    ? ranking.cities
    : ranking.cities.filter((c) => c.zone === zoneFilter);

  return React.createElement(
    'div',
    { className: 'space-y-6' },
    React.createElement(MacroSnapshotBanner, { snapshot: ranking.macroSnapshot }),
    React.createElement(RussiaMap, { cities: ranking.cities, onCityClick }),
    React.createElement(
      'div',
      { className: 'bg-white rounded-lg border border-slate-200' },
      React.createElement(
        'div',
        { className: 'p-5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3' },
        React.createElement(
          'div',
          null,
          React.createElement('h2', { className: 'text-lg font-semibold text-slate-900' }, 'Рейтинг 14 городов-миллионников'),
          React.createElement('p', { className: 'text-sm text-slate-500 mt-0.5' },
            `${filteredCities.length} из ${ranking.cities.length} городов · расчёт ${ranking.durationMs} мс`),
        ),
        React.createElement(ZoneFilter, { filter: zoneFilter, onChange: setZoneFilter }),
      ),
      React.createElement(
        'div',
        { className: 'overflow-x-auto' },
        React.createElement(
          'table',
          { className: 'w-full' },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              { className: 'bg-slate-50 text-xs uppercase tracking-wider text-slate-500' },
              React.createElement('th', { className: 'py-3 px-4 text-left font-medium' }, '#'),
              React.createElement('th', { className: 'py-3 px-4 text-left font-medium' }, 'Город'),
              React.createElement('th', { className: 'py-3 px-4 text-left font-medium' }, 'CityScore'),
              React.createElement('th', { className: 'py-3 px-2 text-center font-medium' }, 'Демогр'),
              React.createElement('th', { className: 'py-3 px-2 text-center font-medium' }, 'Эконом'),
              React.createElement('th', { className: 'py-3 px-2 text-center font-medium' }, 'Жильё'),
              React.createElement('th', { className: 'py-3 px-2 text-center font-medium' }, 'Конкур'),
              React.createElement('th', { className: 'py-3 px-2 text-center font-medium' }, 'Инфра'),
              React.createElement('th', { className: 'py-3 px-4 text-right font-medium' }, 'Цена м² (БК)'),
              React.createElement('th', { className: 'py-3 px-4' }),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            filteredCities.map((c, i) =>
              React.createElement(CityRow, {
                key: c.key,
                rank: ranking.cities.indexOf(c) + 1,
                city: c,
                onClick: onCityClick,
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════
// ЭКРАН 2: КАРТОЧКА ГОРОДА
// ═══════════════════════════════════════════════════════════════

function CityDetailScreen({ city, onBack, onGotoFinance }) {
  const z = ZONE_COLORS[city.zone];
  const radarData = [
    { name: 'Демография', score: city.breakdown.demographyScore },
    { name: 'Экономика', score: city.breakdown.economyScore },
    { name: 'Рынок жилья', score: city.breakdown.housingMarketScore },
    { name: 'Конкуренция', score: city.breakdown.competitionScore },
    { name: 'Инфраструктура', score: city.breakdown.infrastructureScore },
  ];

  return React.createElement(
    'div',
    { className: 'space-y-6' },
    // Заголовок с большим скором
    React.createElement(
      'div',
      { className: 'bg-white rounded-lg border border-slate-200 p-6' },
      React.createElement(
        'div',
        { className: 'flex items-start justify-between flex-wrap gap-4' },
        React.createElement(
          'div',
          null,
          React.createElement(
            'button',
            { onClick: onBack, className: 'text-sm text-slate-500 hover:text-slate-700 mb-2' },
            '← К рейтингу',
          ),
          React.createElement('h1', { className: 'text-3xl font-bold text-slate-900' }, city.name),
          React.createElement('div', { className: 'text-slate-500' }, city.region),
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-4' },
          React.createElement(
            'div',
            { className: 'text-right' },
            React.createElement('div', { className: 'text-xs text-slate-500 uppercase tracking-wider' }, 'CityScore'),
            React.createElement('div', { className: 'text-5xl font-bold tabular-nums', style: { color: z.text } }, city.cityScore.toFixed(1)),
            React.createElement('div', { className: 'text-sm', style: { color: z.text } }, z.label, ' зона'),
          ),
        ),
      ),
      React.createElement(
        'div',
        { className: 'mt-4 p-3 rounded-md', style: { background: z.light, color: z.text } },
        React.createElement('p', { className: 'text-sm' }, city.summary),
      ),
    ),
    // Layout: радар + ключевые цифры
    React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-3 gap-6' },
      // Радар подскоров
      React.createElement(
        'div',
        { className: 'bg-white rounded-lg border border-slate-200 p-5' },
        React.createElement('h3', { className: 'text-sm font-semibold mb-3 text-slate-900' }, 'Подскоры'),
        React.createElement(
          ResponsiveContainer,
          { width: '100%', height: 280 },
          React.createElement(
            RadarChart,
            { data: radarData },
            React.createElement(PolarGrid, { stroke: '#e2e8f0' }),
            React.createElement(PolarAngleAxis, { dataKey: 'name', tick: { fontSize: 11, fill: '#475569' } }),
            React.createElement(PolarRadiusAxis, { domain: [0, 100], tick: { fontSize: 10, fill: '#94a3b8' } }),
            React.createElement(Radar, { name: city.name, dataKey: 'score', stroke: z.bg, fill: z.bg, fillOpacity: 0.4, strokeWidth: 2 }),
          ),
        ),
      ),
      // KPI блок: ключевые показатели города
      React.createElement(
        'div',
        { className: 'lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3' },
        React.createElement(MetricCard, {
          label: 'Население',
          value: `${city.inputs.demography.populationThousands.toLocaleString('ru-RU')} тыс.`,
          sub: `${city.inputs.demography.populationTrend5yPct >= 0 ? '+' : ''}${city.inputs.demography.populationTrend5yPct.toFixed(1)}% за 5 лет`,
        }),
        React.createElement(MetricCard, {
          label: 'Миграция',
          value: `${city.inputs.demography.migrationBalanceThousands >= 0 ? '+' : ''}${city.inputs.demography.migrationBalanceThousands.toFixed(1)} тыс.`,
          sub: 'в год',
          accent: city.inputs.demography.migrationBalanceThousands >= 0 ? 'good' : 'bad',
        }),
        React.createElement(MetricCard, {
          label: '25–45 лет',
          value: fmtPct(city.inputs.demography.shareAge25to45 * 100, 0),
          sub: 'доля группы',
        }),
        React.createElement(MetricCard, {
          label: 'Средняя зарплата',
          value: fmtRub(city.inputs.economy.avgSalary),
          sub: `+${city.inputs.economy.salaryGrowthYoY.toFixed(1)}% YoY`,
        }),
        React.createElement(MetricCard, {
          label: 'Цена м² бизнес-класс',
          value: fmtRub(city.inputs.housing.businessClassPricePerM2),
          sub: `+${city.inputs.housing.priceGrowthYoY.toFixed(1)}% YoY`,
        }),
        React.createElement(MetricCard, {
          label: 'Темп поглощения',
          value: `${city.inputs.housing.monthsOfSupply} мес.`,
          sub: 'запас предложения',
        }),
        React.createElement(MetricCard, {
          label: 'Девелоперов',
          value: city.inputs.competition.activeDevelopers,
          sub: `топ-5: ${fmtPct(city.inputs.competition.top5MarketShare * 100, 0)}`,
        }),
        React.createElement(MetricCard, {
          label: 'Безработица',
          value: fmtPct(city.inputs.economy.unemploymentRate, 1),
        }),
        React.createElement(MetricCard, {
          label: 'КРТ-программы',
          value: `${city.inputs.infrastructure.krtProgramsHa} га`,
          sub: city.inputs.infrastructure.hasMajorInfraProjects ? 'крупные проекты ✓' : '',
        }),
      ),
    ),
    // CTA — переход в финмодель
    React.createElement(
      'div',
      { className: 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6 flex items-center justify-between flex-wrap gap-4' },
      React.createElement(
        'div',
        null,
        React.createElement('h3', { className: 'text-lg font-semibold text-slate-900 mb-1' }, 'Посчитать проект в этом городе'),
        React.createElement('p', { className: 'text-sm text-slate-600' },
          `Цена м² бизнес-класс ${fmtRub(city.inputs.housing.businessClassPricePerM2)} и темп продаж подставятся автоматически`),
      ),
      React.createElement(
        'button',
        {
          onClick: () => onGotoFinance(city),
          className: 'px-5 py-3 bg-slate-900 text-white rounded-md font-medium hover:bg-slate-800 transition',
        },
        'Открыть финмодель →',
      ),
    ),
    // Источники
    React.createElement(
      'div',
      { className: 'bg-slate-50 rounded-lg p-4 text-xs text-slate-600' },
      React.createElement('div', { className: 'font-semibold text-slate-700 mb-1' }, 'Источники данных'),
      React.createElement('div', null, `Актуальность: ${city.dataAsOfDate} · ${city.sources.join(' · ')}`),
      city.needsVerification.length > 0 &&
        React.createElement('div', { className: 'mt-2 text-amber-700' },
          `⚠ Требует верификации аналитиком: ${city.needsVerification.join(', ')}`),
    ),
  );
}

function MetricCard({ label, value, sub, accent }) {
  const colorMap = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    bad: 'text-rose-600',
  };
  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-4' },
    React.createElement('div', { className: 'text-xs uppercase tracking-wider text-slate-500 mb-1' }, label),
    React.createElement('div', { className: `text-xl font-semibold tabular-nums ${colorMap[accent || 'default']}` }, value),
    sub && React.createElement('div', { className: 'text-xs text-slate-500 mt-1' }, sub),
  );
}

// ═══════════════════════════════════════════════════════════════
// ЭКРАН 3: ФИНАНСОВАЯ МОДЕЛЬ (адаптирована из v0.3)
// ═══════════════════════════════════════════════════════════════

function FinanceScreen({ city, onBack }) {
  // Дефолты подстраиваются под город: цена м² из датасета, темп продаж пропорционален monthlySalesM2
  const initialInputs = useMemo(() => ({
    landAreaHa: 2.5,
    allowedDensityM2PerHa: 20000,
    sellableRatio: 0.80,
    averageUnitSizeM2: 50,
    housingClass: 'comfort',
    basePricePerM2: city ? city.inputs.housing.businessClassPricePerM2 : 220000,
    landCost: 450_000_000,
    constructionCostPerM2: 105000,
    infrastructureCost: 300_000_000,
    marketingShare: 0.04,
    constructionMonths: 30,
    discountRateAnnual: 20,
    // Темп продаж — 2-3% от месячного объёма города (рыночная доля одного крупного ЖК)
    salesVelocityM2PerMonth: city ? Math.round(city.inputs.housing.monthlySalesM2 * 0.025) : 1500,
    salesStartMonth: 3,
    financing: { ...DEFAULT_FINANCING_PARAMS },
  }), [city]);

  const [inputs, setInputs] = useState(initialInputs);
  const [scenario, setScenario] = useState('base');

  // Когда меняется город — пересоздаём дефолты
  useEffect(() => { setInputs(initialInputs); }, [initialInputs]);

  const model = useMemo(
    () => runFinancialModel(inputs, {
      successProbContext: city ? {
        cityScore: city.cityScore,
        districtScore: 65, // район пока не выбран — нейтральный
        siteScore: 70,
        redRiskCount: 0,
        confidenceScore: 80,
      } : {
        cityScore: 70, districtScore: 65, siteScore: 70, redRiskCount: 0, confidenceScore: 80,
      },
    }),
    [inputs, city],
  );

  const current = model.scenarios[scenario];
  const irrAccent = current.irr === null ? 'default' :
    current.irr >= 25 ? 'good' :
    current.irr >= 15 ? 'warn' : 'bad';

  return React.createElement(
    'div',
    { className: 'space-y-6' },
    React.createElement(
      'div',
      { className: 'bg-white rounded-lg border border-slate-200 p-5 flex items-center justify-between flex-wrap gap-3' },
      React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          { onClick: onBack, className: 'text-sm text-slate-500 hover:text-slate-700 mb-2' },
          city ? `← К городу ${city.name}` : '← К рейтингу',
        ),
        React.createElement('h1', { className: 'text-2xl font-bold text-slate-900' },
          city ? `Финмодель: проект в городе ${city.name}` : 'Финансовая модель проекта'),
      ),
      React.createElement(
        'div',
        { className: 'inline-flex bg-slate-100 rounded-lg p-1' },
        ['base', 'optimistic', 'stress'].map((s) =>
          React.createElement(
            'button',
            {
              key: s,
              onClick: () => setScenario(s),
              className: `px-4 py-1.5 text-sm font-medium rounded-md transition ${
                scenario === s ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`,
              style: scenario === s ? { color: SCENARIO_COLORS[s] } : {},
            },
            SCENARIO_LABELS[s],
          ),
        ),
      ),
    ),
    // KPI
    React.createElement(
      'div',
      { className: 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3' },
      React.createElement(MetricCard, { label: 'Выручка', value: fmtRub(current.revenue.totalRevenue) }),
      React.createElement(MetricCard, { label: 'CAPEX', value: fmtRub(current.capex.total) }),
      React.createElement(MetricCard, { label: 'IRR', value: fmtPct(current.irr), accent: irrAccent }),
      React.createElement(MetricCard, { label: 'NPV', value: fmtRub(current.npv), accent: current.npv >= 0 ? 'good' : 'bad' }),
      React.createElement(MetricCard, { label: 'P(успеха)', value: fmtPct(model.successProb, 0) }),
      React.createElement(MetricCard, { label: 'Sell-out', value: `${current.sellOutMonths.toFixed(0)} мес.`, sub: `проект ${current.totalProjectMonths} мес.` }),
    ),
    React.createElement(
      'div',
      { className: 'grid grid-cols-1 lg:grid-cols-3 gap-6' },
      React.createElement(InputPanel, { inputs, onChange: setInputs }),
      React.createElement(
        'div',
        { className: 'lg:col-span-2 space-y-6' },
        React.createElement(CashflowChart, { monthlyCashFlow: current.monthlyCashFlow }),
        React.createElement(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-2 gap-6' },
          React.createElement(CapexBars, { capex: current.capex, totalPfInterest: current.totalPfInterest }),
          React.createElement(ScenarioCompare, { scenarios: model.scenarios }),
        ),
      ),
    ),
    model.warnings.length > 0 && React.createElement(WarningsPanel, { warnings: model.warnings }),
  );
}

function InputPanel({ inputs, onChange }) {
  const set = (key) => (v) => onChange({ ...inputs, [key]: v });
  const setFin = (key) => (v) =>
    onChange({ ...inputs, financing: { ...inputs.financing, [key]: v } });
  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-5' },
    React.createElement('h3', { className: 'text-sm font-semibold mb-3 text-slate-900' }, 'Параметры проекта'),
    React.createElement(
      'div',
      { className: 'grid grid-cols-2 gap-3' },
      React.createElement(InputField, { label: 'Площадь, га', value: inputs.landAreaHa, step: 0.1, onChange: set('landAreaHa') }),
      React.createElement(InputField, { label: 'Плотность, м²/га', value: inputs.allowedDensityM2PerHa, step: 1000, onChange: set('allowedDensityM2PerHa') }),
      React.createElement(InputField, { label: 'Цена м² бизнес-класс, ₽', value: inputs.basePricePerM2, step: 5000, onChange: set('basePricePerM2') }),
      React.createElement(InputField, { label: 'Себестоимость м², ₽', value: inputs.constructionCostPerM2, step: 5000, onChange: set('constructionCostPerM2') }),
      React.createElement(InputField, { label: 'Стоимость участка, ₽', value: inputs.landCost, step: 50_000_000, onChange: set('landCost') }),
      React.createElement(InputField, { label: 'Инфраструктура, ₽', value: inputs.infrastructureCost, step: 50_000_000, onChange: set('infrastructureCost') }),
      React.createElement(InputField, { label: 'Срок стройки, мес.', value: inputs.constructionMonths, step: 1, min: 6, onChange: set('constructionMonths') }),
      React.createElement(InputField, { label: 'Темп продаж, м²/мес', value: inputs.salesVelocityM2PerMonth, step: 100, onChange: set('salesVelocityM2PerMonth') }),
      React.createElement(InputField, { label: 'Equity, доля', value: inputs.financing.equityShare, step: 0.05, min: 0, max: 1, onChange: setFin('equityShare') }),
      React.createElement(InputField, { label: 'Ставка ПФ база, %', value: inputs.financing.pfBaseRateAnnual, step: 0.5, onChange: setFin('pfBaseRateAnnual') }),
    ),
  );
}

function InputField({ label, value, onChange, step, min, max }) {
  return React.createElement(
    'label',
    { className: 'block' },
    React.createElement('span', { className: 'text-xs text-slate-600' }, label),
    React.createElement('input', {
      type: 'number',
      value, step: step || 1, min, max,
      onChange: (e) => onChange(Number(e.target.value)),
      className: 'w-full mt-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
    }),
  );
}

function CashflowChart({ monthlyCashFlow }) {
  const data = monthlyCashFlow.map((f) => ({
    month: f.month,
    'ПФ долг': Math.round(f.pfBalanceEnd / 1e6),
    'Эскроу': Math.round(f.escrowBalance / 1e6),
    'Накоп. devCF': Math.round(f.cumulativeDeveloperCashFlow / 1e6),
  }));
  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-5' },
    React.createElement('h3', { className: 'text-sm font-semibold mb-3 text-slate-900' }, 'Помесячный денежный поток (млн ₽)'),
    React.createElement(
      ResponsiveContainer,
      { width: '100%', height: 280 },
      React.createElement(
        LineChart,
        { data, margin: { top: 5, right: 20, bottom: 5, left: 0 } },
        React.createElement(CartesianGrid, { strokeDasharray: '3 3', stroke: '#e2e8f0' }),
        React.createElement(XAxis, { dataKey: 'month', tick: { fontSize: 11 } }),
        React.createElement(YAxis, { tick: { fontSize: 11 } }),
        React.createElement(Tooltip, { formatter: (v) => `${fmtNum(v)} млн ₽` }),
        React.createElement(Legend, { wrapperStyle: { fontSize: 12 } }),
        React.createElement(ReferenceLine, { y: 0, stroke: '#94a3b8' }),
        React.createElement(Line, { type: 'monotone', dataKey: 'Эскроу', stroke: '#10b981', strokeWidth: 2, dot: false }),
        React.createElement(Line, { type: 'monotone', dataKey: 'ПФ долг', stroke: '#ef4444', strokeWidth: 2, dot: false }),
        React.createElement(Line, { type: 'monotone', dataKey: 'Накоп. devCF', stroke: '#3b82f6', strokeWidth: 2.5, dot: false }),
      ),
    ),
  );
}

function CapexBars({ capex, totalPfInterest }) {
  const data = [
    { name: 'Земля', value: capex.land / 1e6, fill: '#64748b' },
    { name: 'Стройка', value: capex.construction / 1e6, fill: '#3b82f6' },
    { name: 'Инфра', value: capex.infrastructure / 1e6, fill: '#8b5cf6' },
    { name: 'Маркетинг', value: capex.marketing / 1e6, fill: '#f59e0b' },
    { name: '% по ПФ', value: totalPfInterest / 1e6, fill: '#ef4444' },
  ];
  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-5' },
    React.createElement('h3', { className: 'text-sm font-semibold mb-3 text-slate-900' }, 'Структура затрат (млн ₽)'),
    React.createElement(
      ResponsiveContainer,
      { width: '100%', height: 240 },
      React.createElement(
        BarChart,
        { data, margin: { top: 5, right: 20, bottom: 5, left: 0 } },
        React.createElement(CartesianGrid, { strokeDasharray: '3 3', stroke: '#e2e8f0' }),
        React.createElement(XAxis, { dataKey: 'name', tick: { fontSize: 11 } }),
        React.createElement(YAxis, { tick: { fontSize: 11 } }),
        React.createElement(Tooltip, { formatter: (v) => `${fmtNum(Math.round(v))} млн ₽` }),
        React.createElement(Bar, { dataKey: 'value' },
          data.map((d, i) => React.createElement(Cell, { key: i, fill: d.fill })),
        ),
      ),
    ),
  );
}

function ScenarioCompare({ scenarios }) {
  const rows = [
    ['Выручка', (s) => fmtRub(s.revenue.totalRevenue)],
    ['CAPEX', (s) => fmtRub(s.capex.total)],
    ['% по ПФ', (s) => fmtRub(s.totalPfInterest)],
    ['NPV', (s) => fmtRub(s.npv)],
    ['IRR', (s) => fmtPct(s.irr)],
    ['Net margin', (s) => fmtPct(s.netMargin)],
  ];
  return React.createElement(
    'div',
    { className: 'bg-white rounded-lg border border-slate-200 p-5' },
    React.createElement('h3', { className: 'text-sm font-semibold mb-3 text-slate-900' }, 'Сравнение сценариев'),
    React.createElement(
      'table',
      { className: 'w-full text-sm' },
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          { className: 'border-b border-slate-200' },
          React.createElement('th', { className: 'text-left py-2 font-medium text-slate-600' }, ''),
          ['base', 'optimistic', 'stress'].map((s) =>
            React.createElement('th', {
              key: s, className: 'text-right py-2 font-medium',
              style: { color: SCENARIO_COLORS[s] },
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
            { key: label, className: 'border-b border-slate-100' },
            React.createElement('td', { className: 'py-2 text-slate-600' }, label),
            ['base', 'optimistic', 'stress'].map((s) =>
              React.createElement('td', { key: s, className: 'text-right py-2 tabular-nums font-medium text-slate-900' }, fn(scenarios[s])),
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
    { className: 'bg-amber-50 border border-amber-200 rounded-lg p-4' },
    React.createElement('h4', { className: 'text-sm font-semibold text-amber-900 mb-2' }, '⚠️ Предупреждения'),
    React.createElement(
      'ul',
      { className: 'text-sm text-amber-800 space-y-1 list-disc list-inside' },
      warnings.map((w, i) => React.createElement('li', { key: i }, w)),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════
// КОРНЕВОЙ КОМПОНЕНТ
// ═══════════════════════════════════════════════════════════════

function App() {
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [screen, setScreen] = useState({ name: 'main' });

  useEffect(() => {
    buildCityRanking()
      .then((r) => { setRanking(r); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return React.createElement(
      'div',
      { className: 'min-h-screen bg-slate-50 flex items-center justify-center' },
      React.createElement('div', { className: 'text-center' },
        React.createElement('div', { className: 'inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900' }),
        React.createElement('p', { className: 'mt-4 text-slate-600' }, 'Подтягиваю данные ЦБ РФ и считаю рейтинг 14 городов...'),
      ),
    );
  }
  if (error) return React.createElement('div', { className: 'p-8 text-red-600' }, `Ошибка: ${error}`);

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
      onBack: () => setScreen({ name: 'main' }),
      onGotoFinance: (c) => setScreen({ name: 'finance', cityKey: c.key }),
    });
  } else if (screen.name === 'finance') {
    const city = ranking.cities.find((c) => c.key === screen.cityKey);
    content = React.createElement(FinanceScreen, {
      city,
      onBack: () => setScreen({ name: 'city', cityKey: city.key }),
    });
  }

  return React.createElement(
    'div',
    { className: 'min-h-screen bg-slate-50' },
    React.createElement(
      'header',
      { className: 'bg-white border-b border-slate-200 sticky top-0 z-10' },
      React.createElement(
        'div',
        { className: 'max-w-7xl mx-auto px-6 py-4 flex items-center justify-between' },
        React.createElement(
          'div',
          { onClick: () => setScreen({ name: 'main' }), className: 'cursor-pointer' },
          React.createElement('h1', { className: 'text-lg font-semibold text-slate-900' }, 'LEVEL Platform'),
          React.createElement('div', { className: 'text-xs text-slate-500' }, 'Скоринг городов и финансовое моделирование'),
        ),
        React.createElement(
          'div',
          { className: 'text-xs text-slate-500' },
          `Макро · обновлено ${ranking.macroSnapshot.asOfDate}`,
        ),
      ),
    ),
    React.createElement(
      'main',
      { className: 'max-w-7xl mx-auto px-6 py-6' },
      content,
    ),
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
