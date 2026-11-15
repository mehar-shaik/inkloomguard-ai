import { DatabaseSync } from 'node:sqlite';
import { Pool, types } from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

// Parse PostgreSQL BIGINT (OID 20) as JS Number so IDs/counts remain numeric across Postgres and SQLite
types.setTypeParser(20, (val: string) => Number(val));

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');

export type DbEngine = 'postgres' | 'sqlite';

export interface RunResult {
  changes: number;
  lastInsertRowid?: number;
}

export interface DbClient {
  engine: DbEngine;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  insert(sql: string, ...params: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

function convertPlaceholdersToPg(sql: string): string {
  let index = 0;
  let inSingleQuote = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== '\\') {
      if (inSingleQuote && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += ch;
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      index++;
      result += `$${index}`;
    } else {
      result += ch;
    }
  }
  return result;
}

function normalizePgParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

function shouldUsePgSsl(connectionString: string): boolean {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return true;
  if (connectionString.includes('sslmode=disable')) return false;
  try {
    const parsed = new URL(connectionString);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
  } catch {
    // Default to SSL for remote URLs like Supabase
  }
  return true;
}

let sqliteInstance: DatabaseSync | null = null;
let pgPool: Pool | null = null;
let initialized = false;

const databaseUrl = process.env.DATABASE_URL?.trim();
const isProductionRuntime = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

if (isProductionRuntime && !databaseUrl && process.env.ALLOW_LOCAL_SQLITE_FALLBACK !== 'true') {
  throw new Error(
    'DATABASE_URL must be configured in production (Supabase PostgreSQL). Local SQLite in DATA_DIR is disabled in production.'
  );
}

export const DB_ENGINE: DbEngine = databaseUrl ? 'postgres' : 'sqlite';

function ensureLocalDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function getSqlite(): DatabaseSync {
  if (!sqliteInstance) {
    ensureLocalDataDirs();
    const dbPath = path.resolve(DATA_DIR, 'inkloomguard.db');
    sqliteInstance = new DatabaseSync(dbPath);
    sqliteInstance.exec('PRAGMA journal_mode = WAL;');
    sqliteInstance.exec('PRAGMA foreign_keys = ON;');
  }
  return sqliteInstance;
}

function getPgPool(): Pool {
  if (!pgPool) {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured.');
    }
    pgPool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: shouldUsePgSsl(databaseUrl) ? { rejectUnauthorized: false } : false,
    });
  }
  return pgPool;
}

export const db: DbClient =
  DB_ENGINE === 'postgres'
    ? {
        engine: 'postgres',
        async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
          const pgSql = convertPlaceholdersToPg(sql);
          const res = await getPgPool().query(pgSql, normalizePgParams(params));
          return res.rows[0] as T | undefined;
        },
        async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
          const pgSql = convertPlaceholdersToPg(sql);
          const res = await getPgPool().query(pgSql, normalizePgParams(params));
          return res.rows as T[];
        },
        async run(sql: string, ...params: unknown[]): Promise<RunResult> {
          const pgSql = convertPlaceholdersToPg(sql);
          const res = await getPgPool().query(pgSql, normalizePgParams(params));
          return { changes: res.rowCount ?? 0 };
        },
        async insert(sql: string, ...params: unknown[]): Promise<number> {
          const trimmed = sql.trim().replace(/;$/, '');
          const withReturning = /\bRETURNING\b/i.test(trimmed) ? trimmed : `${trimmed} RETURNING id`;
          const pgSql = convertPlaceholdersToPg(withReturning);
          const res = await getPgPool().query(pgSql, normalizePgParams(params));
          const row = res.rows[0] as { id?: string | number } | undefined;
          return Number(row?.id ?? 0);
        },
        async exec(sql: string): Promise<void> {
          await getPgPool().query(sql);
        },
        async close(): Promise<void> {
          if (pgPool) {
            await pgPool.end();
            pgPool = null;
          }
        },
      }
    : {
        engine: 'sqlite',
        async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
          const stmt = getSqlite().prepare(sql);
          return stmt.get(...(params as Array<string | number | null | Uint8Array>)) as T | undefined;
        },
        async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
          const stmt = getSqlite().prepare(sql);
          return stmt.all(...(params as Array<string | number | null | Uint8Array>)) as T[];
        },
        async run(sql: string, ...params: unknown[]): Promise<RunResult> {
          const stmt = getSqlite().prepare(sql);
          const res = stmt.run(...(params as Array<string | number | null | Uint8Array>));
          return {
            changes: Number(res.changes ?? 0),
            lastInsertRowid: Number(res.lastInsertRowid ?? 0),
          };
        },
        async insert(sql: string, ...params: unknown[]): Promise<number> {
          const stmt = getSqlite().prepare(sql);
          const res = stmt.run(...(params as Array<string | number | null | Uint8Array>));
          return Number(res.lastInsertRowid);
        },
        async exec(sql: string): Promise<void> {
          getSqlite().exec(sql);
        },
        async close(): Promise<void> {
          if (sqliteInstance) {
            sqliteInstance.close();
            sqliteInstance = null;
          }
        },
      };

