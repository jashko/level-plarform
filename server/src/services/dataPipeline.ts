/**
 * Data Pipeline Service
 * 
 * Handles:
 * - Scheduled data fetching (CBR, bnMAP, CIAN, etc.)
 * - Data validation and anomaly detection
 * - Alert generation for unusual changes
 * - Timeline storage (not overwriting old values)
 */

import { prisma, redis } from '../index.js';
import pino from 'pino';

const logger = pino({ name: 'data-pipeline' });

// ── Types ────────────────────────────────────────────────────────

export interface PipelineJob {
  id: string;
  type: 'cbr_fetch' | 'city_update' | 'crawl' | 'validation';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  itemsProcessed: number;
  errors: string[];
}

export interface DataPoint {
  entityType: string;
  entityId: string;
  field: string;
  value: number;
  source: string;
  timestamp: Date;
}

export interface ValidationResult {
  valid: boolean;
  field: string;
  oldValue: number | null;
  newValue: number;
  changePercent: number;
  threshold: number;
  alertGenerated: boolean;
}

// ── Thresholds for Anomaly Detection ─────────────────────────────

const ANOMALY_THRESHOLDS: Record<string, number> = {
  businessClassPricePerM2: 20,    // ±20% — price spike
  avgSalary: 15,                   // ±15% — salary jump
  dealsGrowthYoY: 50,              // ±50% — deals collapse/surge
  priceGrowthYoY: 30,              // ±30% — price growth anomaly
  monthsOfSupply: 40,              // ±40% — supply shock
  unemploymentRate: 30,            // ±30% — unemployment spike
  keyRateAnnual: 25,               // ±25% — rate change
  mortgageRateAnnual: 20,          // ±20% — mortgage shift
};

// ── CBR Fetch ────────────────────────────────────────────────────

export async function fetchCBRData(): Promise<{
  keyRate: number;
  nextMeeting: string;
}> {
  logger.info('Fetching CBR key rate...');

  const response = await fetch('https://www.cbr.ru/press/keypr/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LevelPlatform/1.0)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`CBR fetch failed: ${response.status}`);
  }

  const html = await response.text();

  // Parse key rate from HTML
  const rateMatch = html.match(/(\d+[.,]\d+)\s*%/);
  const keyRate = rateMatch
    ? parseFloat(rateMatch[1].replace(',', '.'))
    : 14.5; // fallback

  // Parse next meeting date
  const dateMatch = html.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/);
  const nextMeeting = dateMatch ? `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}` : 'неизвестно';

  logger.info({ keyRate, nextMeeting }, 'CBR data fetched');

  return { keyRate, nextMeeting };
}

// ── City Data Crawler ────────────────────────────────────────────

export async function crawlCityData(cityKey: string): Promise<DataPoint[]> {
  logger.info({ cityKey }, 'Crawling city data...');

  const dataPoints: DataPoint[] = [];

  // Sources to crawl per city
  const sources = [
    { url: `https://www.cian.ru/cat.php?deal_type=sale&engine_version=2&offer_type=flat&region=${getCityCianId(cityKey)}&type=4&newobject=1`, name: 'CIAN' },
    { url: `https://domclick.ru/region/${getCityDomclickId(cityKey)}/flatarend`, name: 'ДОМ.РФ' },
  ];

  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const html = await response.text();

      // Extract price per m2
      const priceMatch = html.match(/(\d[\d\s]*)\s*₽\/м²/);
      if (priceMatch) {
        const price = parseInt(priceMatch[1].replace(/\s/g, ''), 10);
        if (price > 50000 && price < 500000) {
          dataPoints.push({
            entityType: 'city',
            entityId: cityKey,
            field: 'businessClassPricePerM2',
            value: price,
            source: source.name,
            timestamp: new Date(),
          });
        }
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      logger.warn({ cityKey, source: source.name, err }, 'Crawl failed');
    }
  }

  return dataPoints;
}

