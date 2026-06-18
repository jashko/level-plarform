/**
 * Validation Service
 * 
 * Comprehensive data validation with:
 * - Anomaly detection (spikes, drops, outliers)
 * - Cross-field validation (logical consistency)
 * - Trend analysis (moving averages, momentum)
 * - Alert generation with severity levels
 */

import { prisma, redis } from '../index.js';
import pino from 'pino';

const logger = pino({ name: 'validation' });

// ── Types ────────────────────────────────────────────────────────

export interface ValidationRule {
  field: string;
  type: 'range' | 'spike' | 'trend' | 'cross-field' | 'custom';
  params: any;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  rule: ValidationRule;
  actualValue: number;
  expectedRange?: [number, number];
  deviation?: number;
  alertGenerated: boolean;
}

// ── Validation Rules ─────────────────────────────────────────────

const CITY_VALIDATION_RULES: ValidationRule[] = [
  // Range checks
  {
    field: 'businessClassPricePerM2',
    type: 'range',
    params: { min: 50000, max: 500000 },
    severity: 'critical',
    message: 'Business class price per m2 out of realistic range',
  },
  {
    field: 'avgSalary',
    type: 'range',
    params: { min: 30000, max: 200000 },
    severity: 'warning',
    message: 'Average salary out of expected range',
  },
  {
    field: 'unemploymentRate',
    type: 'range',
    params: { min: 0, max: 15 },
    severity: 'warning',
    message: 'Unemployment rate unusually high',
  },
  {
    field: 'monthsOfSupply',
    type: 'range',
    params: { min: 1, max: 36 },
    severity: 'warning',
    message: 'Months of supply out of normal range',
  },

  // Spike detection (compared to historical)
  {
    field: 'businessClassPricePerM2',
    type: 'spike',
    params: { thresholdPercent: 20, lookbackDays: 90 },
    severity: 'critical',
    message: 'Price spike detected (>20% change in 90 days)',
  },
  {
    field: 'dealsGrowthYoY',
    type: 'spike',
    params: { thresholdPercent: 50, lookbackDays: 30 },
    severity: 'critical',
    message: 'Deals volume spike detected (>50% change)',
  },

  // Trend checks
  {
    field: 'priceGrowthYoY',
    type: 'trend',
    params: { movingAverageWindow: 3, maxDeviation: 15 },
    severity: 'warning',
    message: 'Price growth trending away from moving average',
  },

  // Cross-field validation
  {
    field: 'businessClassPricePerM2',
    type: 'cross-field',
    params: {
      dependentField: 'avgSalary',
      ratio: { min: 1.5, max: 5.0 }, // price/salary ratio
    },
    severity: 'warning',
    message: 'Price to salary ratio outside normal range',
  },
];

const MACRO_VALIDATION_RULES: ValidationRule[] = [
  {
    field: 'keyRateAnnual',
    type: 'range',
    params: { min: 1, max: 30 },
    severity: 'critical',
    message: 'Key rate out of realistic range',
  },
  {
    field: 'mortgageRateAnnual',
    type: 'range',
    params: { min: 1, max: 40 },
    severity: 'warning',
    message: 'Mortgage rate out of expected range',
  },
  {
    field: 'inflationYoY',
    type: 'range',
    params: { min: -5, max: 30 },
    severity: 'warning',
    message: 'Inflation rate out of expected range',
  },
  {
    field: 'keyRateAnnual',
    type: 'spike',
    params: { thresholdPercent: 25, lookbackDays: 30 },
    severity: 'critical',
    message: 'Key rate changed significantly (>25%)',
  },
];

// ── Validation Engine ────────────────────────────────────────────

export async function validateCityData(
  cityKey: string,
  field: string,
  value: number,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const rules = CITY_VALIDATION_RULES.filter(r => r.field === field);

  for (const rule of rules) {
    const result = await applyRule(cityKey, 'city', rule, value);
    results.push(result);

    if (!result.valid && result.alertGenerated) {
      logger.warn({
        cityKey,
        field,
        value,
        rule: rule.type,
        message: rule.message,
      }, 'Validation failed');
    }
  }

  return results;
}

export async function validateMacroData(
  field: string,
  value: number,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const rules = MACRO_VALIDATION_RULES.filter(r => r.field === field);

  for (const rule of rules) {
    const result = await applyRule('latest', 'macro', rule, value);
    results.push(result);
  }

  return results;
}

