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

export function clearAuthToken(): void {
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
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const token = getAuthToken();

  const headers: Record<string, string> = isFormData
    ? {}
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
    throw new Error(message);
  }
  return data as T;
}

export async function fetchProtectedAssetBlobUrl(filename: string): Promise<string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`/api/uploads/${encodeURIComponent(filename)}`, { headers });
  if (!res.ok) {
    throw new Error(`Unable to load asset (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const api = {
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

  // Dashboard
  getDashboard: () => request<DashboardData>('/api/dashboard'),

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
    }>(`/api/guidelines/${brandId}`),
  uploadGuidelineDoc: (brandId: number, formData: FormData) =>
    request<{
      document: GuidelineDocument;
      autoExtracted: {
        toneRules: string;
        messagingRules: string;
        facts: Array<{ fact_key: string; fact_value: string }>;
        terminology: Array<{ prohibited_term: string; preferred_term: string; severity: string; notes: string }>;
      } | null;
    }>(`/api/guidelines/${brandId}/upload`, { method: 'POST', body: formData }),
  aiExtractDoc: (brandId: number, docId: number) =>
    request<{
      extracted: {
        toneRules: string;
        messagingRules: string;
        facts: Array<{ fact_key: string; fact_value: string }>;
        terminology: Array<{ prohibited_term: string; preferred_term: string; severity: string; notes: string }>;
      };
    }>(`/api/guidelines/${brandId}/ai-extract/${docId}`, { method: 'POST' }),
  saveBrandRules: (brandId: number, tone_rules: string, messaging_rules: string) =>
    request<{ rules: BrandRules }>(`/api/guidelines/${brandId}/rules`, {
      method: 'PUT',
      body: JSON.stringify({ tone_rules, messaging_rules }),
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
    }>(`/api/submissions/${id}`);
    if (!res || !res.submission || typeof res.submission.id !== 'number') {
      throw new Error('Invalid submission detail returned by server.');
    }
    return {
      submission: res.submission,
      issues: Array.isArray(res.issues) ? res.issues : [],
      revisions: Array.isArray(res.revisions) ? res.revisions : [],
      reviewEvents: Array.isArray(res.reviewEvents) ? res.reviewEvents : [],
    };
  },
  createSubmission: async (formData: FormData) => {
    const res = await request<{ submission?: Submission; issues?: ComplianceIssue[]; aiError?: string }>(
      '/api/submissions',
      {
        method: 'POST',
        body: formData,
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