// ── Data Validation ──────────────────────────────────────────────

export async function validateDataPoint(
  entityType: string,
  entityId: string,
  field: string,
  newValue: number,
  source: string,
): Promise<ValidationResult> {
  // Get current value
  let oldValue: number | null = null;

  if (entityType === 'city') {
    const city = await prisma.city.findUnique({ where: { key: entityId } });
    if (city && field in city) {
      oldValue = (city as any)[field];
    }
  } else if (entityType === 'macro') {
    const snapshot = await prisma.macroSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } });
    if (snapshot && field in snapshot) {
      oldValue = (snapshot as any)[field];
    }
  }

  if (oldValue === null || oldValue === undefined) {
    return {
      valid: true,
      field,
      oldValue: null,
      newValue,
      changePercent: 0,
      threshold: 0,
      alertGenerated: false,
    };
  }

  const threshold = ANOMALY_THRESHOLDS[field] ?? 25;
  const changePercent = Math.abs((newValue - oldValue) / oldValue) * 100;
  const isValid = changePercent <= threshold;

  // Generate alert if anomaly detected
  let alertGenerated = false;
  if (!isValid) {
    await prisma.alert.create({
      data: {
        type: 'price_spike',
        severity: changePercent > threshold * 2 ? 'critical' : 'warning',
        entityType,
        entityId,
        title: `Anomaly detected: ${field}`,
        message: `${field} changed by ${changePercent.toFixed(1)}% (${oldValue} → ${newValue}). Source: ${source}`,
      },
    });
    alertGenerated = true;
    logger.warn({ entityType, entityId, field, changePercent, oldValue, newValue }, 'Anomaly detected');
  }

  return {
    valid: isValid,
    field,
    oldValue,
    newValue,
    changePercent,
    threshold,
    alertGenerated,
  };
}

// ── Timeline Storage ─────────────────────────────────────────────

export async function storeDataPoint(dataPoint: DataPoint): Promise<void> {
  // Store in Redis time series (sorted set with timestamp as score)
  const key = `timeline:${dataPoint.entityType}:${dataPoint.entityId}:${dataPoint.field}`;
  const score = dataPoint.timestamp.getTime();
  const value = JSON.stringify({
    value: dataPoint.value,
    source: dataPoint.source,
    timestamp: dataPoint.timestamp.toISOString(),
  });

  await redis.zadd(key, score, value);

  // Keep only last 365 days
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  await redis.zremrangebyscore(key, 0, cutoff);

  // Also store latest value
  const latestKey = `latest:${dataPoint.entityType}:${dataPoint.entityId}:${dataPoint.field}`;
  await redis.set(latestKey, JSON.stringify({
    value: dataPoint.value,
    source: dataPoint.source,
    timestamp: dataPoint.timestamp.toISOString(),
  }));
}

export async function getDataTimeline(
  entityType: string,
  entityId: string,
  field: string,
  days: number = 90,
): Promise<Array<{ timestamp: string; value: number; source: string }>> {
  const key = `timeline:${entityType}:${entityId}:${field}`;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const entries = await redis.zrangebyscore(key, cutoff, '+inf');
  return entries.map(e => JSON.parse(e));
}

// ── Pipeline Runner ──────────────────────────────────────────────

