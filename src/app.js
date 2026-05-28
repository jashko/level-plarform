/**
 * LEVEL Platform — UI
 * Premium dark edition · бизнес-класс как LEVEL GROUP
 */

import React, { useState, useMemo, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LineChart, Line, BarChart, Bar, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, Cell,
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
function ScoreBar({ label, score }) {
  const color = score >= 70 ? T.green : score >= 45 ? T.yellow : T.red;
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', marginBottom: 5 },
    },
      React.createElement('span', { style: { fontSize: 11, color: T.textSub } }, label),
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
      { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 24 } },
      React.createElement(MacroMetric, { label: 'Ключевая ставка',  value: fmtPct(snapshot.keyRateAnnual, 2),         gold: true }),
      React.createElement(MacroMetric, { label: 'Рыночная ипотека', value: fmtPct(snapshot.mortgageRateAnnual, 2) }),
      React.createElement(MacroMetric, { label: 'Семейная ипотека', value: snapshot.preferentialMortgageRate ? fmtPct(snapshot.preferentialMortgageRate, 1) : '—' }),
      React.createElement(MacroMetric, { label: 'MacroScore',       value: `${snapshot.macroScore.toFixed(0)} / 100`,  gold: true }),
      React.createElement(MacroMetric, { label: 'Дата снимка',      value: snapshot.asOfDate }),
    ),
  );
}

function MacroMetric({ label, value, gold }) {
  return React.createElement(
    'div',
    null,
    React.createElement(Label, { style: { marginBottom: 8 } }, label),
    React.createElement('div', {
      style: {
        fontSize: 22,
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        color: gold ? T.gold : T.text,
        fontFamily: 'Inter, sans-serif',
        letterSpacing: '-0.02em',
      },
    }, value),
  );
}

