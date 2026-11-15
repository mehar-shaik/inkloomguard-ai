import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, UPLOAD_DIR, initDatabase, closeDatabase, DB_ENGINE } from '../server/db.ts';
import { inferMimeType, getStorageMode } from '../server/storage.ts';
import { createClient } from '@supabase/supabase-js';

async function migrateSqliteToPostgres() {
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

    const users = sqlite
      .prepare('SELECT id, company_id, name, email, password_hash, role, created_at FROM users ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, company_id, name, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (email) DO NOTHING`,
        [u.id, u.company_id, u.name, u.email, u.password_hash, u.role, u.created_at]
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

    const docs = sqlite
      .prepare(
        'SELECT id, company_id, brand_id, filename, original_name, file_type, extracted_text, uploaded_by, created_at FROM guideline_documents ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;
    for (const d of docs) {
      await client.query(
        `INSERT INTO guideline_documents (id, company_id, brand_id, filename, original_name, file_type, extracted_text, uploaded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [d.id, d.company_id, d.brand_id, d.filename, d.original_name, d.file_type, d.extracted_text, d.uploaded_by, d.created_at]
      );
    }

    const facts = sqlite
      .prepare('SELECT id, company_id, brand_id, fact_key, fact_value, source_doc, created_at FROM approved_facts ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;
    for (const f of facts) {
      await client.query(
        `INSERT INTO approved_facts (id, company_id, brand_id, fact_key, fact_value, source_doc, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [f.id, f.company_id, f.brand_id, f.fact_key, f.fact_value, f.source_doc, f.created_at]
      );
    }

    const terms = sqlite
      .prepare(
        'SELECT id, company_id, brand_id, prohibited_term, preferred_term, severity, notes, created_at FROM terminology_rules ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;
    for (const t of terms) {
      await client.query(
        `INSERT INTO terminology_rules (id, company_id, brand_id, prohibited_term, preferred_term, severity, notes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.company_id, t.brand_id, t.prohibited_term, t.preferred_term, t.severity, t.notes, t.created_at]
      );
    }

    const rules = sqlite
      .prepare('SELECT id, company_id, brand_id, tone_rules, messaging_rules, updated_at FROM brand_rules ORDER BY id ASC')
      .all() as Array<Record<string, unknown>>;
    for (const r of rules) {
      await client.query(
        `INSERT INTO brand_rules (id, company_id, brand_id, tone_rules, messaging_rules, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
         ON CONFLICT (brand_id) DO NOTHING`,
        [r.id, r.company_id, r.brand_id, r.tone_rules, r.messaging_rules, r.updated_at]
      );
    }

    const submissions = sqlite
      .prepare(
        `SELECT id, company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
                file_filename, file_original_name, image_filename, image_alt_text, status, checks_summary_json,
                image_metrics_json, created_at, updated_at
         FROM submissions ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;
    for (const s of submissions) {
      await client.query(
        `INSERT INTO submissions (
          id, company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
          file_filename, file_original_name, image_filename, image_alt_text, status, checks_summary_json,
          image_metrics_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $17::timestamptz)
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
          s.checks_summary_json,
          s.image_metrics_json,
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
        [rev.id, rev.company_id, rev.submission_id, rev.edited_by, rev.content, rev.note, rev.created_at]
      );
    }

    const reviewEvents = sqlite
      .prepare(
        'SELECT id, company_id, submission_id, reviewer_id, reviewer_name, decision, comment, created_at FROM review_events ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;
    for (const ev of reviewEvents) {
      await client.query(
        `INSERT INTO review_events (id, company_id, submission_id, reviewer_id, reviewer_name, decision, comment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [ev.id, ev.company_id, ev.submission_id, ev.reviewer_id, ev.reviewer_name, ev.decision, ev.comment, ev.created_at]
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

    // Reset PostgreSQL IDENTITY sequences safely above MAX(id)
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
    ];
    for (const table of tablesWithId) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
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
        brandId: number;
        submissionId?: number;
        guidelineDocumentId?: number;
        assetKind: string;
        filename: string;
        originalName: string;
        uploadedBy?: number;
      }> = [];

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
        const storageKey = `companies/${task.companyId}/brands/${task.brandId}/${task.assetKind}/${path.basename(task.filename)}`;
        const candidatePaths = [
          path.join(UPLOAD_DIR, storageKey),
          path.join(UPLOAD_DIR, path.basename(task.filename)),
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
          [task.companyId, path.basename(task.filename)]
        );
        if (existingMeta.rowCount === 0) {
          await client.query(
            `INSERT INTO stored_files (
              company_id, brand_id, submission_id, guideline_document_id, asset_kind,
              storage_backend, storage_key, filename, original_name, mime_type, size_bytes, uploaded_by
            ) VALUES ($1, $2, $3, $4, $5, 'supabase', $6, $7, $8, $9, $10, $11)`,
            [
              task.companyId,
              task.brandId,
              task.submissionId ?? null,
              task.guidelineDocumentId ?? null,
              task.assetKind,
              storageKey,
              path.basename(task.filename),
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

migrateSqliteToPostgres().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