export async function runPipeline(type: string): Promise<PipelineJob> {
  const job: PipelineJob = {
    id: `pipeline-${Date.now()}`,
    type: type as any,
    status: 'running',
    startedAt: new Date(),
    itemsProcessed: 0,
    errors: [],
  };

  logger.info({ jobType: type }, 'Starting pipeline job');

  try {
    // Create pipeline run record
    const run = await prisma.dataPipelineRun.create({
      data: {
        type,
        status: 'running',
      },
    });

    if (type === 'cbr_fetch') {
      const cbrData = await fetchCBRData();

      // Validate
      const validation = await validateDataPoint(
        'macro',
        'latest',
        'keyRateAnnual',
        cbrData.keyRate,
        'CBR XML',
      );

      if (validation.valid) {
        // Store
        await storeDataPoint({
          entityType: 'macro',
          entityId: 'latest',
          field: 'keyRateAnnual',
          value: cbrData.keyRate,
          source: 'CBR XML',
          timestamp: new Date(),
        });
        job.itemsProcessed++;
      } else {
        job.errors.push(`Key rate anomaly: ${validation.changePercent.toFixed(1)}% change`);
      }

    } else if (type === 'city_update') {
      const cities = await prisma.city.findMany({ select: { key: true } });

      for (const city of cities) {
        try {
          const dataPoints = await crawlCityData(city.key);
          for (const dp of dataPoints) {
            const validation = await validateDataPoint(
              dp.entityType,
              dp.entityId,
              dp.field,
              dp.value,
              dp.source,
            );

            if (validation.valid) {
              await storeDataPoint(dp);
              job.itemsProcessed++;
            } else {
              job.errors.push(`${city.key}.${dp.field}: ${validation.changePercent.toFixed(1)}% change`);
            }
          }
        } catch (err) {
          job.errors.push(`Failed to crawl ${city.key}: ${(err as Error).message}`);
        }
      }
    }

    // Update run record
    await prisma.dataPipelineRun.update({
      where: { id: run.id },
      data: {
        status: job.errors.length > 0 ? 'completed' : 'completed',
        completedAt: new Date(),
        itemsProcessed: job.itemsProcessed,
        errors: job.errors,
      },
    });

    job.status = 'completed';
    job.completedAt = new Date();

  } catch (err) {
    job.status = 'failed';
    job.errors.push((err as Error).message);
    logger.error({ err, jobType: type }, 'Pipeline job failed');
  }

  logger.info({ job }, 'Pipeline job completed');
  return job;
}

// ── Helper Functions ─────────────────────────────────────────────

function getCityCianId(cityKey: string): string {
  const mapping: Record<string, string> = {
    novosibirsk: '4897',
    yekaterinburg: '3',
    kazan: '4777',
    nizhny: '4690',
    chelyabinsk: '11010',
    samara: '4593',
    ufa: '9',
    rostov: '76',
    omsk: '65',
    krasnodar: '532',
    voronezh: '24',
    volgograd: '8',
    perm: '72',
    krasnoyarsk: '51',
  };
  return mapping[cityKey] || '1';
}

function getCityDomclickId(cityKey: string): string {
  const mapping: Record<string, string> = {
    novosibirsk: 'novosibirskaya-oblast',
    yekaterinburg: 'svdlovskaya-oblast',
    kazan: 'respublika-tatarstan',
    nizhny: 'nizhegorodskaya-oblast',
    chelyabinsk: 'chelyabinskaya-oblast',
    samara: 'samarskaya-oblast',
    ufa: 'respublika-bashkortostan',
    rostov: 'rostovskaya-oblast',
    omsk: 'omskaya-oblast',
    krasnodar: 'krasnodarskiy-kray',
    voronezh: 'voronezhskaya-oblast',
    volgograd: 'volgogradskaya-oblast',
    perm: 'permskiy-kray',
    krasnoyarsk: 'krasnoyarskiy-kray',
  };
  return mapping[cityKey] || 'moscow';
}

// ── Schedule Configuration ───────────────────────────────────────

export const PIPELINE_SCHEDULES = {
  cbr_fetch: {
    cron: '0 7 * * 1-5',    // Every weekday at 7am
    description: 'Fetch CBR key rate',
  },
  city_update: {
    cron: '0 8 * * 1',      // Every Monday at 8am
    description: 'Crawl city data from CIAN, DOM.RF',
  },
  validation: {
    cron: '0 9 * * *',      // Daily at 9am
    description: 'Validate recent data points',
  },
};
