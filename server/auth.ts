import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  db,
  DATA_DIR,
  isProductionEnvironment,
  getDemoOrganizationName,
  getDemoUserEmail,
  isDemoLoginEnabled,
} from './db.ts';
import { getPasswordValidationError } from '../src/utils/password.ts';

export const LEGACY_COOKIE_NAME = 'inkloom_token';
export const PASSWORD_RESET_EXPIRY_MINUTES = 30;
export const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
const MIN_JWT_SECRET_LENGTH = 32;

export class AuthenticationError extends Error {
  statusCode = 401;
  constructor(message = 'Invalid email or password.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class DemoAccountUnavailableError extends Error {
  statusCode = 503;
  code = 'DEMO_ACCOUNT_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'DemoAccountUnavailableError';
  }
}

export type UserRole = 'reviewer' | 'author' | 'admin';
export const VALID_USER_ROLES = new Set<UserRole>(['reviewer', 'author', 'admin']);

export class AuthValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AuthValidationError';
    this.statusCode = statusCode;
  }
}

export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const envSecret = env.JWT_SECRET?.trim();
  const isProd = env.NODE_ENV === 'production' || env.RENDER === 'true' || isProductionEnvironment();

  if (envSecret) {
    if (envSecret === 'REPLACE_WITH_SECURE_RANDOM_JWT_SECRET' || envSecret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be a random secret of at least ${MIN_JWT_SECRET_LENGTH} characters (not the placeholder value).`
      );
    }
    return envSecret;
  }

  if (isProd) {
    throw new Error(
      `JWT_SECRET environment variable must be configured in production (at least ${MIN_JWT_SECRET_LENGTH} random characters). Refusing to start with an insecure or ephemeral signing key.`
    );
  }

  const secretPath = path.resolve(DATA_DIR, '.jwt_secret');
  const dir = path.dirname(secretPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, 'utf-8').trim();
    if (stored.length >= MIN_JWT_SECRET_LENGTH) {
      return stored;
    }
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

const JWT_SECRET = resolveJwtSecret();
const JWT_ISSUER = 'inkloomguard-ai';

export type DefaultLandingPage =
  | 'dashboard'
  | 'guidelines'
  | 'submit'
  | 'analysis'
  | 'corrections'
  | 'review'
  | 'history';

export interface UserPreferences {
  emailNotifications: boolean;
  reviewNotifications: boolean;
  complianceAnalysisNotifications: boolean;
  productAccountNotifications: boolean;
  defaultPage: DefaultLandingPage;
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark';
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  emailNotifications: true,
  reviewNotifications: true,
  complianceAnalysisNotifications: true,
  productAccountNotifications: true,
  defaultPage: 'dashboard',
  sidebarCollapsed: false,
  theme: 'light',
};

const VALID_DEFAULT_PAGES = new Set<DefaultLandingPage>([
  'dashboard',
  'guidelines',
  'submit',
  'analysis',
  'corrections',
  'review',
  'history',
]);

const FORBIDDEN_PREFERENCE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'jwt',
  'secret',
  'apiKey',
  'api_key',
  'role',
  'companyId',
  'company_id',
  'userId',
  'user_id',
]);

const ALLOWED_PREFERENCE_KEYS = new Set([
  'emailNotifications',
  'reviewNotifications',
  'complianceAnalysisNotifications',
  'productAccountNotifications',
  'defaultPage',
  'sidebarCollapsed',
  'theme',
]);

export function parseUserPreferences(raw: unknown): UserPreferences {
  let parsed: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const candidate = JSON.parse(raw);
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>;
  }

  const defaultPageCandidate = String(parsed.defaultPage || '').trim() as DefaultLandingPage;
  const themeCandidate = parsed.theme === 'dark' ? 'dark' : 'light';

  return {
    emailNotifications:
      typeof parsed.emailNotifications === 'boolean'
        ? parsed.emailNotifications
        : DEFAULT_USER_PREFERENCES.emailNotifications,
    reviewNotifications:
      typeof parsed.reviewNotifications === 'boolean'
        ? parsed.reviewNotifications
        : DEFAULT_USER_PREFERENCES.reviewNotifications,
    complianceAnalysisNotifications:
      typeof parsed.complianceAnalysisNotifications === 'boolean'
        ? parsed.complianceAnalysisNotifications
        : DEFAULT_USER_PREFERENCES.complianceAnalysisNotifications,
    productAccountNotifications:
      typeof parsed.productAccountNotifications === 'boolean'
        ? parsed.productAccountNotifications
        : DEFAULT_USER_PREFERENCES.productAccountNotifications,
    defaultPage: VALID_DEFAULT_PAGES.has(defaultPageCandidate)
      ? defaultPageCandidate
      : DEFAULT_USER_PREFERENCES.defaultPage,
    sidebarCollapsed:
      typeof parsed.sidebarCollapsed === 'boolean'
        ? parsed.sidebarCollapsed
        : DEFAULT_USER_PREFERENCES.sidebarCollapsed,
    theme: parsed.theme === 'light' || parsed.theme === 'dark' ? themeCandidate : DEFAULT_USER_PREFERENCES.theme,
  };
}

export function validateAndMergePreferencesUpdate(
  current: UserPreferences,
  patch: unknown,
  userRole: string
): UserPreferences {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AuthValidationError('Preferences payload must be a JSON object.');
  }

  const record = patch as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_PREFERENCE_KEYS.has(key) || !ALLOWED_PREFERENCE_KEYS.has(key)) {
      throw new AuthValidationError(`Unsupported or disallowed preference key: "${key}".`);
    }
  }

  const next: UserPreferences = { ...current };

  const boolKeys = [
    'emailNotifications',
    'reviewNotifications',
    'complianceAnalysisNotifications',
    'productAccountNotifications',
    'sidebarCollapsed',
  ] as const;

  for (const key of boolKeys) {
    if (key in record) {
      if (typeof record[key] !== 'boolean') {
        throw new AuthValidationError(`Preference "${key}" must be a boolean.`);
      }
      next[key] = record[key] as boolean;
    }
  }

  if ('defaultPage' in record) {
    const val = String(record.defaultPage || '').trim() as DefaultLandingPage;
    if (!VALID_DEFAULT_PAGES.has(val)) {
      throw new AuthValidationError('Invalid default workspace page preference.');
    }
    if (val === 'review' && userRole !== 'reviewer' && userRole !== 'admin') {
      throw new AuthValidationError('Review & Approval cannot be set as default landing page for your role.');
    }
    next.defaultPage = val;
  }

  if ('theme' in record) {
    if (record.theme !== 'light' && record.theme !== 'dark') {
      throw new AuthValidationError('Theme preference must be either "light" or "dark".');
    }
    next.theme = record.theme;
  }

  return next;
}

export interface AuthUser {
  id: number;
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  role: string;
  avatarFilename: string | null;
  avatarOriginalName: string | null;
  jobTitle: string;
  bio: string;
  preferences: UserPreferences;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  verificationRequired: boolean;
  passwordUpdatedAt: string | null;
  createdAt: string | null;
  tokenVersion: number;
}

interface RawUserRow {
  id: number | string;
  companyId: number | string;
  companyName: string;
  name: string;
  email: string;
  role: string;
  avatarFilename: string | null;
  avatarOriginalName: string | null;
  jobTitle: string | null;
  bio: string | null;
  preferencesJson: string | null;
  emailVerified: unknown;
  emailVerifiedAt: string | Date | null;
  verificationRequired: unknown;
  passwordUpdatedAt: string | Date | null;
  createdAt: string | Date | null;
  tokenVersion: number | string | null;
}

function toBoolean(val: unknown): boolean {
  return val === true || val === 1 || val === '1' || val === 'true' || val === 't';
}

function toIsoOrNull(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const s = String(val).trim();
  return s || null;
}

function dbBool(val: boolean): boolean | number {
  return db.engine === 'postgres' ? val : val ? 1 : 0;
}

function mapAuthUserRow(row: RawUserRow): AuthUser {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    companyName: row.companyName,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarFilename: row.avatarFilename ?? null,
    avatarOriginalName: row.avatarOriginalName ?? null,
    jobTitle: String(row.jobTitle ?? ''),
    bio: String(row.bio ?? ''),
    preferences: parseUserPreferences(row.preferencesJson),
    emailVerified: toBoolean(row.emailVerified),
    emailVerifiedAt: toIsoOrNull(row.emailVerifiedAt),
    verificationRequired: toBoolean(row.verificationRequired),
    passwordUpdatedAt: toIsoOrNull(row.passwordUpdatedAt),
    createdAt: toIsoOrNull(row.createdAt),
    tokenVersion: Number(row.tokenVersion ?? 1),
  };
}

const AUTH_USER_SELECT = `
  SELECT
    u.id,
    u.company_id AS "companyId",
    c.name AS "companyName",
    u.name,
    u.email,
    u.role,
    u.avatar_filename AS "avatarFilename",
    u.avatar_original_name AS "avatarOriginalName",
    u.job_title AS "jobTitle",
    u.bio AS "bio",
    u.preferences_json AS "preferencesJson",
    u.email_verified AS "emailVerified",
    u.email_verified_at AS "emailVerifiedAt",
    u.verification_required AS "verificationRequired",
    u.password_updated_at AS "passwordUpdatedAt",
    u.created_at AS "createdAt",
    u.token_version AS "tokenVersion"
  FROM users u
  JOIN companies c ON c.id = u.company_id
`;

export interface AuthedRequest extends Request {
  user?: AuthUser;
  authJti?: string;
  authExp?: number;
}

export function generateRawSecurityToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSecurityToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

export function constantTimeTokenHashMatches(rawToken: string, storedHexHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(rawToken) || !/^[a-f0-9]{64}$/i.test(storedHexHash)) {
    return false;
  }
  const computed = Buffer.from(hashSecurityToken(rawToken), 'hex');
  const stored = Buffer.from(storedHexHash, 'hex');
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 1,
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',
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
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      algorithms: ['HS256'],
    }) as {
      jti?: string;
      exp?: number;
    };
    if (decoded?.jti) {
      const nowIso = new Date().toISOString();
      await db.run(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
        decoded.jti,
        decoded.exp ?? 0
      );
      await db.run(
        'UPDATE user_sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL',
        nowIso,
        decoded.jti
      );
    }
  } catch {
    // Ignore expired or malformed token on logout
  }
}

export interface UserSessionView {
  id: number;
  isCurrent: boolean;
  deviceSummary: string;
  browser: string;
  os: string;
  ipAddress: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
}

export function parseUserAgentSummary(userAgentRaw: string): {
  deviceSummary: string;
  browser: string;
  os: string;
} {
  const ua = String(userAgentRaw || '').trim();
  if (!ua) {
    return { deviceSummary: 'Web Session', browser: 'Unknown Browser', os: 'Unknown OS' };
  }

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/node|undici/i.test(ua)) browser = 'API Client';

  let os = 'Desktop';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return {
    deviceSummary: `${browser} on ${os}`,
    browser,
    os,
  };
}

function sanitizeIpAddress(ipRaw?: string): string {
  const clean = String(ipRaw || '').replace(/^::ffff:/, '').trim();
  return clean.slice(0, 64);
}

export async function recordUserSession(params: {
  userId: number;
  companyId: number;
  token: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<void> {
  const decoded = jwt.decode(params.token) as {
    jti?: string;
    exp?: number;
    tokenVersion?: number;
  } | null;
  if (!decoded?.jti) return;

  const nowIso = new Date().toISOString();
  const expiresAt = typeof decoded.exp === 'number' ? decoded.exp : Math.floor(Date.now() / 1000) + 7 * 86400;
  const ua = String(params.userAgent || '').trim().slice(0, 256);
  const ip = sanitizeIpAddress(params.ipAddress);

  await db.run(
    `INSERT INTO user_sessions (
      user_id, company_id, jti, token_version, user_agent, ip_address, created_at, last_seen_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (jti) DO NOTHING`,
    params.userId,
    params.companyId,
    decoded.jti,
    Number(decoded.tokenVersion ?? 1),
    ua,
    ip,
    nowIso,
    nowIso,
    expiresAt
  );
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  let decoded: {
    id?: number;
    companyId?: number;
    jti?: string;
    exp?: number;
    tokenVersion?: number;
  };
  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      algorithms: ['HS256'],
    }) as typeof decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
      return;
    }
    res.status(401).json({ error: 'Invalid authentication token. Please sign in.' });
    return;
  }

  try {
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
      const trackedSession = await db.get<{ revoked_at: string | Date | null; last_seen_at: string | Date | null }>(
        'SELECT revoked_at, last_seen_at FROM user_sessions WHERE jti = ? AND user_id = ? AND company_id = ?',
        decoded.jti,
        decoded.id,
        decoded.companyId
      );
      if (trackedSession?.revoked_at) {
        res.status(401).json({ error: 'Session has been signed out. Please sign in again.' });
        return;
      }
      if (trackedSession) {
        const lastSeenMs = trackedSession.last_seen_at ? new Date(trackedSession.last_seen_at).getTime() : 0;
        if (!lastSeenMs || Date.now() - lastSeenMs > 60_000) {
          await db.run(
            'UPDATE user_sessions SET last_seen_at = ? WHERE jti = ? AND revoked_at IS NULL',
            new Date().toISOString(),
            decoded.jti
          ).catch(() => {});
        }
      }
    }

    const row = await db.get<RawUserRow>(
      `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
      decoded.id,
      decoded.companyId
    );

    if (!row) {
      res.status(401).json({ error: 'User account or organization membership not found. Please sign in again.' });
      return;
    }

    const mapped = mapAuthUserRow(row);
    const tokenHasVersion = typeof decoded.tokenVersion === 'number';
    if (
      (tokenHasVersion && decoded.tokenVersion !== mapped.tokenVersion) ||
      (!tokenHasVersion && mapped.tokenVersion > 1)
    ) {
      res.status(401).json({ error: 'Your session has been invalidated. Please sign in again.' });
      return;
    }

    req.user = mapped;
    req.authJti = decoded.jti;
    req.authExp = decoded.exp;
    next();
  } catch (err) {
    next(err);
  }
}

