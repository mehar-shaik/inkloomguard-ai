import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, types } from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

// Parse PostgreSQL BIGINT (OID 20) safely as JS Number within safe integer bounds
types.setTypeParser(20, (val: string) => {
  const num = Number(val);
  if (!Number.isSafeInteger(num)) {
    throw new RangeError(`PostgreSQL BIGINT value exceeds JS MAX_SAFE_INTEGER: ${val}`);
  }
  return num;
});

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');

export type DbEngine = 'postgres' | 'sqlite';

export interface RunResult {
  changes: number;
  lastInsertRowid?: number;
}

export interface DbTx {
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  insert(sql: string, ...params: unknown[]): Promise<number>;
}

export interface DbClient extends DbTx {
  engine: DbEngine;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function convertPlaceholdersToPg(sql: string): string {
  let index = 0;
  let result = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Single-line comment -- ... \n
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      if (end === -1) {
        result += sql.slice(i);
        break;
      }
      result += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Block comment /* ... */ (supports nesting)
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      result += sql.slice(i, j);
      i = j;
      continue;
    }

    // Single-quoted string literal '...' (handling '' escapes)
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      result += sql.slice(i, j);
      i = j;
      continue;
    }

    // Double-quoted identifier "..." (handling "" escapes)
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      result += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted block $tag$...$tag$
    if (ch === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) {
          const end = closeIdx + tag.length;
          result += sql.slice(i, end);
          i = end;
          continue;
        }
      }
    }

    // Parameter placeholder ? (avoid PostgreSQL JSONB ?| and ?& operators)
    if (ch === '?') {
      if (next === '|' || next === '&') {
        result += ch + next;
        i += 2;
        continue;
      }
      if (next === '?') {
        result += '?';
        i += 2;
        continue;
      }
      index++;
      result += `$${index}`;
      i++;
      continue;
    }

    result += ch;
    i++;
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
let migrationsReady = false;

export function isMigrationsReady(): boolean {
  return migrationsReady;
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
}

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const isProductionRuntime = isProductionEnvironment();
const isPlaceholderDatabaseUrl =
  !isProductionRuntime &&
  Boolean(
    rawDatabaseUrl &&
      (/YOUR_PROJECT_REF/i.test(rawDatabaseUrl) || /YOUR_DB_PASSWORD/i.test(rawDatabaseUrl))
  );
const databaseUrl = isPlaceholderDatabaseUrl ? '' : rawDatabaseUrl;

if (isProductionRuntime && !databaseUrl) {
  throw new Error(
    'DATABASE_URL must be configured in production (Supabase PostgreSQL). Local SQLite in DATA_DIR is strictly disabled in production.'
  );
}

export let DB_ENGINE: DbEngine = databaseUrl ? 'postgres' : 'sqlite';

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
      connectionTimeoutMillis: 5_000,
      ssl: shouldUsePgSsl(databaseUrl) ? { rejectUnauthorized: false } : false,
    });
    pgPool.on('error', (err) => {
      console.error('[InkloomGuard AI] PostgreSQL pool error:', err instanceof Error ? err.message : String(err));
    });
  }
  return pgPool;
}

const pgClient: DbClient = {
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
        async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
          const client = await getPgPool().connect();
          const tx: DbTx = {
            async get<R = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<R | undefined> {
              const pgSql = convertPlaceholdersToPg(sql);
              const res = await client.query(pgSql, normalizePgParams(params));
              return res.rows[0] as R | undefined;
            },
            async all<R = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<R[]> {
              const pgSql = convertPlaceholdersToPg(sql);
              const res = await client.query(pgSql, normalizePgParams(params));
              return res.rows as R[];
            },
            async run(sql: string, ...params: unknown[]): Promise<RunResult> {
              const pgSql = convertPlaceholdersToPg(sql);
              const res = await client.query(pgSql, normalizePgParams(params));
              return { changes: res.rowCount ?? 0 };
            },
            async insert(sql: string, ...params: unknown[]): Promise<number> {
              const trimmed = sql.trim().replace(/;$/, '');
              const withReturning = /\bRETURNING\b/i.test(trimmed) ? trimmed : `${trimmed} RETURNING id`;
              const pgSql = convertPlaceholdersToPg(withReturning);
              const res = await client.query(pgSql, normalizePgParams(params));
              const row = res.rows[0] as { id?: string | number } | undefined;
              return Number(row?.id ?? 0);
            },
          };
          try {
            await client.query('BEGIN');
            const result = await fn(tx);
            await client.query('COMMIT');
            return result;
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        },
        async close(): Promise<void> {
          if (pgPool) {
            await pgPool.end();
            pgPool = null;
          }
        },
      };

