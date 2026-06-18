import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export interface AuthRequest extends Request {
  userId?: string;
  apiKeyId?: string;
}

// ── JWT Authentication ───────────────────────────────────────────
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── API Key Authentication ───────────────────────────────────────
export async function apiKeyMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  // Allow JWT auth as well
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authMiddleware(req, res, next);
  }

  if (!apiKey) {
    res.status(401).json({ error: 'Missing API key. Provide via X-API-Key header or Bearer token.' });
    return;
  }

  try {
    const key = await prisma.apiKey.findUnique({ where: { key: apiKey } });

    if (!key || !key.active) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    if (key.expiresAt && key.expiresAt < new Date()) {
      res.status(401).json({ error: 'API key has expired' });
      return;
    }

    // Check rate limit
    if (key.usedThisMonth >= key.rateLimit) {
      res.status(429).json({
        error: 'Monthly rate limit exceeded',
        limit: key.rateLimit,
        used: key.usedThisMonth,
      });
      return;
    }

    // Increment usage
    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        usedThisMonth: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    req.apiKeyId = key.id;
    next();
  } catch (err) {
    next(err);
  }
}

// ── Role-based access (for admin routes) ─────────────────────────
export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    // For now, simple check — extend with user roles table later
    const adminToken = req.headers['x-admin-token'] as string;
    if (adminToken !== process.env.ADMIN_TOKEN) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