export async function tryAuthenticateRequest(req: Request): Promise<AuthUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      algorithms: ['HS256'],
    }) as {
      id?: number;
      companyId?: number;
      jti?: string;
      tokenVersion?: number;
    };
    if (!decoded || typeof decoded.id !== 'number' || typeof decoded.companyId !== 'number') {
      return null;
    }
    if (decoded.jti) {
      const revoked = await db.get<{ jti: string }>('SELECT jti FROM revoked_tokens WHERE jti = ?', decoded.jti);
      if (revoked) return null;
      const trackedSession = await db.get<{ revoked_at: string | Date | null }>(
        'SELECT revoked_at FROM user_sessions WHERE jti = ? AND user_id = ? AND company_id = ?',
        decoded.jti,
        decoded.id,
        decoded.companyId
      );
      if (trackedSession?.revoked_at) return null;
    }
    const row = await db.get<RawUserRow>(
      `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
      decoded.id,
      decoded.companyId
    );
    if (!row) return null;
    const mapped = mapAuthUserRow(row);
    const tokenHasVersion = typeof decoded.tokenVersion === 'number';
    if (
      (tokenHasVersion && decoded.tokenVersion !== mapped.tokenVersion) ||
      (!tokenHasVersion && mapped.tokenVersion > 1)
    ) {
      return null;
    }
    return mapped;
  } catch {
    return null;
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

export function requireVerifiedEmail(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  if (req.user.verificationRequired && !req.user.emailVerified) {
    res.status(403).json({
      error:
        'Email verification is required before using workspace features. Please verify your email or request a new link from Settings.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
    });
    return;
  }
  next();
}

export async function registerAccount(params: {
  name: string;
  email: string;
  password: string;
  companyName: string;
  role?: string;
}): Promise<AuthUser> {
  const cleanName = String(params.name || '').trim();
  const cleanCompany = String(params.companyName || '').trim();
  const cleanEmail = String(params.email || '').trim().toLowerCase();

  if (!cleanName || cleanName.length > 120) {
    throw new AuthValidationError('Please enter a valid full name (1–120 characters).');
  }
  if (!cleanCompany || cleanCompany.length > 120) {
    throw new AuthValidationError('Please enter a valid company name (1–120 characters).');
  }
  if (!cleanEmail || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthValidationError('Please enter a valid email address.');
  }
  const passwordError = getPasswordValidationError(params.password);
  if (passwordError) {
    throw new AuthValidationError(passwordError);
  }

  const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existing) {
    throw new AuthValidationError('An account with this email already exists.');
  }

  const requestedRole = params.role === undefined ? 'reviewer' : String(params.role).trim().toLowerCase();
  if (requestedRole === 'admin') {
    throw new AuthValidationError('Admin role cannot be self-assigned during public registration.', 403);
  }
  if (requestedRole !== 'author' && requestedRole !== 'reviewer') {
    throw new AuthValidationError('Registration role must be either "author" or "reviewer".', 400);
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const role: 'author' | 'reviewer' = requestedRole;

  const { companyId, userId } = await db.transaction(async (tx) => {
    const cid = await tx.insert('INSERT INTO companies (name) VALUES (?)', cleanCompany);
    const uid = await tx.insert(
      `INSERT INTO users (
        company_id, name, email, password_hash, role,
        email_verified, verification_required, token_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      cid,
      cleanName,
      cleanEmail,
      passwordHash,
      role,
      dbBool(false),
      dbBool(true),
      1
    );
    return { companyId: cid, userId: uid };
  });

  return {
    id: userId,
    companyId,
    companyName: cleanCompany,
    name: cleanName,
    email: cleanEmail,
    role,
    avatarFilename: null,
    avatarOriginalName: null,
    jobTitle: '',
    bio: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    emailVerified: false,
    emailVerifiedAt: null,
    verificationRequired: true,
    passwordUpdatedAt: null,
    createdAt: new Date().toISOString(),
    tokenVersion: 1,
  };
}

