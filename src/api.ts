import type {
  AuthUser,
  Brand,
  DashboardData,
  GuidelineDocument,
  ApprovedFact,
  TerminologyRule,
  BrandRules,
  Submission,
  ComplianceIssue,
  Revision,
  ReviewEvent,
  ExtractedGuidelinesPayload,
  ExtractedFactProposal,
  ExtractedTerminologyProposal,
  GuidelineConflict,
  UserPreferences,
  UserSessionInfo,
  OrganizationSummary,
  TeamMemberSummary,
  BrandVisualGuidelinesConfig,
  BrandLogoVariant,
  AnalyticsQueryParams,
  GovernanceAnalyticsResponse,
  AnalyticsRecurringViolationsPage,
  TeamAnalyticsResponse,
} from './types';

const TOKEN_STORAGE_KEY = 'inkloom_auth_token';

let unauthorizedHandler: ((message: string) => void) | null = null;

export function setUnauthorizedHandler(handler: ((message: string) => void) | null): void {
  unauthorizedHandler = handler;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Fallback if localStorage is restricted
  }
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

const MAX_BLOB_CACHE_ENTRIES = 60;
const protectedBlobCache = new Map<string, Blob>();
const protectedBlobInFlight = new Map<string, Promise<Blob>>();

export function clearProtectedAssetCache(): void {
  protectedBlobCache.clear();
  protectedBlobInFlight.clear();
}

export function evictProtectedAssetCache(filename?: string | null): void {
  if (!filename) return;
  const suffix = `::${filename}`;
  for (const key of protectedBlobCache.keys()) {
    if (key.endsWith(suffix)) {
      protectedBlobCache.delete(key);
    }
  }
  for (const key of protectedBlobInFlight.keys()) {
    if (key.endsWith(suffix)) {
      protectedBlobInFlight.delete(key);
    }
  }
}

export function clearAuthToken(): void {
  clearProtectedAssetCache();
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  verificationEmailSent?: boolean;
  verificationEmailError?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  reason?: string;

  constructor(message: string, status: number, code?: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const token = getAuthToken();

  const headers: Record<string, string> = isFormData
    ? { ...(options.headers as Record<string, string> | undefined) }
    : { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const rawText = await res.text();
  let data: Record<string, unknown> = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      if (res.ok) {
        throw new Error(`Invalid response format from server (${res.status}). Expected JSON.`);
      }
      data = {};
    }
  }

  if (!res.ok) {
    const message =
      (typeof data.error === 'string' && data.error) || `Request failed (${res.status})`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    const reason = typeof data.reason === 'string' ? data.reason : undefined;
    const isAuthAttempt =
      url.startsWith('/api/auth/login') ||
      url.startsWith('/api/auth/register') ||
      url.startsWith('/api/auth/demo');
    if (res.status === 401 && !isAuthAttempt) {
      clearAuthToken();
      if (unauthorizedHandler) {
        unauthorizedHandler(message);
      }
    }
    throw new ApiError(message, res.status, code, reason);
  }
  return data as T;
}