async function applyPostgresMigrations(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Missing PostgreSQL migrations directory at ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await db.get<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = ?',
      file
    );
    if (existing) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await getPgPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [
        file,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

async function applySqliteSchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reviewer',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT '',
      primary_color TEXT NOT NULL DEFAULT '#4F46E5',
      secondary_color TEXT NOT NULL DEFAULT '#06B6D4',
      logo_filename TEXT,
      logo_original_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guideline_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      uploaded_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approved_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      source_doc TEXT NOT NULL DEFAULT 'Manual Entry',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS terminology_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      prohibited_term TEXT NOT NULL,
      preferred_term TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'high',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS brand_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL UNIQUE,
      tone_rules TEXT NOT NULL DEFAULT '',
      messaging_rules TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      submitted_by INTEGER NOT NULL,
      title TEXT NOT NULL,
      input_type TEXT NOT NULL DEFAULT 'text',
      original_content TEXT NOT NULL,
      revised_content TEXT NOT NULL,
      file_filename TEXT,
      file_original_name TEXT,
      image_filename TEXT,
      image_alt_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'analyzed',
      checks_summary_json TEXT NOT NULL DEFAULT '[]',
      image_metrics_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS compliance_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      original_text TEXT NOT NULL,
      explanation TEXT NOT NULL,
      evidence TEXT NOT NULL,
      suggested_correction TEXT NOT NULL,
      resolution_status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      edited_by INTEGER NOT NULL,
      content TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      reviewer_id INTEGER NOT NULL,
      reviewer_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stored_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      submission_id INTEGER,
      guideline_document_id INTEGER,
      asset_kind TEXT NOT NULL,
      storage_backend TEXT NOT NULL DEFAULT 'local',
      storage_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (guideline_document_id) REFERENCES guideline_documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
    CREATE INDEX IF NOT EXISTS idx_brands_company ON brands(company_id);
    CREATE INDEX IF NOT EXISTS idx_guideline_docs_brand_company ON guideline_documents(brand_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_facts_brand_company ON approved_facts(brand_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_terms_brand_company ON terminology_rules(brand_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_company ON submissions(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_issues_submission_company ON compliance_issues(submission_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_submission_company ON revisions(submission_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_review_events_submission_company ON review_events(submission_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_stored_files_company ON stored_files(company_id);
    CREATE INDEX IF NOT EXISTS idx_stored_files_filename ON stored_files(filename, company_id);
    CREATE INDEX IF NOT EXISTS idx_stored_files_brand ON stored_files(brand_id, company_id);
  `);
}

export async function initDatabase(): Promise<void> {
  if (initialized) return;

  if (DB_ENGINE === 'postgres') {
    await applyPostgresMigrations();
  } else {
    await applySqliteSchema();
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  await db.run('DELETE FROM revoked_tokens WHERE expires_at > 0 AND expires_at < ?', nowEpoch);

  await seedInitialWorkspace();
  initialized = true;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  initialized = false;
  await db.close();
}

async function seedInitialWorkspace(): Promise<void> {
  const existing = await db.get<{ cnt: number | string }>('SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM companies');
  if (Number(existing?.cnt ?? 0) > 0) return;

  const companyId = await db.insert('INSERT INTO companies (name) VALUES (?)', 'AetherFlow Systems');

  const hash = bcrypt.hashSync('Inkloom2026!', 10);
  const userId = await db.insert(
    'INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    companyId,
    'Elena Vance',
    'elena@aetherflow.io',
    hash,
    'reviewer'
  );

  const brandId = await db.insert(
    'INSERT INTO brands (company_id, name, industry, primary_color, secondary_color, logo_filename, logo_original_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
    companyId,
    'AetherFlow Cloud',
    'Enterprise Infrastructure',
    '#4F46E5',
    '#06B6D4',
    null,
    'aetherflow_mark.png'
  );

  await db.insert(
    'INSERT INTO brand_rules (company_id, brand_id, tone_rules, messaging_rules) VALUES (?, ?, ?, ?)',
    companyId,
    brandId,
    'Authoritative, crisp, transparent, and technically precise. Avoid hype, exclamation-heavy sales language, or unverified absolutes. Speak directly to engineering and security leaders.',
    'Always position AetherFlow Cloud as an enterprise-grade observability and workflow orchestration platform. Emphasize verifiable uptime, SOC 2 Type II compliance, and deterministic auditing.'
  );

  const factSql = 'INSERT INTO approved_facts (company_id, brand_id, fact_key, fact_value, source_doc) VALUES (?, ?, ?, ?, ?)';
  await db.insert(factSql, companyId, brandId, 'SLA Uptime', '99.95% contractual uptime SLA', 'AetherFlow Brand & Fact Sheet');
  await db.insert(factSql, companyId, brandId, 'Compliance Certification', 'SOC 2 Type II and ISO 27001 certified', 'AetherFlow Brand & Fact Sheet');
  await db.insert(factSql, companyId, brandId, 'Founded Year', 'Founded in 2021 in Seattle, Washington', 'AetherFlow Brand & Fact Sheet');

  const termSql =
    'INSERT INTO terminology_rules (company_id, brand_id, prohibited_term, preferred_term, severity, notes) VALUES (?, ?, ?, ?, ?, ?)';
  await db.insert(termSql, companyId, brandId, 'cheap', 'cost-effective', 'medium', 'Never describe enterprise infrastructure as cheap');
  await db.insert(termSql, companyId, brandId, 'unbreakable', 'resilient', 'high', 'Avoid absolute security promises');
  await db.insert(termSql, companyId, brandId, 'Aetherflow', 'AetherFlow', 'high', 'Capitalize F in AetherFlow');
  await db.insert(termSql, companyId, brandId, '100% uptime', '99.95% contractual uptime SLA', 'critical', 'Must match verified SLA figure');

  const sampleOriginal = `# Q4 Enterprise Infrastructure Brief\n\nAetherflow delivers cheap, unbreakable cloud orchestration with 100% uptime guaranteed for every global team.\n\nWe are the #1 best platform in the world for zero-risk deployments!`;
  const sampleChecks = JSON.stringify([
    { area: 'Brand Tone', status: 'issues_found', summary: 'Overly promotional exclamation and hype language conflicts with calm, authoritative tone rules.' },
    { area: 'Terminology', status: 'issues_found', summary: '3 prohibited or mis-cased terms detected via deterministic rule matching.' },
    { area: 'Brand Messaging', status: 'issues_found', summary: 'Missing approved positioning around observability and deterministic auditing.' },
    { area: 'Facts', status: 'issues_found', summary: 'Claimed "100% uptime" contradicts approved fact "99.95% contractual uptime SLA".' },
    { area: 'Promotional Claims', status: 'issues_found', summary: 'Unsupported superlatives "#1 best platform in the world" and "guaranteed" flagged.' },
    { area: 'Visual Identity', status: 'not_performed', summary: 'Not performed — text-only submission with no image asset attached.' },
    { area: 'Accessibility', status: 'passed', summary: 'Single H1 heading present and concise sentence structure.' },
    { area: 'Governance', status: 'warning', summary: 'Awaiting human reviewer decision after compliance scan.' },
  ]);

  const subId = await db.insert(
    `INSERT INTO submissions (
      company_id, brand_id, submitted_by, title, input_type, original_content, revised_content, status, checks_summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId,
    brandId,
    userId,
    'Q4 Enterprise Launch Brief',
    'text',
    sampleOriginal,
    sampleOriginal,
    'pending_review',
    sampleChecks
  );

  const issueSql = `INSERT INTO compliance_issues (
    company_id, submission_id, category, severity, original_text, explanation, evidence, suggested_correction, resolution_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.insert(
    issueSql,
    companyId,
    subId,
    'Terminology',
    'high',
    'Aetherflow',
    'Brand name casing must preserve internal camelCase capitalization.',
    'Terminology Rule: Prohibited "Aetherflow" -> Preferred "AetherFlow" (Capitalize F in AetherFlow)',
    'AetherFlow',
    'open'
  );
  await db.insert(
    issueSql,
    companyId,
    subId,
    'Terminology',
    'medium',
    'cheap',
    'Using "cheap" undermines enterprise positioning and violates approved terminology.',
    'Terminology Rule: Prohibited "cheap" -> Preferred "cost-effective"',
    'cost-effective',
    'open'
  );
  await db.insert(
    issueSql,
    companyId,
    subId,
    'Facts',
    'critical',
    '100% uptime',
    'Claimed uptime figure contradicts the verified contractual SLA documented in company facts.',
    'Approved Fact [SLA Uptime]: "99.95% contractual uptime SLA"',
    '99.95% contractual uptime SLA',
    'open'
  );
  await db.insert(
    issueSql,
    companyId,
    subId,
    'Promotional Claims',
    'high',
    '#1 best platform in the world for zero-risk deployments!',
    'Unsupported superlative and absolute risk claim cannot be substantiated by approved facts.',
    'Brand Tone Rule: "Avoid hype, exclamation-heavy sales language, or unverified absolutes."',
    'an enterprise-grade orchestration platform built for deterministic auditing.',
    'open'
  );

  await db.insert(
    'INSERT INTO review_events (company_id, submission_id, reviewer_id, reviewer_name, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
    companyId,
    subId,
    userId,
    'Elena Vance',
    'submitted',
    'Initial compliance scan completed across 8 brand governance areas.'
  );
}
