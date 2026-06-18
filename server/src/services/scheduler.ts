/**
 * Scheduler Service
 * 
 * Manages scheduled tasks using node-cron.
 * Handles pipeline execution, data validation, and cleanup.
 */

import cron from 'node-cron';
import pino from 'pino';
import { runPipeline, PIPELINE_SCHEDULES } from './dataPipeline.js';
import { prisma } from '../index.js';
import { deliverWebhook } from '../routes/webhooks.js';

const logger = pino({ name: 'scheduler' });

// ── Scheduled Jobs ───────────────────────────────────────────────

const jobs: Map<string, cron.ScheduledTask> = new Map();

// ── CBR Fetch Job ────────────────────────────────────────────────
function scheduleCBRFetch(): void {
  const job = cron.schedule(PIPELINE_SCHEDULES.cbr_fetch.cron, async () => {
    logger.info('Running scheduled CBR fetch...');

    try {
      const result = await runPipeline('cbr_fetch');

      if (result.status === 'completed') {
        // Trigger webhook
        await deliverWebhook('macro_updated', {
          keyRate: result.itemsProcessed,
          timestamp: new Date().toISOString(),
        });

        // Invalidate cache
        const redis = (await import('../index.js')).redis;
        await redis.del('macro:latest');
      }
    } catch (err) {
      logger.error({ err }, 'CBR fetch job failed');
    }
  }, {
    timezone: 'Europe/Moscow',
  });

  jobs.set('cbr_fetch', job);
  logger.info('CBR fetch job scheduled');
}

// ── City Update Job ──────────────────────────────────────────────
function scheduleCityUpdate(): void {
  const job = cron.schedule(PIPELINE_SCHEDULES.city_update.cron, async () => {
    logger.info('Running scheduled city update...');

    try {
      const result = await runPipeline('city_update');

      if (result.status === 'completed') {
        await deliverWebhook('city_data_updated', {
          itemsProcessed: result.itemsProcessed,
          errors: result.errors.length,
          timestamp: new Date().toISOString(),
        });

        // Invalidate city caches
        const redis = (await import('../index.js')).redis;
        await redis.del('cities:list');
      }
    } catch (err) {
      logger.error({ err }, 'City update job failed');
    }
  }, {
    timezone: 'Europe/Moscow',
  });

  jobs.set('city_update', job);
  logger.info('City update job scheduled');
}

// ── Validation Job ───────────────────────────────────────────────
function scheduleValidation(): void {
  const job = cron.schedule(PIPELINE_SCHEDULES.validation.cron, async () => {
    logger.info('Running scheduled validation...');

    try {
      // Check for unacknowledged critical alerts
      const criticalAlerts = await prisma.alert.findMany({
        where: {
          severity: 'critical',
          acknowledged: false,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
          },
        },
      });

      if (criticalAlerts.length > 0) {
        await deliverWebhook('compliance_alert', {
          alertCount: criticalAlerts.length,
          alerts: criticalAlerts.map(a => ({
            id: a.id,
            type: a.type,
            title: a.title,
            message: a.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      // Reset monthly API usage if new month
      const now = new Date();
      if (now.getDate() === 1) {
        await prisma.apiKey.updateMany({
          data: { usedThisMonth: 0 },
        });
        logger.info('Monthly API usage reset');
      }

    } catch (err) {
      logger.error({ err }, 'Validation job failed');
    }
  }, {
    timezone: 'Europe/Moscow',
  });

  jobs.set('validation', job);
  logger.info('Validation job scheduled');
}

// ── Cleanup Job ──────────────────────────────────────────────────
function scheduleCleanup(): void {
  const job = cron.schedule('0 3 * * *', async () => { // Daily at 3am
    logger.info('Running cleanup...');

    try {
      // Clean old audit logs (keep 90 days)
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const result = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      logger.info({ deleted: result.count }, 'Old audit logs cleaned');

      // Clean old pipeline runs (keep 30 days)
      const pipelineCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const pipelineResult = await prisma.dataPipelineRun.deleteMany({
        where: { startedAt: { lt: pipelineCutoff } },
      });
      logger.info({ deleted: pipelineResult.count }, 'Old pipeline runs cleaned');

      // Clean acknowledged alerts (keep 7 days)
      const alertCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const alertResult = await prisma.alert.deleteMany({
        where: {
          acknowledged: true,
          createdAt: { lt: alertCutoff },
        },
      });
      logger.info({ deleted: alertResult.count }, 'Old alerts cleaned');

    } catch (err) {
      logger.error({ err }, 'Cleanup job failed');
    }
  }, {
    timezone: 'Europe/Moscow',
  });

  jobs.set('cleanup', job);
  logger.info('Cleanup job scheduled');
}

// ── Start All Jobs ───────────────────────────────────────────────

export function startScheduler(): void {
  logger.info('Starting scheduler...');

  scheduleCBRFetch();
  scheduleCityUpdate();
  scheduleValidation();
  scheduleCleanup();

  logger.info(`Scheduler started with ${jobs.size} jobs`);
}

// ── Stop All Jobs ────────────────────────────────────────────────

export function stopScheduler(): void {
  logger.info('Stopping scheduler...');

  jobs.forEach((job, name) => {
    job.stop();
    logger.info({ job: name }, 'Job stopped');
  });

  jobs.clear();
  logger.info('Scheduler stopped');
}

// ── Get Job Status ───────────────────────────────────────────────

export function getSchedulerStatus(): Record<string, any> {
  const status: Record<string, any> = {};

  jobs.forEach((job, name) => {
    status[name] = {
      running: job.getStatus() === 'scheduled',
      schedule: PIPELINE_SCHEDULES[name as keyof typeof PIPELINE_SCHEDULES]?.cron,
      description: PIPELINE_SCHEDULES[name as keyof typeof PIPELINE_SCHEDULES]?.description,
    };
  });

  return status;
}
