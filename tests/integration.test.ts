import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { Jimp } from 'jimp';

// Configure isolated temporary test directory BEFORE importing server modules
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkloom-ci-'));
process.env.DATA_DIR = tempDir;
process.env.DISABLE_HMR = 'true';
process.env.INKLOOM_SKIP_AUTOSTART = 'true';
process.env.JWT_SECRET = 'ci-test-jwt-secret-key-at-least-32-chars-long';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_STORAGE_BUCKET;

const { createApp } = await import('../server.ts');
const { closeDatabase } = await import('../server/db.ts');

let baseUrl = '';

async function req(urlPath: string, opts: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, opts);
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

function authHdr(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function main() {
  const app = await createApp();
  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral port.');
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
  try {

  console.log(`[CI Test] Listening on ${baseUrl}`);

  // 1. Health & Unauth check
  const health = await req('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json?.status, 'ok');
  assert.equal(health.json?.database, 'connected');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

  const unauthDash = await req('/api/dashboard');
  assert.equal(unauthDash.status, 401);

  // 2. Register Company A Reviewer & Author
  const regRev = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Maya Reviewer',
      email: 'maya@novapay-ci.test',
      password: 'Password123!',
      companyName: 'NovaOrg',
      role: 'reviewer',
    }),
  });
  assert.equal(regRev.status, 201);
  const revToken = regRev.json!.token as string;

  const createAuthor = await req('/api/team/members', {
    method: 'POST',
    headers: authHdr(revToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: 'Alex Author',
      email: 'alex@novapay-ci.test',
      password: 'Password123!',
      role: 'author',
    }),
  });
  assert.equal(createAuthor.status, 201);

  const authLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@novapay-ci.test', password: 'Password123!' }),
  });
  assert.equal(authLogin.status, 200);
  const authToken = authLogin.json!.token as string;

  // 3. Upload validation & Brand creation
  const spoofFd = new FormData();
  spoofFd.append('name', 'BadBrand');
  spoofFd.append('logo', new Blob(['NOT_A_PNG'], { type: 'image/png' }), 'bad.png');
  const spoofRes = await req('/api/brands', { method: 'POST', headers: authHdr(revToken), body: spoofFd });
  assert.equal(spoofRes.status, 400);

  const img = new Jimp({ width: 32, height: 32, color: 0x4338caff });
  const pngBuf = await img.getBuffer('image/png');
  const brandFd = new FormData();
  brandFd.append('name', 'NovaPay');
  brandFd.append('industry', 'FinTech');
  brandFd.append('primaryColor', '#4338CA');
  brandFd.append('secondaryColor', '#06B6D4');
  brandFd.append('logo', new Blob([new Uint8Array(pngBuf)], { type: 'image/png' }), 'logo.png');

  const brandRes = await req('/api/brands', { method: 'POST', headers: authHdr(revToken), body: brandFd });
  assert.equal(brandRes.status, 201);
  const brandId = brandRes.json!.brand.id as number;
  const logoFilename = brandRes.json!.brand.logo_filename as string;
  assert.ok(logoFilename);

  const logoGet = await req(`/api/uploads/${logoFilename}`, { headers: authHdr(authToken) });
  assert.equal(logoGet.status, 200);

  // Path traversal check
  const traversalGet = await req('/api/uploads/..%2F..%2Fetc%2Fpasswd', { headers: authHdr(authToken) });
  assert.ok([400, 403, 404].includes(traversalGet.status));

  // 4. Guidelines, Facts, Terminology
  const gdFd = new FormData();
  gdFd.append(
    'document',
    new Blob(['NovaPay was founded in 2021. Prohibited: crypto bank -> regulated payments platform.'], {
      type: 'text/markdown',
    }),
    'guidelines.md'
  );
  const gdRes = await req(`/api/guidelines/${brandId}/upload`, {
    method: 'POST',
    headers: authHdr(revToken),
    body: gdFd,
  });
  assert.equal(gdRes.status, 201);

  const termRes = await req(`/api/guidelines/${brandId}/terminology`, {
    method: 'POST',
    headers: authHdr(revToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prohibited_term: 'crypto bank',
      preferred_term: 'regulated payments platform',
      severity: 'critical',
    }),
  });
  assert.equal(termRes.status, 201);

  // 5. Author submission + analysis + revision + RBAC review
  const subFd = new FormData();
  subFd.append('brandId', String(brandId));
  subFd.append('title', 'Q1 Campaign');
  subFd.append('pastedText', 'Join our #1 crypto bank with 100% guaranteed results!');
  const subRes = await req('/api/submissions', { method: 'POST', headers: authHdr(authToken), body: subFd });
  assert.equal(subRes.status, 201);
  const subId = subRes.json!.submission.id as number;
  assert.ok((subRes.json!.issues || []).length >= 2);

  const revSave = await req(`/api/submissions/${subId}/revisions`, {
    method: 'POST',
    headers: authHdr(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ revisedContent: 'Join our regulated payments platform.', note: 'Fixed copy' }),
  });
  assert.equal(revSave.status, 200);

  const authorApprove = await req(`/api/submissions/${subId}/review`, {
    method: 'POST',
    headers: authHdr(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ decision: 'approved', comment: 'Attempt' }),
  });
  assert.equal(authorApprove.status, 403);

  const revApprove = await req(`/api/submissions/${subId}/review`, {
    method: 'POST',
    headers: authHdr(revToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ decision: 'approved', comment: 'Approved by reviewer' }),
  });
  assert.equal(revApprove.status, 200);
  assert.equal(revApprove.json!.submission.status, 'approved');

  // 6. Cross-organization isolation against Company B
  const orgBRes = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Company B User',
      email: 'user@orgb-ci.test',
      password: 'Password123!',
      companyName: 'OtherOrg',
      role: 'reviewer',
    }),
  });
  assert.equal(orgBRes.status, 201);
  const orgBToken = orgBRes.json!.token as string;

  const crossBrand = await req(`/api/guidelines/${brandId}`, { headers: authHdr(orgBToken) });
  assert.equal(crossBrand.status, 404);
  const crossSub = await req(`/api/submissions/${subId}`, { headers: authHdr(orgBToken) });
  assert.equal(crossSub.status, 404);
  const crossUpload = await req(`/api/uploads/${logoFilename}`, { headers: authHdr(orgBToken) });
  assert.equal(crossUpload.status, 403);

  // 7. Token revocation on logout
  const logoutRes = await req('/api/auth/logout', { method: 'POST', headers: authHdr(revToken) });
  assert.equal(logoutRes.status, 200);
  const revokedMe = await req('/api/auth/me', { headers: authHdr(revToken) });
  assert.equal(revokedMe.status, 401);

  console.log('[CI Test] All integration, RBAC, upload security, and tenant isolation assertions passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (typeof app.locals.closeResources === 'function') {
      await (app.locals.closeResources as () => Promise<void>)();
    }
    await closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