function RussiaMap({ cities, onCityClick }) {
  const minLng = 35, maxLng = 95, minLat = 43, maxLat = 60;
  const W = 800, H = 300;
  const proj = (lng, lat) => ({
    x: ((lng - minLng) / (maxLng - minLng)) * W,
    y: H - ((lat - minLat) / (maxLat - minLat)) * H,
  });

  return React.createElement(
    'div',
    {
      style: {
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: '20px 24px',
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
      React.createElement(Label, null, 'Карта городов'),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 18 } },
        Object.entries(ZONE).map(([k, z]) =>
          React.createElement('div', {
            key: k,
            style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.textMuted },
          },
          React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: z.fg } }),
          z.label,
          ),
        ),
      ),
    ),
    React.createElement(
      'svg',
      {
        viewBox: `0 0 ${W} ${H}`,
        style: { width: '100%', background: T.bg, borderRadius: 8, display: 'block' },
      },
      cities.map((c) => {
        const { x, y } = proj(c.coordinates.lng, c.coordinates.lat);
        const z = ZONE[c.zone];
        const r = 5 + (c.cityScore / 100) * 9;
        return React.createElement(
          'g',
          { key: c.key, onClick: () => onCityClick(c.key), style: { cursor: 'pointer' } },
          React.createElement('circle', { cx: x, cy: y, r: r + 6, fill: z.fg, opacity: 0.06 }),
          React.createElement('circle', { cx: x, cy: y, r, fill: z.fg, opacity: 0.82 }),
          React.createElement('text', {
            x, y: y + r + 14,
            textAnchor: 'middle',
            fontSize: 10,
            fill: T.textSub,
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

function CityRow({ rank, city, onClick }) {
  const z = ZONE[city.zone];
  const thSub = (s) => s >= 70 ? T.green : s >= 45 ? T.textSub : T.red;
  return React.createElement(
    'tr',
    {
      className: 'l-row',
      style: { borderBottom: `1px solid rgba(255,255,255,0.04)`, cursor: 'pointer' },
      onClick: () => onClick(city.key),
    },
    // rank
    React.createElement('td', {
      style: { padding: '14px 16px', width: 48, fontSize: 12, color: T.textMuted, fontVariantNumeric: 'tabular-nums' },
    }, rank),
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
    // open
    React.createElement(
      'td',
      { style: { padding: '14px 16px', textAlign: 'right' } },
      React.createElement('span', {
        style: { fontSize: 12, color: T.gold, letterSpacing: '0.04em', fontWeight: 500 },
      }, 'Открыть →'),
    ),
  );
}

function MainScreen({ ranking, onCityClick }) {
  const [zoneFilter, setZoneFilter] = useState('all');
  const filteredCities = zoneFilter === 'all'
    ? ranking.cities
    : ranking.cities.filter((c) => c.zone === zoneFilter);

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
    React.createElement(MacroSnapshotBanner, { snapshot: ranking.macroSnapshot }),
    React.createElement(RussiaMap, { cities: ranking.cities, onCityClick }),
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
        React.createElement(ZoneFilter, { filter: zoneFilter, onChange: setZoneFilter }),
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
              React.createElement('th', { style: thCell('left') }, 'CityScore'),
              React.createElement('th', { style: thCell() }, 'Демогр'),
              React.createElement('th', { style: thCell() }, 'Эконом'),
              React.createElement('th', { style: thCell() }, 'Жильё'),
              React.createElement('th', { style: thCell() }, 'Конкур'),
              React.createElement('th', { style: thCell() }, 'Инфра'),
              React.createElement('th', { style: { ...thCell('right'), paddingRight: 16 } }, 'Цена м² БК'),
              React.createElement('th', { style: thCell() }),
            ),
          ),
          React.createElement(
            'tbody',
            null,
            filteredCities.map((c) =>
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


// ═════════════════════════════════════════════════════════════════
// ЭКРАН 2 — КАРТОЧКА ГОРОДА
// ═════════════════════════════════════════════════════════════════

function MetricCard({ label, value, sub, accent, gold }) {
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
    React.createElement(Label, { style: { marginBottom: 8 } }, label),
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
      { style: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 } },
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
        { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignContent: 'start' } },
        React.createElement(MetricCard, {
          label: 'Население',
          value: `${city.inputs.demography.populationThousands.toLocaleString('ru-RU')} тыс.`,
          sub: `${city.inputs.demography.populationTrend5yPct >= 0 ? '+' : ''}${city.inputs.demography.populationTrend5yPct.toFixed(1)}% за 5 лет`,
          accent: city.inputs.demography.populationTrend5yPct >= 0 ? 'good' : 'bad',
        }),
        React.createElement(MetricCard, {
          label: 'Миграция',
          value: `${city.inputs.demography.migrationBalanceThousands >= 0 ? '+' : ''}${city.inputs.demography.migrationBalanceThousands.toFixed(1)} тыс.`,
          sub: 'чел/год',
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
          accent: 'good',
        }),
        React.createElement(MetricCard, {
          label: 'Цена м² бизнес-класс',
          value: fmtRub(city.inputs.housing.businessClassPricePerM2),
          sub: `+${city.inputs.housing.priceGrowthYoY.toFixed(1)}% YoY`,
          gold: true,
        }),
        React.createElement(MetricCard, {
          label: 'Темп поглощения',
          value: `${city.inputs.housing.monthsOfSupply} мес.`,
          sub: 'запас предложения',
          accent: city.inputs.housing.monthsOfSupply <= 9 ? 'good'
                : city.inputs.housing.monthsOfSupply >= 15 ? 'bad' : null,
        }),
        React.createElement(MetricCard, {
          label: 'Девелоперов',
          value: city.inputs.competition.activeDevelopers,
          sub: `топ-5: ${fmtPct(city.inputs.competition.top5MarketShare * 100, 0)}`,
        }),
        React.createElement(MetricCard, {
          label: 'Безработица',
          value: fmtPct(city.inputs.economy.unemploymentRate, 1),
          accent: city.inputs.economy.unemploymentRate <= 3 ? 'good'
                : city.inputs.economy.unemploymentRate >= 5 ? 'bad' : null,
        }),
        React.createElement(MetricCard, {
          label: 'КРТ-программы',
          value: `${city.inputs.infrastructure.krtProgramsHa} га`,
          sub: city.inputs.infrastructure.hasMajorInfraProjects ? '✓ крупные проекты' : '',
          accent: city.inputs.infrastructure.hasMajorInfraProjects ? 'good' : null,
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
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 } },

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
          React.createElement(ScoreBar, { label: 'Доступность',          score: result.breakdown.accessScore }),
          React.createElement(ScoreBar, { label: 'Социнфраструктура',    score: result.breakdown.socialInfraScore }),
          React.createElement(ScoreBar, { label: 'Качество среды',       score: result.breakdown.urbanQualityScore }),
          React.createElement(ScoreBar, { label: 'Локальный рынок',      score: result.breakdown.localMarketScore }),
          React.createElement(ScoreBar, { label: 'Совпадение сегмента',  score: result.breakdown.alignmentScore }),
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
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 } },

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
          React.createElement(ScoreBar, { label: 'Юридика',            score: result.breakdown.legalScore }),
          React.createElement(ScoreBar, { label: 'Технология',         score: result.breakdown.techScore }),
          React.createElement(ScoreBar, { label: 'Окружение',          score: result.breakdown.surroundingsScore }),
          React.createElement(ScoreBar, { label: 'Рыночное совпадение', score: result.breakdown.marketFitScore }),
          React.createElement(ScoreBar, { label: 'Финансика',          score: result.breakdown.rawFinancialScore }),
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

function KpiCard({ label, value, sub, color }) {
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '16px 20px' } },
    React.createElement(Label, { style: { marginBottom: 8 } }, label),
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
  const set    = (key) => (v) => onChange({ ...inputs, [key]: v });
  const setFin = (key) => (v) => onChange({ ...inputs, financing: { ...inputs.financing, [key]: v } });
  return React.createElement(
    'div',
    { style: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px' } },
    React.createElement(Label, { style: { marginBottom: 16 } }, 'Параметры проекта'),
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
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

  const [inputs, setInputs] = useState(initialInputs);
  const [scenario, setScenario] = useState('base');
  useEffect(() => { setInputs(initialInputs); }, [initialInputs]);

  const model = useMemo(() =>
    runFinancialModel(inputs, {
      successProbContext: {
        cityScore:     city ? city.cityScore : 70,
        districtScore: districtResult ? districtResult.districtScore : 65,
        siteScore:     siteResult ? siteResult.siteScore : 70,
        redRiskCount:  0,
        confidenceScore: 80,
      },
    }),
  [inputs, city, districtResult, siteResult]);

  const cur = model.scenarios[scenario];
  const irrColor = cur.irr === null ? T.textSub
    : cur.irr >= 25 ? T.green
    : cur.irr >= 15 ? T.yellow
    : T.red;

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 20 } },

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
    ),

    // KPIs
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 } },
      React.createElement(KpiCard, { label: 'Выручка',   value: fmtRub(cur.revenue.totalRevenue) }),
      React.createElement(KpiCard, { label: 'CAPEX',     value: fmtRub(cur.capex.total) }),
      React.createElement(KpiCard, { label: 'IRR',       value: fmtPct(cur.irr), color: irrColor }),
      React.createElement(KpiCard, { label: 'NPV',       value: fmtRub(cur.npv), color: cur.npv >= 0 ? T.green : T.red }),
      React.createElement(KpiCard, { label: 'P(успеха)', value: fmtPct(model.successProb, 0) }),
      React.createElement(KpiCard, { label: 'Sell-out',  value: `${cur.sellOutMonths.toFixed(0)} мес.`, sub: `проект ${cur.totalProjectMonths} мес.` }),
    ),

    // charts + inputs
    React.createElement(
      'div',
      { style: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 } },
      React.createElement(InputPanel, { inputs, onChange: setInputs }),
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
        React.createElement(CashflowChart, { monthlyCashFlow: cur.monthlyCashFlow }),
        React.createElement(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 } },
          React.createElement(CapexBars, { capex: cur.capex, totalPfInterest: cur.totalPfInterest }),
          React.createElement(ScenarioCompare, { scenarios: model.scenarios }),
        ),
      ),
    ),

    model.warnings.length > 0 && React.createElement(WarningsPanel, { warnings: model.warnings }),
  );
}


// ═════════════════════════════════════════════════════════════════
// ROOT APP
// ═════════════════════════════════════════════════════════════════

function App() {
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [screen,  setScreen]  = useState({ name: 'main' });

  useEffect(() => {
    buildCityRanking()
      .then((r) => { setRanking(r); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

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
            padding: '0 36px',
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
      { style: { maxWidth: 1280, margin: '0 auto', padding: '32px 36px 60px' } },
      content,
    ),
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
