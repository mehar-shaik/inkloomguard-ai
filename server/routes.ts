import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import {
  db,
  DB_ENGINE,
  checkDatabaseHealth,
  isProductionEnvironment,
  isMigrationsReady,
  isDemoLoginEnabled,
} from './db.ts';
import {
  requireAuth,
  requireVerifiedEmail,
  requireRole,
  tryAuthenticateRequest,
  registerAccount,
  createTeamMember,
  authenticateAccount,
  authenticateDemoAccount,
  getDemoWorkspaceAvailability,
  DemoAccountUnavailableError,
  signToken,
  clearLegacyAuthCookie,
  revokeTokenFromRequest,
  createPasswordResetToken,
  inspectPasswordResetToken,
  resetPasswordWithToken,
  createEmailVerificationToken,
  verifyEmailWithToken,
  findUserByEmailForAuth,
  changeUserPassword,
  invalidateAllUserSessions,
  findUserByIdForAuth,
  recordUserSession,
  listActiveUserSessions,
  revokeOtherUserSessions,
  revokeSingleUserSession,
  validateAndMergePreferencesUpdate,
  AuthenticationError,
  AuthValidationError,
  type AuthedRequest,
} from './auth.ts';
import {
  isEmailConfigured,
  buildAppActionUrl,
  resolveAppBaseUrl,
  redactEmailSecrets,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} from './email.ts';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_AVATAR_SIZE_BYTES,
  ALLOWED_DOC_EXTENSIONS,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  validateUploadedBufferContent,
  validateRasterImageBuffer,
  sanitizeAvatarImageBuffer,
  extractDocumentDetailsFromBuffer,
  analyzeImageBuffer,
} from './parsers.ts';
import {
  uploadAsset,
  downloadAsset,
  createSignedAssetUrl,
  deleteAsset,
  sanitizeLookupFilename,
  inferMimeType,
  getStorageStatus,
  type StorageBackend,
  type StoredObjectResult,
} from './storage.ts';
import {
  runFullComplianceAnalysis,
  extractStructuredGuidelinesFromText,
  detectGuidelineConflicts,
  formatGeminiError,
  getAiClient,
  type ApprovedFactInput,
  type TerminologyRuleInput,
  type CheckAreaSummary,
} from './complianceEngine.ts';
import {
  DEFAULT_VISUAL_GUIDELINES,
  computeVisualCacheHash,
  extractLogoReferenceProfile,
  normalizeHexColor,
  sanitizeVisualGuidelinesConfig,
  type BrandLogoVariantInput,
  type BrandVisualGuidelinesConfig,
  type LogoReferenceProfile,
  type VisualBrandAnalysisResult,
} from './visualDetection.ts';
import {
  AnalyticsValidationError,
  getGovernanceAnalytics,
  getRecurringViolationsAnalytics,
  getTeamAnalytics,
  invalidateAnalyticsCache,
} from './governanceAnalytics.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
});