const sqliteTxContext = new AsyncLocalStorage<{ depth: number }>();
let sqliteTxMutex: Promise<void> = Promise.resolve();
let sqliteSavepointSeq = 0;

const sqliteClient: DbClient = {
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
        async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
          const tx: DbTx = {
            get: sqliteClient.get.bind(sqliteClient),
            all: sqliteClient.all.bind(sqliteClient),
            run: sqliteClient.run.bind(sqliteClient),
            insert: sqliteClient.insert.bind(sqliteClient),
          };

          const existingCtx = sqliteTxContext.getStore();
          if (existingCtx) {
            const sqlite = getSqlite();
            const spName = `inkloom_sp_${++sqliteSavepointSeq}`;
            sqlite.exec(`SAVEPOINT ${spName}`);
            try {
              const result = await sqliteTxContext.run({ depth: existingCtx.depth + 1 }, () => fn(tx));
              sqlite.exec(`RELEASE SAVEPOINT ${spName}`);
              return result;
            } catch (err) {
              sqlite.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
              sqlite.exec(`RELEASE SAVEPOINT ${spName}`);
              throw err;
            }
          }

          let releaseMutex!: () => void;
          const prevMutex = sqliteTxMutex;
          sqliteTxMutex = new Promise<void>((resolve) => {
            releaseMutex = resolve;
          });
          await prevMutex;

          const sqlite = getSqlite();
          try {
            sqlite.exec('BEGIN IMMEDIATE');
            try {
              const result = await sqliteTxContext.run({ depth: 1 }, () => fn(tx));
              sqlite.exec('COMMIT');
              return result;
            } catch (err) {
              try {
                sqlite.exec('ROLLBACK');
              } catch {
                // Ignore secondary rollback error
              }
              throw err;
            }
          } finally {
            releaseMutex();
          }
        },
        async close(): Promise<void> {
          if (sqliteInstance) {
            sqliteInstance.close();
            sqliteInstance = null;
          }
        },
      };

function getActiveClient(): DbClient {
  return DB_ENGINE === 'postgres' ? pgClient : sqliteClient;
}

export const db: DbClient = {
  get engine(): DbEngine {
    return DB_ENGINE;
  },
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return getActiveClient().get<T>(sql, ...params);
  },
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return getActiveClient().all<T>(sql, ...params);
  },
  run(sql: string, ...params: unknown[]): Promise<RunResult> {
    return getActiveClient().run(sql, ...params);
  },
  insert(sql: string, ...params: unknown[]): Promise<number> {
    return getActiveClient().insert(sql, ...params);
  },
  exec(sql: string): Promise<void> {
    return getActiveClient().exec(sql);
  },
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    return getActiveClient().transaction<T>(fn);
  },
  async close(): Promise<void> {
    await pgClient.close();
    await sqliteClient.close();
  },
};