export async function createTeamMember(params: {
  companyId: number;
  companyName: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<AuthUser> {
  const cleanName = String(params.name || '').trim();
  const cleanEmail = String(params.email || '').trim().toLowerCase();
  if (!cleanName || cleanName.length > 120) {
    throw new AuthValidationError('Please enter a valid team member name (1–120 characters).');
  }
  if (!cleanEmail || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthValidationError('Please enter a valid email address.');
  }
  const passwordError = getPasswordValidationError(params.password);
  if (passwordError) {
    throw new AuthValidationError(passwordError);
  }
  const normalizedRole = String(params.role || '').trim().toLowerCase() as UserRole;
  if (!VALID_USER_ROLES.has(normalizedRole)) {
    throw new AuthValidationError('Team member role must be "author", "reviewer", or "admin".');
  }
  const existing = await db.get<{ id: number }>('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existing) {
    throw new AuthValidationError('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const role: UserRole = normalizedRole;

  const userId = await db.insert(
    `INSERT INTO users (
      company_id, name, email, password_hash, role,
      email_verified, verification_required, token_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params.companyId,
    cleanName,
    cleanEmail,
    passwordHash,
    role,
    dbBool(false),
    dbBool(false),
    1
  );

  return {
    id: userId,
    companyId: params.companyId,
    companyName: params.companyName,
    name: cleanName,
    email: cleanEmail,
    role,
    avatarFilename: null,
    avatarOriginalName: null,
    jobTitle: '',
    bio: '',
    preferences: { ...DEFAULT_USER_PREFERENCES },
    emailVerified: false,
    emailVerifiedAt: null,
    verificationRequired: false,
    passwordUpdatedAt: null,
    createdAt: new Date().toISOString(),
    tokenVersion: 1,
  };
}

export async function authenticateAccount(email: string, password: string): Promise<AuthUser> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !password) {
    throw new AuthenticationError('Invalid email or password.');
  }
  const row = await db.get<RawUserRow & { password_hash: string }>(
    `SELECT
       u.id,
       u.company_id AS "companyId",
       c.name AS "companyName",
       u.name,
       u.email,
       u.role,
       u.avatar_filename AS "avatarFilename",
       u.avatar_original_name AS "avatarOriginalName",
       u.job_title AS "jobTitle",
       u.bio AS "bio",
       u.preferences_json AS "preferencesJson",
       u.email_verified AS "emailVerified",
       u.email_verified_at AS "emailVerifiedAt",
       u.verification_required AS "verificationRequired",
       u.password_updated_at AS "passwordUpdatedAt",
       u.created_at AS "createdAt",
       u.token_version AS "tokenVersion",
       u.password_hash
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE u.email = ?`,
    cleanEmail
  );

  if (!row) {
    throw new AuthenticationError('Invalid email or password.');
  }

  const matches = await bcrypt.compare(password, row.password_hash);
  if (!matches) {
    throw new AuthenticationError('Invalid email or password.');
  }

  return mapAuthUserRow(row);
}

export interface DemoWorkspaceAvailability {
  available: boolean;
  status: 'available' | 'disabled' | 'missing_account';
  organizationName: string;
  message?: string;
}

export async function getDemoWorkspaceAvailability(): Promise<DemoWorkspaceAvailability> {
  const organizationName = getDemoOrganizationName();
  if (!isDemoLoginEnabled()) {
    return {
      available: false,
      status: 'disabled',
      organizationName,
      message:
        'Pre-seeded organization sign-in is disabled in this environment. Please sign in with your work email and password or create a new workspace.',
    };
  }

  const demoEmail = getDemoUserEmail();
  const row = await db.get<{ companyName: string }>(
    `SELECT c.name AS "companyName"
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE LOWER(u.email) = LOWER(?) AND LOWER(c.name) = LOWER(?)
     LIMIT 1`,
    demoEmail,
    organizationName
  );

  if (!row) {
    return {
      available: false,
      status: 'missing_account',
      organizationName,
      message: `Pre-seeded organization (${organizationName}) is not currently provisioned in this environment. Please sign in with your work email and password or create a new workspace.`,
    };
  }

  return {
    available: true,
    status: 'available',
    organizationName: row.companyName,
  };
}

export async function authenticateDemoAccount(): Promise<AuthUser> {
  const organizationName = getDemoOrganizationName();
  const demoEmail = getDemoUserEmail();

  const row = await db.get<RawUserRow & { password_hash: string }>(
    `SELECT
       u.id,
       u.company_id AS "companyId",
       c.name AS "companyName",
       u.name,
       u.email,
       u.role,
       u.avatar_filename AS "avatarFilename",
       u.avatar_original_name AS "avatarOriginalName",
       u.job_title AS "jobTitle",
       u.bio AS "bio",
       u.preferences_json AS "preferencesJson",
       u.email_verified AS "emailVerified",
       u.email_verified_at AS "emailVerifiedAt",
       u.verification_required AS "verificationRequired",
       u.password_updated_at AS "passwordUpdatedAt",
       u.created_at AS "createdAt",
       u.token_version AS "tokenVersion",
       u.password_hash
     FROM users u
     JOIN companies c ON c.id = u.company_id
     WHERE LOWER(u.email) = LOWER(?) AND LOWER(c.name) = LOWER(?)
     LIMIT 1`,
    demoEmail,
    organizationName
  );

  if (!row) {
    throw new DemoAccountUnavailableError(
      `Pre-seeded organization (${organizationName}) is not provisioned in this environment. Please sign in with your work email and password.`
    );
  }

  const configuredPassword = process.env.DEMO_USER_PASSWORD?.trim();
  if (configuredPassword) {
    const matches = await bcrypt.compare(configuredPassword, row.password_hash);
    if (!matches) {
      throw new AuthenticationError('Demo organization sign-in is temporarily unavailable.');
    }
  }

  return mapAuthUserRow(row);
}

export async function createPasswordResetToken(
  email: string,
  requestedIp = ''
): Promise<{ user: AuthUser; rawToken: string; expiresMinutes: number } | null> {
  const cleanEmail = email.trim().toLowerCase();
  const row = await db.get<RawUserRow>(`${AUTH_USER_SELECT} WHERE u.email = ?`, cleanEmail);
  if (!row) {
    return null;
  }

  const user = mapAuthUserRow(row);
  const rawToken = generateRawSecurityToken();
  const tokenHash = hashSecurityToken(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      user.id,
      user.companyId
    );
    await tx.insert(
      `INSERT INTO password_reset_tokens (user_id, company_id, token_hash, expires_at, requested_ip)
       VALUES (?, ?, ?, ?, ?)`,
      user.id,
      user.companyId,
      tokenHash,
      expiresAtIso,
      requestedIp.slice(0, 128)
    );
  });

  return {
    user,
    rawToken,
    expiresMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
  };
}

export async function inspectPasswordResetToken(
  rawToken: string
): Promise<
  | { valid: true; userId: number; companyId: number }
  | { valid: false; reason: 'invalid' | 'used' | 'expired'; error: string }
> {
  const token = String(rawToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { valid: false, reason: 'invalid', error: 'This password reset link is invalid.' };
  }

  const tokenHash = hashSecurityToken(token);
  const row = await db.get<{
    id: number;
    user_id: number;
    company_id: number;
    user_company_id: number;
    token_hash: string;
    expires_at: string | Date;
    used_at: string | Date | null;
  }>(
    `SELECT prt.id, prt.user_id, prt.company_id, u.company_id AS user_company_id,
            prt.token_hash, prt.expires_at, prt.used_at
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id AND u.company_id = prt.company_id
     WHERE prt.token_hash = ?`,
    tokenHash
  );

  if (
    !row ||
    !constantTimeTokenHashMatches(token, row.token_hash) ||
    Number(row.company_id) !== Number(row.user_company_id)
  ) {
    return { valid: false, reason: 'invalid', error: 'This password reset link is invalid.' };
  }

  if (row.used_at) {
    return {
      valid: false,
      reason: 'used',
      error: 'This password reset link has already been used. Please request a new one.',
    };
  }

  const expiresMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
    return {
      valid: false,
      reason: 'expired',
      error: 'This password reset link has expired. Please request a new password reset.',
    };
  }

  return { valid: true, userId: Number(row.user_id), companyId: Number(row.company_id) };
}

export async function resetPasswordWithToken(params: {
  rawToken: string;
  newPassword: string;
}): Promise<{ user: AuthUser; changedAtIso: string }> {
  const token = String(params.rawToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('This password reset link is invalid.');
  }

  const passwordError = getPasswordValidationError(params.newPassword);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const tokenHash = hashSecurityToken(token);
  const nowIso = new Date().toISOString();

  const { updatedUserId, updatedCompanyId } = await db.transaction(async (tx) => {
    const row = await tx.get<{
      id: number;
      user_id: number;
      company_id: number;
      user_company_id: number;
      token_hash: string;
      expires_at: string | Date;
      used_at: string | Date | null;
    }>(
      `SELECT prt.id, prt.user_id, prt.company_id, u.company_id AS user_company_id,
              prt.token_hash, prt.expires_at, prt.used_at
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id AND u.company_id = prt.company_id
       WHERE prt.token_hash = ?`,
      tokenHash
    );

    if (
      !row ||
      !constantTimeTokenHashMatches(token, row.token_hash) ||
      Number(row.company_id) !== Number(row.user_company_id)
    ) {
      throw new Error('This password reset link is invalid.');
    }
    if (row.used_at) {
      throw new Error('This password reset link has already been used. Please request a new one.');
    }
    const expiresMs = new Date(row.expires_at).getTime();
    if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
      throw new Error('This password reset link has expired. Please request a new password reset.');
    }

    const markResult = await tx.run(
      'UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      row.id,
      row.user_id,
      row.company_id
    );
    if (markResult.changes !== 1) {
      throw new Error('This password reset link has already been used.');
    }

    // Invalidate any other outstanding password reset tokens for this user
    await tx.run(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      row.user_id,
      row.company_id
    );

    const passwordHash = await bcrypt.hash(params.newPassword, 10);
    const userUpdateResult = await tx.run(
      `UPDATE users
       SET password_hash = ?,
           token_version = token_version + 1,
           password_updated_at = ?,
           updated_at = ?
       WHERE id = ? AND company_id = ?`,
      passwordHash,
      nowIso,
      nowIso,
      row.user_id,
      row.company_id
    );
    if (userUpdateResult.changes !== 1) {
      throw new Error('Account ownership verification failed.');
    }

    return {
      updatedUserId: Number(row.user_id),
      updatedCompanyId: Number(row.company_id),
    };
  });

  const userRow = await db.get<RawUserRow>(
    `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
    updatedUserId,
    updatedCompanyId
  );
  if (!userRow) {
    throw new Error('Account not found.');
  }

  return { user: mapAuthUserRow(userRow), changedAtIso: nowIso };
}

export async function createEmailVerificationToken(
  userId: number,
  companyId: number
): Promise<{ rawToken: string; expiresHours: number }> {
  const ownerCheck = await db.get<{ id: number }>(
    'SELECT id FROM users WHERE id = ? AND company_id = ?',
    userId,
    companyId
  );
  if (!ownerCheck) {
    throw new Error('User account does not belong to the specified organization.');
  }

  const rawToken = generateRawSecurityToken();
  const tokenHash = hashSecurityToken(rawToken);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      userId,
      companyId
    );
    await tx.insert(
      `INSERT INTO email_verification_tokens (user_id, company_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      userId,
      companyId,
      tokenHash,
      expiresAtIso
    );
  });

  return { rawToken, expiresHours: EMAIL_VERIFICATION_EXPIRY_HOURS };
}

export async function findUserByEmailForAuth(email: string): Promise<AuthUser | null> {
  const cleanEmail = email.trim().toLowerCase();
  const row = await db.get<RawUserRow>(`${AUTH_USER_SELECT} WHERE u.email = ?`, cleanEmail);
  return row ? mapAuthUserRow(row) : null;
}

export async function findUserByIdForAuth(userId: number, companyId: number): Promise<AuthUser | null> {
  const row = await db.get<RawUserRow>(
    `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
    userId,
    companyId
  );
  return row ? mapAuthUserRow(row) : null;
}

export async function verifyEmailWithToken(rawToken: string): Promise<
  | { verified: true; user: AuthUser }
  | { verified: false; reason: 'invalid' | 'used' | 'expired' | 'already_verified'; error: string }
> {
  const token = String(rawToken || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return { verified: false, reason: 'invalid', error: 'This verification link is invalid.' };
  }

  const tokenHash = hashSecurityToken(token);
  const nowIso = new Date().toISOString();

  const outcome = await db.transaction(async (tx) => {
    const row = await tx.get<{
      id: number;
      user_id: number;
      company_id: number;
      user_company_id: number;
      token_hash: string;
      expires_at: string | Date;
      used_at: string | Date | null;
      email_verified: unknown;
    }>(
      `SELECT evt.id, evt.user_id, evt.company_id, u.company_id AS user_company_id,
              evt.token_hash, evt.expires_at, evt.used_at, u.email_verified
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id AND u.company_id = evt.company_id
       WHERE evt.token_hash = ?`,
      tokenHash
    );

    if (
      !row ||
      !constantTimeTokenHashMatches(token, row.token_hash) ||
      Number(row.company_id) !== Number(row.user_company_id)
    ) {
      return { verified: false as const, reason: 'invalid' as const, error: 'This verification link is invalid.' };
    }

    if (toBoolean(row.email_verified)) {
      return {
        verified: false as const,
        reason: 'already_verified' as const,
        error: 'This email address has already been verified.',
      };
    }

    if (row.used_at) {
      return {
        verified: false as const,
        reason: 'used' as const,
        error: 'This verification link has already been used. Request a new verification email if needed.',
      };
    }

    const expiresMs = new Date(row.expires_at).getTime();
    if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
      return {
        verified: false as const,
        reason: 'expired' as const,
        error: 'This verification link has expired. Please request a new verification email.',
      };
    }

    const markResult = await tx.run(
      'UPDATE email_verification_tokens SET used_at = ? WHERE id = ? AND user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      row.id,
      row.user_id,
      row.company_id
    );
    if (markResult.changes !== 1) {
      return {
        verified: false as const,
        reason: 'used' as const,
        error: 'This verification link has already been used.',
      };
    }

    // Mark any other pending verification tokens for this user as used
    await tx.run(
      'UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      row.user_id,
      row.company_id
    );

    const userUpdateResult = await tx.run(
      'UPDATE users SET email_verified = ?, email_verified_at = ?, updated_at = ? WHERE id = ? AND company_id = ?',
      dbBool(true),
      nowIso,
      nowIso,
      row.user_id,
      row.company_id
    );
    if (userUpdateResult.changes !== 1) {
      return {
        verified: false as const,
        reason: 'invalid' as const,
        error: 'Account ownership verification failed.',
      };
    }

    return { verified: true as const, userId: Number(row.user_id), companyId: Number(row.company_id) };
  });

  if (!outcome.verified) {
    return outcome;
  }

  const userRow = await db.get<RawUserRow>(
    `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
    outcome.userId,
    outcome.companyId
  );
  if (!userRow) {
    return { verified: false, reason: 'invalid', error: 'User account not found.' };
  }

  return { verified: true, user: mapAuthUserRow(userRow) };
}

export async function changeUserPassword(params: {
  userId: number;
  companyId: number;
  currentPassword: string;
  newPassword: string;
  currentJti?: string;
  currentExp?: number;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ user: AuthUser; token: string; changedAtIso: string }> {
  const row = await db.get<{ id: number; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE id = ? AND company_id = ?',
    params.userId,
    params.companyId
  );

  if (!row) {
    throw new Error('User account not found.');
  }

  if (!(await bcrypt.compare(params.currentPassword, row.password_hash))) {
    const err = new Error('Current password is incorrect.');
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  if (await bcrypt.compare(params.newPassword, row.password_hash)) {
    const err = new Error('New password must be different from your current password.');
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const passwordError = getPasswordValidationError(params.newPassword);
  if (passwordError) {
    const err = new Error(passwordError);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  const newHash = await bcrypt.hash(params.newPassword, 10);

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE users
       SET password_hash = ?,
           token_version = token_version + 1,
           password_updated_at = ?,
           updated_at = ?
       WHERE id = ? AND company_id = ?`,
      newHash,
      nowIso,
      nowIso,
      params.userId,
      params.companyId
    );

    await tx.run(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND company_id = ? AND used_at IS NULL',
      nowIso,
      params.userId,
      params.companyId
    );

    await tx.run(
      'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL',
      nowIso,
      params.userId,
      params.companyId
    );

    if (params.currentJti) {
      await tx.run(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
        params.currentJti,
        params.currentExp ?? 0
      );
    }
  });

  const updatedRow = await db.get<RawUserRow>(
    `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
    params.userId,
    params.companyId
  );
  if (!updatedRow) {
    throw new Error('Updated account could not be loaded.');
  }

  const updatedUser = mapAuthUserRow(updatedRow);
  const token = signToken(updatedUser);
  await recordUserSession({
    userId: updatedUser.id,
    companyId: updatedUser.companyId,
    token,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return { user: updatedUser, token, changedAtIso: nowIso };
}

export async function invalidateAllUserSessions(
  userId: number,
  companyId: number,
  currentJti?: string,
  currentExp?: number
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ? AND company_id = ?',
      nowIso,
      userId,
      companyId
    );
    await tx.run(
      'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL',
      nowIso,
      userId,
      companyId
    );
    if (currentJti) {
      await tx.run(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
        currentJti,
        currentExp ?? 0
      );
    }
  });
}

export async function listActiveUserSessions(params: {
  userId: number;
  companyId: number;
  tokenVersion: number;
  currentJti?: string;
  currentExp?: number;
  userAgent?: string;
  ipAddress?: string;
}): Promise<UserSessionView[]> {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();

  if (params.currentJti) {
    const existingCurrent = await db.get<{ id: number }>(
      'SELECT id FROM user_sessions WHERE jti = ? AND user_id = ? AND company_id = ?',
      params.currentJti,
      params.userId,
      params.companyId
    );
    if (!existingCurrent) {
      const expiresAt = typeof params.currentExp === 'number' ? params.currentExp : nowEpoch + 7 * 86400;
      await db.run(
        `INSERT INTO user_sessions (
          user_id, company_id, jti, token_version, user_agent, ip_address, created_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (jti) DO NOTHING`,
        params.userId,
        params.companyId,
        params.currentJti,
        params.tokenVersion,
        String(params.userAgent || '').trim().slice(0, 256),
        sanitizeIpAddress(params.ipAddress),
        nowIso,
        nowIso,
        expiresAt
      );
    }
  }

  const rows = await db.all<{
    id: number;
    jti: string;
    user_agent: string;
    ip_address: string;
    created_at: string | Date;
    last_seen_at: string | Date;
    expires_at: number | string;
  }>(
    `SELECT id, jti, user_agent, ip_address, created_at, last_seen_at, expires_at
     FROM user_sessions
     WHERE user_id = ?
       AND company_id = ?
       AND revoked_at IS NULL
       AND token_version = ?
       AND expires_at > ?
     ORDER BY last_seen_at DESC, id DESC`,
    params.userId,
    params.companyId,
    params.tokenVersion,
    nowEpoch
  );

  return rows.map((row) => {
    const parsedUa = parseUserAgentSummary(row.user_agent);
    const expSec = Number(row.expires_at);
    return {
      id: Number(row.id),
      isCurrent: Boolean(params.currentJti && row.jti === params.currentJti),
      deviceSummary: parsedUa.deviceSummary,
      browser: parsedUa.browser,
      os: parsedUa.os,
      ipAddress: row.ip_address || '',
      createdAt: toIsoOrNull(row.created_at),
      lastSeenAt: toIsoOrNull(row.last_seen_at),
      expiresAt: Number.isFinite(expSec) && expSec > 0 ? new Date(expSec * 1000).toISOString() : null,
    };
  });
}

export async function revokeOtherUserSessions(params: {
  userId: number;
  companyId: number;
  currentJti?: string;
  currentExp?: number;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ user: AuthUser; token: string }> {
  const nowIso = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ? AND company_id = ?',
      nowIso,
      params.userId,
      params.companyId
    );
    await tx.run(
      'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL',
      nowIso,
      params.userId,
      params.companyId
    );
    if (params.currentJti) {
      await tx.run(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
        params.currentJti,
        params.currentExp ?? 0
      );
    }
  });

  const updatedRow = await db.get<RawUserRow>(
    `${AUTH_USER_SELECT} WHERE u.id = ? AND u.company_id = ?`,
    params.userId,
    params.companyId
  );
  if (!updatedRow) {
    throw new Error('User account not found.');
  }

  const updatedUser = mapAuthUserRow(updatedRow);
  const freshToken = signToken(updatedUser);
  await recordUserSession({
    userId: updatedUser.id,
    companyId: updatedUser.companyId,
    token: freshToken,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return { user: updatedUser, token: freshToken };
}

export async function revokeSingleUserSession(params: {
  sessionId: number;
  userId: number;
  companyId: number;
  currentJti?: string;
}): Promise<void> {
  if (!Number.isInteger(params.sessionId) || params.sessionId <= 0) {
    throw new AuthValidationError('Invalid session identifier.');
  }

  const session = await db.get<{ id: number; jti: string; expires_at: number }>(
    `SELECT id, jti, expires_at
     FROM user_sessions
     WHERE id = ? AND user_id = ? AND company_id = ? AND revoked_at IS NULL`,
    params.sessionId,
    params.userId,
    params.companyId
  );

  if (!session) {
    const err = new Error('Active session not found.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  if (params.currentJti && session.jti === params.currentJti) {
    throw new AuthValidationError('Use Sign Out to end your current browser session.');
  }

  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND company_id = ?',
      nowIso,
      session.id,
      params.userId,
      params.companyId
    );
    await tx.run(
      'INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING',
      session.jti,
      Number(session.expires_at ?? 0)
    );
  });
}
