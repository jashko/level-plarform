import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../index.js';
import { AppError } from '../middleware/errors.js';

export const webhookRoutes = Router();

const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
});

// ── POST /api/webhooks — Create webhook ──────────────────────────
webhookRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateWebhookSchema.parse(req.body);
    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await prisma.webhook.create({
      data: {
        url: body.url,
        events: JSON.stringify(body.events),
        secret,
      },
    });

    res.status(201).json(webhook);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/webhooks — List webhooks ────────────────────────────
webhookRoutes.get('/', async (_req: Request, res: Response) => {
  const webhooks = await prisma.webhook.findMany({
    orderBy: { createdAt: 'desc' },
  });

  res.json(webhooks);
});

// ── DELETE /api/webhooks/:id — Delete webhook ────────────────────
webhookRoutes.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.webhook.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── POST /api/webhooks/:id/test — Test webhook ───────────────────
webhookRoutes.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhook = await prisma.webhook.findUnique({ where: { id: req.params.id } });
    if (!webhook) {
      throw new AppError(404, 'Webhook not found');
    }

    const payload = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery' },
    });

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex');

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': 'test',
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      await prisma.webhook.update({
        where: { id: webhook.id },
        data: {
          lastTriggered: new Date(),
          failureCount: response.ok ? 0 : { increment: 1 },
        },
      });

      res.json({
        success: response.ok,
        status: response.status,
        deliveredAt: new Date().toISOString(),
      });
    } catch (fetchErr) {
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { failureCount: { increment: 1 } },
      });

      res.json({
        success: false,
        error: (fetchErr as Error).message,
      });
    }
  } catch (err) {
    next(err);
  }
});

// ── Webhook Delivery Helper ──────────────────────────────────────
export async function deliverWebhook(event: string, data: any): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      active: true,
      events: { has: event },
    },
  });

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });

  for (const webhook of webhooks) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex');

    try {
      await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': event,
        },
        body: payload,
        signal: AbortSignal.timeout(10000),
      });

      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { lastTriggered: new Date(), failureCount: 0 },
      });
    } catch {
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { failureCount: { increment: 1 } },
      });
    }
  }
}