export async function fetchProtectedAssetBlobUrl(filename: string): Promise<string> {
  const token = getAuthToken();
  const cacheKey = `${token || 'anon'}::${filename}`;

  const cachedBlob = protectedBlobCache.get(cacheKey);
  if (cachedBlob) {
    protectedBlobCache.delete(cacheKey);
    protectedBlobCache.set(cacheKey, cachedBlob);
    return URL.createObjectURL(cachedBlob);
  }

  let promise = protectedBlobInFlight.get(cacheKey);
  if (!promise) {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    promise = fetch(`/api/uploads/${encodeURIComponent(filename)}`, { headers })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Unable to load asset (${res.status})`);
        }
        return res.blob();
      })
      .finally(() => {
        protectedBlobInFlight.delete(cacheKey);
      });
    protectedBlobInFlight.set(cacheKey, promise);
  }

  const blob = await promise;
  if (protectedBlobCache.size >= MAX_BLOB_CACHE_ENTRIES) {
    const oldestKey = protectedBlobCache.keys().next().value;
    if (oldestKey) {
      protectedBlobCache.delete(oldestKey);
    }
  }
  protectedBlobCache.set(cacheKey, blob);
  return URL.createObjectURL(blob);
}

export const api = {
  // Public Health Check
  getHealth: () =>
    request<{
      status: string;
      demoAvailable?: boolean;
      emailConfigured?: boolean;
      geminiConfigured?: boolean;
    }>('/api/health'),

  // Auth
  me: () => request<{ user: AuthUser }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (payload: {
    name: string;
    email: string;
    password: string;
    companyName: string;
    role: string;
  }) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  demoLogin: () => request<AuthResponse>('/api/auth/demo', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  logoutAll: () => request<{ ok: boolean; message: string }>('/api/auth/logout-all', { method: 'POST' }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  validateResetToken: (token: string) =>
    request<{ valid: boolean; reason?: string; error?: string }>(
      `/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`
    ),
  resetPassword: (payload: { token: string; newPassword: string; confirmPassword: string }) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean; user?: AuthUser; message?: string; reason?: string; error?: string }>(
      '/api/auth/verify-email',
      {
        method: 'POST',
        body: JSON.stringify({ token }),
      }
    ),
  resendVerification: (email?: string) => {
    const trimmed = email?.trim();
    return request<{ ok: boolean; message: string }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(trimmed ? { email: trimmed } : {}),
    });
  },
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    request<{
      ok: boolean;
      user: AuthUser;
      token: string;
      confirmationEmailSent: boolean;
      message: string;
    }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Sessions
  getSessions: () => request<{ sessions: UserSessionInfo[] }>('/api/auth/sessions'),
  revokeOtherSessions: () =>
    request<{ ok: boolean; user: AuthUser; token: string; message: string }>(
      '/api/auth/sessions/revoke-others',
      { method: 'POST' }
    ),
  revokeSession: (sessionId: number) =>
    request<{ ok: boolean; sessions: UserSessionInfo[]; message: string }>(
      `/api/auth/sessions/${sessionId}`,
      { method: 'DELETE' }
    ),

  // Self-service Profile & Avatar
  updateProfile: (payload: { name: string; jobTitle: string; bio: string }) =>
    request<{ user: AuthUser }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  uploadAvatar: (file: Blob, filename = 'avatar.png') => {
    const formData = new FormData();
    formData.append('avatar', file, filename);
    return request<{ user: AuthUser }>('/api/profile/avatar', {
      method: 'POST',
      body: formData,
    });
  },
  deleteAvatar: () =>
    request<{ user: AuthUser }>('/api/profile/avatar', {
      method: 'DELETE',
    }),

  // Notifications & Interface Preferences
  getPreferences: () =>
    request<{ preferences: UserPreferences; emailDeliveryConfigured: boolean }>('/api/preferences'),
  updatePreferences: (patch: Partial<UserPreferences>) =>
    request<{ preferences: UserPreferences; user: AuthUser; emailDeliveryConfigured: boolean }>(
      '/api/preferences',
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    ),

  // Organization & Team
  getOrganization: () =>
    request<{ organization: OrganizationSummary; canManageWorkspace: boolean }>('/api/organization'),
  updateOrganization: (name: string) =>
    request<{ organization: OrganizationSummary; user: AuthUser }>('/api/organization', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  getTeamMembers: () => request<{ members: TeamMemberSummary[] }>('/api/team/members'),
  createTeamMember: (payload: {
    name: string;
    email: string;
    password: string;
    role: 'author' | 'reviewer' | 'admin';
  }) =>
    request<{ member: AuthUser }>('/api/team/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTeamMemberRole: (memberId: number, role: 'author' | 'reviewer' | 'admin') =>
    request<{ member: TeamMemberSummary }>(`/api/team/members/${memberId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  // Dashboard & Governance Analytics
  getDashboard: () => request<DashboardData>('/api/dashboard'),
  getGovernanceAnalytics: (params: AnalyticsQueryParams = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.brandId && params.brandId > 0) qs.set('brandId', String(params.brandId));
    if (params.category) qs.set('category', params.category);
    if (params.status) qs.set('status', params.status);
    if (params.page && params.page > 0) qs.set('page', String(params.page));
    if (params.limit && params.limit > 0) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<GovernanceAnalyticsResponse>(`/api/analytics/governance${q ? `?${q}` : ''}`);
  },
  getRecurringViolations: (params: AnalyticsQueryParams = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.brandId && params.brandId > 0) qs.set('brandId', String(params.brandId));
    if (params.category) qs.set('category', params.category);
    if (params.status) qs.set('status', params.status);
    if (params.page && params.page > 0) qs.set('page', String(params.page));
    if (params.limit && params.limit > 0) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<AnalyticsRecurringViolationsPage>(
      `/api/analytics/recurring-violations${q ? `?${q}` : ''}`
    );
  },
  getTeamAnalytics: (params: AnalyticsQueryParams = {}) => {
    const qs = new URLSearchParams();
    if (params.range) qs.set('range', params.range);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    if (params.brandId && params.brandId > 0) qs.set('brandId', String(params.brandId));
    if (params.category) qs.set('category', params.category);
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return request<TeamAnalyticsResponse>(`/api/analytics/team${q ? `?${q}` : ''}`);
  },

  // Brands
  getBrands: async () => {
    const res = await request<{ brands?: Brand[] }>('/api/brands');
    if (!res || !Array.isArray(res.brands)) {
      throw new Error('Invalid response from server when loading brands.');
    }
    return { brands: res.brands };
  },
  createBrand: (formData: FormData) =>
    request<{ brand: Brand }>('/api/brands', { method: 'POST', body: formData }),
  updateBrand: (id: number, formData: FormData) =>
    request<{ brand: Brand }>(`/api/brands/${id}`, { method: 'PUT', body: formData }),
  deleteBrand: (id: number) => request<{ ok: boolean }>(`/api/brands/${id}`, { method: 'DELETE' }),

  // Guidelines
  getGuidelines: (brandId: number) =>
    request<{
      brand: Brand;
      documents: GuidelineDocument[];
      facts: ApprovedFact[];
      terminology: TerminologyRule[];
      rules: BrandRules;
      visualGuidelines?: BrandVisualGuidelinesConfig;
      logoVariants?: BrandLogoVariant[];
    }>(`/api/guidelines/${brandId}`),
  uploadGuidelineDoc: (brandId: number, formData: FormData) =>
    request<{
      document: GuidelineDocument;
      autoExtracted: ExtractedGuidelinesPayload | null;
      extractionStatus?: string;
      extractionError?: string | null;
      conflicts?: GuidelineConflict[];
    }>(`/api/guidelines/${brandId}/upload`, { method: 'POST', body: formData }),
  aiExtractDoc: (brandId: number, docId: number, force = false) =>
    request<{
      extracted: ExtractedGuidelinesPayload;
      cached?: boolean;
      conflicts?: GuidelineConflict[];
    }>(`/api/guidelines/${brandId}/ai-extract/${docId}`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  deleteGuidelineDoc: (brandId: number, docId: number) =>
    request<{ ok: boolean }>(`/api/guidelines/${brandId}/documents/${docId}`, { method: 'DELETE' }),
  applyExtractedGuidelines: (
    brandId: number,
    payload: {
      sourceDocId: number;
      sourceDoc?: string;
      toneRules?: string;
      messagingRules?: string;
      facts: ExtractedFactProposal[];
      terminology: ExtractedTerminologyProposal[];
      visualGuidelines?: BrandVisualGuidelinesConfig;
    }
  ) =>
    request<{
      rules: BrandRules;
      facts: ApprovedFact[];
      terminology: TerminologyRule[];
      visualGuidelines?: BrandVisualGuidelinesConfig;
      conflicts?: GuidelineConflict[];
      summary: {
        rulesUpdated: boolean;
        visualUpdated?: boolean;
        factsAdded: number;
        factsSkipped: number;
        terminologyAdded: number;
        terminologySkipped: number;
      };
    }>(`/api/guidelines/${brandId}/apply-extracted`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  saveBrandRules: (brandId: number, tone_rules: string, messaging_rules: string) =>
    request<{ rules: BrandRules }>(`/api/guidelines/${brandId}/rules`, {
      method: 'PUT',
      body: JSON.stringify({ tone_rules, messaging_rules }),
    }),
  saveVisualGuidelines: (brandId: number, payload: BrandVisualGuidelinesConfig) =>
    request<{ visualGuidelines: BrandVisualGuidelinesConfig }>(`/api/guidelines/${brandId}/visual`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  uploadLogoVariant: (brandId: number, formData: FormData) =>
    request<{ variant: BrandLogoVariant }>(`/api/guidelines/${brandId}/logo-variants`, {
      method: 'POST',
      body: formData,
    }),
  deleteLogoVariant: (brandId: number, variantId: number) =>
    request<{ ok: boolean }>(`/api/guidelines/${brandId}/logo-variants/${variantId}`, {
      method: 'DELETE',
    }),
  addFact: (brandId: number, payload: { fact_key: string; fact_value: string; source_doc?: string }) =>
    request<{ fact: ApprovedFact }>(`/api/guidelines/${brandId}/facts`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteFact: (brandId: number, factId: number) =>
    request<{ ok: boolean }>(`/api/guidelines/${brandId}/facts/${factId}`, { method: 'DELETE' }),
  addTerminology: (
    brandId: number,
    payload: { prohibited_term: string; preferred_term: string; severity: string; notes?: string }
  ) =>
    request<{ rule: TerminologyRule }>(`/api/guidelines/${brandId}/terminology`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteTerminology: (brandId: number, ruleId: number) =>
    request<{ ok: boolean }>(`/api/guidelines/${brandId}/terminology/${ruleId}`, { method: 'DELETE' }),

  // Submissions & Analysis
  getSubmissions: async () => {
    const res = await request<{ submissions?: Submission[] }>('/api/submissions');
    if (!res || !Array.isArray(res.submissions)) {
      throw new Error('Invalid response from server when loading submissions.');
    }
    return { submissions: res.submissions };
  },
  getSubmissionDetail: async (id: number) => {
    const res = await request<{
      submission?: Submission;
      issues?: ComplianceIssue[];
      revisions?: Revision[];
      reviewEvents?: ReviewEvent[];
      logoVariants?: BrandLogoVariant[];
    }>(`/api/submissions/${id}`);
    if (!res || !res.submission || typeof res.submission.id !== 'number') {
      throw new Error('Invalid submission detail returned by server.');
    }
    return {
      submission: res.submission,
      issues: Array.isArray(res.issues) ? res.issues : [],
      revisions: Array.isArray(res.revisions) ? res.revisions : [],
      reviewEvents: Array.isArray(res.reviewEvents) ? res.reviewEvents : [],
      logoVariants: Array.isArray(res.logoVariants) ? res.logoVariants : [],
    };
  },
  createSubmission: async (formData: FormData, idempotencyKey?: string) => {
    const key =
      idempotencyKey ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : undefined);
    const res = await request<{ submission?: Submission; issues?: ComplianceIssue[]; aiError?: string }>(
      '/api/submissions',
      {
        method: 'POST',
        body: formData,
        headers: key ? { 'Idempotency-Key': key } : undefined,
      }
    );
    if (!res || !res.submission || typeof res.submission.id !== 'number') {
      throw new Error('Submission response was missing a valid submission ID.');
    }
    return {
      submission: res.submission,
      issues: Array.isArray(res.issues) ? res.issues : [],
      aiError: res.aiError,
    };
  },
  reanalyzeSubmission: async (submissionId: number) => {
    const res = await request<{
      submission?: Submission;
      issues?: ComplianceIssue[];
      reviewEvents?: ReviewEvent[];
      aiError?: string;
    }>(`/api/submissions/${submissionId}/reanalyze`, { method: 'POST' });
    if (!res || !res.submission || typeof res.submission.id !== 'number') {
      throw new Error('Re-analysis response was missing a valid submission record.');
    }
    return {
      submission: res.submission,
      issues: Array.isArray(res.issues) ? res.issues : [],
      reviewEvents: Array.isArray(res.reviewEvents) ? res.reviewEvents : [],
      aiError: res.aiError,
    };
  },

  // Corrections & Review
  resolveIssue: (submissionId: number, issueId: number, action: 'accepted' | 'rejected' | 'open') =>
    request<{ issue: ComplianceIssue }>(`/api/submissions/${submissionId}/issues/${issueId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  saveRevision: (submissionId: number, revisedContent: string, note: string) =>
    request<{ submission: Submission }>(`/api/submissions/${submissionId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ revisedContent, note }),
    }),
  submitReview: (
    submissionId: number,
    decision: 'approved' | 'rejected' | 'changes_requested' | 'comment',
    comment: string
  ) =>
    request<{ submission: Submission; reviewEvents: ReviewEvent[] }>(`/api/submissions/${submissionId}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),
};
