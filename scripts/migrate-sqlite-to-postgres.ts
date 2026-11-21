import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, UPLOAD_DIR, initDatabase, closeDatabase, DB_ENGINE } from '../server/db.ts';
import { inferMimeType, getStorageMode } from '../server/storage.ts';
import { createClient } from '@supabase/supabase-js';

export const POSTGRES_ALWAYS_IDENTITY_INSERTS = {
  user_sessions: `INSERT INTO user_sessions (
    id, user_id, company_id, jti, token_version, user_agent, ip_address,
    created_at, last_seen_at, expires_at, revoked_at
  )
  OVERRIDING SYSTEM VALUE
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11::timestamptz)
  ON CONFLICT (jti) DO NOTHING`,

  brand_visual_guidelines: `INSERT INTO brand_visual_guidelines (
    id, company_id, brand_id, accent_colors_json, approved_backgrounds_json,
    logo_rules_json, typography_rules_json, source_document_id, updated_at
  )
  OVERRIDING SYSTEM VALUE
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
  ON CONFLICT (brand_id) DO NOTHING`,

  brand_logo_variants: `INSERT INTO brand_logo_variants (
    id, company_id, brand_id, label, variant_type, filename, original_name,
    width, height, aspect_ratio, dominant_colors_json, features_json, created_at
  )
  OVERRIDING SYSTEM VALUE
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
  ON CONFLICT (id) DO NOTHING`,

  analysis_runs: `INSERT INTO analysis_runs (
    id, company_id, brand_id, submission_id, triggered_by, run_type,
    compliance_score, total_issues, visual_issues, text_issues, ai_status, outcome_status, created_at
  )
  OVERRIDING SYSTEM VALUE
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
  ON CONFLICT (id) DO NOTHING`,
} as const;

export function mapUserSessionInsertParams(us: Record<string, unknown>): unknown[] {
  return [
    us.id,
    us.user_id,
    us.company_id,
    us.jti,
    Number(us.token_version ?? 1),
    us.user_agent ?? '',
    us.ip_address ?? '',
    us.created_at,
    us.last_seen_at,
    Number(us.expires_at ?? 0),
    us.revoked_at ?? null,
  ];
}

export function mapBrandVisualGuidelineInsertParams(vg: Record<string, unknown>): unknown[] {
  return [
    vg.id,
    vg.company_id,
    vg.brand_id,
    vg.accent_colors_json ?? '[]',
    vg.approved_backgrounds_json ?? '[]',
    vg.logo_rules_json ?? '{}',
    vg.typography_rules_json ?? '{}',
    vg.source_document_id ?? null,
    vg.updated_at,
  ];
}

export function mapBrandLogoVariantInsertParams(lv: Record<string, unknown>): unknown[] {
  return [
    lv.id,
    lv.company_id,
    lv.brand_id,
    lv.label,
    lv.variant_type ?? 'secondary',
    lv.filename,
    lv.original_name,
    Number(lv.width ?? 0),
    Number(lv.height ?? 0),
    Number(lv.aspect_ratio ?? 1.0),
    lv.dominant_colors_json ?? '[]',
    lv.features_json ?? '{}',
    lv.created_at,
  ];
}

export function mapAnalysisRunInsertParams(ar: Record<string, unknown>): unknown[] {
  return [
    ar.id,
    ar.company_id,
    ar.brand_id,
    ar.submission_id,
    ar.triggered_by ?? null,
    ar.run_type ?? 'initial',
    ar.compliance_score ?? null,
    Number(ar.total_issues ?? 0),
    Number(ar.visual_issues ?? 0),
    Number(ar.text_issues ?? 0),
    ar.ai_status ?? 'completed',
    ar.outcome_status ?? 'analyzed',
    ar.created_at,
  ];
}

