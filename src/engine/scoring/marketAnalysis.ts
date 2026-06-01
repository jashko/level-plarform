/**
 * Анализ рыночного цикла, профиль рисков и доступность.
 *
 * Эти функции дополняют CityScore, отвечая на вопросы:
 *   - На каком этапе цикла находится рынок?
 *   - Какие конкретные риски несёт вход в этот город?
 *   - Сколько месяцев зарплаты стоит квадратный метр бизнес-класса?
 */

import { clamp, normalizePiecewise } from './normalize';
import type { CityInputs } from './types';

// ──────────────────────────────────────────────────────────────────
// Рыночный цикл
// ──────────────────────────────────────────────────────────────────

export type MarketCyclePosition =
  | 'recovery'    // восстановление / лучшее окно для входа
  | 'expansion'   // активный рост
  | 'peak'        // пик / перегрев
  | 'slowdown'    // замедление / охлаждение
  | 'oversupply'; // перенасыщение

export type EntrySignal = 'enter' | 'watch' | 'wait';

export interface MarketCycleResult {
  position: MarketCyclePosition;
  labelRu: string;
  entrySignal: EntrySignal;
  entrySignalRu: string;
  /** 0–100: насколько хорошее сейчас окно для входа. */
  timingScore: number;
  reasoning: string;
}

export function calculateMarketCycle(inputs: CityInputs): MarketCycleResult {
  const { housing: h, demography: d } = inputs;
  const deals      = h.dealsGrowthYoY;
  const prices     = h.priceGrowthYoY;
  const readiness  = h.sellReadinessRatioPct ?? 65;
  const unsold     = h.unsoldYearsOfSupply   ?? 4.0;

  // ── Перенасыщение ─────────────────────────────────────────────
  if (unsold > 5.5 || readiness < 50) {
    return {
      position: 'oversupply',
      labelRu: 'Перенасыщение',
      entrySignal: 'wait',
      entrySignalRu: 'Ждать',
      timingScore: Math.max(5, readiness / 2 - 5),
      reasoning: `Рынок перенасыщен: ${unsold.toFixed(1)} лет нераспроданного жилья, ` +
        `распроданность всего ${readiness}%. Вход сейчас — риск зайти в затяжное падение.`,
    };
  }

  // ── Глубокое охлаждение ───────────────────────────────────────
  if (deals < -25 && prices < 5) {
    return {
      position: 'slowdown',
      labelRu: 'Коррекция',
      entrySignal: 'wait',
      entrySignalRu: 'Ждать',
      timingScore: 22,
      reasoning: `Сделки упали на ${Math.abs(deals).toFixed(0)}% YoY, ценовой рост минимален (+${prices.toFixed(1)}%). ` +
        `Дождитесь стабилизации спроса.`,
    };
  }

  // ── Умеренное охлаждение ──────────────────────────────────────
  if (deals < -10 && prices < 8) {
    return {
      position: 'slowdown',
      labelRu: 'Охлаждение',
      entrySignal: 'watch',
      entrySignalRu: 'Наблюдать',
      timingScore: 38,
      reasoning: `Рынок охлаждается: сделки ${deals.toFixed(0)}% YoY. Конкуренция снижается — ` +
        `возможен вход с дисконтом на землю, но фаза сжатия ещё не завершена.`,
    };
  }

  // ── Пик ───────────────────────────────────────────────────────
  if (deals > 8 && prices > 14 && readiness > 78) {
    return {
      position: 'peak',
      labelRu: 'Перегрев',
      entrySignal: 'watch',
      entrySignalRu: 'Наблюдать',
      timingScore: 50,
      reasoning: `Рынок перегрет: сделки +${deals.toFixed(0)}%, цены +${prices.toFixed(1)}%, ` +
        `высокая распроданность (${readiness}%). Дорогая земля, сложно найти маржу. Ищите нишу.`,
    };
  }

  // ── Здоровый рост ─────────────────────────────────────────────
  if (deals > -5 && prices > 7 && readiness > 65) {
    const score = 65 + Math.min(15, (prices - 7) * 2) + Math.min(10, (readiness - 65) * 0.3);
    return {
      position: 'expansion',
      labelRu: 'Рост',
      entrySignal: 'enter',
      entrySignalRu: 'Входить',
      timingScore: Math.round(clamp(score, 60, 85)),
      reasoning: `Рынок в фазе роста: цены +${prices.toFixed(1)}% YoY, распроданность ${readiness}%. ` +
        `Хорошее сочетание спроса и ценового потенциала для запуска нового проекта.`,
    };
  }

  // ── Восстановление (дефицит предложения) ────────────────────
  if (readiness > 75 && prices > 3) {
    return {
      position: 'recovery',
      labelRu: 'Дефицит',
      entrySignal: 'enter',
      entrySignalRu: 'Входить',
      timingScore: 80,
      reasoning: `Дефицит предложения: распроданность ${readiness}%, цены растут +${prices.toFixed(1)}%. ` +
        `Оптимальное окно — спрос превышает предложение, конкуренция невысокая.`,
    };
  }

  // ── Стабильный нейтральный ────────────────────────────────────
  return {
    position: 'expansion',
    labelRu: 'Стабильный',
    entrySignal: 'watch',
    entrySignalRu: 'Наблюдать',
    timingScore: 48,
    reasoning: `Нейтральный рынок. Рекомендуется детальный анализ конкретных площадок.`,
  };
}

