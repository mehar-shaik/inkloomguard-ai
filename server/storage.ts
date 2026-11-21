import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UPLOAD_DIR, isProductionEnvironment } from './db.ts';

export type StorageBackend = 'supabase' | 'local';
export type AssetKind =
  | 'brand_logo'
  | 'guideline_document'
  | 'submission_document'
  | 'submission_image'
  | 'user_avatar';

export interface StoredObjectResult {
  backend: StorageBackend;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'inkloomguard-files';

const hasSupabaseConfig = Boolean(
  supabaseUrl &&
    supabaseServiceKey &&
    supabaseBucket &&
    supabaseUrl !== 'https://YOUR_PROJECT_REF.supabase.co' &&
    supabaseServiceKey !== 'YOUR_SUPABASE_SERVICE_ROLE_KEY' &&
    supabaseServiceKey !== 'YOUR_SUPABASE_SECRET_KEY'
);

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!hasSupabaseConfig || !supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase Storage is not configured.');
  }
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabaseClient;
}

export function getStorageMode(): StorageBackend {
  if (hasSupabaseConfig) return 'supabase';

  if (isProductionEnvironment()) {
    throw new Error(
      'Supabase Storage (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET=inkloomguard-files) must be configured in production. Local filesystem storage is disabled in production.'
    );
  }
  return 'local';
}

export function getStorageStatus(): { mode: StorageBackend; bucket: string | null; configured: boolean } {
  if (hasSupabaseConfig && supabaseBucket) {
    return { mode: 'supabase', bucket: supabaseBucket, configured: true };
  }
  return { mode: 'local', bucket: null, configured: !isProductionEnvironment() };
}

export function generateSafeStorageFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

export function sanitizeLookupFilename(rawFilename: string): string {
  const base = path.basename(String(rawFilename || '').trim());
  if (!base || base === '.' || base === '..' || !/^[a-zA-Z0-9._-]+$/.test(base)) {
    throw new Error('Invalid file identifier.');
  }
  return base;
}

export function inferMimeType(filename: string, fallbackMime?: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return fallbackMime || 'application/octet-stream';
}

function buildTenantStorageKey(params: {
  companyId: number;
  brandId?: number | null;
  userId?: number | null;
  assetKind: AssetKind;
  filename: string;
}): string {
  if (!Number.isInteger(params.companyId) || params.companyId <= 0) {
    throw new Error('Valid organization companyId is required for file storage.');
  }
  const safeName = sanitizeLookupFilename(params.filename);
  if (params.assetKind === 'user_avatar') {
    if (!params.userId || !Number.isInteger(params.userId) || params.userId <= 0) {
      throw new Error('Valid userId is required for user avatar storage.');
    }
    return `companies/${params.companyId}/users/${params.userId}/user_avatar/${safeName}`;
  }
  if (!params.brandId || !Number.isInteger(params.brandId) || params.brandId <= 0) {
    throw new Error('Valid brandId is required for brand asset storage.');
  }
  return `companies/${params.companyId}/brands/${params.brandId}/${params.assetKind}/${safeName}`;
}

function resolveLocalFilePath(storageKeyOrFilename: string): string {
  const resolvedBase = path.resolve(UPLOAD_DIR);
  const candidate = path.resolve(resolvedBase, storageKeyOrFilename);
  if (!candidate.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal rejected.');
  }
  return candidate;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function uploadAsset(params: {
  companyId: number;
  brandId?: number | null;
  userId?: number | null;
  assetKind: AssetKind;
  originalName: string;
  buffer: Buffer;
  mimeType?: string;
}): Promise<StoredObjectResult> {
  const mode = getStorageMode();
  const filename = generateSafeStorageFilename(params.originalName);
  const mimeType = inferMimeType(filename, params.mimeType);
  const storageKey = buildTenantStorageKey({
    companyId: params.companyId,
    brandId: params.brandId,
    userId: params.userId,
    assetKind: params.assetKind,
    filename,
  });

  if (mode === 'supabase') {
    const client = getSupabaseClient();
    const { error } = await client.storage.from(supabaseBucket!).upload(storageKey, params.buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) {
      throw new Error(`Failed to store file in Supabase Storage: ${error.message}`);
    }
    return {
      backend: 'supabase',
      storageKey,
      filename,
      mimeType,
      sizeBytes: params.buffer.length,
    };
  }

  // Local development fallback (DATA_DIR/uploads)
  const localPath = resolveLocalFilePath(storageKey);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, params.buffer);

  return {
    backend: 'local',
    storageKey,
    filename,
    mimeType,
    sizeBytes: params.buffer.length,
  };
}

export async function downloadAsset(params: {
  backend: StorageBackend;
  storageKey: string;
  filename: string;
}): Promise<Buffer> {
  if (params.backend === 'supabase') {
    const client = getSupabaseClient();
    const { data, error } = await client.storage.from(supabaseBucket!).download(params.storageKey);
    if (error || !data) {
      throw new Error(error?.message || 'File not found in Supabase Storage.');
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Check tenant storageKey first, then legacy flat UPLOAD_DIR/<filename>
  const safeKeyPath = resolveLocalFilePath(params.storageKey);
  if (await fileExists(safeKeyPath)) {
    return fs.readFile(safeKeyPath);
  }
  const legacyFlatPath = resolveLocalFilePath(sanitizeLookupFilename(params.filename));
  if (await fileExists(legacyFlatPath)) {
    return fs.readFile(legacyFlatPath);
  }
  throw new Error('File not found in local storage.');
}

export async function createSignedAssetUrl(params: {
  backend: StorageBackend;
  storageKey: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  if (params.backend !== 'supabase') {
    return null;
  }
  const client = getSupabaseClient();
  const ttl = Math.max(15, Math.min(300, params.expiresInSeconds ?? 60));
  const { data, error } = await client.storage.from(supabaseBucket!).createSignedUrl(params.storageKey, ttl);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to generate signed storage URL.');
  }
  return data.signedUrl;
}

export async function deleteAsset(params: {
  backend: StorageBackend;
  storageKey: string;
  filename: string;
}): Promise<void> {
  if (params.backend === 'supabase') {
    const client = getSupabaseClient();
    const { error } = await client.storage.from(supabaseBucket!).remove([params.storageKey]);
    if (error) {
      throw new Error(`Failed to delete file from Supabase Storage: ${error.message}`);
    }
    return;
  }

  const safeKeyPath = resolveLocalFilePath(params.storageKey);
  if (await fileExists(safeKeyPath)) {
    await fs.unlink(safeKeyPath);
    return;
  }
  const legacyFlatPath = resolveLocalFilePath(sanitizeLookupFilename(params.filename));
  if (await fileExists(legacyFlatPath)) {
    await fs.unlink(legacyFlatPath);
  }
}