// ── Rule Application ─────────────────────────────────────────────

async function applyRule(
  entityId: string,
  entityType: string,
  rule: ValidationRule,
  value: number,
): Promise<ValidationResult> {
  let valid = true;
  let expectedRange: [number, number] | undefined;
  let deviation: number | undefined;
  let alertGenerated = false;

  switch (rule.type) {
    case 'range': {
      const { min, max } = rule.params;
      valid = value >= min && value <= max;
      expectedRange = [min, max];
      deviation = value < min ? min - value : value - max;
      break;
    }

    case 'spike': {
      const history = await getHistoricalData(entityType, entityId, rule.field, rule.params.lookbackDays);
      if (history.length > 0) {
        const avg = history.reduce((s, h) => s + h.value, 0) / history.length;
        const changePercent = Math.abs((value - avg) / avg) * 100;
        valid = changePercent <= rule.params.thresholdPercent;
        deviation = changePercent;
      }
      break;
    }

    case 'trend': {
      const history = await getHistoricalData(entityType, entityId, rule.field, 90);
      if (history.length >= rule.params.movingAverageWindow) {
        const recent = history.slice(-rule.params.movingAverageWindow);
        const ma = recent.reduce((s, h) => s + h.value, 0) / recent.length;
        const deviationPercent = Math.abs((value - ma) / ma) * 100;
        valid = deviationPercent <= rule.params.maxDeviation;
        deviation = deviationPercent;
      }
      break;
    }

    case 'cross-field': {
      const { dependentField, ratio } = rule.params;
      const dependentValue = await getLatestValue(entityType, entityId, dependentField);
      if (dependentValue !== null) {
        const actualRatio = value / dependentValue;
        valid = actualRatio >= ratio.min && actualRatio <= ratio.max;
        expectedRange = [ratio.min * dependentValue, ratio.max * dependentValue];
        deviation = actualRatio;
      }
      break;
    }
  }

  // Generate alert if invalid
  if (!valid) {
    await prisma.alert.create({
      data: {
        type: 'anomaly',
        severity: rule.severity,
        entityType,
        entityId,
        title: `${rule.type.toUpperCase()}: ${rule.field}`,
        message: `${rule.message}. Value: ${value}`,
      },
    });
    alertGenerated = true;
  }

  return {
    valid,
    rule,
    actualValue: value,
    expectedRange,
    deviation,
    alertGenerated,
  };
}

// ── Historical Data Helpers ──────────────────────────────────────

async function getHistoricalData(
  entityType: string,
  entityId: string,
  field: string,
  days: number,
): Promise<Array<{ timestamp: string; value: number }>> {
  const key = `timeline:${entityType}:${entityId}:${field}`;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const entries = await redis.zrangebyscore(key, cutoff, '+inf');
  return entries.map(e => {
    const parsed = JSON.parse(e);
    return { timestamp: parsed.timestamp, value: parsed.value };
  });
}

async function getLatestValue(
  entityType: string,
  entityId: string,
  field: string,
): Promise<number | null> {
  const key = `latest:${entityType}:${entityId}:${field}`;
  const data = await redis.get(key);
  if (data) {
    return JSON.parse(data).value;
  }
  return null;
}

// ── Batch Validation ─────────────────────────────────────────────

export async function validateAllCities(): Promise<{
  total: number;
  valid: number;
  invalid: number;
  alerts: number;
}> {
  const cities = await prisma.city.findMany();
  let valid = 0;
  let invalid = 0;
  let alerts = 0;

  for (const city of cities) {
    const fields = [
      'businessClassPricePerM2',
      'avgSalary',
      'unemploymentRate',
      'monthsOfSupply',
    ];

    for (const field of fields) {
      const value = (city as any)[field];
      if (value === null || value === undefined) continue;

      const results = await validateCityData(city.key, field, value);
      const hasInvalid = results.some(r => !r.valid);
      const hasAlert = results.some(r => r.alertGenerated);

      if (hasInvalid) invalid++;
      else valid++;

      if (hasAlert) alerts++;
    }
  }

  return {
    total: cities.length * 4,
    valid,
    invalid,
    alerts,
  };
}
