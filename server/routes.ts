import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { db, DB_ENGINE, checkDatabaseHealth } from './db.ts';
import {
  requireAuth,
  requireRole,
  registerAccount,
  createTeamMember,
  authenticateAccount,
  signToken,
  clearLegacyAuthCookie,
  revokeTokenFromRequest,
  type AuthedRequest,
} from './auth.ts';
import {
  MAX_FILE_SIZE_BYTES,
  ALLOWED_DOC_EXTENSIONS,
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_LOGO_EXTENSIONS,
  validateUploadedBufferContent,
  extractDocumentTextFromBuffer,
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
} from './storage.ts';
import {
  runFullComplianceAnalysis,
  extractStructuredGuidelinesFromText,
  formatGeminiError,
  type ApprovedFactInput,
  type TerminologyRuleInput,
  type CheckAreaSummary,
} from './complianceEngine.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

const authAttempts = new Map<string, { count: number; resetAt: number }>();

function authRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const maxAttempts = 60;
  const record = authAttempts.get(key);
  if (!record || record.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }
  record.count += 1;
  if (record.count > maxAttempts) {
    res.status(429).json({ error: 'Too many authentication requests. Please wait a few minutes and try again.' });
    return;
  }
  next();
}

function asyncHandler(
  fn: (req: AuthedRequest, res: express.Response, next: express.NextFunction) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

async function resolveTenantAsset(companyId: number, safeFilename: string): Promise<{
  backend: StorageBackend;
  storageKey: string;
  filename: string;
  mimeType: string;
  originalName: string;
} | null> {
  const stored = await db.get<{
    storage_backend: StorageBackend;
    storage_key: string;
    filename: string;
    mime_type: string;
    original_name: string;
  }>(
    `SELECT storage_backend, storage_key, filename, mime_type, original_name
     FROM stored_files
     WHERE company_id = ? AND filename = ?
     ORDER BY id DESC
     LIMIT 1`,
    companyId,
    safeFilename
  );

  if (stored) {
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

export function createApiRouter(): express.Router {
  const router = express.Router();

  // ---------------- HEALTH CHECK ----------------
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbHealthy = await checkDatabaseHealth();
      if (!dbHealthy) {
        res.status(503).json({ status: 'error', database: 'unavailable' });
        return;
      }
      const apiKey = process.env.GEMINI_API_KEY;
      const geminiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
      const storage = getStorageStatus();
      res.json({
        status: 'ok',
        database: 'connected',
        engine: DB_ENGINE,
        storage: storage.mode,
        geminiConfigured,
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
        if (String(password).length < 6) {
          res.status(400).json({ error: 'Password must be at least 6 characters.' });
          return;
        }
        const user = await registerAccount({ name, email, password, companyName, role });
        const token = signToken(user);
        clearLegacyAuthCookie(res);
        res.status(201).json({ user, token });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
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
        res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed.' });
      }
    })
  );

  router.post(
    '/auth/demo',
    authRateLimit,
    asyncHandler(async (_req, res) => {
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

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    res.json({ user: req.user });
  });

  // ---------------- ORGANIZATION TEAM (RBAC) ----------------
  router.get(
    '/team/members',
    requireAuth,
    asyncHandler(async (req, res) => {
      const members = await db.all(
        'SELECT id, name, email, role, created_at FROM users WHERE company_id = ? ORDER BY id ASC',
        req.user!.companyId
      );
      res.json({ members });
    })
  );

  router.post(
    '/team/members',
    requireAuth,
    requireRole('reviewer'),
    asyncHandler(async (req, res) => {
      try {
        const { name, email, password, role } = req.body ?? {};
        if (!name || !email || !password) {
          res.status(400).json({ error: 'Name, email, and password are required.' });
          return;
        }
        if (String(password).length < 6) {
          res.status(400).json({ error: 'Password must be at least 6 characters.' });
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
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create team member.' });
      }
    })
  );

  // ---------------- TENANT-PROTECTED FILE SERVING ----------------
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
        `SELECT r.id, r.submission_id, r.reviewer_name, r.decision, r.comment, r.created_at,
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
    upload.single('logo'),
    asyncHandler(async (req, res) => {
      try {
        const companyId = req.user!.companyId;
        const { name, industry, primaryColor, secondaryColor } = req.body ?? {};
        if (!name || !String(name).trim()) {
          res.status(400).json({ error: 'Brand name is required.' });
          return;
        }

        if (req.file) {
          validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
        }

        const brandId = await db.insert(
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

        await db.insert(
          'INSERT INTO brand_rules (company_id, brand_id, tone_rules, messaging_rules) VALUES (?, ?, ?, ?)',
          companyId,
          brandId,
          '',
          ''
        );

        if (req.file) {
          const storedLogo = await uploadAsset({
            companyId,
            brandId,
            assetKind: 'brand_logo',
            originalName: req.file.originalname,
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
          });

          await db.run(
            'UPDATE brands SET logo_filename = ?, logo_original_name = ? WHERE id = ? AND company_id = ?',
            storedLogo.filename,
            req.file.originalname,
            brandId,
            companyId
          );

          await db.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            'brand_logo',
            storedLogo.backend,
            storedLogo.storageKey,
            storedLogo.filename,
            req.file.originalname,
            storedLogo.mimeType,
            storedLogo.sizeBytes,
            req.user!.id
          );
        }

        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.status(201).json({ brand });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create brand.' });
      }
    })
  );

  router.put(
    '/brands/:id',
    requireAuth,
    upload.single('logo'),
    asyncHandler(async (req, res) => {
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.id);
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
          validateUploadedBufferContent(req.file.buffer, req.file.originalname, ALLOWED_LOGO_EXTENSIONS);
        }

        let logoFilename = existing.logo_filename;
        let logoOrig = existing.logo_original_name;

        if (req.file) {
          const storedLogo = await uploadAsset({
            companyId,
            brandId,
            assetKind: 'brand_logo',
            originalName: req.file.originalname,
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
          });
          logoFilename = storedLogo.filename;
          logoOrig = req.file.originalname;

          await db.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            brandId,
            'brand_logo',
            storedLogo.backend,
            storedLogo.storageKey,
            storedLogo.filename,
            req.file.originalname,
            storedLogo.mimeType,
            storedLogo.sizeBytes,
            req.user!.id
          );
        }

        const { name, industry, primaryColor, secondaryColor } = req.body ?? {};
        await db.run(
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

        const brand = await db.get('SELECT * FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
        res.json({ brand });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update brand.' });
      }
    })
  );

  router.delete(
    '/brands/:id',
    requireAuth,
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
    upload.single('document'),
    asyncHandler(async (req, res) => {
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
        const extractedText = await extractDocumentTextFromBuffer(req.file.buffer, req.file.originalname);

        if (!extractedText) {
          res.status(400).json({ error: 'No readable text could be extracted from the uploaded file.' });
          return;
        }

        const storedDoc = await uploadAsset({
          companyId,
          brandId,
          assetKind: 'guideline_document',
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
        });

        const docId = await db.insert(
          `INSERT INTO guideline_documents (company_id, brand_id, filename, original_name, file_type, extracted_text, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          companyId,
          brandId,
          storedDoc.filename,
          req.file.originalname,
          ext.replace('.', '').toUpperCase(),
          extractedText,
          req.user!.id
        );

        await db.insert(
          `INSERT INTO stored_files (
            company_id, brand_id, guideline_document_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          companyId,
          brandId,
          docId,
          'guideline_document',
          storedDoc.backend,
          storedDoc.storageKey,
          storedDoc.filename,
          req.file.originalname,
          storedDoc.mimeType,
          storedDoc.sizeBytes,
          req.user!.id
        );

        const doc = await db.get('SELECT * FROM guideline_documents WHERE id = ?', docId);

        let autoExtracted = null;
        if (req.body?.autoExtract === 'true') {
          try {
            autoExtracted = await extractStructuredGuidelinesFromText(extractedText, req.file.originalname);
          } catch {
            // Non-fatal: raw document is still saved
          }
        }

        res.status(201).json({ document: doc, autoExtracted });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Guideline upload failed.' });
      }
    })
  );

  router.post(
    '/guidelines/:brandId/ai-extract/:docId',
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const companyId = req.user!.companyId;
        const brandId = Number(req.params.brandId);
        const docId = Number(req.params.docId);
        const doc = await db.get<{ extracted_text: string; original_name: string }>(
          'SELECT * FROM guideline_documents WHERE id = ? AND brand_id = ? AND company_id = ?',
          docId,
          brandId,
          companyId
        );

        if (!doc) {
          res.status(404).json({ error: 'Guideline document not found.' });
          return;
        }

        const extracted = await extractStructuredGuidelinesFromText(doc.extracted_text, doc.original_name);
        res.json({ extracted });
      } catch (err) {
        const msg = formatGeminiError(err);
        const status = msg.includes('(503)') ? 503 : msg.includes('(429)') ? 429 : 500;
        res.status(status).json({ error: msg });
      }
    })
  );

  router.put(
    '/guidelines/:brandId/rules',
    requireAuth,
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
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { fact_key, fact_value, source_doc } = req.body ?? {};
      if (!fact_key || !fact_value) {
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
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const brandId = Number(req.params.brandId);
      const brand = await db.get('SELECT id FROM brands WHERE id = ? AND company_id = ?', brandId, companyId);
      if (!brand) {
        res.status(404).json({ error: 'Brand not found.' });
        return;
      }

      const { prohibited_term, preferred_term, severity, notes } = req.body ?? {};
      if (!prohibited_term || !preferred_term) {
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
    upload.fields([
      { name: 'document', maxCount: 1 },
      { name: 'image', maxCount: 1 },
    ]),
    asyncHandler(async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const docFile = files?.document?.[0];
      const imgFile = files?.image?.[0];

      try {
        const companyId = req.user!.companyId;
        const { brandId, title, pastedText, imageAltText } = req.body ?? {};
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
          validateUploadedBufferContent(docFile.buffer, docFile.originalname, ALLOWED_DOC_EXTENSIONS);
          extractedDocText = await extractDocumentTextFromBuffer(docFile.buffer, docFile.originalname);
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

        const storedDoc = docFile
          ? await uploadAsset({
              companyId,
              brandId: parsedBrandId,
              assetKind: 'submission_document',
              originalName: docFile.originalname,
              buffer: docFile.buffer,
              mimeType: docFile.mimetype,
            })
          : null;

        const storedImg = imgFile
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

        const submissionId = await db.insert(
          `INSERT INTO submissions (
            company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
            file_filename, file_original_name, image_filename, image_alt_text, status, checks_summary_json, image_metrics_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify(analysis.checks),
          imageMetrics ? JSON.stringify(imageMetrics) : null
        );

        if (storedDoc && docFile) {
          await db.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, submission_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            parsedBrandId,
            submissionId,
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
          await db.insert(
            `INSERT INTO stored_files (
              company_id, brand_id, submission_id, asset_kind, storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            companyId,
            parsedBrandId,
            submissionId,
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
          await db.insert(
            `INSERT INTO compliance_issues (
              company_id, submission_id, category, severity, original_text, explanation, evidence, suggested_correction, resolution_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
            companyId,
            submissionId,
            issue.category,
            issue.severity,
            issue.original_text,
            issue.explanation,
            issue.evidence,
            issue.suggested_correction
          );
        }

        await db.insert(
          'INSERT INTO review_events (company_id, submission_id, reviewer_id, reviewer_name, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
          companyId,
          submissionId,
          req.user!.id,
          req.user!.name,
          'submitted',
          `Compliance scan finished: ${analysis.issues.length} issue${analysis.issues.length === 1 ? '' : 's'} detected.`
        );

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
        const issues = await db.all('SELECT * FROM compliance_issues WHERE submission_id = ?', submissionId);

        res.status(201).json({ submission: normalizedSubmission, issues, aiError: analysis.aiError });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Submission analysis failed.' });
      }
    })
  );

  // ---------------- CORRECTIONS & REVISIONS ----------------
  router.post(
    '/submissions/:id/issues/:issueId/resolve',
    requireAuth,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      const issueId = Number(req.params.issueId);
      const { action } = req.body ?? {};

      if (!['accepted', 'rejected', 'open'].includes(action)) {
        res.status(400).json({ error: 'Invalid resolution status.' });
        return;
      }

      const updated = await db.run(
        'UPDATE compliance_issues SET resolution_status = ? WHERE id = ? AND submission_id = ? AND company_id = ?',
        action,
        issueId,
        subId,
        companyId
      );

      if (updated.changes === 0) {
        res.status(404).json({ error: 'Issue not found.' });
        return;
      }

      const issue = await db.get('SELECT * FROM compliance_issues WHERE id = ?', issueId);
      res.json({ issue });
    })
  );

  router.post(
    '/submissions/:id/revisions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const companyId = req.user!.companyId;
      const subId = Number(req.params.id);
      const { revisedContent, note } = req.body ?? {};

      const sub = await db.get<{ checks_summary_json: string }>(
        'SELECT * FROM submissions WHERE id = ? AND company_id = ?',
        subId,
        companyId
      );

      if (!sub) {
        res.status(404).json({ error: 'Submission not found.' });
        return;
      }

      if (typeof revisedContent !== 'string') {
        res.status(400).json({ error: 'Revised content text is required.' });
        return;
      }

      await db.run(
        "UPDATE submissions SET revised_content = ?, status = 'pending_review', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?",
        revisedContent,
        subId,
        companyId
      );

      await db.insert(
        'INSERT INTO revisions (company_id, submission_id, edited_by, content, note) VALUES (?, ?, ?, ?, ?)',
        companyId,
        subId,
        req.user!.id,
        revisedContent,
        String(note || 'Saved revised draft')
      );

      await db.insert(
        'INSERT INTO review_events (company_id, submission_id, reviewer_id, reviewer_name, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
        companyId,
        subId,
        req.user!.id,
        req.user!.name,
        'revision_saved',
        String(note || 'Content revision saved and queued for human approval.')
      );

      const updated = await db.get('SELECT * FROM submissions WHERE id = ?', subId);
      res.json({ submission: updated });
    })
  );

  // ---------------- HUMAN REVIEW & APPROVAL ----------------
  router.post(
    '/submissions/:id/review',
    requireAuth,
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

      const sub = await db.get<{ status: string; checks_summary_json: string }>(
        'SELECT * FROM submissions WHERE id = ? AND company_id = ?',
        subId,
        companyId
      );

      if (!sub) {
        res.status(404).json({ error: 'Submission not found.' });
        return;
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

      await db.run(
        'UPDATE submissions SET status = ?, checks_summary_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?',
        nextStatus,
        JSON.stringify(checks),
        subId,
        companyId
      );

      await db.insert(
        'INSERT INTO review_events (company_id, submission_id, reviewer_id, reviewer_name, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
        companyId,
        subId,
        req.user!.id,
        req.user!.name,
        decision,
        String(comment || '').trim()
      );

      const updatedSubmission = await db.get('SELECT * FROM submissions WHERE id = ?', subId);
      const reviewEvents = await db.all(
        'SELECT * FROM review_events WHERE submission_id = ? AND company_id = ? ORDER BY id DESC',
        subId,
        companyId
      );

      res.json({ submission: updatedSubmission, reviewEvents });
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