// ──────────────────────────────────────────────────────────────────
// Профиль рисков
// ──────────────────────────────────────────────────────────────────

export interface CityRiskProfile {
  /** 0–100, выше = хуже. Убыль населения, отрицательная миграция. */
  demographicRisk: number;
  /** 0–100. Низкая ликвидность рынка: мало сделок, длинный запас. */
  liquidityRisk: number;
  /** 0–100. Высокая концентрация, федеральные игроки. */
  competitionRisk: number;
  /** 0–100. Цена м² относительно зарплаты → чувствительность к ставке. */
  affordabilityRisk: number;
  /** 0–100. Объём нераспроданного жилья, строительный пайплайн. */
  supplyOverhang: number;
  /** Взвешенный итоговый риск 0–100. */
  overallRisk: number;
  /** Жёсткие блокеры — условия, при которых вход нецелесообразен. */
  hardBlockers: string[];
}

export function calculateCityRiskProfile(inputs: CityInputs): CityRiskProfile {
  const { housing: h, demography: d, economy: e, competition: c } = inputs;
  const hardBlockers: string[] = [];

  // 1. Демографический риск
  const demoRisk = normalizePiecewise(d.populationTrend5yPct, [
    [-6, 100], [-3, 75], [-1, 50], [0, 40], [3, 20], [8, 5],
  ]);
  const migRisk = normalizePiecewise(d.migrationBalanceThousands, [
    [-15, 80], [-5, 55], [0, 40], [5, 20], [20, 0],
  ]);
  const demographicRisk = Math.round(clamp(0.6 * demoRisk + 0.4 * migRisk, 0, 100));
  if (d.populationTrend5yPct < -3) {
    hardBlockers.push(`Критический отток: убыль ${Math.abs(d.populationTrend5yPct).toFixed(1)}% за 5 лет`);
  }

  // 2. Риск ликвидности
  const dealRisk = normalizePiecewise(h.dealsGrowthYoY, [
    [-50, 100], [-30, 80], [-15, 55], [-5, 40], [0, 30], [15, 10],
  ]);
  const supplyRisk1 = normalizePiecewise(h.monthsOfSupply, [
    [6, 0], [12, 30], [18, 60], [24, 100],
  ]);
  const liquidityRisk = Math.round(clamp(0.55 * dealRisk + 0.45 * supplyRisk1, 0, 100));
  if (h.dealsGrowthYoY < -40) {
    hardBlockers.push(`Обвал спроса: сделки ${h.dealsGrowthYoY.toFixed(0)}% YoY`);
  }

  // 3. Конкурентный риск
  const concRisk = normalizePiecewise(c.top5MarketShare, [
    [0.25, 5], [0.50, 35], [0.70, 65], [0.85, 90],
  ]);
  const competitionRisk = Math.round(clamp(
    concRisk + (c.hasFederalPlayers ? 12 : 0) + (c.hasWhiteSpaceBusinessClass ? -15 : 0),
    0, 100,
  ));

  // 4. Доступность / макро-чувствительность
  const affordMonths = h.businessClassPricePerM2 / e.avgSalary;
  const affordabilityRisk = Math.round(normalizePiecewise(affordMonths, [
    [1.5, 5], [2.5, 30], [3.2, 55], [4.0, 78], [5.5, 100],
  ]));
  if (affordMonths > 4.5) {
    hardBlockers.push(`Низкая доступность: ${affordMonths.toFixed(1)} мес. ЗП на м² — покупатели уходят`);
  }

  // 5. Навес предложения (Дом.РФ данные)
  const srRisk = normalizePiecewise(h.sellReadinessRatioPct ?? 65, [
    [85, 0], [70, 25], [60, 55], [45, 85], [35, 100],
  ]);
  const unsoldRisk = normalizePiecewise(h.unsoldYearsOfSupply ?? 4, [
    [2, 0], [3.5, 20], [5, 55], [6.5, 85], [8, 100],
  ]);
  const supplyOverhang = Math.round(clamp(0.55 * srRisk + 0.45 * unsoldRisk, 0, 100));
  if ((h.unsoldYearsOfSupply ?? 0) > 5.5) {
    hardBlockers.push(`Перенасыщение: ${(h.unsoldYearsOfSupply ?? 0).toFixed(1)} лет нераспроданного жилья`);
  }

  const overallRisk = Math.round(clamp(
    0.20 * demographicRisk +
    0.25 * liquidityRisk   +
    0.20 * competitionRisk +
    0.20 * affordabilityRisk +
    0.15 * supplyOverhang,
    0, 100,
  ));

  return {
    demographicRisk,
    liquidityRisk,
    competitionRisk,
    affordabilityRisk,
    supplyOverhang,
    overallRisk,
    hardBlockers,
  };
}

