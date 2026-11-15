import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, DATA_DIR } from './db.ts';

export const LEGACY_COOKIE_NAME = 'inkloom_token';

function resolveJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret !== 'REPLACE_WITH_SECURE_RANDOM_JWT_SECRET') {
    return envSecret;
  }

  if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
    console.warn(
      '[InkloomGuard AI] WARNING: JWT_SECRET environment variable is not configured. Sessions will invalidate on stateless restarts unless JWT_SECRET is set.'
    );
    return crypto.randomBytes(48).toString('hex');
  }

  const secretPath = path.resolve(DATA_DIR, '.jwt_secret');
  const dir = path.dirname(secretPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, 'utf-8').trim();
    if (stored.length >= 32) {
      return stored;
    }
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

const JWT_SECRET = resolveJwtSecret();
const JWT_ISSUER = 'inkloomguard-ai';

export interface AuthUser {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: '7d',
      issuer: JWT_ISSUER,
      jwtid: crypto.randomUUID(),
    }
  );
}

export function clearLegacyAuthCookie(res: Response): void {
  res.clearCookie(LEGACY_COOKIE_NAME, { path: '/' });
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const [scheme, token] = authHeader.split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token.trim();
}

export async function revokeTokenFromRequest(req: Request): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) return;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as {
      jti?: string;
      exp?: number;
    };
    if (decoded?.jti) {
      await db.run(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
        decoded.jti,
        decoded.exp ?? 0
      );
    }
  } catch {
    // Ignore expired or malformed token on logout
  }
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as {
      id?: number;
      companyId?: number;
      jti?: string;
    };

    if (!decoded || typeof decoded.id !== 'number' || typeof decoded.companyId !== 'number') {
      res.status(401).json({ error: 'Invalid authentication token payload.' });
      return;
    }

    if (decoded.jti) {
      const revoked = await db.get<{ jti: string }>('SELECT jti FROM revoked_tokens WHERE jti = ?', decoded.jti);
      if (revoked) {
        res.status(401).json({ error: 'Session has been signed out. Please sign in again.' });
        return;
      }
    }

    const row = await db.get<AuthUser>(
      `SELECT u.id, u.company_id AS "companyId", c.name AS "companyName", u.name, u.email, u.role
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.id = ? AND u.company_id = ?`,
      decoded.id,
      decoded.companyId
    );

    if (!row) {
      res.status(401).json({ error: 'User account or organization membership not found. Please sign in again.' });
      return;
    }

    req.user = {
      ...row,
      id: Number(row.id),
      companyId: Number(row.companyId),
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
      return;
    }
    res.status(401).json({ error: 'Invalid authentication token. Please sign in.' });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. Requires role: ${allowedRoles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

export async function registerAccount(params: {
  name: string;
  email: string;
  password: string;
  companyName: string;
  role?: string;
}): Promise<AuthUser> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const companyId = await db.insert('INSERT INTO companies (name) VALUES (?)', params.companyName.trim());
  const passwordHash = bcrypt.hashSync(params.password, 10);
  const role = params.role === 'author' ? 'author' : 'reviewer';

  const userId = await db.insert(
    'INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    companyId,
    params.name.trim(),
    cleanEmail,
    passwordHash,
    role
  );

  return {
    id: userId,
    companyId,
    companyName: params.companyName.trim(),
    name: params.name.trim(),
    email: cleanEmail,
    role,
  };
}

export async function createTeamMember(params: {
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  password: string;
  role: 'author' | 'reviewer';
}): Promise<AuthUser> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Please enter a valid email address.');
  }
  const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existing) {
    throw new Error('An account with this email already exists.');
  }

  const passwordHash = bcrypt.hashSync(params.password, 10);
  const role = params.role === 'author' ? 'author' : 'reviewer';

  const userId = await db.insert(
    'INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    params.companyId,
    params.name.trim(),
    cleanEmail,
    passwordHash,
    role
  );

  return {
    id: userId,
    companyId: params.companyId,
    companyName: params.companyName,
    name: params.name.trim(),
    email: cleanEmail,
    role,
  };
}

export async function authenticateAccount(email: string, password: string): Promise<AuthUser> {
  const cleanEmail = email.trim().toLowerCase();
  const row = await db.get<AuthUser & { password_hash: string }>(
    `SELECT u.id, u.company_id AS "companyId", c.name AS "companyName", u.name, u.email, u.role, u.password_hash
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE u.email = ?`,
    cleanEmail
  );

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    throw new Error('Invalid email or password.');
  }

  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    companyName: row.companyName,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}