export function extractDevPostgresFallbackReason(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    errors?: unknown[];
  };
  const fallbackCodes = new Set([
    // Network / socket errors
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    // PostgreSQL connection & auth SQLSTATE codes
    '08001',
    '08003',
    '08004',
    '08006',
    '28000',
    '28P01',
    '3D000',
    'XX000',
  ]);
  if (typeof e.code === 'string' && fallbackCodes.has(e.code)) return e.code;
  if (Array.isArray(e.errors)) {
    for (const nested of e.errors) {
      const reason = extractDevPostgresFallbackReason(nested);
      if (reason) return reason;
    }
  }
  if (e.cause) {
    const reason = extractDevPostgresFallbackReason(e.cause);
    if (reason) return reason;
  }
  if (typeof e.message === 'string') {
    for (const code of fallbackCodes) {
      if (e.message.includes(code)) return code;
    }
    if (/timeout expired|Connection terminated unexpectedly/i.test(e.message)) {
      return 'ETIMEDOUT';
    }
    if (/password authentication failed/i.test(e.message)) {
      return '28P01 (password authentication failed)';
    }
    if (/Tenant or user not found/i.test(e.message)) {
      return 'XX000 (Tenant or user not found)';
    }
    if (/no pg_hba\.conf entry/i.test(e.message)) {
      return '28000 (no pg_hba.conf entry)';
    }
    if (/database ".*" does not exist/i.test(e.message)) {
      return '3D000 (database does not exist)';
    }
  }
  return null;
}

const POSTGRES_MIGRATION_LOCK_ID = 84291047;

async function applyPostgresMigrations(): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Missing PostgreSQL migrations directory at ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const lockClient = await getPgPool().connect();
  try {
    // Serialize migrations across concurrent app instances/deployments
    await lockClient.query('SELECT pg_advisory_lock($1)', [POSTGRES_MIGRATION_LOCK_ID]);

    await lockClient.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    for (const file of files) {
      const existing = await lockClient.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [file]
      );
      if ((existing.rowCount ?? 0) > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      try {
        await lockClient.query('BEGIN');
        await lockClient.query(sql);
        await lockClient.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
          [file]
        );
        await lockClient.query('COMMIT');
      } catch (err) {
        await lockClient.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [POSTGRES_MIGRATION_LOCK_ID]).catch(() => {});
    lockClient.release();
  }
}

