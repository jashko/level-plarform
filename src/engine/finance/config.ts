/**
 * Конфигурация сценарного движка. В проде — редактируемый JSON.
 */

import type {
  ProjectFinanceParams,
  Scenario,
  ScenarioAdjustments,
} from './types';

export const SCENARIO_ADJUSTMENTS: Record<Scenario, ScenarioAdjustments> = {
  base: {
    priceMultiplier: 1.0,
    costMultiplier: 1.0,
    salesVelocityMultiplier: 1.0,
    discountRateDelta: 0,
    pfRateDelta: 0,
  },
  optimistic: {
    priceMultiplier: 1.15,
    costMultiplier: 0.95,
    salesVelocityMultiplier: 1.30,
    discountRateDelta: -3,
    pfRateDelta: -2,
  },
  stress: {
    priceMultiplier: 0.85,
    costMultiplier: 1.15,
    salesVelocityMultiplier: 0.60,
    discountRateDelta: 3,
    pfRateDelta: 3,
  },
};

/** Параметры чувствительности (по ТЗ ±5/10/15%). */
export const SENSITIVITY_DELTAS: number[] = [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];

/** Пороги нормализации IRR для FinancialScore (0–100). */
export const IRR_NORMALIZATION = {
  floorPct: 15,
  ceilingPct: 40,
};

export const SUCCESS_PROB_WEIGHTS = {
  cityScore: 0.30,
  districtScore: 0.20,
  siteScore: 0.20,
  financialScore: 0.30,
};

export const SUCCESS_PROB_PENALTIES = {
  perRedRisk: 5,
  stressIrrNegative: 20,
  confidenceDivisor: 2,
};

/**
 * Нормативная себестоимость строительства МКД по Приказу Минстроя РФ (2025 г.),
 * ₽/м² ОБЩЕЙ площади (все зоны: жильё + МОП + паркинг).
 *
 * Источник: Приказы Минстроя об утверждении нормативной стоимости
 * одного квадратного метра общей площади жилого помещения, 2025.
 *
 * Для бизнес-класса применяется коэффициент BUSINESS_CLASS_CONSTRUCTION_PREMIUM.
 * Пересчёт в ₽/м² ПРОДАВАЕМОЙ площади: делить на sellableRatio (типично 0.78).
 */
export const MINSTROI_NORMATIVE_2025: Record<string, number> = {
  novosibirsk:    88_000,  // Новосибирская область
  yekaterinburg:  87_000,  // Свердловская область
  kazan:          91_000,  // Республика Татарстан
  nizhny:         82_000,  // Нижегородская область
  chelyabinsk:    67_000,  // Челябинская область
  samara:         74_000,  // Самарская область
  ufa:            76_000,  // Республика Башкортостан
  rostov:         74_000,  // Ростовская область
  omsk:           67_000,  // Омская область
  krasnodar:      76_000,  // Краснодарский край
  voronezh:       73_000,  // Воронежская область
  volgograd:      64_000,  // Волгоградская область
  perm:           68_000,  // Пермский край
  krasnoyarsk:    86_000,  // Красноярский край
};

/**
 * Коэффициент удорожания строительства бизнес-класса относительно
 * стандартного МКД по нормативам Минстроя.
 * Диапазон Союза инженеров-сметчиков для БК: 1.4–1.8 (монолит, навесной
 * фасад, premium МОП, инженерия, подземный паркинг). Берём нижнюю границу.
 */
export const BUSINESS_CLASS_CONSTRUCTION_PREMIUM = 1.4;

/**
 * Помесячные мультипликаторы спроса (сезонность продаж, среднее = 1.0).
 * Источник: Росреестр ДДУ 2020–2025, усреднено по регионам.
 * [Янв, Фев, Мар, Апр, Май, Июн, Июл, Авг, Сен, Окт, Ноя, Дек]
 * Пики: октябрь (+23%), сентябрь (+18%). Спад: июль (−27%), январь (−12%).
 */
export const SALES_SEASONALITY = [
  0.88, 0.92, 1.05, 1.12, 1.08, 0.88,
  0.73, 0.82, 1.18, 1.23, 1.13, 0.98,
]; // Сумма = 12.00, среднее = 1.00

/**
 * Налог на имущество организаций (НК РФ ст. 380), % годовых от балансовой стоимости.
 * База во время стройки = накопленный CAPEX; после ввода = доля нераспроданных кв.
 * Федеральный максимум 2.2%; регионы могут снижать.
 */
export const PROPERTY_TAX_RATE_DEFAULT = 2.2;

/**
 * Возвращает параметры ПФ, откалиброванные под текущую ключевую ставку ЦБ.
 *
 * Реальная практика (Сбер/ВТБ/ДОМ.РФ, 2024–2026):
 *  - Базовая ставка ПФ ≈ КС + 2.0–2.5 п.п. (без эскроу-покрытия)
 *  - Льготная ставка ПФ при покрытии эскроу ≈ КС × 0.01% (символическая, по 214-ФЗ)
 *    На практике от 0.01% до 4% в зависимости от банка и условий
 *  - Equity share: бизнес-класс обычно 20–25% (банки требуют "кожу в игре")
 */
export function getDefaultFinancingParams(ks: number = 14.25): ProjectFinanceParams {
  // Базовая ставка ПФ = КС + маржа банка (~2.2 п.п. в нормальных условиях)
  const pfBaseRate = Math.round((ks + 2.2) * 10) / 10;
  // Льготная ставка при 100% покрытии эскроу: практика Сбер/ВТБ ≈ 0.1–5%
  // При высокой КС банки держат её чуть выше, при низкой — символическая
  const pfEscrowRate = ks > 16 ? 4.0 : ks > 12 ? 3.0 : 2.0;

  return {
    equityShare:                       0.20,
    pfBaseRateAnnual:                  pfBaseRate,
    pfEscrowCoveredRateAnnual:         pfEscrowRate,
    escrowReleaseLagMonths:            2,
    escrowCoverageDiscount:            0.70,
    escrowDiscountActivationProgress:  0.30,
    pfCommitmentFeeAnnual:             1.5,
    pfCommittedLineMultiplier:         1.0,
    // Поэтапное раскрытие: 0 = только финальное (консервативная схема по умолчанию)
    escrowMidReleasePct:               0,
    escrowMidReleaseProgressPct:       0.50,
  };
}

/**
 * Дефолтные параметры при КС = 14.25% (с 19.06.2026).
 * Используется как начальное значение в UI до подгрузки актуальных данных.
 */
export const DEFAULT_FINANCING_PARAMS: ProjectFinanceParams = getDefaultFinancingParams(14.25);
