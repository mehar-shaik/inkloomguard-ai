import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, DB_ENGINE, checkDatabaseHealth, isProductionEnvironment, isMigrationsReady } from './db.ts';
import {
  requireAuth,
  requireVerifiedEmail,
  requireRole,
  tryAuthenticateRequest,
  registerAccount,
  createTeamMember,
  authenticateAccount,
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
  AuthenticationError,
  AuthValidationError,
  type AuthedRequest,
} from './auth.ts';
import {
  isEmailConfigured,
  buildAppActionUrl,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} from './email.ts';
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_DOC_EXTENSIONS,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  validateUploadedBufferContent,
  validateRasterImageBuffer,
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
  type ApprovedFactInput,
  type TerminologyRuleInput,
  type CheckAreaSummary,
} from './complianceEngine.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

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

const resendVerificationRateLimit = createRateLimiter({
  prefix: 'resend-verify',
  windowMs: 15 * 60 * 1000,
  maxAttempts: 3,
  message: 'Too many verification email requests. Please wait before requesting another email.',
});

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
  const host = req.get('x-forwarded-host') || req.get('host');
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

interface ResolvedAsset {
  backend: StorageBackend;
  storageKey: string;
  filename: string;
  mimeType: string;
  originalName: string;
}

async function resolveTenantAsset(companyId: number, safeFilename: string): Promise<ResolvedAsset | null> {
  const stored = await db.get<{
    storage_backend: StorageBackend;
    storage_key: string;
    filename: string;
    mime_type: string;
    original_name: string;
    asset_kind: string;
  }>(
    `SELECT storage_backend, storage_key, filename, mime_type, original_name, asset_kind
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
  }>(
    `SELECT storage_backend, storage_key, filename, mime_type, original_name
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
        demoAvailable: !isProductionEnvironment(),
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
        clearLegacyAuthCookie(res);

        let verificationEmailSent = false;
        let verificationEmailError: string | undefined;
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(user.id, user.companyId);
          if (isEmailConfigured()) {
            const verificationUrl = buildAppActionUrl(
              `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
              getRequestOrigin(req)
            );
            await sendVerificationEmail({
              to: user.email,
              name: user.name,
              companyName: user.companyName,
              verificationUrl,
              expiresHours,
            });
            verificationEmailSent = true;
          } else {
            verificationEmailError = 'Email delivery is not configured yet.';
          }
        } catch (emailErr) {
          console.error(
            '[InkloomGuard AI] Verification email dispatch error during registration:',
            emailErr instanceof Error ? emailErr.message : 'Email delivery error'
          );
          verificationEmailError = 'Verification email could not be sent automatically. You can resend it from Settings.';
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
    asyncHandler(async (_req, res) => {
      if (isProductionEnvironment()) {
        res.status(404).json({ error: 'Not found.' });
        return;
      }
      try {
        const user = await authenticateAccount('elena@aetherflow.io', 'Inkloom2026!');
        const token = signToken(user);
        clearLegacyAuthCookie(res);
        res.json({ user, token });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Demo login unavailable.' });
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
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to reset password.' });
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
    resendVerificationRateLimit,
    asyncHandler(async (req, res) => {
      if (!isEmailConfigured()) {
        res.status(503).json({
          error: 'Email service is not configured. Please configure Brevo email settings before sending verification emails.',
        });
        return;
      }

      const authedUser = await tryAuthenticateRequest(req);
      if (authedUser) {
        if (authedUser.emailVerified) {
          res.status(400).json({ error: 'Your email address is already verified.' });
          return;
        }
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(
            authedUser.id,
            authedUser.companyId
          );
          const verificationUrl = buildAppActionUrl(
            `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
            getRequestOrigin(req)
          );
          await sendVerificationEmail({
            to: authedUser.email,
            name: authedUser.name,
            companyName: authedUser.companyName,
            verificationUrl,
            expiresHours,
          });
          res.json({
            ok: true,
            message: 'A new verification email has been sent to your registered address.',
          });
          return;
        } catch (err) {
          console.error(
            '[InkloomGuard AI] Resend verification email failed:',
            err instanceof Error ? err.message : 'Email delivery error'
          );
          res.status(503).json({
            error: 'Unable to send verification email right now. Please try again later.',
          });
          return;
        }
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }

      const neutralMessage =
        'If an unverified account exists for that email address, a verification email has been sent.';
      const targetUser = await findUserByEmailForAuth(email);
      if (targetUser && !targetUser.emailVerified) {
        try {
          const { rawToken, expiresHours } = await createEmailVerificationToken(
            targetUser.id,
            targetUser.companyId
          );
          const verificationUrl = buildAppActionUrl(
            `/?mode=verify-email&token=${encodeURIComponent(rawToken)}`,
            getRequestOrigin(req)
          );
          await sendVerificationEmail({
            to: targetUser.email,
            name: targetUser.name,
            companyName: targetUser.companyName,
            verificationUrl,
            expiresHours,
          });
        } catch (err) {
          console.error(
            '[InkloomGuard AI] Public resend verification email failed:',
            err instanceof Error ? err.message : 'Email delivery error'
          );
          res.status(503).json({
            error: 'Unable to send verification email right now. Please try again later.',
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
        const statusCode = (err as { statusCode?: number }).statusCode || 400;
        res.status(statusCode).json({
          error: err instanceof Error ? err.message : 'Unable to update password.',
        });
      }
    })
  );

  // ---------------- ORGANIZATION TEAM (RBAC) ----------------
  router.get(
    '/team/members',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const members = await db.all(
        'SELECT id, name, email, role, email_verified, created_at FROM users WHERE company_id = ? ORDER BY id ASC',
        req.user!.companyId
      );
      res.json({ members });
    })
  );

  router.post(
    '/team/members',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      try {
        const { name, email, password, role } = req.body ?? {};
        if (!name || !email || !password) {
          res.status(400).json({ error: 'Name, email, and password are required.' });
          return;
        }
        const member = await createTeamMember({
          companyId: req.user!.companyId,
          companyName: req.user!.companyName,
          name,
          email,
          password,
          role: role === 'reviewer' ? 'reviewer' : 'author',
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

  // ---------------- TENANT-PROTECTED FILE SERVING ----------------
  router.get(
    '/uploads/id/:fileId/signed-url',
    requireAuth,
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const fileId = Number(req.params.fileId);
      if (!Number.isInteger(fileId) || fileId <= 0) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }

      const asset = await resolveTenantAssetById(req.user!.companyId, fileId);
      if (!asset) {
        res.status(403).json({ error: 'Access denied to private company asset.' });
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
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      const fileId = Number(req.params.fileId);
      if (!Number.isInteger(fileId) || fileId <= 0) {
        res.status(400).json({ error: 'Invalid file ID.' });
        return;
      }

      const asset = await resolveTenantAssetById(req.user!.companyId, fileId);
      if (!asset) {
        res.status(403).json({ error: 'Access denied to private company asset.' });
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
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      let safeFilename: string;
      try {
        safeFilename = sanitizeLookupFilename(String(req.params.filename));
      } catch {
        res.status(400).json({ error: 'Invalid file identifier.' });
        return;
      }

      const asset = await resolveTenantAsset(req.user!.companyId, safeFilename);
      if (!asset) {
        res.status(403).json({ error: 'Access denied to private company asset.' });
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
    requireVerifiedEmail,
    asyncHandler(async (req, res) => {
      let safeFilename: string;
      try {
        safeFilename = sanitizeLookupFilename(String(req.params.filename));
      } catch {
        res.status(400).json({ error: 'Invalid file identifier.' });
        return;
      }

      const asset = await resolveTenantAsset(req.user!.companyId, safeFilename);
      if (!asset) {
        res.status(403).json({ error: 'Access denied to private company asset.' });
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
    requireRole('reviewer'),
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

        if (req.file) {
          const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
          await validateRasterImageBuffer(req.file.buffer, ext);
        }

        const brandId = await db.transaction(async (tx) => {
          const createdId = await tx.insert(
            `INSERT INTO brands (company_id, name, industry, primary_color, secondary_color, logo_filename, logo_original_name)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            String(name).trim(),
            String(industry || '').trim(),
            String(primaryColor || '#4F46E5').trim(),
            String(secondaryColor || '#06B6D4').trim(),
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

        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.status(201).json({ brand });
      } catch (err) {
        await safeRollbackAssets([uploadedLogo]);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create brand.' });
      }
    })
  );

  router.put(
    '/brands/:id',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
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

        if (req.file) {
          const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
          await validateRasterImageBuffer(req.file.buffer, ext);
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

          const { name, industry, primaryColor, secondaryColor } = req.body ?? {};
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
            primaryColor ? String(primaryColor).trim() : existing.primary_color,
            secondaryColor ? String(secondaryColor).trim() : existing.secondary_color,
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

        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.json({ brand });
      } catch (err) {
        await safeRollbackAssets([uploadedLogo]);
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update brand.' });
      }
    })
  );

  router.delete(
    '/brands/:id',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.id);

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

      res.json({ brand, documents, facts, terminology, rules });
    })
  );

  router.post(
    '/guidelines/:brandId/upload',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    upload.single('document'),
    asyncHandler(async (req, res) => {
      let storedDoc: StoredObjectResult | null = null;
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.brandId);
        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        if (!brand) {
          res.status(404).json({ error: 'Brand not found.' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Please select a PDF, DOCX, or TXT guideline file.' });
          return;
        }

        const ext = validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_DOC_EXTENSIONS);
        const extractionDetails = await extractDocumentDetailsFromBuffer(req.file.buffer, req.file.originalname);

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
            extractionStatus = 'failed';
            extractionError = formatGeminiError(extractErr);
            await db.run(
              `UPDATE guideline_documents SET extraction_status = 'failed', extraction_error = ? WHERE id = ? AND company_id = ?`,
              extractionError,
              docId,
              companyId
            );
          }
        }

        const doc = await db.get('SELECT * FROM guideline_documents WHERE id = ?', docId);
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
        res.status(400).json({ error: err instanceof Error ? err.message : 'Guideline upload failed.' });
      }
    })
  );

  router.post(
    '/guidelines/:brandId/ai-extract/:docId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const docId = Number(req.params.docId);
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
        const msg = formatGeminiError(err);
        await db
          .run(
            `UPDATE guideline_documents SET extraction_status = 'failed', extraction_error = ? WHERE id = ? AND company_id = ?`,
            msg,
            docId,
            companyId
          )
          .catch(() => {});
        const status = msg.includes('(503)') ? 503 : msg.includes('(429)') ? 429 : msg.includes('(504)') ? 504 : 500;
        res.status(status).json({ error: msg });
      }
    })
  );

  router.delete(
    '/guidelines/:brandId/documents/:docId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const docId = Number(req.params.docId);

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
    requireRole('reviewer'),
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

      const { toneRules, messagingRules, facts, terminology, sourceDoc, sourceDocId } = (req.body ?? {}) as {
        toneRules?: unknown;
        messagingRules?: unknown;
        sourceDoc?: unknown;
        sourceDocId?: unknown;
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

        return {
          rules: updatedRules,
          facts: updatedFacts,
          terminology: updatedTerms,
          conflicts,
          summary: {
            rulesUpdated,
            factsAdded,
            factsSkipped,
            terminologyAdded,
            terminologySkipped,
          },
        };
      });

      res.json(result);
    })
  );

  router.put(
    '/guidelines/:brandId/rules',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
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
      res.json({ rules });
    })
  );

  router.post(
    '/guidelines/:brandId/facts',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
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

      const fact = await db.get('SELECT * FROM approved_facts WHERE id = ?', factId);
      res.status(201).json({ fact });
    })
  );

  router.delete(
    '/guidelines/:brandId/facts/:factId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const factId = Number(req.params.factId);
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
      res.json({ ok: true });
    })
  );

  router.post(
    '/guidelines/:brandId/terminology',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
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

      const rule = await db.get('SELECT * FROM terminology_rules WHERE id = ?', ruleId);
      res.status(201).json({ rule });
    })
  );

  router.delete(
    '/guidelines/:brandId/terminology/:ruleId',
    requireAuth,
    requireVerifiedEmail,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const ruleId = Number(req.params.ruleId);
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

      const submission = await db.get(
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
        `SELECT r.*, u.name AS editor_name
         FROM revisions r
         JOIN users u ON u.id = r.edited_by
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

      res.json({ submission, issues, revisions, reviewEvents });
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
          const docExt = validateUploadedBufferContent(docFile.buffer, docFile.originalname, ALLOWED_DOC_EXTENSIONS);
          const docDetails = await extractDocumentDetailsFromBuffer(docFile.buffer, docFile.originalname);
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
          validateUploadedBufferContent(imgFile.buffer, imgFile.originalname, ALLOWED_IMAGE_EXTENSIONS);
          imageMime = inferMimeType(imgFile.originalname, imgFile.mimetype);
          imageMetrics = await analyzeImageBuffer(imgFile.buffer, brand.primary_color, brand.secondary_color);
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

        const analysis = await runFullComplianceAnalysis({
          content: combinedContent,
          brand: {
            brandId: Number(brand.id),
            brandName: brand.name,
            primaryColor: brand.primary_color,
            secondaryColor: brand.secondary_color,
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
                checks_summary_json, image_metrics_json, analysis_timings_json,
                content_hash, request_idempotency_key
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        res.status(400).json({ error: err instanceof Error ? err.message : 'Submission analysis failed.' });
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
        }>('SELECT id, name, primary_color, secondary_color FROM brands WHERE id = ? AND company_id = ?', sub.brand_id, companyId);

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

        const analysis = await runFullComplianceAnalysis({
          content: sub.original_content || '',
          brand: {
            brandId: Number(brand.id),
            brandName: brand.name,
            primaryColor: brand.primary_color,
            secondaryColor: brand.secondary_color,
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
        const msg = formatGeminiError(err);
        await db
          .run(
            "UPDATE submissions SET ai_status = 'failed', ai_error = ?, reanalysis_started_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
            msg,
            subId,
            companyId
          )
          .catch(() => {});
        const status = msg.includes('(504)') ? 504 : msg.includes('(503)') ? 503 : msg.includes('(429)') ? 429 : 500;
        res.status(status).json({ error: msg });
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
      const { decision, comment } = req.body ?? {};

      if (!['approved', 'rejected', 'changes_requested', 'comment'].includes(decision)) {
        res.status(400).json({ error: 'Decision must be approved, rejected, changes_requested, or comment.' });
        return;
      }

      if (decision !== 'comment' && req.user!.role !== 'reviewer') {
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

      res.json({ submission: outcome.submission, reviewEvents: outcome.reviewEvents });
    })
  );

  // Global error handler for Multer file size/upload errors
  router.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Uploaded file exceeds the 10 MB size limit.' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  });

  return router;
}
