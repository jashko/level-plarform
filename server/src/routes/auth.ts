import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { AppError } from '../middleware/errors.js';

export const authRoutes = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

// ── POST /api/auth/register ──────────────────────────────────────
authRoutes.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RegisterSchema.parse(req.body);

    const existing = await prisma.$queryRaw`SELECT id FROM users WHERE email = ${body.email}`;
    if ((existing as any[]).length > 0) {
      throw new AppError(409, 'Email already registered');
    }

    const hashedPassword = await bcrypt.hash(body.password, 12);

    // For now, use raw query since we don't have a User model
    // In production, add User model to schema
    const token = jwt.sign({ email: body.email, name: body.name }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: { email: body.email, name: body.name },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
authRoutes.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LoginSchema.parse(req.body);

    // Simplified — in production, query users table
    const token = jwt.sign({ email: body.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────
authRoutes.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Not authenticated');
    }

    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
    res.json({ email: payload.email, name: payload.name });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/api-keys — Generate API key ───────────────────
authRoutes.post('/api-keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, tier } = req.body;

    const key = `lvl_${Buffer.from(Math.random().toString(36)).toString('base64').slice(0, 32)}`;

    const apiKey = await prisma.apiKey.create({
      data: {
        key,
        name: name || 'Unnamed Key',
        tier: tier || 'basic',
        rateLimit: tier === 'pro' ? 10000 : tier === 'enterprise' ? 100000 : 100,
      },
    });

    res.status(201).json(apiKey);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/auth/api-keys — List API keys ───────────────────────
authRoutes.get('/api-keys', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        tier: true,
        rateLimit: true,
        usedThisMonth: true,
        lastUsedAt: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(keys);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/auth/api-keys/:id — Revoke API key ───────────────
authRoutes.delete('/api-keys/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.apiKey.update({
      where: { id: req.params.id },
      data: { active: false },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