function runSingleAvatarUpload(req: express.Request, res: express.Response): Promise<void> {
  return new Promise((resolve, reject) => {
    avatarUpload.single('avatar')(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export const authAttempts = new Map<string, { count: number; resetAt: number }>();

const STALE_REANALYSIS_LOCK_MS = 5 * 60 * 1000;

export function pruneAuthAttempts(now = Date.now(), maxEntries = 5000): number {
  let removed = 0;
  for (const [k, record] of authAttempts.entries()) {
    if (record.resetAt <= now) {
      authAttempts.delete(k);
      removed += 1;
    }
  }
  if (authAttempts.size > maxEntries) {
    const overflow = authAttempts.size - maxEntries;
    let count = 0;
    for (const k of authAttempts.keys()) {
      authAttempts.delete(k);
      removed += 1;
      count += 1;
      if (count >= overflow) break;
    }
  }
  return removed;
}

const authCleanupTimer = setInterval(() => {
  pruneAuthAttempts();
}, 5 * 60 * 1000);
if (typeof authCleanupTimer.unref === 'function') {
  authCleanupTimer.unref();
}

function createRateLimiter(options: {
  prefix: string;
  windowMs: number;
  maxAttempts: number;
  message: string;
  keyFn?: (req: express.Request) => string;
}): express.RequestHandler {
  return (req, res, next) => {
    const rawKey = options.keyFn ? options.keyFn(req) : req.ip || 'unknown';
    const key = `${options.prefix}:${rawKey}`;
    const now = Date.now();

    if (authAttempts.size > 500) {
      pruneAuthAttempts(now);
    }

    const record = authAttempts.get(key);
    if (!record || record.resetAt <= now) {
      if (record) authAttempts.delete(key);
      authAttempts.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    record.count += 1;
    if (record.count > options.maxAttempts) {
      res.status(429).json({ error: options.message });
      return;
    }
    next();
  };
}

const authRateLimit = createRateLimiter({
  prefix: 'auth',
  windowMs: 5 * 60 * 1000,
  maxAttempts: 60,
  message: 'Too many authentication requests. Please wait a few minutes and try again.',
});

const forgotPasswordRateLimit = createRateLimiter({
  prefix: 'forgot-pw',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 5,
  message: 'Too many password reset requests. Please wait 15 minutes before trying again.',
});

const resetPasswordRateLimit = createRateLimiter({
  prefix: 'reset-pw',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
  message: 'Too many password reset attempts. Please wait 15 minutes and try again.',
});

function consumeRateLimitSlot(options: {
  prefix: string;
  windowMs: number;
  maxAttempts: number;
  key: string;
}): boolean {
  const mapKey = `${options.prefix}:${options.key}`;
  const now = Date.now();

  if (authAttempts.size > 500) {
    pruneAuthAttempts(now);
  }

  const record = authAttempts.get(mapKey);
  if (!record || record.resetAt <= now) {
    if (record) authAttempts.delete(mapKey);
    authAttempts.set(mapKey, { count: 1, resetAt: now + options.windowMs });
    return true;
  }
  record.count += 1;
  return record.count <= options.maxAttempts;
}

const RESEND_VERIFICATION_RATE_LIMIT = {
  prefix: 'resend-verify',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 3,
  message: 'Too many verification email requests. Please wait before requesting another email.',
};

const verifyEmailRateLimit = createRateLimiter({
  prefix: 'verify-email',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 15,
  message: 'Too many email verification attempts. Please wait a few minutes and try again.',
});

const changePasswordRateLimit = createRateLimiter({
  prefix: 'change-pw',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 10,
  message: 'Too many password change attempts. Please wait 15 minutes and try again.',
});

function getRequestOrigin(req: express.Request): string | undefined {
  const rawHost = req.get('x-forwarded-host') || req.get('host');
  if (!rawHost) return undefined;
  const host = rawHost.split(',')[0].trim();
  if (!host) return undefined;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${host}`;
}

function asyncHandler(
  fn: (req: AuthedRequest, res: express.Response, next: express.NextFunction) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

function sha256Hex(parts: Array<string | Buffer>): string {
  const h = crypto.createHash('sha256');
  for (const part of parts) {
    h.update(part);
  }
  return h.digest('hex');
}

async function safeRollbackAssets(assets: Array<StoredObjectResult | null>): Promise<void> {
  for (const asset of assets) {
    if (!asset) continue;
    try {
      await deleteAsset({
        backend: asset.backend,
        storageKey: asset.storageKey,
        filename: asset.filename,
      });
    } catch {
      // Best-effort cleanup
    }
  }
}

const SAFE_UPLOAD_VALIDATION_PATTERNS: Array<{ pattern: RegExp; map?: (msg: string) => string }> = [
  { pattern: /^Unsupported file type "[^"]*"\. Allowed: [a-z0-9.,\s]+$/i },
  { pattern: /^Uploaded (?:file|avatar image) is empty\.$/i },
  { pattern: /^Image buffer is empty\.$/i },
  { pattern: /^Uploaded file exceeds the 10 MB size limit\.$/i },
  { pattern: /^Profile picture (?:must be 5 MB or smaller|exceeds the 5 MB size limit)\.$/i },
  { pattern: /^File contents do not match a valid (?:PNG|JPEG|WEBP|SVG|PDF|DOCX) (?:image|document|archive)\.$/i },
  { pattern: /^SVG contains disallowed scripting or active content\.$/i },
  { pattern: /^Binary content is not allowed in text or Markdown uploads\.$/i },
  {
    pattern: /^Unable to decode image(?: file| buffer)?:/i,
    map: () => 'Uploaded image file is corrupted or cannot be decoded.',
  },
  {
    pattern: /^Unable to (?:process profile picture|resize image):/i,
    map: () => 'Uploaded image could not be processed. Please upload a valid PNG, JPEG, or WebP file.',
  },
  {
    pattern: /^Decoded (?:avatar )?image (?:produced empty|buffer has invalid) dimensions\.$/i,
    map: () => 'Uploaded image has invalid dimensions.',
  },
];

export function sanitizeUploadValidationMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message.trim() : '';
  if (!raw) return fallback;
  for (const rule of SAFE_UPLOAD_VALIDATION_PATTERNS) {
    if (rule.pattern.test(raw)) {
      return rule.map ? rule.map(raw) : raw;
    }
  }
  return fallback;
}

const SAFE_PASSWORD_RESET_MESSAGES = new Set([
  'This password reset link is invalid.',
  'This password reset link has already been used. Please request a new one.',
  'This password reset link has already been used.',
  'This password reset link has expired. Please request a new password reset.',
]);

const SAFE_PASSWORD_POLICY_PATTERN =
  /^Password (?:must be 128 characters or fewer\.|does not meet security requirements: )/;

export function sanitizePasswordResetError(err: unknown): { status: number; error: string } {
  if (err instanceof AuthValidationError) {
    return { status: err.statusCode, error: err.message };
  }
  const msg = err instanceof Error ? err.message.trim() : '';
  if (SAFE_PASSWORD_RESET_MESSAGES.has(msg) || SAFE_PASSWORD_POLICY_PATTERN.test(msg)) {
    return { status: 400, error: msg };
  }
  return { status: 500, error: 'Unable to reset password right now.' };
}

const SAFE_CHANGE_PASSWORD_MESSAGES = new Set([
  'Current password is incorrect.',
  'New password must be different from your current password.',
]);

export function sanitizeChangePasswordError(err: unknown): { status: number; error: string } {
  if (err instanceof AuthValidationError) {
    return { status: err.statusCode, error: err.message };
  }
  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  const msg = err instanceof Error ? err.message.trim() : '';
  if (statusCode === 400 && (SAFE_CHANGE_PASSWORD_MESSAGES.has(msg) || SAFE_PASSWORD_POLICY_PATTERN.test(msg))) {
    return { status: 400, error: msg };
  }
  return { status: 500, error: 'Unable to update password right now.' };
}

const SAFE_BREVO_DIAGNOSTIC_PATTERNS = [
  /^Email delivery request to Brevo timed out\./,
  /^Brevo API authentication or authorization failed \(HTTP (?:401|403)\)\./,
  /^Brevo rejected the email payload \(HTTP 400\)\./,
  /^Brevo transactional email endpoint was not found \(HTTP 404\)\./,
  /^Brevo email rate limit or sending quota exceeded \(HTTP 429\)\./,
  /^Brevo email service is temporarily unavailable \(HTTP 5\d\d\)\./,
  /^Brevo email delivery failed with HTTP [45]\d\d\./,
  /^Brevo returned an invalid or unexpected JSON response\./,
  /^Unable to reach Brevo email API over HTTPS/,
];

export function sanitizeEmailDeliveryError(err: unknown, fallback: string): string {
  const redacted = redactEmailSecrets(err instanceof Error ? err.message.trim() : '');
  if (redacted && SAFE_BREVO_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(redacted))) {
    return redacted;
  }
  return fallback;
}

const SAFE_AI_DIAGNOSTIC_PATTERNS = [
  /^Gemini AI returned an invalid structured response\./,
  /^Gemini AI request timed out\b/,
  /^Gemini AI service is temporarily experiencing high demand \(503\)\./,
  /^Gemini AI rate limit or quota reached \(429\)\./,
  /^Gemini API authentication failed\./,
  /^Configured Gemini model "[^"]+" is unavailable or unsupported \(404\)\./,
  /^Network error while reaching Gemini AI service\./,
];

export function sanitizeAiRouteError(err: unknown, fallback: string): { status: number; error: string } {
  const formatted = formatGeminiError(err);
  if (SAFE_AI_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(formatted))) {
    const status = formatted.includes('(504)')
      ? 504
      : formatted.includes('(503)')
        ? 503
        : formatted.includes('(429)')
          ? 429
          : 500;
    return { status, error: formatted };
  }
  return { status: 500, error: fallback };
}

interface BrandVisualGuidelineRow {
  id: number;
  accent_colors_json: string;
  approved_backgrounds_json: string;
  logo_rules_json: string;
  typography_rules_json: string;
  source_document_id: number | null;
  updated_at: string | Date;
}

interface BrandLogoVariantRow {
  id: number;
  company_id: number;
  brand_id: number;
  label: string;
  variant_type: string;
  filename: string;
  original_name: string;
  width: number;
  height: number;
  aspect_ratio: number;
  dominant_colors_json: string;
  features_json: string;
  created_at: string | Date;
}

function parseVisualGuidelinesRow(row: BrandVisualGuidelineRow | undefined | null): BrandVisualGuidelinesConfig {
  if (!row) {
    return sanitizeVisualGuidelinesConfig(DEFAULT_VISUAL_GUIDELINES);
  }
  const safeParse = (raw: string, fallback: unknown) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  return sanitizeVisualGuidelinesConfig({
    accentColors: safeParse(row.accent_colors_json || '[]', []),
    approvedBackgrounds: safeParse(row.approved_backgrounds_json || '[]', []),
    logoRules: safeParse(row.logo_rules_json || '{}', {}),
    typographyRules: safeParse(row.typography_rules_json || '{}', {}),
    sourceDocumentId: row.source_document_id ?? null,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : undefined,
  });
}

function serializePublicLogoVariant(row: BrandLogoVariantRow) {
  let dominantColors: string[] = [];
  try {
    const parsed = JSON.parse(row.dominant_colors_json || '[]');
    if (Array.isArray(parsed)) dominantColors = parsed.filter((c): c is string => typeof c === 'string');
  } catch {
    dominantColors = [];
  }
  return {
    id: Number(row.id),
    brand_id: Number(row.brand_id),
    label: row.label,
    variant_type: row.variant_type,
    filename: row.filename,
    original_name: row.original_name,
    width: Number(row.width),
    height: Number(row.height),
    aspect_ratio: Number(row.aspect_ratio),
    dominant_colors: dominantColors,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  };
}

async function loadBrandVisualContext(
  companyId: number,
  brand: { id: number; logo_filename?: string | null }
): Promise<{
  visualGuidelines: BrandVisualGuidelinesConfig;
  primaryLogoBuffer: Buffer | null;
  primaryLogoProfile: LogoReferenceProfile | null;
  logoVariants: BrandLogoVariantInput[];
  publicLogoVariants: ReturnType<typeof serializePublicLogoVariant>[];
}> {
  const vgRow = await db.get<BrandVisualGuidelineRow>(
    'SELECT * FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
    brand.id,
    companyId
  );
  const visualGuidelines = parseVisualGuidelinesRow(vgRow);

  const variantRows = await db.all<BrandLogoVariantRow>(
    'SELECT * FROM brand_logo_variants WHERE brand_id = ? AND company_id = ? ORDER BY id ASC',
    brand.id,
    companyId
  );

  let primaryLogoBuffer: Buffer | null = null;
  let primaryLogoProfile: LogoReferenceProfile | null = null;
  if (brand.logo_filename) {
    const logoAsset = await resolveTenantAsset(companyId, brand.logo_filename);
    if (logoAsset) {
      try {
        primaryLogoBuffer = await downloadAsset({
          backend: logoAsset.backend,
          storageKey: logoAsset.storageKey,
          filename: logoAsset.filename,
        });
        primaryLogoProfile = await extractLogoReferenceProfile(primaryLogoBuffer, brand.logo_filename);
      } catch {
        primaryLogoBuffer = null;
        primaryLogoProfile = null;
      }
    }
  }

  const logoVariants: BrandLogoVariantInput[] = [];
  for (const row of variantRows) {
    let profile: LogoReferenceProfile | null = null;
    try {
      const parsed = JSON.parse(row.features_json || '{}');
      if (parsed && Array.isArray(parsed.norm24) && Array.isArray(parsed.edge24)) {
        profile = parsed as LogoReferenceProfile;
      }
    } catch {
      profile = null;
    }

    let dominantColors: string[] = [];
    try {
      const parsedCols = JSON.parse(row.dominant_colors_json || '[]');
      if (Array.isArray(parsedCols)) {
        dominantColors = parsedCols.filter((c): c is string => typeof c === 'string');
      }
    } catch {
      dominantColors = [];
    }

    let buf: Buffer | null = null;
    const varAsset = await resolveTenantAsset(companyId, row.filename);
    if (varAsset) {
      try {
        buf = await downloadAsset({
          backend: varAsset.backend,
          storageKey: varAsset.storageKey,
          filename: varAsset.filename,
        });
        if (!profile) {
          profile = await extractLogoReferenceProfile(buf, row.filename);
        }
      } catch {
        buf = null;
      }
    }

    logoVariants.push({
      id: Number(row.id),
      label: row.label,
      variant_type: row.variant_type,
      filename: row.filename,
      original_name: row.original_name,
      width: Number(row.width),
      height: Number(row.height),
      aspect_ratio: Number(row.aspect_ratio),
      dominant_colors: dominantColors,
      profile,
      buffer: buf,
    });
  }

  return {
    visualGuidelines,
    primaryLogoBuffer,
    primaryLogoProfile,
    logoVariants,
    publicLogoVariants: variantRows.map(serializePublicLogoVariant),
  };
}

interface ResolvedAsset {
  backend: StorageBackend;
  storageKey: string;
  filename: string;
  mimeType: string;
  originalName: string;
  assetKind?: string;
  userId?: number | null;
}

function checkAssetAccess(
  user: NonNullable<AuthedRequest['user']>,
  asset: ResolvedAsset | null
): { allowed: true } | { allowed: false; status: number; error: string; code?: string } {
  if (!asset) {
    return { allowed: false, status: 403, error: 'Access denied to private company asset.' };
  }
  if (asset.assetKind === 'user_avatar') {
    const expectedPrefix = `companies/${user.companyId}/users/${user.id}/`;
    if (
      asset.userId !== user.id ||
      (asset.storageKey.startsWith('companies/') && !asset.storageKey.startsWith(expectedPrefix))
    ) {
      return { allowed: false, status: 403, error: 'Access denied to private user avatar.' };
    }
    return { allowed: true };
  }
  if (user.verificationRequired && !user.emailVerified) {
    return {
      allowed: false,
      status: 403,
      error:
        'Email verification is required before using workspace features. Please verify your email or request a new link from Settings.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
    };
  }
  return { allowed: true };
}

async function resolveTenantAsset(companyId: number, safeFilename: string): Promise<ResolvedAsset | null> {
  const stored = await db.get<{
    storage_backend: StorageBackend;
    storage_key: string;
    filename: string;
    mime_type: string;
    original_name: string;
    asset_kind: string;
    user_id: number | null;
  }>(
    `SELECT storage_backend, storage_key, filename, mime_type, original_name, asset_kind, user_id
     FROM stored_files
     WHERE company_id = ? AND filename = ?
     ORDER BY id DESC
     LIMIT 1`,
    companyId,
    safeFilename
  );

  if (stored) {
    if (
      stored.storage_key.startsWith('companies/') &&
      !stored.storage_key.startsWith(`companies/${companyId}/`)
    ) {
      return null;
    }

    return {
      backend: stored.storage_backend === 'supabase' ? 'supabase' : 'local',
      storageKey: stored.storage_key,
      filename: stored.filename,
      mimeType: stored.mime_type || inferMimeType(stored.filename),
      originalName: stored.original_name || stored.filename,
      assetKind: stored.asset_kind,
      userId: stored.user_id !== null && stored.user_id !== undefined ? Number(stored.user_id) : null,
    };
  }

  // Fallback for legacy SQLite rows created prior to stored_files metadata table
  const brandMatch = await db.get<{ id: number; logo_original_name: string | null }>(
    'SELECT id, logo_original_name FROM brands WHERE company_id = ? AND logo_filename = ?',
    companyId,
    safeFilename
  );
  if (brandMatch) {
    return {
      backend: 'local',
      storageKey: safeFilename,
      filename: safeFilename,
      mimeType: inferMimeType(safeFilename),
      originalName: brandMatch.logo_original_name || safeFilename,
      assetKind: 'brand_logo',
    };
  }

  const subMatch = await db.get<{ id: number; file_original_name: string | null }>(
    'SELECT id, file_original_name FROM submissions WHERE company_id = ? AND (file_filename = ? OR image_filename = ?)',
    companyId,
    safeFilename,
    safeFilename
  );
  if (subMatch) {
    return {
      backend: 'local',
      storageKey: safeFilename,
      filename: safeFilename,
      mimeType: inferMimeType(safeFilename),
      originalName: subMatch.file_original_name || safeFilename,
      assetKind: 'submission_document',
    };
  }

  const docMatch = await db.get<{ id: number; original_name: string | null }>(
    'SELECT id, original_name FROM guideline_documents WHERE company_id = ? AND filename = ?',
    companyId,
    safeFilename
  );
  if (docMatch) {
    return {
      backend: 'local',
      storageKey: safeFilename,
      filename: safeFilename,
      mimeType: inferMimeType(safeFilename),
      originalName: docMatch.original_name || safeFilename,
      assetKind: 'guideline_document',
    };
  }

  const userMatch = await db.get<{ id: number; avatar_original_name: string | null }>(
    'SELECT id, avatar_original_name FROM users WHERE company_id = ? AND avatar_filename = ?',
    companyId,
    safeFilename
  );
  if (userMatch) {
    return {
      backend: 'local',
      storageKey: safeFilename,
      filename: safeFilename,
      mimeType: inferMimeType(safeFilename),
      originalName: userMatch.avatar_original_name || safeFilename,
      assetKind: 'user_avatar',
      userId: Number(userMatch.id),
    };
  }

  return null;
}

async function resolveTenantAssetById(companyId: number, fileId: number): Promise<ResolvedAsset | null> {
  const stored = await db.get<{
    storage_backend: StorageBackend;
    storage_key: string;
    filename: string;
    mime_type: string;
    original_name: string;
    asset_kind: string;
    user_id: number | null;
  }>(
    `SELECT storage_backend, storage_key, filename, mime_type, original_name, asset_kind, user_id
     FROM stored_files
     WHERE id = ? AND company_id = ?`,
    fileId,
    companyId
  );
  if (!stored) return null;
  if (
    stored.storage_key.startsWith('companies/') &&
    !stored.storage_key.startsWith(`companies/${companyId}/`)
  ) {
    return null;
  }
  return {
    backend: stored.storage_backend === 'supabase' ? 'supabase' : 'local',
    storageKey: stored.storage_key,
    filename: stored.filename,
    mimeType: stored.mime_type || inferMimeType(stored.filename),
    originalName: stored.original_name || stored.filename,
    assetKind: stored.asset_kind,
    userId: stored.user_id !== null && stored.user_id !== undefined ? Number(stored.user_id) : null,
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ---------------- HEALTH CHECK ----------------
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbHealthy = await checkDatabaseHealth();
      if (!dbHealthy) {
        res.status(503).json({ status: 'error', database: 'unavailable', migrationsReady: isMigrationsReady() });
        return;
      }
      const apiKey = process.env.GEMINI_API_KEY;
      const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
      const storage = getStorageStatus();
      const demo = await getDemoWorkspaceAvailability();
      res.json({
        status: 'ok',
        database: 'connected',
        migrationsReady: isMigrationsReady(),
        engine: DB_ENGINE,
        storage: storage.mode,
        storageConfigured: storage.configured,
        storageBucket: storage.bucket,
        geminiConfigured,
        emailConfigured: isEmailConfigured(),
        demoAvailable: demo.available,
        demoStatus: demo.status,
        demoOrganizationName: demo.organizationName,
        ...(demo.message ? { demoMessage: demo.message } : {}),
        timestamp: new Date().toISOString(),
      });
    })
  );

  // ---------------- AUTH ROUTES ----------------
  router.post(
    '/auth/register',
    authRateLimit,
    asyncHandler(async (req, res) => {
      try {
        const { name, email, password, companyName, role } = req.body ?? {};
        if (!name || !email || !password || !companyName) {
          res.status(400).json({ error: 'Name, email, password, and company name are required.' });
          return;
        }
        const user = await registerAccount({ name, email, password, companyName, role });
        const token = signToken(user);
        await recordUserSession({
          userId: user.id,
          companyId: user.companyId,
          token,
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });
        clearLegacyAuthCookie(res);

        let verificationEmailSent = false;
        let verificationEmailError: string | undefined;
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(user.id, user.companyId);
          if (isEmailConfigured()) {
            const origin = getRequestOrigin(req);
            const verificationUrl = buildAppActionUrl(
              `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
              origin
            );
            await sendVerificationEmail({
              to: user.email,
              name: user.name,
              companyName: user.companyName,
              verificationUrl,
              expiresHours,
            });
            verificationEmailSent = true;
            console.log(
              `[InkloomGuard AI] Registration verification email dispatched (userId=${user.id}, baseUrl=${resolveAppBaseUrl(origin)})`
            );
          } else {
            verificationEmailError =
              'Email delivery is not configured on the server yet. Once configured, click Resend Verification Email.';
          }
        } catch (emailErr) {
          const redactedLog = redactEmailSecrets(
            emailErr instanceof Error ? emailErr.message : 'Email delivery error'
          );
          console.error('[InkloomGuard AI] Verification email dispatch error during registration:', redactedLog);
          verificationEmailError = sanitizeEmailDeliveryError(
            emailErr,
            'Unable to send verification email right now. You can retry from Security Settings.'
          );
        }

        res.status(201).json({
          user,
          token,
          verificationEmailSent,
          verificationEmailError,
        });
      } catch (err) {
        if (err instanceof AuthValidationError || err instanceof AuthenticationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        const code = (err as { code?: string })?.code;
        if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: 'An account with that email already exists.' });
          return;
        }
        console.error('[InkloomGuard AI] Register error:', err instanceof Error ? err.message : 'Unknown error');
        res.status(500).json({ error: 'Registration failed due to a server error.' });
      }
    })
  );

  router.post(
    '/auth/login',
    authRateLimit,
    asyncHandler(async (req, res) => {
      try {
        const { email, password } = req.body ?? {};
        if (!email || !password) {
          res.status(400).json({ error: 'Email and password are required.' });
          return;
        }
        const user = await authenticateAccount(email, password);
        const token = signToken(user);
        await recordUserSession({
          userId: user.id,
          companyId: user.companyId,
          token,
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });
        clearLegacyAuthCookie(res);
        res.json({ user, token });
      } catch (err) {
        if (err instanceof AuthenticationError || err instanceof AuthValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        console.error('[InkloomGuard AI] Login error:', err instanceof Error ? err.message : 'Unknown error');
        res.status(500).json({ error: 'Unable to sign in right now due to a server error.' });
      }
    })
  );

  router.post(
    '/auth/demo',
    authRateLimit,
    asyncHandler(async (req, res) => {
      if (!isDemoLoginEnabled()) {
        res.status(404).json({ error: 'Not found.' });
        return;
      }
      try {
        const user = await authenticateDemoAccount();
        const token = signToken(user);
        await recordUserSession({
          userId: user.id,
          companyId: user.companyId,
          token,
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });
        clearLegacyAuthCookie(res);
        res.json({ user, token });
      } catch (err) {
        if (err instanceof DemoAccountUnavailableError) {
          res.status(err.statusCode).json({ error: err.message, code: err.code });
          return;
        }
        if (err instanceof AuthenticationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        console.error('[InkloomGuard AI] Demo login error:', err instanceof Error ? err.message : 'Unknown error');
        res.status(500).json({ error: 'Demo login unavailable.' });
      }
    })
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      await revokeTokenFromRequest(req);
      clearLegacyAuthCookie(res);
      res.json({ ok: true });
    })
  );

  router.post(
    '/auth/logout-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await invalidateAllUserSessions(req.user!.id, req.user!.companyId, req.authJti, req.authExp);
      clearLegacyAuthCookie(res);
      res.json({ ok: true, message: 'All active sessions have been signed out.' });
    })
  );

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    res.json({ user: req.user });
  });

  router.get(
    '/auth/sessions',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const sessions = await listActiveUserSessions({
        userId: req.user!.id,
        companyId: req.user!.companyId,
        tokenVersion: req.user!.tokenVersion,
        currentJti: req.authJti,
        currentExp: req.authExp,
        userAgent: req.get('user-agent'),
        ipAddress: req.ip,
      });
      res.json({ sessions });
    })
  );

  router.post(
    '/auth/sessions/revoke-others',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const result = await revokeOtherUserSessions({
        userId: req.user!.id,
        companyId: req.user!.companyId,
        currentJti: req.authJti,
        currentExp: req.authExp,
        userAgent: req.get('user-agent'),
        ipAddress: req.ip,
      });
      res.json({
        ok: true,
        user: result.user,
        token: result.token,
        message: 'All other active sessions have been signed out.',
      });
    })
  );

  router.delete(
    '/auth/sessions/:sessionId',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const sessionId = Number(req.params.sessionId);
      try {
        await revokeSingleUserSession({
          sessionId,
          userId: req.user!.id,
          companyId: req.user!.companyId,
          currentJti: req.authJti,
        });
        const sessions = await listActiveUserSessions({
          userId: req.user!.id,
          companyId: req.user!.companyId,
          tokenVersion: req.user!.tokenVersion,
          currentJti: req.authJti,
          currentExp: req.authExp,
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });
        res.json({
          ok: true,
          sessions,
          message: 'Selected session has been signed out.',
        });
      } catch (err) {
        if (err instanceof AuthValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          res.status(404).json({ error: 'Active session not found.' });
          return;
        }
        console.error('[InkloomGuard AI] Revoke session error:', err);
        res.status(500).json({ error: 'Unable to revoke session right now.' });
      }
    })
  );

  router.post(
    '/auth/forgot-password',
    forgotPasswordRateLimit,
    asyncHandler(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }

      const neutralMessage =
        'If an account is registered with that email address, we have sent password reset instructions.';

      try {
        const created = await createPasswordResetToken(email, req.ip || '');
        if (created) {
          if (!isEmailConfigured()) {
            console.error('[InkloomGuard AI] Password reset requested but email delivery service is not configured.');
          } else {
            const resetUrl = buildAppActionUrl(
              `/?mode=reset-password&token=${encodeURIComponent(created.rawToken)}`,
              getRequestOrigin(req)
            );
            await sendPasswordResetEmail({
              to: created.user.email,
              name: created.user.name,
              resetUrl,
              expiresMinutes: created.expiresMinutes,
            });
          }
        }
      } catch (err) {
        console.error(
          '[InkloomGuard AI] Password reset email failed:',
          err instanceof Error ? err.message : 'Email delivery error'
        );
      }

      res.json({ ok: true, message: neutralMessage });
    })
  );

  router.get(
    '/auth/reset-password/validate',
    resetPasswordRateLimit,
    asyncHandler(async (req, res) => {
      const token = String(req.query?.token || '');
      const status = await inspectPasswordResetToken(token);
      if (!status.valid) {
        res.status(400).json({ valid: false, reason: status.reason, error: status.error });
        return;
      }
      res.json({ valid: true });
    })
  );

  router.post(
    '/auth/reset-password',
    resetPasswordRateLimit,
    asyncHandler(async (req, res) => {
      const { token, newPassword, confirmPassword } = req.body ?? {};
      if (!token || !newPassword) {
        res.status(400).json({ error: 'Reset token and new password are required.' });
        return;
      }
      if (confirmPassword !== undefined && String(newPassword) !== String(confirmPassword)) {
        res.status(400).json({ error: 'Password confirmation does not match.' });
        return;
      }

      try {
        const result = await resetPasswordWithToken({
          rawToken: String(token),
          newPassword: String(newPassword),
        });

        if (isEmailConfigured()) {
          await sendPasswordChangedEmail({
            to: result.user.email,
            name: result.user.name,
            companyName: result.user.companyName,
            changedAtIso: result.changedAtIso,
          }).catch((emailErr) => {
            console.error(
              '[InkloomGuard AI] Password reset confirmation email failed:',
              emailErr instanceof Error ? emailErr.message : 'Email delivery error'
            );
          });
        }

        res.json({
          ok: true,
          message: 'Your password has been reset successfully. All previous sessions have been signed out.',
        });
      } catch (err) {
        const sanitized = sanitizePasswordResetError(err);
        if (sanitized.status >= 500) {
          console.error('[InkloomGuard AI] Reset password error:', err);
        }
        res.status(sanitized.status).json({ error: sanitized.error });
      }
    })
  );

  router.post(
    '/auth/verify-email',
    verifyEmailRateLimit,
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token || '');
      if (!token.trim()) {
        res.status(400).json({ ok: false, reason: 'invalid', error: 'Verification token is required.' });
        return;
      }

      const result = await verifyEmailWithToken(token);
      if (!result.verified) {
        res.status(400).json({
          ok: false,
          reason: result.reason,
          error: result.error,
        });
        return;
      }

      res.json({
        ok: true,
        user: result.user,
        message: 'Your email address has been verified successfully.',
      });
    })
  );

  router.post(
    '/auth/resend-verification',
    asyncHandler(async (req, res) => {
      const authedUser = await tryAuthenticateRequest(req);
      const explicitEmailRaw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const hasExplicitEmail = Boolean(explicitEmailRaw);

      if (hasExplicitEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(explicitEmailRaw)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }

      if (!hasExplicitEmail && !authedUser) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }

      // If caller is authenticated for this exact account (or omitted email) and it's already verified, inform them without burning a rate-limit slot
      if (authedUser && (!hasExplicitEmail || authedUser.email === explicitEmailRaw) && authedUser.emailVerified) {
        res.status(400).json({ error: 'Your email address is already verified.' });
        return;
      }

      const allowed = consumeRateLimitSlot({
        prefix: RESEND_VERIFICATION_RATE_LIMIT.prefix,
        windowMs: RESEND_VERIFICATION_RATE_LIMIT.windowMs,
        maxAttempts: RESEND_VERIFICATION_RATE_LIMIT.maxAttempts,
        key: req.ip || 'unknown',
      });
      if (!allowed) {
        res.status(429).json({ error: RESEND_VERIFICATION_RATE_LIMIT.message });
        return;
      }

      if (!isEmailConfigured()) {
        res.status(503).json({
          error: 'Email service is not configured. Please configure Brevo email settings before sending verification emails.',
        });
        return;
      }

      const origin = getRequestOrigin(req);

      // Authenticated user requesting verification for their own account (no explicit override email)
      if (!hasExplicitEmail && authedUser) {
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(
            authedUser.id,
            authedUser.companyId
          );
          const verificationUrl = buildAppActionUrl(
            `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
            origin
          );
          await sendVerificationEmail({
            to: authedUser.email,
            name: authedUser.name,
            companyName: authedUser.companyName,
            verificationUrl,
            expiresHours,
          });
          console.log(
            `[InkloomGuard AI] Resend verification email dispatched (userId=${authedUser.id}, baseUrl=${resolveAppBaseUrl(origin)})`
          );
          res.json({
            ok: true,
            message: 'A new verification email has been sent to your registered address.',
          });
          return;
        } catch (err) {
          const redactedLog = redactEmailSecrets(
            err instanceof Error ? err.message : 'Unable to send verification email right now.'
          );
          console.error('[InkloomGuard AI] Resend verification email failed:', redactedLog);
          res.status(503).json({
            error: sanitizeEmailDeliveryError(err, 'Unable to send verification email right now.'),
          });
          return;
        }
      }

      // Explicit email provided (unauthenticated flow OR signed-in user requesting for a specific email)
      const neutralMessage =
        'If an unverified account exists for that email address, a verification email has been sent.';
      const targetUser = await findUserByEmailForAuth(explicitEmailRaw);
      if (targetUser && !targetUser.emailVerified) {
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(
            targetUser.id,
            targetUser.companyId
          );
          const verificationUrl = buildAppActionUrl(
            `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
            origin
          );
          await sendVerificationEmail({
            to: targetUser.email,
            name: targetUser.name,
            companyName: targetUser.companyName,
            verificationUrl,
            expiresHours,
          });
          console.log(
            `[InkloomGuard AI] Public resend verification email dispatched (userId=${targetUser.id}, baseUrl=${resolveAppBaseUrl(origin)})`
          );
        } catch (err) {
          const redactedLog = redactEmailSecrets(
            err instanceof Error ? err.message : 'Unable to send verification email right now.'
          );
          console.error('[InkloomGuard AI] Public resend verification email failed:', redactedLog);
          res.status(503).json({
            error: sanitizeEmailDeliveryError(err, 'Unable to send verification email right now.'),
          });
          return;
        }
      }

      res.json({ ok: true, message: neutralMessage });
    })
  );

  router.post(
    '/auth/change-password',
    requireAuth,
    requireVerifiedEmail,
    changePasswordRateLimit,
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
      if (!currentPassword || !newPassword || !confirmPassword) {
        res.status(400).json({
          error: 'Current password, new password, and password confirmation are required.',
        });
        return;
      }
      if (String(newPassword) !== String(confirmPassword)) {
        res.status(400).json({ error: 'New password and confirmation do not match.' });
        return;
      }

      try {
        const result = await changeUserPassword({
          userId: req.user!.id,
          companyId: req.user!.companyId,
          currentPassword: String(currentPassword),
          newPassword: String(newPassword),
          currentJti: req.authJti,
          currentExp: req.authExp,
          userAgent: req.get('user-agent'),
          ipAddress: req.ip,
        });

        let confirmationEmailSent = false;
        if (isEmailConfigured()) {
          try {
            await sendPasswordChangedEmail({
              to: result.user.email,
              name: result.user.name,
              companyName: result.user.companyName,
              changedAtIso: result.changedAtIso,
            });
            confirmationEmailSent = true;
          } catch (emailErr) {
            console.error(
              '[InkloomGuard AI] Password changed confirmation email failed:',
              emailErr instanceof Error ? emailErr.message : 'Email delivery error'
            );
          }
        }

        res.json({
          ok: true,
          user: result.user,
          token: result.token,
          confirmationEmailSent,
          message: 'Password updated successfully. All other active sessions have been signed out.',
        });
      } catch (err) {
        const sanitized = sanitizeChangePasswordError(err);
        if (sanitized.status >= 500) {
          console.error('[InkloomGuard AI] Change password error:', err);
        }
        res.status(sanitized.status).json({ error: sanitized.error });
      }
    })
  );

  // ---------------- USER PREFERENCES (SETTINGS) ----------------
  router.get(
    '/preferences',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      res.json({
        preferences: req.user!.preferences,
        emailDeliveryConfigured: isEmailConfigured(),
      });
    })
  );

  router.put(
    '/preferences',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        const nextPreferences = validateAndMergePreferencesUpdate(
          req.user!.preferences,
          req.body,
          req.user!.role
        );
        const nowIso = new Date().toISOString();
        const result = await db.run(
          'UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ? AND company_id = ?',
          JSON.stringify(nextPreferences),
          nowIso,
          req.user!.id,
          req.user!.companyId
        );
        if (result.changes !== 1) {
          res.status(404).json({ error: 'User account not found.' });
          return;
        }
        const updatedUser = await findUserByIdForAuth(req.user!.id, req.user!.companyId);
        if (!updatedUser) {
          res.status(404).json({ error: 'User account not found.' });
          return;
        }
        res.json({
          preferences: updatedUser.preferences,
          user: updatedUser,
          emailDeliveryConfigured: isEmailConfigured(),
        });
      } catch (err) {
        if (err instanceof AuthValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  // ---------------- ORGANIZATION / WORKSPACE & TEAM (RBAC) ----------------
  router.get(
    '/organization',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const companyId = req.user!.companyId;
      const company = await db.get<{ id: number; name: string; created_at: string | Date }>(
        'SELECT id, name, created_at FROM companies WHERE id = ?',
        companyId
      );
      if (!company) {
        res.status(404).json({ error: 'Organization workspace not found.' });
        return;
      }
      const [memberCountRow, brandCountRow, submissionCountRow] = await Promise.all([
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE company_id = ?', companyId),
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM brands WHERE company_id = ?', companyId),
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM submissions WHERE company_id = ?', companyId),
      ]);

      res.json({
        organization: {
          id: Number(company.id),
          name: company.name,
          createdAt:
            company.created_at instanceof Date
              ? company.created_at.toISOString()
              : String(company.created_at || ''),
          memberCount: Number(memberCountRow?.c ?? 0),
          brandCount: Number(brandCountRow?.c ?? 0),
          submissionCount: Number(submissionCountRow?.c ?? 0),
        },
        canManageWorkspace: req.user!.role === 'reviewer' || req.user!.role === 'admin',
      });
    })
  );

  router.put(
    '/organization',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!rawName || rawName.length > 120) {
        res.status(400).json({ error: 'Organization name must be between 1 and 120 characters.' });
        return;
      }

      const companyId = req.user!.companyId;
      const result = await db.run('UPDATE companies SET name = ? WHERE id = ?', rawName, companyId);
      if (result.changes !== 1) {
        res.status(404).json({ error: 'Organization workspace not found.' });
        return;
      }

      const [company, memberCountRow, brandCountRow, submissionCountRow, updatedUser] = await Promise.all([
        db.get<{ id: number; name: string; created_at: string | Date }>(
          'SELECT id, name, created_at FROM companies WHERE id = ?',
          companyId
        ),
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE company_id = ?', companyId),
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM brands WHERE company_id = ?', companyId),
        db.get<{ c: number }>('SELECT COUNT(*) AS c FROM submissions WHERE company_id = ?', companyId),
        findUserByIdForAuth(req.user!.id, companyId),
      ]);

      if (!company || !updatedUser) {
        res.status(404).json({ error: 'Organization workspace not found.' });
        return;
      }

      res.json({
        organization: {
          id: Number(company.id),
          name: company.name,
          createdAt:
            company.created_at instanceof Date
              ? company.created_at.toISOString()
              : String(company.created_at || ''),
          memberCount: Number(memberCountRow?.c ?? 0),
          brandCount: Number(brandCountRow?.c ?? 0),
          submissionCount: Number(submissionCountRow?.c ?? 0),
        },
        user: updatedUser,
      });
    })
  );

  router.get(
    '/team/members',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await db.all<{
        id: number;
        name: string;
        email: string;
        role: string;
        job_title: string | null;
        email_verified: unknown;
        created_at: string | Date;
      }>(
        'SELECT id, name, email, role, job_title, email_verified, created_at FROM users WHERE company_id = ? ORDER BY id ASC',
        req.user!.companyId
      );
      const members = rows.map((row) => ({
        id: Number(row.id),
        name: row.name,
        email: row.email,
        role: row.role,
        jobTitle: String(row.job_title ?? ''),
        email_verified: row.email_verified,
        emailVerified:
          row.email_verified === true ||
          row.email_verified === 1 ||
          row.email_verified === '1' ||
          row.email_verified === 'true' ||
          row.email_verified === 't',
        created_at: row.created_at,
        createdAt:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
      }));
      res.json({ members });
    })
  );

  router.post(
    '/team/members',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        const { name, email, password, role } = req.body ?? {};
        if (!name || !email || !password) {
          res.status(400).json({ error: 'Name, email, and password are required.' });
          return;
        }
        const requestedRole = role === undefined ? 'author' : String(role).trim().toLowerCase();
        if (requestedRole !== 'author' && requestedRole !== 'reviewer' && requestedRole !== 'admin') {
          res.status(400).json({ error: 'Team member role must be "author", "reviewer", or "admin".' });
          return;
        }
        if (requestedRole === 'admin' && req.user!.role !== 'admin') {
          res.status(403).json({
            error: 'Only organization Administrators can assign the Admin role.',
          });
          return;
        }
        const member = await createTeamMember({
          companyId: req.user!.companyId,
          companyName: req.user!.companyName,
          name,
          email,
          password,
          role: requestedRole,
        });
        res.status(201).json({ member });
      } catch (err) {
        if (err instanceof AuthValidationError || err instanceof AuthenticationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        const code = (err as { code?: string })?.code;
        if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: 'A team member with this email already exists.' });
          return;
        }
        console.error('[InkloomGuard AI] Create team member error:', err instanceof Error ? err.message : 'Unknown error');
        res.status(500).json({ error: 'Failed to create team member.' });
      }
    })
  );

  router.patch(
    '/team/members/:memberId/role',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req: AuthedRequest, res) => {
      const memberId = Number(req.params.memberId);
      if (!Number.isInteger(memberId) || memberId <= 0) {
        res.status(400).json({ error: 'Invalid team member ID.' });
        return;
      }

      if (memberId === req.user!.id) {
        res.status(403).json({ error: 'You cannot modify your own organization role.' });
        return;
      }

      const nextRole = typeof req.body?.role === 'string' ? req.body.role.trim().toLowerCase() : '';
      if (nextRole !== 'author' && nextRole !== 'reviewer' && nextRole !== 'admin') {
        res.status(400).json({ error: 'Role must be "author", "reviewer", or "admin".' });
        return;
      }

      const companyId = req.user!.companyId;
      const target = await db.get<{ id: number; role: string }>(
        'SELECT id, role FROM users WHERE id = ? AND company_id = ?',
        memberId,
        companyId
      );
      if (!target) {
        res.status(404).json({ error: 'Team member not found in your organization.' });
        return;
      }

      if ((nextRole === 'admin' || target.role === 'admin') && req.user!.role !== 'admin') {
        res.status(403).json({
          error: 'Only organization Administrators can assign or modify the Admin role.',
        });
        return;
      }

      if ((target.role === 'reviewer' || target.role === 'admin') && nextRole === 'author') {
        const reviewerCountRow = await db.get<{ c: number }>(
          "SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND role IN ('reviewer', 'admin')",
          companyId
        );
        if (Number(reviewerCountRow?.c ?? 0) <= 1) {
          res.status(400).json({
            error: 'At least one active Reviewer or Admin must remain in the organization.',
          });
          return;
        }
      }

      const nowIso = new Date().toISOString();
      await db.transaction(async (tx) => {
        await tx.run(
          'UPDATE users SET role = ?, token_version = token_version + 1, updated_at = ? WHERE id = ? AND company_id = ?',
          nextRole,
          nowIso,
          memberId,
          companyId
        );
        await tx.run(
          'UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND company_id = ? AND revoked_at IS NULL',
          nowIso,
          memberId,
          companyId
        );
      });

      const updatedRow = await db.get<{
        id: number;
        name: string;
        email: string;
        role: string;
        job_title: string | null;
        email_verified: unknown;
        created_at: string | Date;
      }>(
        'SELECT id, name, email, role, job_title, email_verified, created_at FROM users WHERE id = ? AND company_id = ?',
        memberId,
        companyId
      );
      if (!updatedRow) {
        res.status(404).json({ error: 'Team member not found.' });
        return;
      }

      res.json({
        member: {
          id: Number(updatedRow.id),
          name: updatedRow.name,
          email: updatedRow.email,
          role: updatedRow.role,
          jobTitle: String(updatedRow.job_title ?? ''),
          emailVerified:
            updatedRow.email_verified === true ||
            updatedRow.email_verified === 1 ||
            updatedRow.email_verified === '1' ||
            updatedRow.email_verified === 'true' ||
            updatedRow.email_verified === 't',
          createdAt:
            updatedRow.created_at instanceof Date
              ? updatedRow.created_at.toISOString()
              : String(updatedRow.created_at || ''),
        },
      });
    })
  );

  // ---------------- SELF-SERVICE PROFILE & AVATAR ----------------
  router.put(
    '/profile',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (body && typeof body === 'object' && 'role' in body) {
        res.status(403).json({
          error: 'Account role cannot be modified through profile settings.',
        });
        return;
      }

      const rawName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!rawName || rawName.length > 120) {
        res.status(400).json({ error: 'Display name must be between 1 and 120 characters.' });
        return;
      }

      const rawJobTitle = body.jobTitle === undefined || body.jobTitle === null ? '' : String(body.jobTitle).trim();
      if (rawJobTitle.length > 120) {
        res.status(400).json({ error: 'Job title cannot exceed 120 characters.' });
        return;
      }

      const rawBio = body.bio === undefined || body.bio === null ? '' : String(body.bio).trim();
      if (rawBio.length > 500) {
        res.status(400).json({ error: 'Bio cannot exceed 500 characters.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const result = await db.run(
        `UPDATE users
         SET name = ?,
             job_title = ?,
             bio = ?,
             updated_at = ?
         WHERE id = ? AND company_id = ?`,
        rawName,
        rawJobTitle,
        rawBio,
        nowIso,
        req.user!.id,
        req.user!.companyId
      );

      if (result.changes !== 1) {
        res.status(404).json({ error: 'User profile not found.' });
        return;
      }

      const updatedUser = await findUserByIdForAuth(req.user!.id, req.user!.companyId);
      if (!updatedUser) {
        res.status(404).json({ error: 'User profile not found.' });
        return;
      }

      res.json({ user: updatedUser });
    })
  );

  router.post(
    '/profile/avatar',
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        await runSingleAvatarUpload(req, res);
      } catch (err) {
        if (err instanceof multer.MulterError) {
          console.error('[InkloomGuard AI] Avatar upload middleware error:', err);
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'Profile picture exceeds the 5 MB size limit.' });
            return;
          }
          res.status(400).json({ error: 'Invalid profile picture upload.' });
          return;
        }
        throw err;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Please select an image file (PNG, JPEG, or WebP) to upload.' });
        return;
      }

      let sanitized: Awaited<ReturnType<typeof sanitizeAvatarImageBuffer>>;
      try {
        sanitized = await sanitizeAvatarImageBuffer(req.file.buffer, req.file.originalname);
      } catch (err) {
        console.error('[InkloomGuard AI] Avatar image validation error:', err);
        res.status(400).json({
          error: sanitizeUploadValidationMessage(err, 'Invalid profile picture upload.'),
        });
        return;
      }

      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const safeOriginalName = path.basename(req.file.originalname || `avatar${sanitized.ext}`).slice(0, 180);

      let uploaded: StoredObjectResult;
      try {
        uploaded = await uploadAsset({
          companyId,
          userId,
          assetKind: 'user_avatar',
          originalName: `avatar${sanitized.ext}`,
          buffer: sanitized.buffer,
          mimeType: sanitized.mimeType,
        });
      } catch (err) {
        console.error('[InkloomGuard AI] Avatar storage upload failed:', err instanceof Error ? err.message : 'Unknown error');
        res.status(500).json({ error: 'Unable to store profile picture right now.' });
        return;
      }

      let assetsToDelete: Array<{ backend: StorageBackend; storageKey: string; filename: string }> = [];
      try {
        const nowIso = new Date().toISOString();
        assetsToDelete = await db.transaction(async (tx) => {
          const prevUser = await tx.get<{ avatar_filename: string | null }>(
            'SELECT avatar_filename FROM users WHERE id = ? AND company_id = ?',
            userId,
            companyId
          );
          if (!prevUser) {
            throw new Error('User account not found.');
          }

          const existingRows = await tx.all<{
            storage_backend: StorageBackend;
            storage_key: string;
            filename: string;
          }>(
            `SELECT storage_backend, storage_key, filename
             FROM stored_files
             WHERE company_id = ? AND user_id = ? AND asset_kind = 'user_avatar'`,
            companyId,
            userId
          );

          const cleanupList: Array<{ backend: StorageBackend; storageKey: string; filename: string }> =
            existingRows.map((r) => ({
              backend: r.storage_backend === 'supabase' ? 'supabase' : 'local',
              storageKey: r.storage_key,
              filename: r.filename,
            }));

          if (
            prevUser.avatar_filename &&
            !cleanupList.some((item) => item.filename === prevUser.avatar_filename)
          ) {
            cleanupList.push({
              backend: uploaded.backend,
              storageKey: prevUser.avatar_filename,
              filename: prevUser.avatar_filename,
            });
          }

          await tx.run(
            `DELETE FROM stored_files
             WHERE company_id = ? AND user_id = ? AND asset_kind = 'user_avatar'`,
            companyId,
            userId
          );

          await tx.run(
            `UPDATE users
             SET avatar_filename = ?,
                 avatar_original_name = ?,
                 updated_at = ?
             WHERE id = ? AND company_id = ?`,
            uploaded.filename,
            safeOriginalName,
            nowIso,
            userId,
            companyId
          );

          await tx.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, user_id, submission_id, guideline_document_id,
              asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes
            ) VALUES (?, NULL, ?, NULL, NULL, 'user_avatar', ?, ?, ?, ?, ?, ?)`,
            companyId,
            userId,
            uploaded.backend,
            uploaded.storageKey,
            uploaded.filename,
            safeOriginalName,
            uploaded.mimeType,
            uploaded.sizeBytes
          );

          return cleanupList;
        });
      } catch (err) {
        await safeRollbackAssets([uploaded]);
        throw err;
      }

      // Clean up replaced avatar files after DB commit
      for (const oldAsset of assetsToDelete) {
        if (oldAsset.storageKey === uploaded.storageKey && oldAsset.filename === uploaded.filename) {
          continue;
        }
        try {
          await deleteAsset(oldAsset);
        } catch {
          // Best-effort cleanup
        }
      }

      const updatedUser = await findUserByIdForAuth(userId, companyId);
      if (!updatedUser) {
        res.status(404).json({ error: 'User profile not found.' });
        return;
      }

      res.json({ user: updatedUser });
    })
  );

  router.delete(
    '/profile/avatar',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.user!.id;
      const companyId = req.user!.companyId;
      const nowIso = new Date().toISOString();

      const assetsToDelete = await db.transaction(async (tx) => {
        const prevUser = await tx.get<{ avatar_filename: string | null }>(
          'SELECT avatar_filename FROM users WHERE id = ? AND company_id = ?',
          userId,
          companyId
        );
        if (!prevUser) {
          throw new Error('User account not found.');
        }

        const existingRows = await tx.all<{
          storage_backend: StorageBackend;
          storage_key: string;
          filename: string;
        }>(
          `SELECT storage_backend, storage_key, filename
           FROM stored_files
           WHERE company_id = ? AND user_id = ? AND asset_kind = 'user_avatar'`,
          companyId,
          userId
        );

        const cleanupList: Array<{ backend: StorageBackend; storageKey: string; filename: string }> =
          existingRows.map((r) => ({
            backend: r.storage_backend === 'supabase' ? 'supabase' : 'local',
            storageKey: r.storage_key,
            filename: r.filename,
          }));

        if (
          prevUser.avatar_filename &&
          !cleanupList.some((item) => item.filename === prevUser.avatar_filename)
        ) {
          cleanupList.push({
            backend: getStorageStatus().mode,
            storageKey: prevUser.avatar_filename,
            filename: prevUser.avatar_filename,
          });
        }

        await tx.run(
          `UPDATE users
           SET avatar_filename = NULL,
               avatar_original_name = NULL,
               updated_at = ?
           WHERE id = ? AND company_id = ?`,
          nowIso,
          userId,
          companyId
        );

        await tx.run(
          `DELETE FROM stored_files
           WHERE company_id = ? AND user_id = ? AND asset_kind = 'user_avatar'`,
          companyId,
          userId
        );

        return cleanupList;
      });

      for (const oldAsset of assetsToDelete) {
        try {
          await deleteAsset(oldAsset);
        } catch {
          // Best-effort cleanup
        }
      }

      const updatedUser = await findUserByIdForAuth(userId, companyId);
      if (!updatedUser) {
        res.status(404).json({ error: 'User profile not found.' });
        return;
      }

      res.json({ user: updatedUser });
    })
  );

  // ---------------- TENANT-PROTECTED FILE SERVING ----------------
  router.get(
    '/uploads/id/:fileId/signed-url',
    requireAuth,
    asyncHandler(async (req, res) => {
      const fileId = Number(req.params.fileId);
      if (!Number.isInteger(fileId) || fileId <= 0) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }

      const asset = await resolveTenantAssetById(req.user!.companyId, fileId);
      const access = checkAssetAccess(req.user!, asset);
      if (!access.allowed || !asset) {
        res.status(access.allowed ? 403 : access.status).json({
          error: access.allowed ? 'Access denied.' : access.error,
          ...(access.allowed || !access.code ? {} : { code: access.code }),
        });
        return;
      }

      const signedUrl = await createSignedAssetUrl({
        backend: asset.backend,
        storageKey: asset.storageKey,
        expiresInSeconds: 60,
      });

      res.json({
        url: signedUrl || `/api/uploads/id/${fileId}`,
        backend: asset.backend,
        expiresInSeconds: signedUrl ? 60 : null,
      });
    })
  );

  router.get(
    '/uploads/id/:fileId',
    requireAuth,
    asyncHandler(async (req, res) => {
      const fileId = Number(req.params.fileId);
      if (!Number.isInteger(fileId) || fileId <= 0) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }

      const asset = await resolveTenantAssetById(req.user!.companyId, fileId);
      const access = checkAssetAccess(req.user!, asset);
      if (!access.allowed || !asset) {
        res.status(access.allowed ? 403 : access.status).json({
          error: access.allowed ? 'Access denied.' : access.error,
          ...(access.allowed || !access.code ? {} : { code: access.code }),
        });
        return;
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await downloadAsset({
          backend: asset.backend,
          storageKey: asset.storageKey,
          filename: asset.filename,
        });
      } catch {
        res.status(404).json({ error: 'File not found.' });
        return;
      }

      res.setHeader('Content-Type', asset.mimeType || inferMimeType(asset.filename));
      res.setHeader('Content-Length', String(fileBuffer.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      const safeOriginal = asset.originalName.replace(/[\r\n"]/g, '');
      res.setHeader('Content-Disposition', `inline; filename="${safeOriginal}"`);
      if (path.extname(asset.filename).toLowerCase() === '.svg') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }
      res.send(fileBuffer);
    })
  );

  router.get(
    '/uploads/:filename/signed-url',
    requireAuth,
    asyncHandler(async (req, res) => {
      let safeFilename: string;
      try {
        safeFilename = sanitizeLookupFilename(String(req.params.filename));
      } catch {
        res.status(400).json({ error: 'Invalid file identifier.' });
        return;
      }

      const asset = await resolveTenantAsset(req.user!.companyId, safeFilename);
      const access = checkAssetAccess(req.user!, asset);
      if (!access.allowed || !asset) {
        res.status(access.allowed ? 403 : access.status).json({
          error: access.allowed ? 'Access denied.' : access.error,
          ...(access.allowed || !access.code ? {} : { code: access.code }),
        });
        return;
      }

      const signedUrl = await createSignedAssetUrl({
        backend: asset.backend,
        storageKey: asset.storageKey,
        expiresInSeconds: 60,
      });

      res.json({
        url: signedUrl || `/api/uploads/${encodeURIComponent(safeFilename)}`,
        backend: asset.backend,
        expiresInSeconds: signedUrl ? 60 : null,
      });
    })
  );

  router.get(
    '/uploads/:filename',
    requireAuth,
    asyncHandler(async (req, res) => {
      let safeFilename: string;
      try {
        safeFilename = sanitizeLookupFilename(String(req.params.filename));
      } catch {
        res.status(400).json({ error: 'Invalid file identifier.' });
        return;
      }

      const asset = await resolveTenantAsset(req.user!.companyId, safeFilename);
      const access = checkAssetAccess(req.user!, asset);
      if (!access.allowed || !asset) {
        res.status(access.allowed ? 403 : access.status).json({
          error: access.allowed ? 'Access denied.' : access.error,
          ...(access.allowed || !access.code ? {} : { code: access.code }),
        });
        return;
      }

      let fileBuffer: Buffer;
      try {
        fileBuffer = await downloadAsset({
          backend: asset.backend,
          storageKey: asset.storageKey,
          filename: asset.filename,
        });
      } catch {
        res.status(404).json({ error: 'File not found.' });
        return;
      }

      res.setHeader('Content-Type', asset.mimeType || inferMimeType(asset.filename));
      res.setHeader('Content-Length', String(fileBuffer.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      const safeOriginal = asset.originalName.replace(/[\r\n"]/g, '');
      res.setHeader('Content-Disposition', `inline; filename="${safeOriginal}"`);

      const ext = path.extname(asset.filename).toLowerCase();
      if (ext === '.svg') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      }

      res.send(fileBuffer);
    })
  );

  // ---------------- DASHBOARD ----------------
  router.get(
    '/dashboard',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required. Please sign in.' });
        return;
      }
      const companyId = req.user.companyId;

      const totalSubmissionsRow = await db.get<{ c: number | string }>(
        'SELECT CAST(COUNT(*) AS INTEGER) AS c FROM submissions WHERE company_id = ?',
        companyId
      );
      const issuesFoundRow = await db.get<{ c: number | string }>(
        "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM compliance_issues WHERE company_id = ? AND resolution_status = 'open'",
        companyId
      );
      const pendingReviewsRow = await db.get<{ c: number | string }>(
        "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM submissions WHERE company_id = ? AND status IN ('pending_review', 'analyzed', 'revision_saved', 'changes_requested')",
        companyId
      );
      const approvedContentRow = await db.get<{ c: number | string }>(
        "SELECT CAST(COUNT(*) AS INTEGER) AS c FROM submissions WHERE company_id = ? AND status = 'approved'",
        companyId
      );

      const brands = await db.all(
        `SELECT b.*,
          (SELECT CAST(COUNT(*) AS INTEGER) FROM approved_facts f WHERE f.brand_id = b.id AND f.company_id = b.company_id) AS "factsCount",
          (SELECT CAST(COUNT(*) AS INTEGER) FROM terminology_rules t WHERE t.brand_id = b.id AND t.company_id = b.company_id) AS "terminologyCount",
          (SELECT CAST(COUNT(*) AS INTEGER) FROM submissions s WHERE s.brand_id = b.id AND s.company_id = b.company_id) AS "submissionsCount"
         FROM brands b
         WHERE b.company_id = ?
         ORDER BY b.created_at DESC`,
        companyId
      );

      const recentActivity = await db.all(
        `SELECT r.id, r.submission_id, r.reviewer_name, r.decision, r.comment, r.previous_status, r.new_status, r.created_at,
                s.title AS submission_title, b.name AS brand_name
         FROM review_events r
         JOIN submissions s ON s.id = r.submission_id
         JOIN brands b ON b.id = s.brand_id
         WHERE r.company_id = ?
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 12`,
        companyId
      );

      res.json({
        metrics: {
          totalSubmissions: Number(totalSubmissionsRow?.c ?? 0),
          issuesFound: Number(issuesFoundRow?.c ?? 0),
          pendingReviews: Number(pendingReviewsRow?.c ?? 0),
          approvedContent: Number(approvedContentRow?.c ?? 0),
        },
        brands,
        recentActivity,
      });
    })
  );

  // ---------------- GOVERNANCE ANALYTICS ----------------
  router.get(
    '/analytics/governance',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req: AuthedRequest, res) => {
      if (
        req.query?.scope === 'organization' &&
        req.user!.role !== 'reviewer' &&
        req.user!.role !== 'admin'
      ) {
        res.status(403).json({
          error: 'Organization-wide analytics scope is restricted to Brand Reviewers & Admins.',
        });
        return;
      }
      try {
        const analytics = await getGovernanceAnalytics(req.user!, {
          range: req.query?.range,
          startDate: req.query?.startDate,
          endDate: req.query?.endDate,
          brandId: req.query?.brandId,
          category: req.query?.category,
          status: req.query?.status,
          page: req.query?.page,
          limit: req.query?.limit,
        });
        res.json(analytics);
      } catch (err) {
        if (err instanceof AnalyticsValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.get(
    '/analytics/recurring-violations',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        const data = await getRecurringViolationsAnalytics(req.user!, {
          range: req.query?.range,
          startDate: req.query?.startDate,
          endDate: req.query?.endDate,
          brandId: req.query?.brandId,
          category: req.query?.category,
          status: req.query?.status,
          page: req.query?.page,
          limit: req.query?.limit,
        });
        res.json(data);
      } catch (err) {
        if (err instanceof AnalyticsValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  router.get(
    '/analytics/team',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req: AuthedRequest, res) => {
      try {
        const team = await getTeamAnalytics(req.user!, {
          range: req.query?.range,
          startDate: req.query?.startDate,
          endDate: req.query?.endDate,
          brandId: req.query?.brandId,
          category: req.query?.category,
          status: req.query?.status,
        });
        res.json(team);
      } catch (err) {
        if (err instanceof AnalyticsValidationError) {
          res.status(err.statusCode).json({ error: err.message });
          return;
        }
        throw err;
      }
    })
  );

  // ---------------- BRANDS ----------------
  router.get(
    '/brands',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const brands = await db.all(
        'SELECT * FROM brands WHERE company_id = ? ORDER BY created_at DESC',
        req.user!.companyId
      );
      res.json({ brands });
    })
  );

  router.post(
    '/brands',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    upload.single('logo'),
    asyncHandler(async (req, res) => {
      let uploadedLogo: StoredObjectResult | null = null;
      try {
        const companyId = req.user!.companyId;
        const { name, industry, primaryColor, secondaryColor } = req.body ?? {};
        if (!name || !String(name).trim()) {
          res.status(400).json({ error: 'Brand name is required.' });
          return;
        }

        const rawPrimary = typeof primaryColor === 'string' ? primaryColor.trim() : '';
        const rawSecondary = typeof secondaryColor === 'string' ? secondaryColor.trim() : '';
        const normalizedPrimary = rawPrimary ? normalizeHexColor(rawPrimary) : '#4F46E5';
        const normalizedSecondary = rawSecondary ? normalizeHexColor(rawSecondary) : '#06B6D4';
        if (!normalizedPrimary) {
          res.status(400).json({ error: 'Invalid primary brand hex color. Expected #RRGGBB format.' });
          return;
        }
        if (!normalizedSecondary) {
          res.status(400).json({ error: 'Invalid secondary brand hex color. Expected #RRGGBB format.' });
          return;
        }

        if (req.file) {
          try {
            const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
            await validateRasterImageBuffer(req.file.buffer, ext);
          } catch (validationErr) {
            console.error('[InkloomGuard AI] Brand logo validation error:', validationErr);
            res.status(400).json({
              error: sanitizeUploadValidationMessage(validationErr, 'Invalid brand logo upload.'),
            });
            return;
          }
        }

        const brandId = await db.transaction(async (tx) => {
          const createdId = await tx.insert(
            `INSERT INTO brands (company_id, name, industry, primary_color, secondary_color, logo_filename, logo_original_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            String(name).trim(),
            String(industry || '').trim(),
            normalizedPrimary,
            normalizedSecondary,
            null,
            req.file ? req.file.originalname : null
          );

          await tx.insert(
            'INSERT INTO brand_rules (company_id, brand_id, tone_rules, messaging_rules) VALUES (?, ?, ?, ?)',
            companyId,
            createdId,
            '',
            ''
          );

          if (req.file) {
            uploadedLogo = await uploadAsset({
              companyId,
              brandId: createdId,
              assetKind: 'brand_logo',
              originalName: req.file.originalname,
              buffer: req.file.buffer,
              mimeType: req.file.mimetype,
            });

            await tx.run(
              'UPDATE brands SET logo_filename = ?, logo_original_name = ? WHERE id = ? AND company_id = ?',
              uploadedLogo.filename,
              req.file.originalname,
              createdId,
              companyId
            );

            await tx.insert(
              `INSERT INTO stored_files (
                company_id, brand_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              companyId,
              createdId,
              'brand_logo',
              uploadedLogo.backend,
              uploadedLogo.storageKey,
              uploadedLogo.filename,
              req.file.originalname,
              uploadedLogo.mimeType,
              uploadedLogo.sizeBytes,
              req.user!.id
            );
          }

          return createdId;
        });

        invalidateAnalyticsCache(companyId);
        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.status(201).json({ brand });
      } catch (err) {
        await safeRollbackAssets([uploadedLogo]);
        console.error('[InkloomGuard AI] Create brand error:', err);
        res.status(500).json({ error: 'Failed to create brand.' });
      }
    })
  );

  router.put(
    '/brands/:id',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    upload.single('logo'),
    asyncHandler(async (req, res) => {
      let uploadedLogo: StoredObjectResult | null = null;
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.id);
        if (!Number.isInteger(brandId) || brandId <= 0) {
          res.status(400).json({ error: 'Invalid brand ID.' });
          return;
        }
        const existing = await db.get<{
          id: number;
          name: string;
          industry: string;
          primary_color: string;
          secondary_color: string;
          logo_filename: string | null;
          logo_original_name: string | null;
        }>('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);

        if (!existing) {
          res.status(404).json({ error: 'Brand not found in your organization.' });
          return;
        }

        const { name, industry, primaryColor, secondaryColor } = req.body ?? {};
        const rawPrimary = typeof primaryColor === 'string' ? primaryColor.trim() : '';
        const rawSecondary = typeof secondaryColor === 'string' ? secondaryColor.trim() : '';
        const nextPrimary = rawPrimary ? normalizeHexColor(rawPrimary) : existing.primary_color;
        const nextSecondary = rawSecondary ? normalizeHexColor(rawSecondary) : existing.secondary_color;
        if (!nextPrimary) {
          res.status(400).json({ error: 'Invalid primary brand hex color. Expected #RRGGBB format.' });
          return;
        }
        if (!nextSecondary) {
          res.status(400).json({ error: 'Invalid secondary brand hex color. Expected #RRGGBB format.' });
          return;
        }

        if (req.file) {
          try {
            const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
            await validateRasterImageBuffer(req.file.buffer, ext);
          } catch (validationErr) {
            console.error('[InkloomGuard AI] Brand logo update validation error:', validationErr);
            res.status(400).json({
              error: sanitizeUploadValidationMessage(validationErr, 'Invalid brand logo upload.'),
            });
            return;
          }
          uploadedLogo = await uploadAsset({
            companyId,
            brandId,
            assetKind: 'brand_logo',
            originalName: req.file.originalname,
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
          });
        }

        const oldLogoAsset =
          uploadedLogo && existing.logo_filename
            ? await db.get<{ id: number; storage_backend: StorageBackend; storage_key: string; filename: string }>(
                `SELECT id, storage_backend, storage_key, filename
                 FROM stored_files
                 WHERE company_id = ? AND brand_id = ? AND asset_kind = 'brand_logo' AND filename = ?`,
                companyId,
                brandId,
                existing.logo_filename
              )
            : null;

        await db.transaction(async (tx) => {
          let logoFilename = existing.logo_filename;
          let logoOrig = existing.logo_original_name;

          if (uploadedLogo && req.file) {
            logoFilename = uploadedLogo.filename;
            logoOrig = req.file.originalname;

            await tx.insert(
              `INSERT INTO stored_files (
                company_id, brand_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              companyId,
              brandId,
              'brand_logo',
              uploadedLogo.backend,
              uploadedLogo.storageKey,
              uploadedLogo.filename,
              req.file.originalname,
              uploadedLogo.mimeType,
              uploadedLogo.sizeBytes,
              req.user!.id
            );

            if (oldLogoAsset) {
              await tx.run('DELETE FROM stored_files WHERE id = ? AND company_id = ?', oldLogoAsset.id, companyId);
            }
          }

          await tx.run(
            `UPDATE brands
             SET name = ?,
                 industry = ?,
                 primary_color = ?,
                 secondary_color = ?,
                 logo_filename = ?,
                 logo_original_name = ?
             WHERE id = ? AND company_id = ?`,
            name ? String(name).trim() : existing.name,
            industry !== undefined ? String(industry).trim() : existing.industry,
            nextPrimary,
            nextSecondary,
            logoFilename,
            logoOrig,
            brandId,
            companyId
          );
        });

        if (oldLogoAsset) {
          try {
            await deleteAsset({
              backend: oldLogoAsset.storage_backend === 'supabase' ? 'supabase' : 'local',
              storageKey: oldLogoAsset.storage_key,
              filename: oldLogoAsset.filename,
            });
          } catch {
            // Non-fatal post-commit cleanup
          }
        }

        invalidateAnalyticsCache(companyId);
        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.json({ brand });
      } catch (err) {
        await safeRollbackAssets([uploadedLogo]);
        console.error('[InkloomGuard AI] Update brand error:', err);
        res.status(500).json({ error: 'Failed to update brand.' });
      }
    })
  );

  router.delete(
    '/brands/:id',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.id);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }

      const assetsToRemove = await db.all<{
        storage_backend: StorageBackend;
        storage_key: string;
        filename: string;
      }>(
        'SELECT storage_backend, storage_key, filename FROM stored_files WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );

      const resDel = await db.run('DELETE FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (resDel.changes === 0) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      for (const asset of assetsToRemove) {
        try {
          await deleteAsset({
            backend: asset.storage_backend === 'supabase' ? 'supabase' : 'local',
            storageKey: asset.storage_key,
            filename: asset.filename,
          });
        } catch {
          // Non-fatal cleanup
        }
      }

      invalidateAnalyticsCache(companyId);
      res.json({ ok: true });
    })
  );

  // ---------------- BRAND GUIDELINES ----------------
  router.get(
    '/guidelines/:brandId',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }
      const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const documents = await db.all(
        'SELECT * FROM guideline_documents WHERE brand_id = ? AND company_id = ? ORDER BY created_at DESC',
        brandId,
        companyId
      );
      const facts = await db.all(
        'SELECT * FROM approved_facts WHERE brand_id = ? AND company_id = ? ORDER BY id DESC',
        brandId,
        companyId
      );
      const terminology = await db.all(
        'SELECT * FROM terminology_rules WHERE brand_id = ? AND company_id = ? ORDER BY id DESC',
        brandId,
        companyId
      );
      const rules =
        (await db.get('SELECT * FROM brand_rules WHERE brand_id = ? AND company_id = ?', brandId, companyId)) || {
          tone_rules: '',
          messaging_rules: '',
        };
      const vgRow = await db.get<BrandVisualGuidelineRow>(
        'SELECT * FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );
      const variantRows = await db.all<BrandLogoVariantRow>(
        'SELECT * FROM brand_logo_variants WHERE brand_id = ? AND company_id = ? ORDER BY id ASC',
        brandId,
        companyId
      );

      res.json({
        brand,
        documents,
        facts,
        terminology,
        rules,
        visualGuidelines: parseVisualGuidelinesRow(vgRow),
        logoVariants: variantRows.map(serializePublicLogoVariant),
      });
    })
  );

  router.put(
    '/guidelines/:brandId/visual',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const body = req.body ?? {};
      if (body.accentColors !== undefined) {
        if (!Array.isArray(body.accentColors)) {
          res.status(400).json({ error: 'accentColors must be an array of hex colors.' });
          return;
        }
        for (const item of body.accentColors) {
          if (typeof item === 'string' && item.trim() && !normalizeHexColor(item)) {
            res.status(400).json({ error: `Invalid accent hex color "${item}". Expected #RRGGBB format.` });
            return;
          }
        }
      }
      if (body.approvedBackgrounds !== undefined) {
        if (!Array.isArray(body.approvedBackgrounds)) {
          res.status(400).json({ error: 'approvedBackgrounds must be an array of hex colors.' });
          return;
        }
        for (const item of body.approvedBackgrounds) {
          if (typeof item === 'string' && item.trim() && !normalizeHexColor(item)) {
            res.status(400).json({ error: `Invalid approved background hex color "${item}". Expected #RRGGBB format.` });
            return;
          }
        }
      }

      const sanitized = sanitizeVisualGuidelinesConfig(body);
      const existing = await db.get<{ id: number; source_document_id: number | null }>(
        'SELECT id, source_document_id FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );

      if (existing) {
        await db.run(
          `UPDATE brand_visual_guidelines
           SET accent_colors_json = ?,
               approved_backgrounds_json = ?,
               logo_rules_json = ?,
               typography_rules_json = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE brand_id = ? AND company_id = ?`,
          JSON.stringify(sanitized.accentColors),
          JSON.stringify(sanitized.approvedBackgrounds),
          JSON.stringify(sanitized.logoRules),
          JSON.stringify(sanitized.typographyRules),
          brandId,
          companyId
        );
      } else {
        await db.insert(
          `INSERT INTO brand_visual_guidelines (
            company_id, brand_id, accent_colors_json, approved_backgrounds_json, logo_rules_json, typography_rules_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          companyId,
          brandId,
          JSON.stringify(sanitized.accentColors),
          JSON.stringify(sanitized.approvedBackgrounds),
          JSON.stringify(sanitized.logoRules),
          JSON.stringify(sanitized.typographyRules)
        );
      }

      const updatedRow = await db.get<BrandVisualGuidelineRow>(
        'SELECT * FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );
      invalidateAnalyticsCache(companyId);
      res.json({ visualGuidelines: parseVisualGuidelinesRow(updatedRow) });
    })
  );

  router.post(
    '/guidelines/:brandId/logo-variants',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    upload.single('logo'),
    asyncHandler(async (req, res) => {
      let uploadedVariant: StoredObjectResult | null = null;
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.brandId);
        if (!Number.isInteger(brandId) || brandId <= 0) {
          res.status(400).json({ error: 'Invalid brand ID.' });
          return;
        }
        const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        if (!brand) {
          res.status(404).json({ error: 'Brand not found.' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Please select a logo image file (PNG, JPEG, WebP, or SVG).' });
          return;
        }

        let profile: LogoReferenceProfile;
        try {
          const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
          await validateRasterImageBuffer(req.file.buffer, ext);
          profile = await extractLogoReferenceProfile(req.file.buffer, req.file.originalname);
        } catch (validationErr) {
          console.error('[InkloomGuard AI] Logo variant validation error:', validationErr);
          res.status(400).json({
            error: sanitizeUploadValidationMessage(validationErr, 'Invalid logo variant image.'),
          });
          return;
        }

        const rawLabel = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
        const defaultLabel = path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 80);
        const label = (rawLabel || defaultLabel || 'Logo Variant').slice(0, 100);
        const rawType = typeof req.body?.variantType === 'string' ? req.body.variantType.trim().toLowerCase() : 'secondary';
        const variantType = ['primary', 'secondary', 'dark', 'light', 'monochrome', 'icon'].includes(rawType)
          ? rawType
          : 'secondary';

        uploadedVariant = await uploadAsset({
          companyId,
          brandId,
          assetKind: 'brand_logo',
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
        });

        const variantId = await db.transaction(async (tx) => {
          const insertedId = await tx.insert(
            `INSERT INTO brand_logo_variants (
              company_id, brand_id, label, variant_type, filename, original_name,
              width, height, aspect_ratio, dominant_colors_json, features_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            label,
            variantType,
            uploadedVariant!.filename,
            req.file!.originalname,
            profile.fgWidth || profile.width,
            profile.fgHeight || profile.height,
            profile.aspectRatio,
            JSON.stringify(profile.dominantColors),
            JSON.stringify(profile)
          );

          await tx.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            'brand_logo',
            uploadedVariant!.backend,
            uploadedVariant!.storageKey,
            uploadedVariant!.filename,
            req.file!.originalname,
            uploadedVariant!.mimeType,
            uploadedVariant!.sizeBytes,
            req.user!.id
          );

          return insertedId;
        });

        const created = await db.get<BrandLogoVariantRow>(
          'SELECT * FROM brand_logo_variants WHERE id = ? AND company_id = ?',
          variantId,
          companyId
        );
        if (!created) {
          res.status(500).json({ error: 'Logo variant could not be retrieved after creation.' });
          return;
        }
        invalidateAnalyticsCache(companyId);
        res.status(201).json({ variant: serializePublicLogoVariant(created) });
      } catch (err) {
        await safeRollbackAssets([uploadedVariant]);
        console.error('[InkloomGuard AI] Upload logo variant error:', err);
        res.status(500).json({ error: 'Failed to upload logo variant.' });
      }
    })
  );

  router.delete(
    '/guidelines/:brandId/logo-variants/:variantId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const variantId = Number(req.params.variantId);
      if (!Number.isInteger(brandId) || brandId <= 0 || !Number.isInteger(variantId) || variantId <= 0) {
        res.status(400).json({ error: 'Invalid brand or variant ID.' });
        return;
      }

      const existing = await db.get<{ id: number; filename: string }>(
        'SELECT id, filename FROM brand_logo_variants WHERE id = ? AND brand_id = ? AND company_id = ?',
        variantId,
        brandId,
        companyId
      );
      if (!existing) {
        res.status(404).json({ error: 'Logo variant not found.' });
        return;
      }

      const storedAsset = await db.get<{ id: number; storage_backend: StorageBackend; storage_key: string; filename: string }>(
        `SELECT id, storage_backend, storage_key, filename
         FROM stored_files
         WHERE company_id = ? AND brand_id = ? AND asset_kind = 'brand_logo' AND filename = ?`,
        companyId,
        brandId,
        existing.filename
      );

      await db.transaction(async (tx) => {
        await tx.run(
          'DELETE FROM brand_logo_variants WHERE id = ? AND brand_id = ? AND company_id = ?',
          variantId,
          brandId,
          companyId
        );
        if (storedAsset) {
          await tx.run('DELETE FROM stored_files WHERE id = ? AND company_id = ?', storedAsset.id, companyId);
        }
      });

      try {
        await deleteAsset({
          backend: storedAsset?.storage_backend === 'supabase' ? 'supabase' : getStorageStatus().mode,
          storageKey: storedAsset?.storage_key || existing.filename,
          filename: existing.filename,
        });
      } catch {
        // Non-fatal post-commit cleanup
      }

      invalidateAnalyticsCache(companyId);
      res.json({ ok: true });
    })
  );

  router.post(
    '/guidelines/:brandId/upload',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    upload.single('document'),
    asyncHandler(async (req, res) => {
      let storedDoc: StoredObjectResult | null = null;
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.brandId);
        if (!Number.isInteger(brandId) || brandId <= 0) {
          res.status(400).json({ error: 'Invalid brand ID.' });
          return;
        }
        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        if (!brand) {
          res.status(404).json({ error: 'Brand not found.' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Please select a PDF, DOCX, or TXT guideline file.' });
          return;
        }

        let ext: string;
        let extractionDetails: Awaited<ReturnType<typeof extractDocumentDetailsFromBuffer>>;
        try {
          ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_DOC_EXTENSIONS);
          extractionDetails = await extractDocumentDetailsFromBuffer(req.file.buffer, req.file.originalname);
        } catch (validationErr) {
          console.error('[InkloomGuard AI] Guideline document validation/parse error:', validationErr);
          res.status(400).json({
            error: sanitizeUploadValidationMessage(
              validationErr,
              'Unable to read the uploaded guideline document. Please upload a valid PDF, DOCX, TXT, or Markdown file.'
            ),
          });
          return;
        }

        if (extractionDetails.isScannedOrEmpty || !extractionDetails.text) {
          res.status(400).json({
            error:
              ext === '.pdf'
                ? 'This PDF appears to be scanned or contains no selectable text layer. Please upload a text-searchable PDF, DOCX, TXT, or Markdown file.'
                : 'No readable text could be extracted from the uploaded file.',
          });
          return;
        }

        const contentHash = sha256Hex([req.file.buffer]);

        storedDoc = await uploadAsset({
          companyId,
          brandId,
          assetKind: 'guideline_document',
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
        });

        const docId = await db.transaction(async (tx) => {
          const insertedId = await tx.insert(
            `INSERT INTO guideline_documents (
              company_id, brand_id, filename, original_name, file_type, extracted_text,
              content_hash, page_count, extraction_status, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
            companyId,
            brandId,
            storedDoc!.filename,
            req.file!.originalname,
            ext.replace('.', '').toUpperCase(),
            extractionDetails.text,
            contentHash,
            extractionDetails.pageCount ?? 1,
            req.user!.id
          );

          await tx.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, guideline_document_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            insertedId,
            'guideline_document',
            storedDoc!.backend,
            storedDoc!.storageKey,
            storedDoc!.filename,
            req.file!.originalname,
            storedDoc!.mimeType,
            storedDoc!.sizeBytes,
            req.user!.id
          );

          return insertedId;
        });

        let autoExtracted = null;
        let extractionStatus: string = 'pending';
        let extractionError: string | null = null;
        let conflicts: ReturnType<typeof detectGuidelineConflicts> = [];

        if (req.body?.autoExtract === 'true') {
          // Check cache for identical content_hash in this brand
          const cachedDoc = await db.get<{ extracted_rules_json: string | null }>(
            `SELECT extracted_rules_json
             FROM guideline_documents
             WHERE company_id = ? AND brand_id = ? AND content_hash = ? AND extraction_status = 'completed'
               AND extracted_rules_json IS NOT NULL AND id != ?
             ORDER BY id DESC LIMIT 1`,
            companyId,
            brandId,
            contentHash,
            docId
          );

          try {
            if (cachedDoc?.extracted_rules_json) {
              autoExtracted = JSON.parse(cachedDoc.extracted_rules_json);
            } else {
              autoExtracted = await extractStructuredGuidelinesFromText(extractionDetails.text, req.file.originalname);
            }
            extractionStatus = 'completed';
            await db.run(
              `UPDATE guideline_documents
               SET extracted_rules_json = ?, extracted_at = CURRENT_TIMESTAMP, extraction_status = 'completed', extraction_error = NULL
               WHERE id = ? AND company_id = ?`,
              JSON.stringify(autoExtracted),
              docId,
              companyId
            );

            const existingFacts = await db.all<{ fact_key: string; fact_value: string }>(
              'SELECT fact_key, fact_value FROM approved_facts WHERE brand_id = ? AND company_id = ?',
              brandId,
              companyId
            );
            const existingTerms = await db.all<{ prohibited_term: string; preferred_term: string }>(
              'SELECT prohibited_term, preferred_term FROM terminology_rules WHERE brand_id = ? AND company_id = ?',
              brandId,
              companyId
            );
            conflicts = detectGuidelineConflicts({
              existingFacts,
              existingTerms,
              incomingFacts: autoExtracted.facts || [],
              incomingTerms: autoExtracted.terminology || [],
            });
          } catch (extractErr) {
            console.error('[InkloomGuard AI] Guideline auto-extract error:', extractErr);
            extractionStatus = 'failed';
            extractionError = sanitizeAiRouteError(
              extractErr,
              'AI guideline extraction failed. Please retry from the document panel.'
            ).error;
            await db.run(
              `UPDATE guideline_documents SET extraction_status = 'failed', extraction_error = ? WHERE id = ? AND company_id = ?`,
              extractionError,
              docId,
              companyId
            );
          }
        }

        const doc = await db.get('SELECT * FROM guideline_documents WHERE id = ? AND company_id = ?', docId, companyId);
        // Proposal-only response: rules are NEVER applied to brand profile without explicit reviewer confirmation
        res.status(201).json({
          document: doc,
          autoExtracted,
          extractionStatus,
          extractionError,
          conflicts,
        });
      } catch (err) {
        await safeRollbackAssets([storedDoc]);
        console.error('[InkloomGuard AI] Guideline upload error:', err);
        res.status(500).json({ error: 'Guideline upload failed.' });
      }
    })
  );

  router.post(
    '/guidelines/:brandId/ai-extract/:docId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const docId = Number(req.params.docId);
      if (!Number.isInteger(brandId) || brandId <= 0 || !Number.isInteger(docId) || docId <= 0) {
        res.status(400).json({ error: 'Invalid brand or document ID.' });
        return;
      }
      const force = Boolean(req.body?.force);

      const doc = await db.get<{
        id: number;
        extracted_text: string;
        original_name: string;
        extraction_status: string | null;
        extracted_rules_json: string | null;
      }>(
        'SELECT id, extracted_text, original_name, extraction_status, extracted_rules_json FROM guideline_documents WHERE id = ? AND brand_id = ? AND company_id = ?',
        docId,
        brandId,
        companyId
      );

      if (!doc) {
        res.status(404).json({ error: 'Guideline document not found.' });
        return;
      }

      try {
        let extracted = null;
        let cached = false;
        if (!force && doc.extraction_status === 'completed' && doc.extracted_rules_json) {
          try {
            extracted = JSON.parse(doc.extracted_rules_json);
            cached = true;
          } catch {
            extracted = null;
          }
        }

        if (!extracted) {
          extracted = await extractStructuredGuidelinesFromText(doc.extracted_text, doc.original_name);
          await db.run(
            `UPDATE guideline_documents
             SET extracted_rules_json = ?, extracted_at = CURRENT_TIMESTAMP, extraction_status = 'completed', extraction_error = NULL
             WHERE id = ? AND company_id = ?`,
            JSON.stringify(extracted),
            docId,
            companyId
          );
        }

        const existingFacts = await db.all<{ fact_key: string; fact_value: string }>(
          'SELECT fact_key, fact_value FROM approved_facts WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );
        const existingTerms = await db.all<{ prohibited_term: string; preferred_term: string }>(
          'SELECT prohibited_term, preferred_term FROM terminology_rules WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );
        const conflicts = detectGuidelineConflicts({
          existingFacts,
          existingTerms,
          incomingFacts: extracted.facts || [],
          incomingTerms: extracted.terminology || [],
        });

        res.json({ extracted, cached, conflicts });
      } catch (err) {
        console.error('[InkloomGuard AI] Guideline AI extract error:', err);
        const sanitized = sanitizeAiRouteError(
          err,
          'AI guideline extraction failed due to a server error. Please try again shortly.'
        );
        await db
          .run(
            `UPDATE guideline_documents SET extraction_status = 'failed', extraction_error = ? WHERE id = ? AND company_id = ?`,
            sanitized.error,
            docId,
            companyId
          )
          .catch(() => {});
        res.status(sanitized.status).json({ error: sanitized.error });
      }
    })
  );

  router.delete(
    '/guidelines/:brandId/documents/:docId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const docId = Number(req.params.docId);
      if (!Number.isInteger(brandId) || brandId <= 0 || !Number.isInteger(docId) || docId <= 0) {
        res.status(400).json({ error: 'Invalid brand or document ID.' });
        return;
      }

      const assets = await db.all<{ storage_backend: StorageBackend; storage_key: string; filename: string }>(
        `SELECT storage_backend, storage_key, filename
         FROM stored_files
         WHERE company_id = ? AND brand_id = ? AND guideline_document_id = ?`,
        companyId,
        brandId,
        docId
      );

      const del = await db.run(
        'DELETE FROM guideline_documents WHERE id = ? AND brand_id = ? AND company_id = ?',
        docId,
        brandId,
        companyId
      );
      if (del.changes === 0) {
        res.status(404).json({ error: 'Guideline document not found.' });
        return;
      }

      for (const a of assets) {
        try {
          await deleteAsset({
            backend: a.storage_backend === 'supabase' ? 'supabase' : 'local',
            storageKey: a.storage_key,
            filename: a.filename,
          });
        } catch {
          // Non-fatal cleanup
        }
      }

      res.json({ ok: true });
    })
  );

  router.post(
    '/guidelines/:brandId/apply-extracted',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }

      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { toneRules, messagingRules, facts, terminology, visualGuidelines: incomingVisualRaw, sourceDoc, sourceDocId } = (req.body ?? {}) as {
        toneRules?: unknown;
        messagingRules?: unknown;
        sourceDoc?: unknown;
        sourceDocId?: unknown;
        visualGuidelines?: unknown;
        facts?: Array<{
          fact_key?: unknown;
          fact_value?: unknown;
          source_page?: unknown;
          source_section?: unknown;
          source_excerpt?: unknown;
        }>;
        terminology?: Array<{
          prohibited_term?: unknown;
          preferred_term?: unknown;
          severity?: unknown;
          notes?: unknown;
          source_page?: unknown;
          source_section?: unknown;
          source_excerpt?: unknown;
        }>;
      };

      // Strictly verify provenance against an actual uploaded guideline_documents row for this brand & company
      let verifiedDoc: { id: number; original_name: string } | undefined;
      if (sourceDocId !== undefined && sourceDocId !== null && sourceDocId !== '') {
        const parsedDocId = Number(sourceDocId);
        if (!Number.isInteger(parsedDocId) || parsedDocId <= 0) {
          res.status(400).json({ error: 'Invalid sourceDocId provenance identifier.' });
          return;
        }
        verifiedDoc = await db.get<{ id: number; original_name: string }>(
          'SELECT id, original_name FROM guideline_documents WHERE id = ? AND brand_id = ? AND company_id = ?',
          parsedDocId,
          brandId,
          companyId
        );
        if (!verifiedDoc) {
          res.status(404).json({ error: 'Source guideline document not found for this brand.' });
          return;
        }
      } else if (typeof sourceDoc === 'string' && sourceDoc.trim()) {
        verifiedDoc = await db.get<{ id: number; original_name: string }>(
          `SELECT id, original_name
           FROM guideline_documents
           WHERE brand_id = ? AND company_id = ? AND LOWER(original_name) = LOWER(?)
           ORDER BY id DESC LIMIT 1`,
          brandId,
          companyId,
          sourceDoc.trim()
        );
        if (!verifiedDoc) {
          res.status(400).json({
            error: 'Valid sourceDocId or matching uploaded brand guideline document is required for rule provenance.',
          });
          return;
        }
      } else {
        res.status(400).json({ error: 'Source guideline document provenance (sourceDocId) is required.' });
        return;
      }

      const sourceName = verifiedDoc.original_name;
      const verifiedDocId = verifiedDoc.id;

      const incomingTone = typeof toneRules === 'string' ? toneRules.trim() : '';
      const incomingMessaging = typeof messagingRules === 'string' ? messagingRules.trim() : '';
      const incomingFacts = Array.isArray(facts) ? facts.slice(0, 25) : [];
      const incomingTerms = Array.isArray(terminology) ? terminology.slice(0, 35) : [];

      const result = await db.transaction(async (tx) => {
        const existingRules = await tx.get<{ id: number; tone_rules: string; messaging_rules: string }>(
          'SELECT id, tone_rules, messaging_rules FROM brand_rules WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );

        let rulesUpdated = false;
        const nextTone = incomingTone || existingRules?.tone_rules || '';
        const nextMessaging = incomingMessaging || existingRules?.messaging_rules || '';

        if (incomingTone || incomingMessaging) {
          if (existingRules) {
            if (nextTone !== existingRules.tone_rules || nextMessaging !== existingRules.messaging_rules) {
              await tx.run(
                'UPDATE brand_rules SET tone_rules = ?, messaging_rules = ?, source_document_id = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ? AND company_id = ?',
                nextTone,
                nextMessaging,
                verifiedDocId,
                brandId,
                companyId
              );
              rulesUpdated = true;
            }
          } else {
            await tx.insert(
              'INSERT INTO brand_rules (company_id, brand_id, tone_rules, messaging_rules, source_document_id) VALUES (?, ?, ?, ?, ?)',
              companyId,
              brandId,
              nextTone,
              nextMessaging,
              verifiedDocId
            );
            rulesUpdated = true;
          }
        }

        const existingFacts = await tx.all<{ fact_key: string; fact_value: string }>(
          'SELECT fact_key, fact_value FROM approved_facts WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );
        const existingTerms = await tx.all<{ prohibited_term: string; preferred_term: string }>(
          'SELECT prohibited_term, preferred_term FROM terminology_rules WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );

        const conflicts = detectGuidelineConflicts({
          existingFacts,
          existingTerms,
          incomingFacts: incomingFacts
            .filter((f) => typeof f?.fact_key === 'string' && typeof f?.fact_value === 'string')
            .map((f) => ({ fact_key: String(f.fact_key), fact_value: String(f.fact_value) })),
          incomingTerms: incomingTerms
            .filter((t) => typeof t?.prohibited_term === 'string' && typeof t?.preferred_term === 'string')
            .map((t) => ({ prohibited_term: String(t.prohibited_term), preferred_term: String(t.preferred_term) })),
        });

        const seenFacts = new Set(
          existingFacts.map((f) => `${f.fact_key.trim().toLowerCase()}::${f.fact_value.trim().toLowerCase()}`)
        );
        const existingFactKeySet = new Set(existingFacts.map((f) => f.fact_key.trim().toLowerCase()));

        let factsAdded = 0;
        let factsSkipped = 0;
        for (const f of incomingFacts) {
          const key = String(f?.fact_key || '').trim();
          const val = String(f?.fact_value || '').trim();
          if (!key || !val) continue;
          const sig = `${key.toLowerCase()}::${val.toLowerCase()}`;
          if (seenFacts.has(sig) || existingFactKeySet.has(key.toLowerCase())) {
            factsSkipped += 1;
            continue;
          }
          seenFacts.add(sig);
          existingFactKeySet.add(key.toLowerCase());
          const srcPage =
            typeof f?.source_page === 'number' && Number.isInteger(f.source_page) && f.source_page > 0
              ? f.source_page
              : null;
          const srcSection = typeof f?.source_section === 'string' ? f.source_section.trim().slice(0, 200) : '';
          const srcExcerpt = typeof f?.source_excerpt === 'string' ? f.source_excerpt.trim().slice(0, 400) : '';

          await tx.insert(
            `INSERT INTO approved_facts (
              company_id, brand_id, fact_key, fact_value, source_doc,
              source_document_id, source_page, source_section, source_excerpt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            key,
            val,
            sourceName,
            verifiedDocId,
            srcPage,
            srcSection,
            srcExcerpt
          );
          factsAdded += 1;
        }

        const seenTerms = new Set(existingTerms.map((t) => t.prohibited_term.trim().toLowerCase()));
        const existingPrefSet = new Set(existingTerms.map((t) => t.preferred_term.trim().toLowerCase()));

        let terminologyAdded = 0;
        let terminologySkipped = 0;
        for (const t of incomingTerms) {
          const prohibited = String(t?.prohibited_term || '').trim();
          const preferred = String(t?.preferred_term || '').trim();
          if (!prohibited || !preferred || prohibited.toLowerCase() === preferred.toLowerCase()) continue;
          const sig = prohibited.toLowerCase();
          if (seenTerms.has(sig) || existingPrefSet.has(sig)) {
            terminologySkipped += 1;
            continue;
          }
          seenTerms.add(sig);
          const rawSev = String(t?.severity || 'high').toLowerCase();
          const severity = ['critical', 'high', 'medium', 'low'].includes(rawSev) ? rawSev : 'high';
          const notes = String(t?.notes || '').trim();
          const srcPage =
            typeof t?.source_page === 'number' && Number.isInteger(t.source_page) && t.source_page > 0
              ? t.source_page
              : null;
          const srcSection = typeof t?.source_section === 'string' ? t.source_section.trim().slice(0, 200) : '';
          const srcExcerpt = typeof t?.source_excerpt === 'string' ? t.source_excerpt.trim().slice(0, 400) : '';

          await tx.insert(
            `INSERT INTO terminology_rules (
              company_id, brand_id, prohibited_term, preferred_term, severity, notes,
              source_document_id, source_page, source_section, source_excerpt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            prohibited,
            preferred,
            severity,
            notes,
            verifiedDocId,
            srcPage,
            srcSection,
            srcExcerpt
          );
          terminologyAdded += 1;
        }

        let visualUpdated = false;
        if (incomingVisualRaw && typeof incomingVisualRaw === 'object') {
          const sanitizedIncoming = sanitizeVisualGuidelinesConfig(incomingVisualRaw);
          const hasAnyIncomingVisual =
            sanitizedIncoming.accentColors.length > 0 ||
            sanitizedIncoming.approvedBackgrounds.length > 0 ||
            sanitizedIncoming.logoRules.logoRequired !== null ||
            sanitizedIncoming.logoRules.minWidthPx !== null ||
            sanitizedIncoming.logoRules.clearSpaceRatio !== null ||
            sanitizedIncoming.logoRules.allowedPlacements.length > 0 ||
            sanitizedIncoming.logoRules.prohibitedMisuse.length > 0 ||
            Boolean(sanitizedIncoming.logoRules.notes) ||
            Boolean(sanitizedIncoming.typographyRules.primaryFont) ||
            Boolean(sanitizedIncoming.typographyRules.secondaryFont) ||
            Boolean(sanitizedIncoming.typographyRules.headingStyle) ||
            Boolean(sanitizedIncoming.typographyRules.bodyStyle) ||
            Boolean(sanitizedIncoming.typographyRules.notes);

          if (hasAnyIncomingVisual) {
            const existingVgRow = await tx.get<BrandVisualGuidelineRow>(
              'SELECT * FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
              brandId,
              companyId
            );
            const curVg = parseVisualGuidelinesRow(existingVgRow);
            const mergedVg: BrandVisualGuidelinesConfig = {
              accentColors: Array.from(new Set([...curVg.accentColors, ...sanitizedIncoming.accentColors])).slice(0, 10),
              approvedBackgrounds: Array.from(
                new Set([...curVg.approvedBackgrounds, ...sanitizedIncoming.approvedBackgrounds])
              ).slice(0, 10),
              logoRules: {
                logoRequired:
                  sanitizedIncoming.logoRules.logoRequired !== null
                    ? sanitizedIncoming.logoRules.logoRequired
                    : curVg.logoRules.logoRequired,
                minWidthPx: sanitizedIncoming.logoRules.minWidthPx ?? curVg.logoRules.minWidthPx,
                clearSpaceRatio: sanitizedIncoming.logoRules.clearSpaceRatio ?? curVg.logoRules.clearSpaceRatio,
                allowedPlacements: Array.from(
                  new Set([...curVg.logoRules.allowedPlacements, ...sanitizedIncoming.logoRules.allowedPlacements])
                ).slice(0, 12),
                prohibitedMisuse: Array.from(
                  new Set([...curVg.logoRules.prohibitedMisuse, ...sanitizedIncoming.logoRules.prohibitedMisuse])
                ).slice(0, 15),
                notes: sanitizedIncoming.logoRules.notes || curVg.logoRules.notes,
              },
              typographyRules: {
                primaryFont: sanitizedIncoming.typographyRules.primaryFont || curVg.typographyRules.primaryFont,
                secondaryFont: sanitizedIncoming.typographyRules.secondaryFont || curVg.typographyRules.secondaryFont,
                headingStyle: sanitizedIncoming.typographyRules.headingStyle || curVg.typographyRules.headingStyle,
                bodyStyle: sanitizedIncoming.typographyRules.bodyStyle || curVg.typographyRules.bodyStyle,
                notes: sanitizedIncoming.typographyRules.notes || curVg.typographyRules.notes,
              },
            };

            if (existingVgRow) {
              await tx.run(
                `UPDATE brand_visual_guidelines
                 SET accent_colors_json = ?,
                     approved_backgrounds_json = ?,
                     logo_rules_json = ?,
                     typography_rules_json = ?,
                     source_document_id = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE brand_id = ? AND company_id = ?`,
                JSON.stringify(mergedVg.accentColors),
                JSON.stringify(mergedVg.approvedBackgrounds),
                JSON.stringify(mergedVg.logoRules),
                JSON.stringify(mergedVg.typographyRules),
                verifiedDocId,
                brandId,
                companyId
              );
            } else {
              await tx.insert(
                `INSERT INTO brand_visual_guidelines (
                  company_id, brand_id, accent_colors_json, approved_backgrounds_json,
                  logo_rules_json, typography_rules_json, source_document_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                companyId,
                brandId,
                JSON.stringify(mergedVg.accentColors),
                JSON.stringify(mergedVg.approvedBackgrounds),
                JSON.stringify(mergedVg.logoRules),
                JSON.stringify(mergedVg.typographyRules),
                verifiedDocId
              );
            }
            visualUpdated = true;
          }
        }

        const updatedRules =
          (await tx.get('SELECT * FROM brand_rules WHERE brand_id = ? AND company_id = ?', brandId, companyId)) || {
            tone_rules: '',
            messaging_rules: '',
          };
        const updatedFacts = await tx.all(
          'SELECT * FROM approved_facts WHERE brand_id = ? AND company_id = ? ORDER BY id DESC',
          brandId,
          companyId
        );
        const updatedTerms = await tx.all(
          'SELECT * FROM terminology_rules WHERE brand_id = ? AND company_id = ? ORDER BY id DESC',
          brandId,
          companyId
        );
        const updatedVgRow = await tx.get<BrandVisualGuidelineRow>(
          'SELECT * FROM brand_visual_guidelines WHERE brand_id = ? AND company_id = ?',
          brandId,
          companyId
        );

        return {
          rules: updatedRules,
          facts: updatedFacts,
          terminology: updatedTerms,
          visualGuidelines: parseVisualGuidelinesRow(updatedVgRow),
          conflicts,
          summary: {
            rulesUpdated,
            visualUpdated,
            factsAdded,
            factsSkipped,
            terminologyAdded,
            terminologySkipped,
          },
        };
      });

      invalidateAnalyticsCache(companyId);
      res.json(result);
    })
  );

  router.put(
    '/guidelines/:brandId/rules',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { tone_rules, messaging_rules } = req.body ?? {};
      const existing = await db.get(
        'SELECT id FROM brand_rules WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );
      if (existing) {
        await db.run(
          'UPDATE brand_rules SET tone_rules = ?, messaging_rules = ?, updated_at = CURRENT_TIMESTAMP WHERE brand_id = ? AND company_id = ?',
          String(tone_rules ?? ''),
          String(messaging_rules ?? ''),
          brandId,
          companyId
        );
      } else {
        await db.insert(
          'INSERT INTO brand_rules (company_id, brand_id, tone_rules, messaging_rules) VALUES (?, ?, ?, ?)',
          companyId,
          brandId,
          String(tone_rules ?? ''),
          String(messaging_rules ?? '')
        );
      }
      const rules = await db.get(
        'SELECT * FROM brand_rules WHERE brand_id = ? AND company_id = ?',
        brandId,
        companyId
      );
      invalidateAnalyticsCache(companyId);
      res.json({ rules });
    })
  );

  router.post(
    '/guidelines/:brandId/facts',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { fact_key, fact_value, source_doc } = req.body ?? {};
      if (!fact_key || !fact_value || !String(fact_key).trim() || !String(fact_value).trim()) {
        res.status(400).json({ error: 'Fact label and value are required.' });
        return;
      }

      const factId = await db.insert(
        'INSERT INTO approved_facts (company_id, brand_id, fact_key, fact_value, source_doc) VALUES (?, ?, ?, ?, ?)',
        companyId,
        brandId,
        String(fact_key).trim(),
        String(fact_value).trim(),
        String(source_doc || 'Manual Entry').trim()
      );

      invalidateAnalyticsCache(companyId);
      const fact = await db.get('SELECT * FROM approved_facts WHERE id = ? AND company_id = ?', factId, companyId);
      res.status(201).json({ fact });
    })
  );

  router.delete(
    '/guidelines/:brandId/facts/:factId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const factId = Number(req.params.factId);
      if (!Number.isInteger(brandId) || brandId <= 0 || !Number.isInteger(factId) || factId <= 0) {
        res.status(400).json({ error: 'Invalid brand or fact ID.' });
        return;
      }
      const delRes = await db.run(
        'DELETE FROM approved_facts WHERE id = ? AND brand_id = ? AND company_id = ?',
        factId,
        brandId,
        companyId
      );
      if (delRes.changes === 0) {
        res.status(404).json({ error: 'Approved fact not found.' });
        return;
      }
      invalidateAnalyticsCache(companyId);
      res.json({ ok: true });
    })
  );

  router.post(
    '/guidelines/:brandId/terminology',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      if (!Number.isInteger(brandId) || brandId <= 0) {
        res.status(400).json({ error: 'Invalid brand ID.' });
        return;
      }
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { prohibited_term, preferred_term, severity, notes } = req.body ?? {};
      if (!prohibited_term || !preferred_term || !String(prohibited_term).trim() || !String(preferred_term).trim()) {
        res.status(400).json({ error: 'Both prohibited and preferred terms are required.' });
        return;
      }

      const ruleId = await db.insert(
        'INSERT INTO terminology_rules (company_id, brand_id, prohibited_term, preferred_term, severity, notes) VALUES (?, ?, ?, ?, ?, ?)',
        companyId,
        brandId,
        String(prohibited_term).trim(),
        String(preferred_term).trim(),
        ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'high',
        String(notes || '').trim()
      );

      invalidateAnalyticsCache(companyId);
      const rule = await db.get('SELECT * FROM terminology_rules WHERE id = ? AND company_id = ?', ruleId, companyId);
      res.status(201).json({ rule });
    })
  );

  router.delete(
    '/guidelines/:brandId/terminology/:ruleId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer', 'admin'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const ruleId = Number(req.params.ruleId);
      if (!Number.isInteger(brandId) || brandId <= 0 || !Number.isInteger(ruleId) || ruleId <= 0) {
        res.status(400).json({ error: 'Invalid brand or terminology rule ID.' });
        return;
      }
      const delRes = await db.run(
        'DELETE FROM terminology_rules WHERE id = ? AND brand_id = ? AND company_id = ?',
        ruleId,
        brandId,
        companyId
      );
      if (delRes.changes === 0) {
        res.status(404).json({ error: 'Terminology rule not found.' });
        return;
      }
      invalidateAnalyticsCache(companyId);
      res.json({ ok: true });
    })
  );

  // ---------------- SUBMISSIONS & COMPLIANCE ANALYSIS ----------------
  router.get(
    '/submissions',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const rows = await db.all(
        `SELECT s.*, b.name AS brand_name, b.primary_color AS brand_primary_color,
                u.name AS submitted_by_name,
                (SELECT CAST(COUNT(*) AS INTEGER) FROM compliance_issues ci WHERE ci.submission_id = s.id) AS total_issues,
                (SELECT CAST(COUNT(*) AS INTEGER) FROM compliance_issues ci WHERE ci.submission_id = s.id AND ci.resolution_status = 'open') AS open_issues,
                (SELECT decision FROM review_events re WHERE re.submission_id = s.id ORDER BY re.id DESC LIMIT 1) AS latest_decision
         FROM submissions s
         JOIN brands b ON b.id = s.brand_id
         JOIN users u ON u.id = s.submitted_by
         WHERE s.company_id = ?
         ORDER BY s.created_at DESC, s.id DESC`,
        companyId
      );

      res.json({ submissions: rows });
    })
  );

  router.get(
    '/submissions/:id',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      if (!Number.isInteger(subId) || subId <= 0) {
        res.status(400).json({ error: 'Invalid submission ID.' });
        return;
      }

      const submission = await db.get<{ brand_id: number } & Record<string, unknown>>(
        `SELECT s.*, b.name AS brand_name, b.primary_color AS brand_primary_color, b.secondary_color AS brand_secondary_color,
                b.logo_filename AS brand_logo_filename, u.name AS submitted_by_name
         FROM submissions s
         JOIN brands b ON b.id = s.brand_id
         JOIN users u ON u.id = s.submitted_by
         WHERE s.id = ? AND s.company_id = ?`,
        subId,
        companyId
      );

      if (!submission) {
        res.status(404).json({ error: 'Submission not found.' });
        return;
      }

      const issues = await db.all(
        'SELECT * FROM compliance_issues WHERE submission_id = ? AND company_id = ? ORDER BY id ASC',
        subId,
        companyId
      );
      const revisions = await db.all(
        `SELECT r.*, COALESCE(u.name, 'Workspace Member') AS editor_name
         FROM revisions r
         LEFT JOIN users u ON u.id = r.edited_by
         WHERE r.submission_id = ? AND r.company_id = ?
         ORDER BY r.id DESC`,
        subId,
        companyId
      );
      const reviewEvents = await db.all(
        'SELECT * FROM review_events WHERE submission_id = ? AND company_id = ? ORDER BY id DESC',
        subId,
        companyId
      );
      const variantRows = await db.all<BrandLogoVariantRow>(
        'SELECT * FROM brand_logo_variants WHERE brand_id = ? AND company_id = ? ORDER BY id ASC',
        Number(submission.brand_id),
        companyId
      );

      res.json({
        submission,
        issues,
        revisions,
        reviewEvents,
        logoVariants: variantRows.map(serializePublicLogoVariant),
      });
    })
  );

  router.post(
    '/submissions',
    requireAuth,
    requireVerifiedEmail,
    upload.fields([
      { name: 'document', maxCount: 1 },
      { name: 'image', maxCount: 1 },
    ]),
    asyncHandler(async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const docFile = files?.document?.[0];
      const imgFile = files?.image?.[0];
      let storedDoc: StoredObjectResult | null = null;
      let storedImg: StoredObjectResult | null = null;

      try {
        const companyId = req.user!.companyId;
        const { brandId, title, pastedText, imageAltText, idempotencyKey: bodyKey } = req.body ?? {};
        const rawIdempotencyKey = (req.get('idempotency-key') || bodyKey || '').toString().trim();
        const requestIdempotencyKey = rawIdempotencyKey ? rawIdempotencyKey.slice(0, 128) : null;

        if (requestIdempotencyKey) {
          const existing = await db.get<{ id: number }>(
            'SELECT * FROM submissions WHERE company_id = ? AND request_idempotency_key = ?',
            companyId,
            requestIdempotencyKey
          );
          if (existing) {
            const issues = await db.all(
              'SELECT * FROM compliance_issues WHERE submission_id = ? AND company_id = ? ORDER BY id ASC',
              existing.id,
              companyId
            );
            res.status(200).json({
              submission: { ...existing, id: Number(existing.id) },
              issues,
              idempotentReplay: true,
            });
            return;
          }
        }

        const parsedBrandId = Number(brandId);

        if (!Number.isInteger(parsedBrandId) || parsedBrandId <= 0) {
          res.status(400).json({ error: 'Please select a valid brand profile.' });
          return;
        }

        const brand = await db.get<{
          id: number;
          name: string;
          primary_color: string;
          secondary_color: string;
          logo_filename: string | null;
        }>('SELECT * FROM brands WHERE id = ? AND company_id = ?', parsedBrandId, companyId);

        if (!brand) {
          res.status(404).json({ error: 'Selected brand not found in your organization.' });
          return;
        }

        if (!title || !String(title).trim()) {
          res.status(400).json({ error: 'Submission title is required.' });
          return;
        }

        let extractedDocText = '';
        let inputType = 'text';

        if (docFile) {
          let docExt: string;
          let docDetails: Awaited<ReturnType<typeof extractDocumentDetailsFromBuffer>>;
          try {
            docExt = validateUploadedBufferContent(docFile.buffer, docFile.originalname, ALLOWED_DOC_EXTENSIONS);
            docDetails = await extractDocumentDetailsFromBuffer(docFile.buffer, docFile.originalname);
          } catch (validationErr) {
            console.error('[InkloomGuard AI] Submission document validation/parse error:', validationErr);
            res.status(400).json({
              error: sanitizeUploadValidationMessage(
                validationErr,
                'Unable to read the uploaded document. Please upload a valid PDF, DOCX, TXT, or Markdown file.'
              ),
            });
            return;
          }
          if (docDetails.isScannedOrEmpty && !String(pastedText || '').trim() && !imgFile) {
            res.status(400).json({
              error:
                docExt === '.pdf'
                  ? 'Uploaded PDF appears scanned or contains no selectable text layer. Paste summary text or upload a text-searchable PDF/DOCX.'
                  : 'Uploaded document contains no readable text.',
            });
            return;
          }
          extractedDocText = docDetails.text;
          inputType = 'document';
        }

        let imageMetrics = null;
        let imageMime: string | null = null;
        if (imgFile) {
          try {
            validateUploadedBufferContent(imgFile.buffer, imgFile.originalname, ALLOWED_IMAGE_EXTENSIONS);
            imageMime = inferMimeType(imgFile.originalname, imgFile.mimetype);
            imageMetrics = await analyzeImageBuffer(imgFile.buffer, brand.primary_color, brand.secondary_color);
          } catch (validationErr) {
            console.error('[InkloomGuard AI] Submission image validation/decode error:', validationErr);
            res.status(400).json({
              error: sanitizeUploadValidationMessage(validationErr, 'Invalid or unreadable image upload.'),
            });
            return;
          }
          inputType = docFile || String(pastedText || '').trim() ? 'mixed' : 'image';
        }

        const combinedContent = [String(pastedText || '').trim(), extractedDocText].filter(Boolean).join('\n\n');

        if (!combinedContent && !imgFile) {
          res.status(400).json({ error: 'Please paste text, upload a PDF/DOCX document, or attach an image.' });
          return;
        }

        const contentHash = sha256Hex([
          String(parsedBrandId),
          combinedContent,
          docFile ? docFile.buffer : '',
          imgFile ? imgFile.buffer : '',
          String(imageAltText || '').trim(),
        ]);

        const brandRulesRow = await db.get<{ tone_rules: string; messaging_rules: string }>(
          'SELECT tone_rules, messaging_rules FROM brand_rules WHERE brand_id = ? AND company_id = ?',
          parsedBrandId,
          companyId
        );

        const facts = await db.all<ApprovedFactInput>(
          'SELECT id, fact_key, fact_value, source_doc FROM approved_facts WHERE brand_id = ? AND company_id = ?',
          parsedBrandId,
          companyId
        );

        const terminology = await db.all<TerminologyRuleInput>(
          'SELECT id, prohibited_term, preferred_term, severity, notes FROM terminology_rules WHERE brand_id = ? AND company_id = ?',
          parsedBrandId,
          companyId
        );

        const visualCtx = await loadBrandVisualContext(companyId, brand);
        const visualImageHash = imgFile
          ? computeVisualCacheHash({
              imageBuffer: imgFile.buffer,
              brandId: parsedBrandId,
              primaryColor: brand.primary_color,
              secondaryColor: brand.secondary_color,
              primaryLogoFilename: brand.logo_filename,
              logoVariants: visualCtx.logoVariants,
              visualGuidelines: visualCtx.visualGuidelines,
              hasAiClient: Boolean(getAiClient()),
            })
          : null;

        const analysis = await runFullComplianceAnalysis({
          content: combinedContent,
          brand: {
            brandId: Number(brand.id),
            brandName: brand.name,
            primaryColor: brand.primary_color,
            secondaryColor: brand.secondary_color,
            primaryLogoFilename: brand.logo_filename,
            primaryLogoBuffer: visualCtx.primaryLogoBuffer,
            primaryLogoProfile: visualCtx.primaryLogoProfile,
            logoVariants: visualCtx.logoVariants,
            visualGuidelines: visualCtx.visualGuidelines,
            toneRules: brandRulesRow?.tone_rules || '',
            messagingRules: brandRulesRow?.messaging_rules || '',
            facts,
            terminology,
          },
          hasImage: Boolean(imgFile),
          imageBuffer: imgFile ? imgFile.buffer : null,
          imageMimeType: imageMime,
          imageAltText: String(imageAltText || ''),
          imageMetrics,
        });

        storedDoc = docFile
          ? await uploadAsset({
              companyId,
              brandId: parsedBrandId,
              assetKind: 'submission_document',
              originalName: docFile.originalname,
              buffer: docFile.buffer,
              mimeType: docFile.mimetype,
            })
          : null;

        storedImg = imgFile
          ? await uploadAsset({
              companyId,
              brandId: parsedBrandId,
              assetKind: 'submission_image',
              originalName: imgFile.originalname,
              buffer: imgFile.buffer,
              mimeType: imgFile.mimetype,
            })
          : null;

        const subStatus = analysis.issues.length > 0 ? 'pending_review' : 'analyzed';

        let submissionId: number;
        try {
          submissionId = await db.transaction(async (tx) => {
            const insertedId = await tx.insert(
              `INSERT INTO submissions (
                company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
                file_filename, file_original_name, image_filename, image_alt_text, status,
                compliance_score, analysis_coverage, ai_status, ai_error,
                checks_summary_json, image_metrics_json, visual_analysis_json, visual_image_hash,
                analysis_timings_json, content_hash, request_idempotency_key
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              companyId,
              parsedBrandId,
              req.user!.id,
              String(title).trim(),
              inputType,
              combinedContent,
              analysis.suggestedRevisedContent || combinedContent,
              storedDoc ? storedDoc.filename : null,
              docFile ? docFile.originalname : null,
              storedImg ? storedImg.filename : null,
              String(imageAltText || '').trim(),
              subStatus,
              analysis.complianceScore,
              analysis.analysisCoverage,
              analysis.aiStatus,
              analysis.aiError || null,
              JSON.stringify(analysis.checks),
              imageMetrics ? JSON.stringify(imageMetrics) : null,
              analysis.visualAnalysis ? JSON.stringify(analysis.visualAnalysis) : null,
              visualImageHash,
              JSON.stringify({
                ...analysis.timingsMs,
                rewriteWarnings: analysis.rewriteWarnings,
              }),
              contentHash,
              requestIdempotencyKey
            );

            if (storedDoc && docFile) {
              await tx.insert(
                `INSERT INTO stored_files (
                  company_id, brand_id, submission_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                companyId,
                parsedBrandId,
                insertedId,
                'submission_document',
                storedDoc.backend,
                storedDoc.storageKey,
                storedDoc.filename,
                docFile.originalname,
                storedDoc.mimeType,
                storedDoc.sizeBytes,
                req.user!.id
              );
            }

            if (storedImg && imgFile) {
              await tx.insert(
                `INSERT INTO stored_files (
                  company_id, brand_id, submission_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                companyId,
                parsedBrandId,
                insertedId,
                'submission_image',
                storedImg.backend,
                storedImg.storageKey,
                storedImg.filename,
                imgFile.originalname,
                storedImg.mimeType,
                storedImg.sizeBytes,
                req.user!.id
              );
            }

            for (const issue of analysis.issues) {
              await tx.insert(
                `INSERT INTO compliance_issues (
                  company_id, submission_id, category, severity, original_text, explanation, evidence, suggested_correction, resolution_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
                companyId,
                insertedId,
                issue.category,
                issue.severity,
                issue.original_text,
                issue.explanation,
                issue.evidence,
                issue.suggested_correction
              );
            }

            const visualIssuesCount = analysis.issues.filter((i) => i.category === 'Visual Identity').length;
            const textIssuesCount = analysis.issues.length - visualIssuesCount;

            await tx.insert(
              `INSERT INTO analysis_runs (
                company_id, brand_id, submission_id, triggered_by, run_type,
                compliance_score, total_issues, visual_issues, text_issues, ai_status, outcome_status
              ) VALUES (?, ?, ?, ?, 'initial', ?, ?, ?, ?, ?, ?)`,
              companyId,
              parsedBrandId,
              insertedId,
              req.user!.id,
              analysis.complianceScore,
              analysis.issues.length,
              visualIssuesCount,
              textIssuesCount,
              analysis.aiStatus,
              subStatus
            );

            await tx.insert(
              `INSERT INTO review_events (
                company_id, submission_id, reviewer_id, reviewer_name, decision, comment, previous_status, new_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              companyId,
              insertedId,
              req.user!.id,
              req.user!.name,
              'submitted',
              `Compliance scan finished: ${analysis.issues.length} issue${analysis.issues.length === 1 ? '' : 's'} detected.`,
              '',
              subStatus
            );

            return insertedId;
          });
          invalidateAnalyticsCache(companyId);
        } catch (txErr) {
          await safeRollbackAssets([storedDoc, storedImg]);
          // Handle concurrent idempotency-key race cleanly
          const errCode = (txErr as { code?: string })?.code;
          if (requestIdempotencyKey && (errCode === '23505' || errCode === 'SQLITE_CONSTRAINT_UNIQUE')) {
            const existing = await db.get<{ id: number }>(
              'SELECT * FROM submissions WHERE company_id = ? AND request_idempotency_key = ?',
              companyId,
              requestIdempotencyKey
            );
            if (existing) {
              const issues = await db.all(
                'SELECT * FROM compliance_issues WHERE submission_id = ? AND company_id = ? ORDER BY id ASC',
                existing.id,
                companyId
              );
              res.status(200).json({
                submission: { ...existing, id: Number(existing.id) },
                issues,
                idempotentReplay: true,
              });
              return;
            }
          }
          throw txErr;
        }

        const submission = await db.get<{ id: number | string }>(
          'SELECT * FROM submissions WHERE id = ? AND company_id = ?',
          submissionId,
          companyId
        );
        if (!submission || !Number(submission.id)) {
          res.status(500).json({ error: 'Submission could not be retrieved after creation.' });
          return;
        }
        const normalizedSubmission = { ...submission, id: Number(submission.id) };
        const issues = await db.all(
          'SELECT * FROM compliance_issues WHERE submission_id = ? AND company_id = ? ORDER BY id ASC',
          submissionId,
          companyId
        );

        res.status(201).json({
          submission: normalizedSubmission,
          issues,
          aiError: analysis.aiError,
          rewriteWarnings: analysis.rewriteWarnings,
        });
      } catch (err) {
        await safeRollbackAssets([storedDoc, storedImg]);
        console.error('[InkloomGuard AI] Submission creation/analysis error:', err);
        res.status(500).json({ error: 'Submission analysis failed.' });
      }
    })
  );

  router.post(
    '/submissions/:id/reanalyze',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      if (!Number.isInteger(subId) || subId <= 0) {
        res.status(400).json({ error: 'Invalid submission ID.' });
        return;
      }

      const sub = await db.get<{
        id: number;
        brand_id: number;
        original_content: string;
        revised_content: string;
        image_filename: string | null;
        image_alt_text: string;
        image_metrics_json: string | null;
        visual_analysis_json: string | null;
        visual_image_hash: string | null;
        status: string;
        ai_status: string | null;
        reanalysis_started_at: string | null;
      }>('SELECT * FROM submissions WHERE id = ? AND company_id = ?', subId, companyId);

      if (!sub) {
        res.status(404).json({ error: 'Submission not found.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const staleCutoffIso = new Date(Date.now() - STALE_REANALYSIS_LOCK_MS).toISOString();

      // Atomic cross-instance DB lock: only succeeds when not actively pending (or stale > 5m)
      const lockRes = await db.run(
        `UPDATE submissions
         SET ai_status = 'pending',
             ai_error = NULL,
             reanalysis_started_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND company_id = ?
           AND (
             ai_status IS NULL
             OR ai_status != 'pending'
             OR (reanalysis_started_at IS NOT NULL AND reanalysis_started_at < ?)
           )`,
        nowIso,
        subId,
        companyId,
        staleCutoffIso
      );

      if (lockRes.changes === 0) {
        res.status(409).json({ error: 'Compliance analysis is already in progress for this submission.' });
        return;
      }

      try {
        const brand = await db.get<{
          id: number;
          name: string;
          primary_color: string;
          secondary_color: string;
          logo_filename: string | null;
        }>(
          'SELECT id, name, primary_color, secondary_color, logo_filename FROM brands WHERE id = ? AND company_id = ?',
          sub.brand_id,
          companyId
        );

        if (!brand) {
          await db.run(
            "UPDATE submissions SET ai_status = ?, reanalysis_started_at = NULL WHERE id = ? AND company_id = ?",
            sub.ai_status || 'failed',
            subId,
            companyId
          );
          res.status(404).json({ error: 'Associated brand not found.' });
          return;
        }

        let imageBuffer: Buffer | null = null;
        let imageMimeType: string | null = null;
        let imageMetrics = null;
        if (sub.image_metrics_json) {
          try {
            imageMetrics = JSON.parse(sub.image_metrics_json);
          } catch {
            imageMetrics = null;
          }
        }

        if (sub.image_filename) {
          const asset = await resolveTenantAsset(companyId, sub.image_filename);
          if (asset) {
            try {
              imageBuffer = await downloadAsset({
                backend: asset.backend,
                storageKey: asset.storageKey,
                filename: asset.filename,
              });
              imageMimeType = asset.mimeType;
              imageMetrics = await analyzeImageBuffer(imageBuffer, brand.primary_color, brand.secondary_color);
            } catch {
              imageBuffer = null;
            }
          }
        }

        const brandRulesRow = await db.get<{ tone_rules: string; messaging_rules: string }>(
          'SELECT tone_rules, messaging_rules FROM brand_rules WHERE brand_id = ? AND company_id = ?',
          brand.id,
          companyId
        );
        const facts = await db.all<ApprovedFactInput>(
          'SELECT id, fact_key, fact_value, source_doc FROM approved_facts WHERE brand_id = ? AND company_id = ?',
          brand.id,
          companyId
        );
        const terminology = await db.all<TerminologyRuleInput>(
          'SELECT id, prohibited_term, preferred_term, severity, notes FROM terminology_rules WHERE brand_id = ? AND company_id = ?',
          brand.id,
          companyId
        );

        const visualCtx = await loadBrandVisualContext(companyId, brand);
        const visualImageHash = imageBuffer
          ? computeVisualCacheHash({
              imageBuffer,
              brandId: Number(brand.id),
              primaryColor: brand.primary_color,
              secondaryColor: brand.secondary_color,
              primaryLogoFilename: brand.logo_filename,
              logoVariants: visualCtx.logoVariants,
              visualGuidelines: visualCtx.visualGuidelines,
              hasAiClient: Boolean(getAiClient()),
            })
          : null;

        let cachedVisualAnalysis: VisualBrandAnalysisResult | null = null;
        const forceVisual = req.body?.forceVisual === true;
        if (
          !forceVisual &&
          imageBuffer &&
          visualImageHash &&
          sub.visual_image_hash === visualImageHash &&
          sub.visual_analysis_json
        ) {
          try {
            cachedVisualAnalysis = JSON.parse(sub.visual_analysis_json) as VisualBrandAnalysisResult;
          } catch {
            cachedVisualAnalysis = null;
          }
        }

        const analysis = await runFullComplianceAnalysis({
          content: sub.original_content || '',
          brand: {
            brandId: Number(brand.id),
            brandName: brand.name,
            primaryColor: brand.primary_color,
            secondaryColor: brand.secondary_color,
            primaryLogoFilename: brand.logo_filename,
            primaryLogoBuffer: visualCtx.primaryLogoBuffer,
            primaryLogoProfile: visualCtx.primaryLogoProfile,
            logoVariants: visualCtx.logoVariants,
            visualGuidelines: visualCtx.visualGuidelines,
            toneRules: brandRulesRow?.tone_rules || '',
            messagingRules: brandRulesRow?.messaging_rules || '',
            facts,
            terminology,
          },
          hasImage: Boolean(sub.image_filename),
          imageBuffer,
          imageMimeType,
          imageAltText: sub.image_alt_text || '',
          imageMetrics,
          cachedVisualAnalysis,
        });

        await db.transaction(async (tx) => {
          const revCountRow = await tx.get<{ cnt: number | string }>(
            'SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM revisions WHERE submission_id = ? AND company_id = ?',
            subId,
            companyId
          );
          const hasManualRevisions = Number(revCountRow?.cnt ?? 0) > 0;
          const nextRevisedContent = hasManualRevisions
            ? sub.revised_content
            : analysis.suggestedRevisedContent || sub.original_content;

          const preserveTerminalStatus = sub.status === 'approved' || sub.status === 'rejected';
          const nextStatus = preserveTerminalStatus
            ? sub.status
            : analysis.issues.length > 0
              ? 'pending_review'
              : 'analyzed';

          const hadCompletedPriorAi = sub.ai_status === 'completed';
          const aiErrored = analysis.aiStatus === 'failed' || Boolean(analysis.aiError);
          const preserveExistingResults =
            analysis.aiStatus === 'failed' || (hadCompletedPriorAi && aiErrored);
          const auditNewStatus = preserveExistingResults ? sub.status : nextStatus;

          if (preserveExistingResults) {
            await tx.run(
              `UPDATE submissions
               SET ai_status = ?, ai_error = ?, reanalysis_started_at = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND company_id = ?`,
              analysis.aiStatus,
              analysis.aiError || 'AI compliance analysis failed. Existing results were preserved — please retry shortly.',
              subId,
              companyId
            );
          } else {
            await tx.run(
              `UPDATE submissions
               SET revised_content = ?,
                   status = ?,
                   compliance_score = ?,
                   analysis_coverage = ?,
                   ai_status = ?,
                   ai_error = ?,
                   reanalysis_started_at = NULL,
                   checks_summary_json = ?,
                   image_metrics_json = ?,
                   visual_analysis_json = ?,
                   visual_image_hash = ?,
                   analysis_timings_json = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND company_id = ?`,
              nextRevisedContent,
              nextStatus,
              analysis.complianceScore,
              analysis.analysisCoverage,
              analysis.aiStatus,
              analysis.aiError || null,
              JSON.stringify(analysis.checks),
              imageMetrics ? JSON.stringify(imageMetrics) : sub.image_metrics_json,
              analysis.visualAnalysis ? JSON.stringify(analysis.visualAnalysis) : sub.visual_analysis_json,
              visualImageHash ?? sub.visual_image_hash,
              JSON.stringify({
                ...analysis.timingsMs,
                rewriteWarnings: analysis.rewriteWarnings,
              }),
              subId,
              companyId
            );

            await tx.run(
              'DELETE FROM compliance_issues WHERE submission_id = ? AND company_id = ?',
              subId,
              companyId
            );
            for (const issue of analysis.issues) {
                await tx.insert(
                  `INSERT INTO compliance_issues (
                    company_id, submission_id, category, severity, original_text, explanation, evidence, suggested_correction, resolution_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
                  companyId,
                  subId,
                  issue.category,
                  issue.severity,
                  issue.original_text,
                  issue.explanation,
                  issue.evidence,
                  issue.suggested_correction
                );
              }

              const visualIssuesCount = analysis.issues.filter((i) => i.category === 'Visual Identity').length;
              const textIssuesCount = analysis.issues.length - visualIssuesCount;

              await tx.insert(
                `INSERT INTO analysis_runs (
                  company_id, brand_id, submission_id, triggered_by, run_type,
                  compliance_score, total_issues, visual_issues, text_issues, ai_status, outcome_status
                ) VALUES (?, ?, ?, ?, 'reanalysis', ?, ?, ?, ?, ?, ?)`,
                companyId,
                brand.id,
                subId,
                req.user!.id,
                analysis.complianceScore,
                analysis.issues.length,
                visualIssuesCount,
                textIssuesCount,
                analysis.aiStatus,
                nextStatus
              );
            }

          await tx.insert(
            `INSERT INTO review_events (
              company_id, submission_id, reviewer_id, reviewer_name, decision, comment, previous_status, new_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            subId,
            req.user!.id,
            req.user!.name,
            'reanalyzed',
            analysis.aiError
              ? `Re-analysis finished (${analysis.aiStatus}): ${analysis.aiError}`
              : `Re-analysis completed (${analysis.issues.length} issue${analysis.issues.length === 1 ? '' : 's'} detected, score ${analysis.complianceScore}/100).`,
            sub.status,
            auditNewStatus
          );
        });

        invalidateAnalyticsCache(companyId);

        const updatedSubmission = await db.get(
          `SELECT s.*, b.name AS brand_name, b.primary_color AS brand_primary_color, b.secondary_color AS brand_secondary_color,
                  b.logo_filename AS brand_logo_filename, u.name AS submitted_by_name
           FROM submissions s
           JOIN brands b ON b.id = s.brand_id
           JOIN users u ON u.id = s.submitted_by
           WHERE s.id = ? AND s.company_id = ?`,
          subId,
          companyId
        );
        const issues = await db.all(
          'SELECT * FROM compliance_issues WHERE submission_id = ? AND company_id = ? ORDER BY id ASC',
          subId,
          companyId
        );
        const reviewEvents = await db.all(
          'SELECT * FROM review_events WHERE submission_id = ? AND company_id = ? ORDER BY id DESC',
          subId,
          companyId
        );

        res.json({
          submission: updatedSubmission,
          issues,
          reviewEvents,
          aiError: analysis.aiError,
          rewriteWarnings: analysis.rewriteWarnings,
        });
      } catch (err) {
        console.error('[InkloomGuard AI] Submission reanalysis error:', err);
        const sanitized = sanitizeAiRouteError(
          err,
          'Submission re-analysis failed due to a server error. Please try again shortly.'
        );
        await db
          .run(
            "UPDATE submissions SET ai_status = 'failed', ai_error = ?, reanalysis_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
            sanitized.error,
            subId,
            companyId
          )
          .catch(() => {});
        res.status(sanitized.status).json({ error: sanitized.error });
      }
    })
  );

  // ---------------- CORRECTIONS & REVISIONS ----------------
  router.post(
    '/submissions/:id/issues/:issueId/resolve',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      const issueId = Number(req.params.issueId);
      if (!Number.isInteger(subId) || subId <= 0 || !Number.isInteger(issueId) || issueId <= 0) {
        res.status(400).json({ error: 'Invalid submission or issue ID.' });
        return;
      }
      const { action } = req.body ?? {};

      if (!['accepted', 'rejected', 'open'].includes(action)) {
        res.status(400).json({ error: 'Invalid resolution status.' });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const sub = await tx.get<{ id: number; status: string }>(
          'SELECT id, status FROM submissions WHERE id = ? AND company_id = ?',
          subId,
          companyId
        );
        if (!sub) return { errorStatus: 404, error: 'Submission not found.' } as const;
        if (sub.status === 'approved' || sub.status === 'rejected') {
          return {
            errorStatus: 409,
            error: `Cannot alter issue resolutions when submission status is "${sub.status}".`,
          } as const;
        }

        const existingIssue = await tx.get<{ id: number; category: string; resolution_status: string }>(
          'SELECT id, category, resolution_status FROM compliance_issues WHERE id = ? AND submission_id = ? AND company_id = ?',
          issueId,
          subId,
          companyId
        );
        if (!existingIssue) return { errorStatus: 404, error: 'Issue not found.' } as const;

        await tx.run(
          'UPDATE compliance_issues SET resolution_status = ? WHERE id = ? AND submission_id = ? AND company_id = ?',
          action,
          issueId,
          subId,
          companyId
        );

        await tx.insert(
          `INSERT INTO review_events (
            company_id, submission_id, reviewer_id, reviewer_name, decision, comment, previous_status, new_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId,
          subId,
          req.user!.id,
          req.user!.name,
          'issue_resolved',
          `Marked ${existingIssue.category} issue #${issueId} as ${action}.`,
          existingIssue.resolution_status,
          action
        );

        const issue = await tx.get('SELECT * FROM compliance_issues WHERE id = ? AND company_id = ?', issueId, companyId);
        return { issue } as const;
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ error: outcome.error });
        return;
      }

      invalidateAnalyticsCache(companyId);
      res.json({ issue: outcome.issue });
    })
  );

  router.post(
    '/submissions/:id/revisions',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      if (!Number.isInteger(subId) || subId <= 0) {
        res.status(400).json({ error: 'Invalid submission ID.' });
        return;
      }
      const { revisedContent, note } = req.body ?? {};

      if (typeof revisedContent !== 'string') {
        res.status(400).json({ error: 'Revised content text is required.' });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const sub = await tx.get<{ id: number; status: string }>(
          'SELECT id, status FROM submissions WHERE id = ? AND company_id = ?',
          subId,
          companyId
        );
        if (!sub) return { errorStatus: 404, error: 'Submission not found.' } as const;
        if (sub.status === 'approved') {
          return {
            errorStatus: 409,
            error: 'Approved submissions cannot be edited directly. A reviewer must request changes before revising.',
          } as const;
        }

        const nextStatus = 'pending_review';
        await tx.run(
          'UPDATE submissions SET revised_content = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?',
          revisedContent,
          nextStatus,
          subId,
          companyId
        );

        await tx.insert(
          'INSERT INTO revisions (company_id, submission_id, edited_by, content, note) VALUES (?, ?, ?, ?, ?)',
          companyId,
          subId,
          req.user!.id,
          revisedContent,
          String(note || 'Saved revised draft')
        );

        await tx.insert(
          `INSERT INTO review_events (
            company_id, submission_id, reviewer_id, reviewer_name, decision, comment, previous_status, new_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId,
          subId,
          req.user!.id,
          req.user!.name,
          'revision_saved',
          String(note || 'Content revision saved and queued for human approval.'),
          sub.status,
          nextStatus
        );

        const updated = await tx.get('SELECT * FROM submissions WHERE id = ? AND company_id = ?', subId, companyId);
        return { submission: updated } as const;
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ error: outcome.error });
        return;
      }

      invalidateAnalyticsCache(companyId);
      res.json({ submission: outcome.submission });
    })
  );

  // ---------------- HUMAN REVIEW & APPROVAL ----------------
  router.post(
    '/submissions/:id/review',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      if (!Number.isInteger(subId) || subId <= 0) {
        res.status(400).json({ error: 'Invalid submission ID.' });
        return;
      }
      const { decision, comment } = req.body ?? {};

      if (!['approved', 'rejected', 'changes_requested', 'comment'].includes(decision)) {
        res.status(400).json({ error: 'Decision must be approved, rejected, changes_requested, or comment.' });
        return;
      }

      if (decision !== 'comment' && req.user!.role !== 'reviewer' && req.user!.role !== 'admin') {
        res.status(403).json({
          error: 'Only Brand Reviewers & Admins can approve, reject, or request changes. Content Authors may post comments.',
        });
        return;
      }

      const trimmedComment = String(comment || '').trim();
      if ((decision === 'rejected' || decision === 'changes_requested' || decision === 'comment') && !trimmedComment) {
        res.status(400).json({ error: 'A review comment is required for this action.' });
        return;
      }

      const outcome = await db.transaction(async (tx) => {
        const sub = await tx.get<{ status: string; checks_summary_json: string }>(
          'SELECT status, checks_summary_json FROM submissions WHERE id = ? AND company_id = ?',
          subId,
          companyId
        );

        if (!sub) return { errorStatus: 404, error: 'Submission not found.' } as const;

        if (decision === 'approved') {
          if (sub.status === 'approved') {
            return { errorStatus: 409, error: 'Submission is already approved.' } as const;
          }
          if (sub.status === 'rejected') {
            return {
              errorStatus: 409,
              error: 'Rejected submissions must have a new revision saved before approval.',
            } as const;
          }
        } else if (decision === 'rejected') {
          if (sub.status === 'rejected') {
            return { errorStatus: 409, error: 'Submission is already rejected.' } as const;
          }
          if (sub.status === 'approved') {
            return {
              errorStatus: 409,
              error: 'Approved submissions must first have changes requested before rejecting.',
            } as const;
          }
        }

        let nextStatus = sub.status;
        if (decision === 'approved') nextStatus = 'approved';
        else if (decision === 'rejected') nextStatus = 'rejected';
        else if (decision === 'changes_requested') nextStatus = 'changes_requested';

        let checks: CheckAreaSummary[] = [];
        try {
          checks = JSON.parse(sub.checks_summary_json || '[]');
        } catch {
          checks = [];
        }

        if (decision !== 'comment') {
          checks = checks.map((c) => {
            if (c.area !== 'Governance') return c;
            if (decision === 'approved') {
              return { ...c, status: 'passed', summary: `Approved by ${req.user!.name}.` };
            }
            if (decision === 'rejected') {
              return { ...c, status: 'issues_found', summary: `Rejected by ${req.user!.name}.` };
            }
            return { ...c, status: 'warning', summary: `Changes requested by ${req.user!.name}.` };
          });
        }

        await tx.run(
          'UPDATE submissions SET status = ?, checks_summary_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?',
          nextStatus,
          JSON.stringify(checks),
          subId,
          companyId
        );

        await tx.insert(
          `INSERT INTO review_events (
            company_id, submission_id, reviewer_id, reviewer_name, decision, comment, previous_status, new_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId,
          subId,
          req.user!.id,
          req.user!.name,
          decision,
          trimmedComment,
          sub.status,
          nextStatus
        );

        const updatedSubmission = await tx.get('SELECT * FROM submissions WHERE id = ? AND company_id = ?', subId, companyId);
        const reviewEvents = await tx.all(
          'SELECT * FROM review_events WHERE submission_id = ? AND company_id = ? ORDER BY id DESC',
          subId,
          companyId
        );

        return { submission: updatedSubmission, reviewEvents } as const;
      });

      if ('errorStatus' in outcome && typeof outcome.errorStatus === 'number') {
        res.status(outcome.errorStatus).json({ error: outcome.error });
        return;
      }

      invalidateAnalyticsCache(companyId);
      res.json({ submission: outcome.submission, reviewEvents: outcome.reviewEvents });
    })
  );

  // Global error handler for Multer file size/upload errors
  router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      console.error('[InkloomGuard AI] File upload error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Uploaded file exceeds the 10 MB size limit.' });
        return;
      }
      res.status(400).json({ error: 'Invalid file upload request.' });
      return;
    }
    next(err);
  });

  return router;
}