// ──────────────────────────────────────────────────────────────────
// Индекс доступности
// ──────────────────────────────────────────────────────────────────

export interface AffordabilityIndex {
  /** Число месяцев средней ЗП для покупки 1 м² бизнес-класса. */
  monthsPerM2: number;
  /** Оценка: 'high' | 'moderate' | 'premium' | 'elite'. */
  tier: 'high' | 'moderate' | 'premium' | 'elite';
  tierRu: string;
  /** Ежемесячный платёж как % от средней ЗП (ипотека, 30 лет, 20% взнос, 14.5%). */
  mortgagePaymentSharePct: number;
  /**
   * Средняя площадь квартиры бизнес-класса 65 м².
   * Платёж = (цена×65×0.8 × ставка / 12) / (1 - (1+ставка/12)^-360).
   */
  recommendedMonthlyIncome: number;
}

export function calculateAffordability(inputs: CityInputs): AffordabilityIndex {
  const price = inputs.housing.businessClassPricePerM2;
  const salary = inputs.economy.avgSalary;
  const monthsPerM2 = price / salary;

  const tier: AffordabilityIndex['tier'] =
    monthsPerM2 < 2.2 ? 'high'
    : monthsPerM2 < 3.2 ? 'moderate'
    : monthsPerM2 < 4.2 ? 'premium'
    : 'elite';

  const tierRu = tier === 'high' ? 'Доступный'
    : tier === 'moderate' ? 'Умеренный'
    : tier === 'premium' ? 'Премиум'
    : 'Элитный';

  // Ипотека: 65 м², 80% LTV, ставка 14.5%, 30 лет
  const loanAmount = price * 65 * 0.80;
  const monthlyRate = 0.145 / 12;
  const months = 360;
  const payment = loanAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  const mortgagePaymentSharePct = Math.round((payment / salary) * 100);
  const recommendedMonthlyIncome = Math.round(payment / 0.40); // комфортно при ≤40% дохода

  return {
    monthsPerM2: Math.round(monthsPerM2 * 10) / 10,
    tier,
    tierRu,
    mortgagePaymentSharePct,
    recommendedMonthlyIncome,
  };
}