async function migrateSqliteToPostgres() {
  process.env.INKLOOM_STRICT_POSTGRES = 'true';
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl || DB_ENGINE !== 'postgres') {
    console.error('ERROR: DATABASE_URL must be set to your Supabase PostgreSQL connection string.');
    process.exit(1);
  }

  const sqlitePath = process.env.SQLITE_SOURCE_PATH
    ? path.resolve(process.env.SQLITE_SOURCE_PATH)
    : path.resolve(DATA_DIR, 'inkloomguard.db');

  if (!fs.existsSync(sqlitePath)) {
    console.error(`ERROR: Source SQLite database not found at ${sqlitePath}`);
    process.exit(1);
  }

  console.log(`[migrate] Source SQLite: ${sqlitePath}`);
  console.log('[migrate] Ensuring target PostgreSQL schema migrations are applied...');
  await initDatabase();

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    // Check if target already has non-seed data; we NEVER wipe or overwrite existing records.
    await client.query('BEGIN');

    const companies = sqlite.prepare('SELECT id, name, created_at FROM companies ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
      created_at: string;
    }>;

    // Remove auto-seeded AetherFlow row ONLY if source SQLite has company id 1 and target was freshly auto-seeded
    // with only 1 company named 'AetherFlow Systems' and no custom users. Instead, use safe ON CONFLICT DO NOTHING
    // across all tables so existing production rows are NEVER touched!
    for (const c of companies) {
      await client.query(
        'INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3::timestamptz) ON CONFLICT (id) DO NOTHING',
        [c.id, c.name, c.created_at]
      );
    }

    const toPgBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

    const users = sqlite.prepare('SELECT * FROM users ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const u of users) {
      await client.query(
        `INSERT INTO users (
           id, company_id, name, email, password_hash, role,
           avatar_filename, avatar_original_name, job_title, bio, preferences_json,
           email_verified, email_verified_at, verification_required, token_version, password_updated_at,
           updated_at, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14, $15, $16::timestamptz, $17::timestamptz, $18::timestamptz)
         ON CONFLICT (email) DO NOTHING`,
        [
          u.id,
          u.company_id,
          u.name,
          u.email,
          u.password_hash,
          u.role,
          u.avatar_filename ?? null,
          u.avatar_original_name ?? null,
          u.job_title ?? '',
          u.bio ?? '',
          u.preferences_json ?? '{}',
          toPgBool(u.email_verified),
          u.email_verified_at ?? null,
          toPgBool(u.verification_required),
          Number(u.token_version ?? 1),
          u.password_updated_at ?? null,
          u.updated_at || u.created_at,
          u.created_at,
        ]
      );
    }

    const brands = sqlite
      .prepare(
        'SELECT id, company_id, name, industry, primary_color, secondary_color, logo_filename, logo_original_name, created_at FROM brands ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;
    for (const b of brands) {
      await client.query(
        `INSERT INTO brands (id, company_id, name, industry, primary_color, secondary_color, logo_filename, logo_original_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          b.id,
          b.company_id,
          b.name,
          b.industry,
          b.primary_color,
          b.secondary_color,
          b.logo_filename,
          b.logo_original_name,
          b.created_at,
        ]
      );
    }

    const docs = sqlite.prepare('SELECT * FROM guideline_documents ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const d of docs) {
      await client.query(
        `INSERT INTO guideline_documents (
           id, company_id, brand_id, filename, original_name, file_type, extracted_text, uploaded_by,
           content_hash, extracted_rules_json, extracted_at, extraction_status, extraction_error, page_count, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, $15::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          d.id,
          d.company_id,
          d.brand_id,
          d.filename,
          d.original_name,
          d.file_type,
          d.extracted_text,
          d.uploaded_by ?? null,
          d.content_hash ?? null,
          d.extracted_rules_json ?? null,
          d.extracted_at ?? null,
          d.extraction_status ?? 'pending',
          d.extraction_error ?? null,
          Number(d.page_count ?? 1),
          d.created_at,
        ]
      );
    }

    const facts = sqlite.prepare('SELECT * FROM approved_facts ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const f of facts) {
      await client.query(
        `INSERT INTO approved_facts (
           id, company_id, brand_id, fact_key, fact_value, source_doc,
           source_document_id, source_page, source_section, source_excerpt, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          f.id,
          f.company_id,
          f.brand_id,
          f.fact_key,
          f.fact_value,
          f.source_doc,
          f.source_document_id ?? null,
          f.source_page ?? null,
          f.source_section ?? '',
          f.source_excerpt ?? '',
          f.created_at,
        ]
      );
    }

    const terms = sqlite.prepare('SELECT * FROM terminology_rules ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const t of terms) {
      await client.query(
        `INSERT INTO terminology_rules (
           id, company_id, brand_id, prohibited_term, preferred_term, severity, notes,
           source_document_id, source_page, source_section, source_excerpt, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id,
          t.company_id,
          t.brand_id,
          t.prohibited_term,
          t.preferred_term,
          t.severity,
          t.notes,
          t.source_document_id ?? null,
          t.source_page ?? null,
          t.source_section ?? '',
          t.source_excerpt ?? '',
          t.created_at,
        ]
      );
    }

    const rules = sqlite.prepare('SELECT * FROM brand_rules ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const r of rules) {
      await client.query(
        `INSERT INTO brand_rules (id, company_id, brand_id, tone_rules, messaging_rules, source_document_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (brand_id) DO NOTHING`,
        [r.id, r.company_id, r.brand_id, r.tone_rules, r.messaging_rules, r.source_document_id ?? null, r.updated_at]
      );
    }

    const submissions = sqlite.prepare('SELECT * FROM submissions ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const s of submissions) {
      await client.query(
        `INSERT INTO submissions (
          id, company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
          file_filename, file_original_name, image_filename, image_alt_text, status,
          compliance_score, analysis_coverage, ai_status, ai_error,
          request_idempotency_key, content_hash, analysis_stage, analysis_timings_json,
          checks_summary_json, image_metrics_json, visual_analysis_json, visual_image_hash, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26::timestamptz, $27::timestamptz)
        ON CONFLICT (id) DO NOTHING`,
        [
          s.id,
          s.company_id,
          s.brand_id,
          s.submitted_by,
          s.title,
          s.input_type,
          s.original_content,
          s.revised_content,
          s.file_filename,
          s.file_original_name,
          s.image_filename,
          s.image_alt_text,
          s.status,
          s.compliance_score ?? null,
          s.analysis_coverage ?? null,
          s.ai_status ?? 'completed',
          s.ai_error ?? null,
          s.request_idempotency_key ?? null,
          s.content_hash ?? null,
          s.analysis_stage ?? 'completed',
          s.analysis_timings_json ?? null,
          s.checks_summary_json,
          s.image_metrics_json,
          s.visual_analysis_json ?? null,
          s.visual_image_hash ?? null,
          s.created_at,
          s.updated_at,
        ]
      );
    }

    const issues = sqlite
      .prepare(
        `SELECT id, company_id, submission_id, category, severity, original_text, explanation, evidence,
                suggested_correction, resolution_status, created_at
         FROM compliance_issues ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;
    for (const i of issues) {
      await client.query(
        `INSERT INTO compliance_issues (
          id, company_id, submission_id, category, severity, original_text, explanation, evidence,
          suggested_correction, resolution_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
        ON CONFLICT (id) DO NOTHING`,
        [
          i.id,
          i.company_id,
          i.submission_id,
          i.category,
          i.severity,
          i.original_text,
          i.explanation,
          i.evidence,
          i.suggested_correction,
          i.resolution_status,
          i.created_at,
        ]
      );
    }

    const revisions = sqlite
      .prepare('SELECT id, company_id, submission_id, edited_by, content, note, created_at FROM revisions ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;
    for (const rev of revisions) {
      await client.query(
        `INSERT INTO revisions (id, company_id, submission_id, edited_by, content, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [rev.id, rev.company_id, rev.submission_id, rev.edited_by ?? null, rev.content, rev.note, rev.created_at]
      );
    }

    const reviewEvents = sqlite.prepare('SELECT * FROM review_events ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    for (const ev of reviewEvents) {
      await client.query(
        `INSERT INTO review_events (id, company_id, submission_id, reviewer_id, reviewer_name, decision, previous_status, new_status, comment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [
          ev.id,
          ev.company_id,
          ev.submission_id,
          ev.reviewer_id ?? null,
          ev.reviewer_name,
          ev.decision,
          ev.previous_status ?? '',
          ev.new_status ?? '',
          ev.comment,
          ev.created_at,
        ]
      );
    }

    const revoked = sqlite
      .prepare('SELECT jti, expires_at, created_at FROM revoked_tokens')
      .all() as Array<Record<string, unknown>>;
    for (const rt of revoked) {
      await client.query(
        `INSERT INTO revoked_tokens (jti, expires_at, created_at)
         VALUES ($1, $2, $3::timestamptz)
         ON CONFLICT (jti) DO NOTHING`,
        [rt.jti, rt.expires_at, rt.created_at]
      );
    }

    const hasTable = (name: string) =>
      Boolean(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
      );

    if (hasTable('user_sessions')) {
      const sessions = sqlite.prepare('SELECT * FROM user_sessions ORDER BY id ASC').all() as Array<Record<string, unknown>>;
      for (const us of sessions) {
        await client.query(
          POSTGRES_ALWAYS_IDENTITY_INSERTS.user_sessions,
          mapUserSessionInsertParams(us)
        );
      }
    }

    if (hasTable('brand_visual_guidelines')) {
      const visualRows = sqlite
        .prepare('SELECT * FROM brand_visual_guidelines ORDER BY id ASC')
        .all() as Array<Record<string, unknown>>;
      for (const vg of visualRows) {
        await client.query(
          POSTGRES_ALWAYS_IDENTITY_INSERTS.brand_visual_guidelines,
          mapBrandVisualGuidelineInsertParams(vg)
        );
      }
    }

    const logoVariants = hasTable('brand_logo_variants')
      ? (sqlite.prepare('SELECT * FROM brand_logo_variants ORDER BY id ASC').all() as Array<Record<string, unknown>>)
      : [];
    for (const lv of logoVariants) {
      await client.query(
        POSTGRES_ALWAYS_IDENTITY_INSERTS.brand_logo_variants,
        mapBrandLogoVariantInsertParams(lv)
      );
    }

    if (hasTable('analysis_runs')) {
      const runs = sqlite.prepare('SELECT * FROM analysis_runs ORDER BY id ASC').all() as Array<Record<string, unknown>>;
      for (const ar of runs) {
        await client.query(
          POSTGRES_ALWAYS_IDENTITY_INSERTS.analysis_runs,
          mapAnalysisRunInsertParams(ar)
        );
      }
    }

    // Reset PostgreSQL IDENTITY sequences safely above MAX(id) (or 1, not yet called, when empty)
    const tablesWithId = [
      'companies',
      'users',
      'brands',
      'guideline_documents',
      'approved_facts',
      'terminology_rules',
      'brand_rules',
      'submissions',
      'compliance_issues',
      'revisions',
      'review_events',
      'stored_files',
      'user_sessions',
      'brand_visual_guidelines',
      'brand_logo_variants',
      'analysis_runs',
    ];
    for (const table of tablesWithId) {
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence($1, 'id'),
           COALESCE((SELECT MAX(id) FROM ${table}), 1),
           EXISTS (SELECT 1 FROM ${table})
         )`,
        [table]
      );
    }

    await client.query('COMMIT');
    console.log(
      `[migrate] Database rows synced safely (${companies.length} companies, ${users.length} users, ${brands.length} brands, ${submissions.length} submissions).`
    );

    // Optional file upload migration to Supabase Storage when configured
    if (getStorageMode() === 'supabase' && fs.existsSync(UPLOAD_DIR)) {
      const supabase = createClient(
        process.env.SUPABASE_URL!.trim(),
        process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const bucket = process.env.SUPABASE_STORAGE_BUCKET!.trim();

      const uploadTasks: Array<{
        companyId: number;
        brandId: number | null;
        userId?: number;
        submissionId?: number;
        guidelineDocumentId?: number;
        assetKind: string;
        filename: string;
        originalName: string;
        uploadedBy?: number;
      }> = [];

      for (const u of users) {
        if (u.avatar_filename) {
          uploadTasks.push({
            companyId: Number(u.company_id),
            brandId: null,
            userId: Number(u.id),
            assetKind: 'user_avatar',
            filename: String(u.avatar_filename),
            originalName: String(u.avatar_original_name || u.avatar_filename),
            uploadedBy: Number(u.id),
          });
        }
      }
      for (const b of brands) {
        if (b.logo_filename) {
          uploadTasks.push({
            companyId: Number(b.company_id),
            brandId: Number(b.id),
            assetKind: 'brand_logo',
            filename: String(b.logo_filename),
            originalName: String(b.logo_original_name || b.logo_filename),
          });
        }
      }
      for (const lv of logoVariants) {
        if (lv.filename) {
          uploadTasks.push({
            companyId: Number(lv.company_id),
            brandId: Number(lv.brand_id),
            assetKind: 'brand_logo',
            filename: String(lv.filename),
            originalName: String(lv.original_name || lv.filename),
          });
        }
      }
      for (const d of docs) {
        uploadTasks.push({
          companyId: Number(d.company_id),
          brandId: Number(d.brand_id),
          guidelineDocumentId: Number(d.id),
          assetKind: 'guideline_document',
          filename: String(d.filename),
          originalName: String(d.original_name),
          uploadedBy: Number(d.uploaded_by),
        });
      }
      for (const s of submissions) {
        if (s.file_filename) {
          uploadTasks.push({
            companyId: Number(s.company_id),
            brandId: Number(s.brand_id),
            submissionId: Number(s.id),
            assetKind: 'submission_document',
            filename: String(s.file_filename),
            originalName: String(s.file_original_name || s.file_filename),
            uploadedBy: Number(s.submitted_by),
          });
        }
        if (s.image_filename) {
          uploadTasks.push({
            companyId: Number(s.company_id),
            brandId: Number(s.brand_id),
            submissionId: Number(s.id),
            assetKind: 'submission_image',
            filename: String(s.image_filename),
            originalName: String(s.image_filename),
            uploadedBy: Number(s.submitted_by),
          });
        }
      }

      let uploadedCount = 0;
      for (const task of uploadTasks) {
        const cleanFilename = path.basename(task.filename);
        const storageKey =
          task.assetKind === 'user_avatar'
            ? `companies/${task.companyId}/users/${task.userId}/user_avatar/${cleanFilename}`
            : `companies/${task.companyId}/brands/${task.brandId}/${task.assetKind}/${cleanFilename}`;
        const candidatePaths = [
          path.join(UPLOAD_DIR, storageKey),
          path.join(UPLOAD_DIR, cleanFilename),
        ];
        const foundPath = candidatePaths.find((p) => fs.existsSync(p));
        if (!foundPath) continue;

        const fileBuffer = fs.readFileSync(foundPath);
        const mimeType = inferMimeType(task.filename);

        await supabase.storage.from(bucket).upload(storageKey, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });

        const existingMeta = await client.query(
          'SELECT id FROM stored_files WHERE company_id = $1 AND filename = $2 LIMIT 1',
          [task.companyId, cleanFilename]
        );
        if (existingMeta.rowCount === 0) {
          await client.query(
            `INSERT INTO stored_files (
              company_id, brand_id, user_id, submission_id, guideline_document_id, asset_kind,
              storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES ($1, $2, $3, $4, $5, $6, 'supabase', $7, $8, $9, $10, $11, $12)`,
            [
              task.companyId,
              task.brandId,
              task.userId ?? null,
              task.submissionId ?? null,
              task.guidelineDocumentId ?? null,
              task.assetKind,
              storageKey,
              cleanFilename,
              task.originalName,
              mimeType,
              fileBuffer.length,
              task.uploadedBy ?? null,
            ]
          );
        }
        uploadedCount++;
      }
      console.log(`[migrate] Synced ${uploadedCount} existing upload files into private Supabase bucket "${bucket}".`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
    await closeDatabase();
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  migrateSqliteToPostgres().catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
}