export async function upgradeSqliteUsersRoleConstraint(
  targetDb: Pick<DbClient, 'get' | 'all' | 'exec'> = db
): Promise<boolean> {
  const usersDdl = await targetDb.get<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
  );
  if (!usersDdl?.sql || /CHECK\s*\([^)]*'admin'/i.test(usersDdl.sql)) {
    return false;
  }

  const existingCols = new Set(
    (await targetDb.all<{ name: string }>('PRAGMA table_info(users)')).map((c) => c.name)
  );
  const colOrDefault = (name: string, fallbackSql: string) =>
    existingCols.has(name) ? name : `${fallbackSql} AS ${name}`;

  await targetDb.exec('PRAGMA foreign_keys = OFF;');
  try {
    await targetDb.exec(`
      BEGIN TRANSACTION;
      DROP TABLE IF EXISTS users_migrated;
      CREATE TABLE users_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer', 'author', 'admin')),
        avatar_filename TEXT,
        avatar_original_name TEXT,
        job_title TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        preferences_json TEXT NOT NULL DEFAULT '{}',
        email_verified INTEGER NOT NULL DEFAULT 0,
        email_verified_at TEXT,
        verification_required INTEGER NOT NULL DEFAULT 0,
        token_version INTEGER NOT NULL DEFAULT 1,
        password_updated_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (id, company_id),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      );
      INSERT INTO users_migrated (
        id, company_id, name, email, password_hash, role,
        avatar_filename, avatar_original_name, job_title, bio, preferences_json,
        email_verified, email_verified_at, verification_required,
        token_version, password_updated_at, updated_at, created_at
      )
      SELECT
        id,
        company_id,
        name,
        email,
        password_hash,
        role,
        ${colOrDefault('avatar_filename', 'NULL')},
        ${colOrDefault('avatar_original_name', 'NULL')},
        ${colOrDefault('job_title', "''")},
        ${colOrDefault('bio', "''")},
        ${colOrDefault('preferences_json', "'{}'")},
        ${colOrDefault('email_verified', '0')},
        ${colOrDefault('email_verified_at', 'NULL')},
        ${colOrDefault('verification_required', '0')},
        ${colOrDefault('token_version', '1')},
        ${colOrDefault('password_updated_at', 'NULL')},
        ${colOrDefault('updated_at', 'created_at')},
        created_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_migrated RENAME TO users;
      CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
    `);

    const fkViolations = await targetDb.all('PRAGMA foreign_key_check;');
    if (fkViolations.length > 0) {
      throw new Error(
        `SQLite users role constraint migration detected ${fkViolations.length} foreign key violation(s).`
      );
    }

    await targetDb.exec('COMMIT;');
    return true;
  } catch (err) {
    await targetDb.exec('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    await targetDb.exec('PRAGMA foreign_keys = ON;');
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
      role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer', 'author', 'admin')),
      avatar_filename TEXT,
      avatar_original_name TEXT,
      job_title TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      preferences_json TEXT NOT NULL DEFAULT '{}',
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      verification_required INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 1,
      password_updated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (id, company_id),
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
      UNIQUE (id, company_id),
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
      uploaded_by INTEGER,
      content_hash TEXT,
      extracted_rules_json TEXT,
      extracted_at TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      extraction_error TEXT,
      page_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (id, company_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS approved_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      source_doc TEXT NOT NULL DEFAULT 'Manual Entry',
      source_document_id INTEGER,
      source_page INTEGER,
      source_section TEXT NOT NULL DEFAULT '',
      source_excerpt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES guideline_documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS terminology_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      prohibited_term TEXT NOT NULL,
      preferred_term TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      notes TEXT NOT NULL DEFAULT '',
      source_document_id INTEGER,
      source_page INTEGER,
      source_section TEXT NOT NULL DEFAULT '',
      source_excerpt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES guideline_documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS brand_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL UNIQUE,
      tone_rules TEXT NOT NULL DEFAULT '',
      messaging_rules TEXT NOT NULL DEFAULT '',
      source_document_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES guideline_documents(id) ON DELETE SET NULL
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
      status TEXT NOT NULL DEFAULT 'analyzed' CHECK (status IN ('analyzed', 'pending_review', 'revision_saved', 'changes_requested', 'approved', 'rejected')),
      compliance_score INTEGER CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)),
      analysis_coverage INTEGER CHECK (analysis_coverage IS NULL OR (analysis_coverage >= 0 AND analysis_coverage <= 100)),
      ai_status TEXT NOT NULL DEFAULT 'completed' CHECK (ai_status IN ('completed', 'partial', 'failed', 'pending')),
      ai_error TEXT,
      request_idempotency_key TEXT,
      content_hash TEXT,
      analysis_stage TEXT NOT NULL DEFAULT 'completed',
      analysis_timings_json TEXT,
      reanalysis_started_at TEXT,
      checks_summary_json TEXT NOT NULL DEFAULT '[]',
      image_metrics_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (id, company_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (submitted_by, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS compliance_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      original_text TEXT NOT NULL,
      explanation TEXT NOT NULL,
      evidence TEXT NOT NULL,
      suggested_correction TEXT NOT NULL,
      resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'accepted', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      edited_by INTEGER,
      content TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      reviewer_id INTEGER,
      reviewer_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      previous_status TEXT NOT NULL DEFAULT '',
      new_status TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      requested_ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      jti TEXT NOT NULL UNIQUE,
      token_version INTEGER NOT NULL DEFAULT 1,
      user_agent TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stored_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER,
      user_id INTEGER,
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
      CHECK (
        (asset_kind = 'brand_logo' AND brand_id IS NOT NULL AND submission_id IS NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
        (asset_kind = 'guideline_document' AND brand_id IS NOT NULL AND guideline_document_id IS NOT NULL AND submission_id IS NULL AND user_id IS NULL) OR
        (asset_kind IN ('submission_document', 'submission_image') AND brand_id IS NOT NULL AND submission_id IS NOT NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
        (asset_kind = 'user_avatar' AND user_id IS NOT NULL AND brand_id IS NULL AND submission_id IS NULL AND guideline_document_id IS NULL)
      ),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (guideline_document_id) REFERENCES guideline_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
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
    CREATE INDEX IF NOT EXISTS idx_submissions_company_status_created ON submissions(company_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_issues_company_category_severity ON compliance_issues(company_id, category, severity);
    DROP INDEX IF EXISTS idx_password_reset_tokens_hash;
    DROP INDEX IF EXISTS idx_email_verification_tokens_hash;
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_expires ON password_reset_tokens(user_id, company_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_expires ON email_verification_tokens(user_id, company_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_company_active ON user_sessions(user_id, company_id, revoked_at, expires_at);
  `);

  const ensureSqliteColumn = async (table: string, column: string, definition: string) => {
    const cols = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  await ensureSqliteColumn('users', 'avatar_filename', 'TEXT');
  await ensureSqliteColumn('users', 'avatar_original_name', 'TEXT');
  await ensureSqliteColumn('users', 'job_title', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('users', 'preferences_json', "TEXT NOT NULL DEFAULT '{}'");
  await ensureSqliteColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  await ensureSqliteColumn('users', 'email_verified_at', 'TEXT');
  await ensureSqliteColumn('users', 'verification_required', 'INTEGER NOT NULL DEFAULT 0');
  await ensureSqliteColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');
  await ensureSqliteColumn('users', 'password_updated_at', 'TEXT');
  await ensureSqliteColumn('users', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  await db.run("UPDATE users SET updated_at = created_at WHERE updated_at = ''");

  await upgradeSqliteUsersRoleConstraint(db);

  await ensureSqliteColumn('stored_files', 'user_id', 'INTEGER');

  // Safely upgrade legacy SQLite stored_files CHECK constraint if created before user_avatar support
  const storedFilesDdl = await db.get<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stored_files'"
  );
  if (storedFilesDdl?.sql && !storedFilesDdl.sql.includes("'user_avatar'")) {
    await db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;
      CREATE TABLE stored_files_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        brand_id INTEGER,
        user_id INTEGER,
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
        CHECK (
          (asset_kind = 'brand_logo' AND brand_id IS NOT NULL AND submission_id IS NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
          (asset_kind = 'guideline_document' AND brand_id IS NOT NULL AND guideline_document_id IS NOT NULL AND submission_id IS NULL AND user_id IS NULL) OR
          (asset_kind IN ('submission_document', 'submission_image') AND brand_id IS NOT NULL AND submission_id IS NOT NULL AND guideline_document_id IS NULL AND user_id IS NULL) OR
          (asset_kind = 'user_avatar' AND user_id IS NOT NULL AND brand_id IS NULL AND submission_id IS NULL AND guideline_document_id IS NULL)
        ),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id, company_id) REFERENCES users(id, company_id) ON DELETE CASCADE,
        FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
        FOREIGN KEY (guideline_document_id) REFERENCES guideline_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO stored_files_migrated (
        id, company_id, brand_id, user_id, submission_id, guideline_document_id,
        asset_kind, storage_backend, storage_key, filename, original_name, mime_type,
        size_bytes, uploaded_by, created_at
      )
      SELECT
        id, company_id, brand_id, user_id, submission_id, guideline_document_id,
        asset_kind, storage_backend, storage_key, filename, original_name, mime_type,
        size_bytes, uploaded_by, created_at
      FROM stored_files;
      DROP TABLE stored_files;
      ALTER TABLE stored_files_migrated RENAME TO stored_files;
      CREATE INDEX IF NOT EXISTS idx_stored_files_company ON stored_files(company_id);
      CREATE INDEX IF NOT EXISTS idx_stored_files_filename ON stored_files(filename, company_id);
      CREATE INDEX IF NOT EXISTS idx_stored_files_brand ON stored_files(brand_id, company_id);
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  await db.exec('CREATE INDEX IF NOT EXISTS idx_stored_files_user ON stored_files(user_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_stored_files_company_user ON stored_files(company_id, user_id);');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stored_files_company_filename_unique ON stored_files(company_id, filename);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_stored_files_submission ON stored_files(submission_id, company_id);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_stored_files_guideline_doc ON stored_files(guideline_document_id, company_id);');

  await ensureSqliteColumn('guideline_documents', 'content_hash', 'TEXT');
  await ensureSqliteColumn('guideline_documents', 'extracted_rules_json', 'TEXT');
  await ensureSqliteColumn('guideline_documents', 'extracted_at', 'TEXT');
  await ensureSqliteColumn('guideline_documents', 'extraction_status', "TEXT NOT NULL DEFAULT 'pending'");
  await ensureSqliteColumn('guideline_documents', 'extraction_error', 'TEXT');
  await ensureSqliteColumn('guideline_documents', 'page_count', 'INTEGER NOT NULL DEFAULT 1');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_guideline_docs_hash ON guideline_documents(company_id, brand_id, content_hash);');

  await ensureSqliteColumn('approved_facts', 'source_document_id', 'INTEGER');
  await ensureSqliteColumn('approved_facts', 'source_page', 'INTEGER');
  await ensureSqliteColumn('approved_facts', 'source_section', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('approved_facts', 'source_excerpt', "TEXT NOT NULL DEFAULT ''");
  await db.exec('CREATE INDEX IF NOT EXISTS idx_facts_source_doc ON approved_facts(source_document_id);');

  await ensureSqliteColumn('terminology_rules', 'source_document_id', 'INTEGER');
  await ensureSqliteColumn('terminology_rules', 'source_page', 'INTEGER');
  await ensureSqliteColumn('terminology_rules', 'source_section', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('terminology_rules', 'source_excerpt', "TEXT NOT NULL DEFAULT ''");
  await db.exec('CREATE INDEX IF NOT EXISTS idx_terms_source_doc ON terminology_rules(source_document_id);');

  await ensureSqliteColumn('brand_rules', 'source_document_id', 'INTEGER');

  await ensureSqliteColumn('submissions', 'compliance_score', 'INTEGER');
  await ensureSqliteColumn('submissions', 'analysis_coverage', 'INTEGER');
  await ensureSqliteColumn('submissions', 'ai_status', "TEXT NOT NULL DEFAULT 'completed'");
  await ensureSqliteColumn('submissions', 'ai_error', 'TEXT');
  await ensureSqliteColumn('submissions', 'request_idempotency_key', 'TEXT');
  await ensureSqliteColumn('submissions', 'content_hash', 'TEXT');
  await ensureSqliteColumn('submissions', 'analysis_stage', "TEXT NOT NULL DEFAULT 'completed'");
  await ensureSqliteColumn('submissions', 'analysis_timings_json', 'TEXT');
  await ensureSqliteColumn('submissions', 'reanalysis_started_at', 'TEXT');
  await ensureSqliteColumn('submissions', 'visual_analysis_json', 'TEXT');
  await ensureSqliteColumn('submissions', 'visual_image_hash', 'TEXT');
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_company_idempotency ON submissions(company_id, request_idempotency_key) WHERE request_idempotency_key IS NOT NULL;'
  );
  await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_company_content_hash ON submissions(company_id, brand_id, content_hash);');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_visual_hash ON submissions(company_id, brand_id, visual_image_hash);');

  await ensureSqliteColumn('review_events', 'previous_status', "TEXT NOT NULL DEFAULT ''");
  await ensureSqliteColumn('review_events', 'new_status', "TEXT NOT NULL DEFAULT ''");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS brand_visual_guidelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL UNIQUE,
      accent_colors_json TEXT NOT NULL DEFAULT '[]',
      approved_backgrounds_json TEXT NOT NULL DEFAULT '[]',
      logo_rules_json TEXT NOT NULL DEFAULT '{}',
      typography_rules_json TEXT NOT NULL DEFAULT '{}',
      source_document_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES guideline_documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS brand_logo_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      variant_type TEXT NOT NULL DEFAULT 'secondary',
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      aspect_ratio REAL NOT NULL DEFAULT 1.0,
      dominant_colors_json TEXT NOT NULL DEFAULT '[]',
      features_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_brand_visual_guidelines_brand_company
      ON brand_visual_guidelines(brand_id, company_id);
    CREATE INDEX IF NOT EXISTS idx_brand_logo_variants_brand_company
      ON brand_logo_variants(brand_id, company_id);

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      triggered_by INTEGER,
      run_type TEXT NOT NULL DEFAULT 'initial' CHECK (run_type IN ('initial', 'reanalysis')),
      compliance_score INTEGER CHECK (compliance_score IS NULL OR (compliance_score >= 0 AND compliance_score <= 100)),
      total_issues INTEGER NOT NULL DEFAULT 0,
      visual_issues INTEGER NOT NULL DEFAULT 0,
      text_issues INTEGER NOT NULL DEFAULT 0,
      ai_status TEXT NOT NULL DEFAULT 'completed',
      outcome_status TEXT NOT NULL DEFAULT 'analyzed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id, company_id) REFERENCES brands(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id, company_id) REFERENCES submissions(id, company_id) ON DELETE CASCADE,
      FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analysis_runs_company_created
      ON analysis_runs(company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_submission_company
      ON analysis_runs(submission_id, company_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_submissions_company_brand_created
      ON submissions(company_id, brand_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_submissions_company_submitter_created
      ON submissions(company_id, submitted_by, created_at);
    CREATE INDEX IF NOT EXISTS idx_review_events_company_decision_created
      ON review_events(company_id, decision, created_at);
    CREATE INDEX IF NOT EXISTS idx_compliance_issues_company_resolution
      ON compliance_issues(company_id, resolution_status, category);
  `);
}

export async function runMigrations(): Promise<void> {
  if (DB_ENGINE === 'postgres') {
    try {
      await applyPostgresMigrations();
      migrationsReady = true;
      return;
    } catch (err) {
      const allowDevFallback =
        !isProductionEnvironment() &&
        process.env.INKLOOM_STRICT_POSTGRES !== 'true' &&
        process.env.ALLOW_DEV_SQLITE_FALLBACK !== 'false';
      const fallbackReason = extractDevPostgresFallbackReason(err);
      if (allowDevFallback && fallbackReason) {
        console.warn(
          `[InkloomGuard AI] PostgreSQL is unavailable in development (${fallbackReason}). Falling back to local SQLite in DATA_DIR. Check DATABASE_URL if you want to use PostgreSQL locally.`
        );
        await pgClient.close().catch(() => {});
        DB_ENGINE = 'sqlite';
        await applySqliteSchema();
        migrationsReady = true;
        return;
      }
      migrationsReady = false;
      throw err;
    }
  }
  await applySqliteSchema();
  migrationsReady = true;
}

export async function initDatabase(): Promise<void> {
  if (initialized) return;

  await runMigrations();

  const nowEpoch = Math.floor(Date.now() / 1000);
  await db.run('DELETE FROM revoked_tokens WHERE expires_at > 0 AND expires_at < ?', nowEpoch);

  if (!isProductionEnvironment()) {
    await seedInitialWorkspace();
  }
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
  migrationsReady = false;
  await db.close();
}

async function seedInitialWorkspace(): Promise<void> {
  if (isProductionEnvironment()) return;

  const existing = await db.get<{ cnt: number | string }>('SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM companies');
  if (Number(existing?.cnt ?? 0) > 0) return;

  const companyId = await db.insert('INSERT INTO companies (name) VALUES (?)', 'AetherFlow Systems');

  const hash = await bcrypt.hash('Inkloom2026!', 10);
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
      company_id, brand_id, submitted_by, title, input_type, original_content, revised_content,
      status, compliance_score, ai_status, checks_summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId,
    brandId,
    userId,
    'Q4 Enterprise Launch Brief',
    'text',
    sampleOriginal,
    sampleOriginal,
    'pending_review',
    38,
    'completed',
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
