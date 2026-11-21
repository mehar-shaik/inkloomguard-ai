import { db, DB_ENGINE } from './db.ts';
import type { AuthUser } from './auth.ts';

export type AnalyticsRange = '7d' | '30d' | '90d' | '12m' | 'custom' | 'all';
export type TrendGranularity = 'day' | 'week' | 'month';

export class AnalyticsValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsValidationError';
  }
}

export interface AnalyticsFilterInput {
  range?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  brandId?: unknown;
  category?: unknown;
  status?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface ValidatedAnalyticsFilters {
  range: AnalyticsRange;
  startDate: string | null;
  endDate: string | null;
  startIso: string | null;
  endIso: string | null;
  prevStartIso: string | null;
  prevEndIso: string | null;
  granularity: TrendGranularity;
  brandId: number | null;
  category: string | null;
  status: string | null;
  page: number;
  limit: number;
}

export interface OverviewMetrics {
  totalSubmissions: number;
  analyzedSubmissions: number;
  fullyCompliantSubmissions: number;
  submissionsRequiringCorrections: number;
  awaitingReviewCount: number;
  pendingReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  complianceRate: number | null;
  previousComplianceRate: number | null;
  complianceRateDelta: number | null;
  averageComplianceScore: number | null;
  openViolationsCount: number;
  resolvedViolationsCount: number;
  totalViolationsCount: number;
  totalAnalysisRuns: number;
  reanalysisRunsCount: number;
}

export interface TrendBucketPoint {
  bucketKey: string;
  label: string;
  startDate: string;
  endDate: string;
  submissionVolume: number;
  analyzedSubmissions: number;
  fullyCompliantCount: number;
  complianceRate: number | null;
  violationVolume: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  analysisRunsCount: number;
  reanalysisCount: number;
}

export interface SeverityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface RecurringViolationItem {
  ruleKey: string;
  ruleName: string;
  category: string;
  subCheckType: string | null;
  occurrences: number;
  affectedSubmissions: number;
  openOccurrences: number;
  resolvedOccurrences: number;
  severityDistribution: SeverityDistribution;
  previousOccurrences: number | null;
  deltaOccurrences: number | null;
  changePct: number | null;
  latestSubmissionId: number | null;
  latestSubmissionTitle: string | null;
  latestBrandId: number | null;
  latestBrandName: string | null;
}

export interface RecurringViolationsPage {
  items: RecurringViolationItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CategoryBreakdownItem {
  category: string;
  issueType: 'visual' | 'text';
  totalCount: number;
  openCount: number;
  resolvedCount: number;
  affectedSubmissions: number;
  sharePct: number | null;
  severityDistribution: SeverityDistribution;
}

export interface VisualSubCheckBreakdownItem {
  checkId: string;
  title: string;
  violationCount: number;
  passedCount: number;
  inconclusiveCount: number;
  notApplicableCount: number;
  affectedSubmissions: number;
  openIssueCount: number;
}

export interface IssueBreakdownMetrics {
  textViolations: number;
  visualViolations: number;
  totalViolations: number;
  textSharePct: number | null;
  visualSharePct: number | null;
  categoryBreakdown: CategoryBreakdownItem[];
  visualSubCheckBreakdown: VisualSubCheckBreakdownItem[];
}

export interface ReviewAnalyticsMetrics {
  pendingReviewCount: number;
  decidedSubmissionsCount: number;
  formalDecisionsCount: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  changesRequestedDecisions: number;
  commentsCount: number;
  reanalyzedEventsCount: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  changesRequestedRate: number | null;
  averageTurnaroundHours: number | null;
  medianTurnaroundHours: number | null;
  turnaroundSampleSize: number;
  turnaroundExcludedCount: number;
  reviewActivitySeries: Array<{
    bucketKey: string;
    label: string;
    approved: number;
    rejected: number;
    changesRequested: number;
    comments: number;
    reanalyzed: number;
  }>;
}

export interface TeamMemberActivityItem {
  userId: number;
  name: string;
  role: string;
  jobTitle: string;
  submissionsCreated: number;
  reviewsCompleted: number;
  approvedCount: number;
  rejectedCount: number;
  changesRequestedCount: number;
  commentsCount: number;
  outstandingWorkload: number;
}

export interface TeamAnalyticsResponse {
  scope: 'organization';
  period: {
    range: AnalyticsRange;
    startDate: string | null;
    endDate: string | null;
  };
  summary: {
    activeContributors: number;
    activeReviewers: number;
    totalSubmissionsCreated: number;
    totalReviewsCompleted: number;
    pendingQueueSize: number;
  };
  members: TeamMemberActivityItem[];
}

export interface GovernanceInsightItem {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'positive';
  title: string;
  observation: string;
  supportingData: string;
  impact: string;
  suggestedAction: string;
  targetPage?: 'guidelines' | 'analysis' | 'review' | 'corrections' | 'history' | 'submit';
  targetSubmissionId?: number | null;
  targetBrandId?: number | null;
}

export interface GovernanceAnalyticsResponse {
  scope: 'organization' | 'personal';
  canViewTeamAnalytics: boolean;
  timezone: 'UTC';
  appliedFilters: {
    range: AnalyticsRange;
    startDate: string | null;
    endDate: string | null;
    brandId: number | null;
    category: string | null;
    status: string | null;
    granularity: TrendGranularity;
  };
  brands: Array<{
    id: number;
    name: string;
    primaryColor: string;
    secondaryColor: string;
  }>;
  availableCategories: string[];
  overview: OverviewMetrics;
  trends: TrendBucketPoint[];
  recurringViolations: RecurringViolationsPage;
  issueBreakdown: IssueBreakdownMetrics;
  reviewAnalytics: ReviewAnalyticsMetrics;
  teamActivity: TeamAnalyticsResponse | null;
  insights: GovernanceInsightItem[];
  metricDefinitions: Array<{
    key: string;
    label: string;
    formula: string;
    dataSource: string;
  }>;
}

const VALID_RANGES = new Set<AnalyticsRange>(['7d', '30d', '90d', '12m', 'custom', 'all']);
const VALID_STATUSES = new Set([
  'analyzed',
  'pending_review',
  'revision_saved',
  'changes_requested',
  'approved',
  'rejected',
]);
const VALID_CATEGORIES = new Set([
  'Brand Tone',
  'Terminology',
  'Brand Messaging',
  'Facts',
  'Promotional Claims',
  'Visual Identity',
  'Accessibility',
  'Governance',
  'Visual',
  'Text',
]);

const MAX_CUSTOM_RANGE_DAYS = 730;
const ANALYTICS_CACHE_TTL_MS = 20_000;
const MAX_ANALYTICS_CACHE_ENTRIES = 200;
const analyticsCache = new Map<string, { expiresAt: number; payload: unknown }>();

export function clearAnalyticsCache(): void {
  analyticsCache.clear();
}

export function invalidateAnalyticsCache(companyId?: number | null): void {
  if (!companyId) {
    analyticsCache.clear();
    return;
  }
  const prefix = `${companyId}:`;
  for (const key of analyticsCache.keys()) {
    if (key.startsWith(prefix)) {
      analyticsCache.delete(key);
    }
  }
}

function getCachedAnalytics<T>(key: string): T | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.payload as T;
}

function setCachedAnalytics(key: string, payload: unknown): void {
  if (analyticsCache.size >= MAX_ANALYTICS_CACHE_ENTRIES) {
    const oldestKey = analyticsCache.keys().next().value;
    if (oldestKey) analyticsCache.delete(oldestKey);
  }
  analyticsCache.set(key, {
    expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS,
    payload,
  });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parseStrictIsoDateOnly(raw: unknown, fieldName: string): Date {
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new AnalyticsValidationError(`${fieldName} must be formatted as YYYY-MM-DD.`);
  }
  const [yStr, mStr, dStr] = str.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new AnalyticsValidationError(`${fieldName} ("${str}") is not a valid calendar date.`);
  }
  return dt;
}

function toIsoDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcSqliteTimestamp(isoString: string): string {
  const dt = new Date(isoString);
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

export function parseDbTimestampMs(raw: string | Date | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (!hasTz) {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      normalized = `${trimmed.replace(' ', 'T')}Z`;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      normalized = `${trimmed}Z`;
    }
  }
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function validateAnalyticsFilters(
  input: AnalyticsFilterInput,
  now: Date = new Date()
): ValidatedAnalyticsFilters {
  const rawRange =
    input.range === undefined || input.range === null || String(input.range).trim() === ''
      ? '30d'
      : String(input.range).trim();
  if (!VALID_RANGES.has(rawRange as AnalyticsRange)) {
    throw new AnalyticsValidationError(
      'Invalid date range. Allowed values: 7d, 30d, 90d, 12m, custom, all.'
    );
  }
  const range = rawRange as AnalyticsRange;

  let brandId: number | null = null;
  if (
    input.brandId !== undefined &&
    input.brandId !== null &&
    String(input.brandId).trim() !== '' &&
    String(input.brandId).trim() !== 'all'
  ) {
    const parsedBrand = Number(input.brandId);
    if (!Number.isInteger(parsedBrand) || parsedBrand <= 0) {
      throw new AnalyticsValidationError('brandId must be a positive integer or "all".');
    }
    brandId = parsedBrand;
  }

  let category: string | null = null;
  if (
    input.category !== undefined &&
    input.category !== null &&
    String(input.category).trim() !== '' &&
    String(input.category).trim().toLowerCase() !== 'all'
  ) {
    const cat = String(input.category).trim();
    if (!VALID_CATEGORIES.has(cat)) {
      throw new AnalyticsValidationError(`Unsupported compliance category filter: "${cat}".`);
    }
    category = cat;
  }

  let status: string | null = null;
  if (
    input.status !== undefined &&
    input.status !== null &&
    String(input.status).trim() !== '' &&
    String(input.status).trim().toLowerCase() !== 'all'
  ) {
    const st = String(input.status).trim();
    if (!VALID_STATUSES.has(st)) {
      throw new AnalyticsValidationError(`Unsupported submission status filter: "${st}".`);
    }
    status = st;
  }

  let page = 1;
  if (input.page !== undefined && input.page !== null && String(input.page).trim() !== '') {
    const parsedPage = Number(input.page);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new AnalyticsValidationError('page must be a positive integer.');
    }
    page = parsedPage;
  }

  let limit = 10;
  if (input.limit !== undefined && input.limit !== null && String(input.limit).trim() !== '') {
    const parsedLimit = Number(input.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
      throw new AnalyticsValidationError('limit must be an integer between 1 and 50.');
    }
    limit = parsedLimit;
  }

  const todayUtcEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  const todayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );

  let startUtc: Date | null = null;
  let endUtc: Date | null = null;

  if (range === 'custom') {
    if (!input.startDate || !input.endDate) {
      throw new AnalyticsValidationError('Custom date range requires both startDate and endDate.');
    }
    startUtc = parseStrictIsoDateOnly(input.startDate, 'startDate');
    const parsedEndStart = parseStrictIsoDateOnly(input.endDate, 'endDate');
    endUtc = new Date(parsedEndStart.getTime() + 86_400_000 - 1);
    if (startUtc.getTime() > endUtc.getTime()) {
      throw new AnalyticsValidationError('startDate must be earlier than or equal to endDate.');
    }
    const spanDays = Math.ceil((endUtc.getTime() - startUtc.getTime() + 1) / 86_400_000);
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
      throw new AnalyticsValidationError(
        `Custom date range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days.`
      );
    }
  } else if (range !== 'all') {
    if (
      (input.startDate && String(input.startDate).trim()) ||
      (input.endDate && String(input.endDate).trim())
    ) {
      if (input.startDate) parseStrictIsoDateOnly(input.startDate, 'startDate');
      if (input.endDate) parseStrictIsoDateOnly(input.endDate, 'endDate');
    }
    const daysBack = range === '7d' ? 6 : range === '30d' ? 29 : range === '90d' ? 89 : 364;
    startUtc = new Date(todayUtcStart.getTime() - daysBack * 86_400_000);
    endUtc = todayUtcEnd;
  }

  let prevStartIso: string | null = null;
  let prevEndIso: string | null = null;
  if (startUtc && endUtc) {
    const windowMs = endUtc.getTime() - startUtc.getTime() + 1;
    const prevEnd = new Date(startUtc.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - windowMs + 1);
    prevStartIso = prevStart.toISOString();
    prevEndIso = prevEnd.toISOString();
  }

  let granularity: TrendGranularity = 'day';
  if (range === '90d') {
    granularity = 'week';
  } else if (range === '12m' || range === 'all') {
    granularity = 'month';
  } else if (range === 'custom' && startUtc && endUtc) {
    const spanDays = Math.ceil((endUtc.getTime() - startUtc.getTime() + 1) / 86_400_000);
    if (spanDays > 150) granularity = 'month';
    else if (spanDays > 35) granularity = 'week';
    else granularity = 'day';
  }

  return {
    range,
    startDate: startUtc ? toIsoDateOnlyUtc(startUtc) : null,
    endDate: endUtc ? toIsoDateOnlyUtc(endUtc) : null,
    startIso: startUtc ? startUtc.toISOString() : null,
    endIso: endUtc ? endUtc.toISOString() : null,
    prevStartIso,
    prevEndIso,
    granularity,
    brandId,
    category,
    status,
    page,
    limit,
  };
}

function buildSqlDateRangeClause(
  columnExpr: string,
  startIso: string | null,
  endIso: string | null
): { clause: string; params: string[] } {
  if (!startIso || !endIso) {
    return { clause: '', params: [] };
  }
  if (DB_ENGINE === 'postgres') {
    return {
      clause: ` AND ${columnExpr} >= ?::timestamptz AND ${columnExpr} <= ?::timestamptz`,
      params: [startIso, endIso],
    };
  }
  return {
    clause: ` AND datetime(${columnExpr}) >= datetime(?) AND datetime(${columnExpr}) <= datetime(?)`,
    params: [formatUtcSqliteTimestamp(startIso), formatUtcSqliteTimestamp(endIso)],
  };
}

function formatDayBucketUtc(ms: number): {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
} {
  const dt = new Date(ms);
  const key = toIsoDateOnlyUtc(dt);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${monthNames[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  return { key, label, startDate: key, endDate: key };
}

function formatWeekBucketUtc(ms: number): {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
} {
  const dt = new Date(ms);
  const dayOfWeek = (dt.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - dayOfWeek, 0, 0, 0, 0)
  );
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const key = toIsoDateOnlyUtc(monday);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${monthNames[monday.getUTCMonth()]} ${monday.getUTCDate()}`;
  return {
    key,
    label,
    startDate: key,
    endDate: toIsoDateOnlyUtc(sunday),
  };
}

function formatMonthBucketUtc(ms: number): {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
} {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mm = String(m + 1).padStart(2, '0');
  const lastDay = new Date(Date.UTC(y, m + 1, 0));
  return {
    key: `${y}-${mm}`,
    label: `${monthNames[m]} '${String(y).slice(-2)}`,
    startDate: `${y}-${mm}-01`,
    endDate: toIsoDateOnlyUtc(lastDay),
  };
}

function bucketForTimestamp(ms: number, granularity: TrendGranularity) {
  if (granularity === 'month') return formatMonthBucketUtc(ms);
  if (granularity === 'week') return formatWeekBucketUtc(ms);
  return formatDayBucketUtc(ms);
}

function buildContinuousBuckets(
  granularity: TrendGranularity,
  startMs: number,
  endMs: number
): Array<{ key: string; label: string; startDate: string; endDate: string }> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return [];
  }
  const buckets: Array<{ key: string; label: string; startDate: string; endDate: string }> = [];
  const seen = new Set<string>();

  if (granularity === 'day') {
    let cursor = Date.UTC(
      new Date(startMs).getUTCFullYear(),
      new Date(startMs).getUTCMonth(),
      new Date(startMs).getUTCDate()
    );
    const endDt = new Date(endMs);
    const endDayStart = Date.UTC(
      endDt.getUTCFullYear(),
      endDt.getUTCMonth(),
      endDt.getUTCDate()
    );
    while (cursor <= endDayStart && buckets.length < 400) {
      const b = formatDayBucketUtc(cursor);
      if (!seen.has(b.key)) {
        seen.add(b.key);
        buckets.push(b);
      }
      cursor += 86_400_000;
    }
    return buckets;
  }

  if (granularity === 'week') {
    let cursor = startMs;
    const limit = endMs + 7 * 86_400_000;
    while (cursor <= limit && buckets.length < 160) {
      const b = formatWeekBucketUtc(cursor);
      if (!seen.has(b.key)) {
        seen.add(b.key);
        buckets.push(b);
      }
      if (Date.parse(`${b.endDate}T23:59:59.999Z`) >= endMs) break;
      cursor += 7 * 86_400_000;
    }
    return buckets;
  }

  const startDt = new Date(startMs);
  const endDt = new Date(endMs);
  let year = startDt.getUTCFullYear();
  let month = startDt.getUTCMonth();
  const endYear = endDt.getUTCFullYear();
  const endMonth = endDt.getUTCMonth();
  while ((year < endYear || (year === endYear && month <= endMonth)) && buckets.length < 120) {
    const b = formatMonthBucketUtc(Date.UTC(year, month, 1));
    if (!seen.has(b.key)) {
      seen.add(b.key);
      buckets.push(b);
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return buckets;
}

export interface NormalizedViolationRule {
  ruleKey: string;
  ruleName: string;
  subCheckType: string | null;
}

export function normalizeViolationRule(issue: {
  category: string;
  original_text: string;
  explanation: string;
  evidence: string;
}): NormalizedViolationRule {
  const category = (issue.category || 'Governance').trim();
  const orig = (issue.original_text || '').trim();
  const exp = (issue.explanation || '').trim();
  const ev = (issue.evidence || '').trim();
  const combinedLower = `${orig} ${exp} ${ev}`.toLowerCase();

  if (category === 'Visual Identity') {
    if (
      combinedLower.includes('logo matching') ||
      combinedLower.includes('logo missing') ||
      combinedLower.includes('required brand logo') ||
      combinedLower.includes('logo was not detected') ||
      combinedLower.includes('logo variant')
    ) {
      return {
        ruleKey: 'visual::logo_matching',
        ruleName: 'Logo Matching & Recognition',
        subCheckType: 'logo_matching',
      };
    }
    if (
      combinedLower.includes('distortion') ||
      combinedLower.includes('aspect ratio') ||
      combinedLower.includes('stretched') ||
      combinedLower.includes('minimum logo width') ||
      combinedLower.includes('pixel width')
    ) {
      return {
        ruleKey: 'visual::logo_distortion',
        ruleName: 'Logo Distortion & Minimum Size',
        subCheckType: 'logo_distortion',
      };
    }
    if (
      combinedLower.includes('clear space') ||
      combinedLower.includes('placement') ||
      combinedLower.includes('contrast ratio') ||
      combinedLower.includes('padding')
    ) {
      return {
        ruleKey: 'visual::logo_placement_clear_space',
        ruleName: 'Logo Clear Space & Placement',
        subCheckType: 'logo_placement_clear_space',
      };
    }
    if (
      combinedLower.includes('typography') ||
      combinedLower.includes('typeface') ||
      combinedLower.includes('font')
    ) {
      return {
        ruleKey: 'visual::typography_consistency',
        ruleName: 'Typography Consistency',
        subCheckType: 'typography_consistency',
      };
    }
    if (
      combinedLower.includes('color') ||
      combinedLower.includes('palette') ||
      combinedLower.includes('background') ||
      combinedLower.includes('δe') ||
      combinedLower.includes('delta e') ||
      combinedLower.includes('dominant')
    ) {
      return {
        ruleKey: 'visual::brand_colors',
        ruleName: 'Brand Color & Palette Deviations',
        subCheckType: 'brand_colors',
      };
    }
    return {
      ruleKey: 'visual::general',
      ruleName: 'Visual Identity Compliance',
      subCheckType: null,
    };
  }

  if (category === 'Terminology') {
    const termMatch =
      ev.match(/["']([^"']{1,60})["']\s*->/) ||
      exp.match(/prohibited term\s+["']([^"']{1,60})["']/i) ||
      exp.match(/["']([^"']{1,60})["']\s+(?:must be replaced|is prohibited|violates)/i);
    if (termMatch?.[1]) {
      const term = termMatch[1].trim();
      return {
        ruleKey: `terminology::${term.toLowerCase()}`,
        ruleName: `Prohibited Term: "${term}"`,
        subCheckType: null,
      };
    }
    if (orig && orig.length <= 48 && !orig.includes(' ')) {
      return {
        ruleKey: `terminology::${orig.toLowerCase()}`,
        ruleName: `Prohibited Term: "${orig}"`,
        subCheckType: null,
      };
    }
    return {
      ruleKey: 'terminology::general',
      ruleName: 'Prohibited Terminology Usage',
      subCheckType: null,
    };
  }

  if (category === 'Facts') {
    const bracketMatch = ev.match(/\[([^\]]{1,80})\]/) || orig.match(/\[([^\]]{1,80})\]/);
    if (bracketMatch?.[1]) {
      const factKey = bracketMatch[1].trim();
      return {
        ruleKey: `facts::${factKey.toLowerCase()}`,
        ruleName: `Approved Fact Mismatch: ${factKey}`,
        subCheckType: null,
      };
    }
    return {
      ruleKey: 'facts::general',
      ruleName: 'Unverified or Conflicting Brand Fact',
      subCheckType: null,
    };
  }

  if (category === 'Accessibility') {
    if (combinedLower.includes('alt-text') || combinedLower.includes('alt text')) {
      return {
        ruleKey: 'accessibility::alt_text',
        ruleName: 'Image Alt-Text Completeness & Length',
        subCheckType: null,
      };
    }
    if (combinedLower.includes('wcag') || combinedLower.includes('contrast')) {
      return {
        ruleKey: 'accessibility::wcag_contrast',
        ruleName: 'WCAG Luminance Contrast Threshold',
        subCheckType: null,
      };
    }
    return {
      ruleKey: 'accessibility::general',
      ruleName: 'Accessibility Guideline Compliance',
      subCheckType: null,
    };
  }

  if (category === 'Promotional Claims') {
    if (
      combinedLower.includes('superlative') ||
      combinedLower.includes('absolute') ||
      combinedLower.includes('guarantee') ||
      combinedLower.includes('100%') ||
      combinedLower.includes('best-in-class')
    ) {
      return {
        ruleKey: 'claims::unsubstantiated_superlative',
        ruleName: 'Unsubstantiated Absolute or Superlative Claim',
        subCheckType: null,
      };
    }
  }

  const normalizedSummary = exp
    .replace(/\b\d+(?:\.\d+)?%?\b/g, '#')
    .replace(/["'`][^"'`]{1,40}["'`]/g, '"..."')
    .replace(/\s+/g, ' ')
    .trim();

  const shortRule = normalizedSummary
    ? normalizedSummary.length > 72
      ? `${normalizedSummary.slice(0, 69)}...`
      : normalizedSummary
    : `${category} Guideline Violation`;

  return {
    ruleKey: `${category.toLowerCase()}::${shortRule.toLowerCase()}`,
    ruleName: shortRule,
    subCheckType: null,
  };
}

interface ScopedSubmissionRow {
  id: number;
  brand_id: number;
  brand_name: string;
  submitted_by: number;
  title: string;
  status: string;
  compliance_score: number | null;
  ai_status: string;
  visual_analysis_json: string | null;
  created_at: string | Date;
}

interface ScopedIssueRow {
  id: number;
  submission_id: number;
  brand_id: number;
  brand_name: string;
  submission_title: string;
  category: string;
  severity: string;
  original_text: string;
  explanation: string;
  evidence: string;
  resolution_status: string;
  created_at: string | Date;
}

interface ScopedReviewEventRow {
  id: number;
  submission_id: number;
  reviewer_id: number | null;
  decision: string;
  created_at: string | Date;
}

interface ScopedAnalysisRunRow {
  id: number;
  submission_id: number;
  run_type: string;
  created_at: string | Date;
}

function doesIssueMatchCategoryFilter(category: string, filter: string | null): boolean {
  if (!filter) return true;
  if (filter === 'Visual' || filter === 'Visual Identity') {
    return category === 'Visual Identity';
  }
  if (filter === 'Text') {
    return category !== 'Visual Identity';
  }
  return category === filter;
}

function buildCategoryExistsClause(filter: string | null): { clause: string; params: string[] } {
  if (!filter) return { clause: '', params: [] };
  if (filter === 'Visual' || filter === 'Visual Identity') {
    return {
      clause:
        " AND EXISTS (SELECT 1 FROM compliance_issues ci_f WHERE ci_f.submission_id = s.id AND ci_f.company_id = s.company_id AND ci_f.category = 'Visual Identity')",
      params: [],
    };
  }
  if (filter === 'Text') {
    return {
      clause:
        " AND EXISTS (SELECT 1 FROM compliance_issues ci_f WHERE ci_f.submission_id = s.id AND ci_f.company_id = s.company_id AND ci_f.category != 'Visual Identity')",
      params: [],
    };
  }
  return {
    clause:
      ' AND EXISTS (SELECT 1 FROM compliance_issues ci_f WHERE ci_f.submission_id = s.id AND ci_f.company_id = s.company_id AND ci_f.category = ?)',
    params: [filter],
  };
}

function classifySubmissionCompliance(
  sub: ScopedSubmissionRow,
  issueCounts: { total: number; open: number }
): { analyzed: boolean; fullyCompliant: boolean; requiringCorrections: boolean } {
  const analyzed = sub.compliance_score !== null && sub.compliance_score !== undefined && sub.ai_status !== 'pending';
  if (!analyzed) {
    return { analyzed: false, fullyCompliant: false, requiringCorrections: false };
  }
  const hasBlockingStatus = sub.status === 'changes_requested' || sub.status === 'rejected';
  const fullyCompliant =
    !hasBlockingStatus &&
    issueCounts.open === 0 &&
    (issueCounts.total === 0 || sub.status === 'approved');
  const requiringCorrections = !fullyCompliant;
  return { analyzed, fullyCompliant, requiringCorrections };
}

function emptySeverityDist(): SeverityDistribution {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function bumpSeverity(dist: SeverityDistribution, rawSeverity: string): void {
  const s = (rawSeverity || '').toLowerCase();
  if (s === 'critical') dist.critical += 1;
  else if (s === 'high') dist.high += 1;
  else if (s === 'medium') dist.medium += 1;
  else dist.low += 1;
}

const VISUAL_SUBCHECK_LABELS: Record<string, string> = {
  logo_matching: 'Logo Matching & Recognition',
  logo_distortion: 'Logo Distortion & Minimum Size',
  logo_placement_clear_space: 'Logo Clear Space & Placement',
  brand_colors: 'Brand Color & Palette Deviations',
  typography_consistency: 'Typography Consistency',
};

async function fetchPeriodSubmissionAndIssueState(params: {
  companyId: number;
  userId: number;
  isReviewerOrAdmin: boolean;
  startIso: string | null;
  endIso: string | null;
  brandId: number | null;
  category: string | null;
  status: string | null;
}) {
  const dateFilter = buildSqlDateRangeClause('s.created_at', params.startIso, params.endIso);
  const catFilter = buildCategoryExistsClause(params.category);

  const whereParts: string[] = ['s.company_id = ?'];
  const whereArgs: unknown[] = [params.companyId];

  if (!params.isReviewerOrAdmin) {
    whereParts.push('s.submitted_by = ?');
    whereArgs.push(params.userId);
  }
  if (params.brandId !== null) {
    whereParts.push('s.brand_id = ?');
    whereArgs.push(params.brandId);
  }
  if (params.status !== null) {
    whereParts.push('s.status = ?');
    whereArgs.push(params.status);
  }

  const baseWhere = whereParts.join(' AND ') + dateFilter.clause + catFilter.clause;
  const baseArgs = [...whereArgs, ...dateFilter.params, ...catFilter.params];

  const submissions = await db.all<ScopedSubmissionRow>(
    `SELECT s.id, s.brand_id, b.name AS brand_name, s.submitted_by, s.title, s.status,
            s.compliance_score, s.ai_status, s.visual_analysis_json, s.created_at
     FROM submissions s
     JOIN brands b ON b.id = s.brand_id
     WHERE ${baseWhere}
     ORDER BY s.created_at ASC, s.id ASC`,
    ...baseArgs
  );

  if (submissions.length === 0) {
    return {
      submissions: [] as ScopedSubmissionRow[],
      issues: [] as ScopedIssueRow[],
      issueCountsBySub: new Map<number, { total: number; open: number }>(),
    };
  }

  const allIssuesForSubmissions = await db.all<ScopedIssueRow>(
    `SELECT ci.id, ci.submission_id, s.brand_id, b.name AS brand_name, s.title AS submission_title,
            ci.category, ci.severity, ci.original_text, ci.explanation, ci.evidence,
            ci.resolution_status, ci.created_at
     FROM compliance_issues ci
     JOIN submissions s ON s.id = ci.submission_id AND s.company_id = ci.company_id
     JOIN brands b ON b.id = s.brand_id
     WHERE ${baseWhere}
     ORDER BY ci.id ASC`,
    ...baseArgs
  );

  const issueCountsBySub = new Map<number, { total: number; open: number }>();
  const filteredIssues: ScopedIssueRow[] = [];

  for (const issue of allIssuesForSubmissions) {
    const subId = Number(issue.submission_id);
    if (doesIssueMatchCategoryFilter(issue.category, params.category)) {
      filteredIssues.push({ ...issue, id: Number(issue.id), submission_id: subId, brand_id: Number(issue.brand_id) });
      const cur = issueCountsBySub.get(subId) || { total: 0, open: 0 };
      cur.total += 1;
      if (issue.resolution_status === 'open') cur.open += 1;
      issueCountsBySub.set(subId, cur);
    }
  }

  return {
    submissions: submissions.map((s) => ({
      ...s,
      id: Number(s.id),
      brand_id: Number(s.brand_id),
      submitted_by: Number(s.submitted_by),
      compliance_score: s.compliance_score === null || s.compliance_score === undefined ? null : Number(s.compliance_score),
    })),
    issues: filteredIssues,
    issueCountsBySub,
  };
}

function buildRecurringViolationsList(params: {
  currentIssues: ScopedIssueRow[];
  previousIssues: ScopedIssueRow[];
  hasPreviousPeriod: boolean;
}): RecurringViolationItem[] {
  const prevCounts = new Map<string, number>();
  if (params.hasPreviousPeriod) {
    for (const issue of params.previousIssues) {
      const norm = normalizeViolationRule(issue);
      prevCounts.set(norm.ruleKey, (prevCounts.get(norm.ruleKey) || 0) + 1);
    }
  }

  const groups = new Map<
    string,
    {
      ruleKey: string;
      ruleName: string;
      category: string;
      subCheckType: string | null;
      occurrences: number;
      openOccurrences: number;
      resolvedOccurrences: number;
      subIds: Set<number>;
      severityDistribution: SeverityDistribution;
      latestSubmissionId: number | null;
      latestSubmissionTitle: string | null;
      latestBrandId: number | null;
      latestBrandName: string | null;
      latestTimestampMs: number;
    }
  >();

  for (const issue of params.currentIssues) {
    const norm = normalizeViolationRule(issue);
    const ts = parseDbTimestampMs(issue.created_at) ?? 0;
    let group = groups.get(norm.ruleKey);
    if (!group) {
      group = {
        ruleKey: norm.ruleKey,
        ruleName: norm.ruleName,
        category: issue.category,
        subCheckType: norm.subCheckType,
        occurrences: 0,
        openOccurrences: 0,
        resolvedOccurrences: 0,
        subIds: new Set<number>(),
        severityDistribution: emptySeverityDist(),
        latestSubmissionId: issue.submission_id,
        latestSubmissionTitle: issue.submission_title,
        latestBrandId: issue.brand_id,
        latestBrandName: issue.brand_name,
        latestTimestampMs: ts,
      };
      groups.set(norm.ruleKey, group);
    }

    group.occurrences += 1;
    if (issue.resolution_status === 'open') group.openOccurrences += 1;
    else group.resolvedOccurrences += 1;
    group.subIds.add(issue.submission_id);
    bumpSeverity(group.severityDistribution, issue.severity);

    if (ts >= group.latestTimestampMs) {
      group.latestTimestampMs = ts;
      group.latestSubmissionId = issue.submission_id;
      group.latestSubmissionTitle = issue.submission_title;
      group.latestBrandId = issue.brand_id;
      group.latestBrandName = issue.brand_name;
    }
  }

  return Array.from(groups.values())
    .map((g) => {
      const prev = params.hasPreviousPeriod ? prevCounts.get(g.ruleKey) ?? 0 : null;
      const delta = prev !== null ? g.occurrences - prev : null;
      const changePct =
        prev !== null && prev > 0 ? round1(((g.occurrences - prev) / prev) * 100) : null;
      return {
        ruleKey: g.ruleKey,
        ruleName: g.ruleName,
        category: g.category,
        subCheckType: g.subCheckType,
        occurrences: g.occurrences,
        affectedSubmissions: g.subIds.size,
        openOccurrences: g.openOccurrences,
        resolvedOccurrences: g.resolvedOccurrences,
        severityDistribution: g.severityDistribution,
        previousOccurrences: prev,
        deltaOccurrences: delta,
        changePct,
        latestSubmissionId: g.latestSubmissionId,
        latestSubmissionTitle: g.latestSubmissionTitle,
        latestBrandId: g.latestBrandId,
        latestBrandName: g.latestBrandName,
      };
    })
    .sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      if (b.affectedSubmissions !== a.affectedSubmissions) {
        return b.affectedSubmissions - a.affectedSubmissions;
      }
      return a.ruleName.localeCompare(b.ruleName);
    });
}

function generateGroundedInsights(params: {
  isReviewerOrAdmin: boolean;
  overview: OverviewMetrics;
  recurring: RecurringViolationItem[];
  issueBreakdown: IssueBreakdownMetrics;
  reviewAnalytics: ReviewAnalyticsMetrics;
}): GovernanceInsightItem[] {
  const { overview, recurring, issueBreakdown, reviewAnalytics, isReviewerOrAdmin } = params;
  if (overview.totalSubmissions === 0) {
    return [];
  }

  const insights: GovernanceInsightItem[] = [];

  // 1. Top recurring rule violation
  const topRecurring = recurring[0];
  if (topRecurring && topRecurring.occurrences >= 2) {
    const trendClause =
      topRecurring.deltaOccurrences !== null && topRecurring.deltaOccurrences > 0
        ? ` (+${topRecurring.deltaOccurrences} vs previous period)`
        : '';
    insights.push({
      id: `insight-recurring-${topRecurring.ruleKey}`,
      severity:
        topRecurring.severityDistribution.critical > 0 || topRecurring.severityDistribution.high >= 2
          ? 'critical'
          : 'warning',
      title: `Recurring ${topRecurring.category} pattern detected`,
      observation: `"${topRecurring.ruleName}" occurred ${topRecurring.occurrences} times across ${topRecurring.affectedSubmissions} submission${topRecurring.affectedSubmissions === 1 ? '' : 's'}${trendClause}.`,
      supportingData: `${topRecurring.openOccurrences} open · ${topRecurring.resolvedOccurrences} resolved`,
      impact: `Repeatedly triggers rework and lowers first-pass compliance in ${topRecurring.category}.`,
      suggestedAction:
        topRecurring.category === 'Visual Identity'
          ? 'Update brand visual guidelines and share acceptable logo/palette templates with content creators.'
          : 'Clarify this rule in Brand Guidelines and review affected drafts before submission.',
      targetPage: 'guidelines',
      targetBrandId: topRecurring.latestBrandId,
      targetSubmissionId: topRecurring.latestSubmissionId,
    });
  }

  // 2. Visual vs Text concentration
  if (issueBreakdown.visualViolations > 0 && issueBreakdown.totalViolations > 0) {
    const visualShare = issueBreakdown.visualSharePct ?? 0;
    const topVisualSub = [...issueBreakdown.visualSubCheckBreakdown]
      .filter((item) => item.violationCount > 0)
      .sort((a, b) => b.violationCount - a.violationCount)[0];
    if (visualShare >= 35 || issueBreakdown.visualViolations >= 2) {
      insights.push({
        id: 'insight-visual-concentration',
        severity: visualShare >= 50 ? 'warning' : 'info',
        title: `Visual Identity accounts for ${visualShare}% of flagged violations`,
        observation: topVisualSub
          ? `${issueBreakdown.visualViolations} visual violation${issueBreakdown.visualViolations === 1 ? '' : 's'} detected, led by ${topVisualSub.title} (${topVisualSub.violationCount} failure${topVisualSub.violationCount === 1 ? '' : 's'}).`
          : `${issueBreakdown.visualViolations} of ${issueBreakdown.totalViolations} compliance violations relate to Visual Identity.`,
        supportingData: `Visual: ${issueBreakdown.visualViolations} · Text: ${issueBreakdown.textViolations}`,
        impact: 'Visual asset defects frequently require design handoff and extend creative approval cycles.',
        suggestedAction:
          'Verify uploaded reference logos, minimum pixel widths, and approved palette hex codes in Brand Guidelines.',
        targetPage: topRecurring?.category === 'Visual Identity' && topRecurring.latestSubmissionId ? 'analysis' : 'guidelines',
        targetSubmissionId: topRecurring?.latestSubmissionId ?? null,
        targetBrandId: topRecurring?.latestBrandId ?? null,
      });
    }
  }

  // 3. Review queue / turnaround health
  if (reviewAnalytics.pendingReviewCount > 0) {
    const avgHrs = reviewAnalytics.averageTurnaroundHours;
    const isSlow = avgHrs !== null && avgHrs >= 24;
    const backlogRatio = overview.totalSubmissions > 0 ? reviewAnalytics.pendingReviewCount / overview.totalSubmissions : 0;
    if (isSlow || backlogRatio >= 0.4 || reviewAnalytics.pendingReviewCount >= 3) {
      insights.push({
        id: 'insight-review-queue',
        severity: isSlow ? 'warning' : 'info',
        title: isSlow
          ? `Review turnaround averages ${avgHrs} hours`
          : `${reviewAnalytics.pendingReviewCount} submission${reviewAnalytics.pendingReviewCount === 1 ? '' : 's'} awaiting human sign-off`,
        observation:
          avgHrs !== null
            ? `${reviewAnalytics.pendingReviewCount} item${reviewAnalytics.pendingReviewCount === 1 ? '' : 's'} remain in the review queue with an average decision turnaround of ${avgHrs} hours across ${reviewAnalytics.turnaroundSampleSize} decided audit${reviewAnalytics.turnaroundSampleSize === 1 ? '' : 's'}.`
            : `${reviewAnalytics.pendingReviewCount} submission${reviewAnalytics.pendingReviewCount === 1 ? '' : 's'} currently require human review and governance approval.`,
        supportingData: `Pending: ${reviewAnalytics.pendingReviewCount} · Formal decisions: ${reviewAnalytics.formalDecisionsCount}`,
        impact: 'Unreviewed items delay campaign publishing and block final compliance sign-off.',
        suggestedAction: isReviewerOrAdmin
          ? 'Open the Review & Approval queue to prioritize awaiting submissions.'
          : 'Address open correction suggestions so reviewers can approve pending drafts promptly.',
        targetPage: isReviewerOrAdmin ? 'review' : 'history',
      });
    }
  }

  // 4. Compliance rate performance or open critical/high backlog
  const openCriticalHigh = recurring.reduce(
    (sum, item) => sum + item.severityDistribution.critical + item.severityDistribution.high,
    0
  );
  if (overview.complianceRate !== null) {
    if (overview.complianceRate < 70 && overview.analyzedSubmissions >= 2) {
      insights.push({
        id: 'insight-compliance-rate-low',
        severity: openCriticalHigh > 0 ? 'critical' : 'warning',
        title: `Compliance rate is ${overview.complianceRate}% across analyzed submissions`,
        observation: `${overview.submissionsRequiringCorrections} of ${overview.analyzedSubmissions} analyzed submission${overview.analyzedSubmissions === 1 ? '' : 's'} required corrections or revision.`,
        supportingData: `${overview.openViolationsCount} open violation${overview.openViolationsCount === 1 ? '' : 's'} (${openCriticalHigh} critical/high)`,
        impact: 'High correction volume increases reviewer load and slows campaign launches.',
        suggestedAction:
          'Resolve open high-severity issues in Correction Suggestions and re-run compliance checks.',
        targetPage: 'corrections',
        targetSubmissionId: recurring[0]?.latestSubmissionId ?? null,
      });
    } else if (overview.complianceRate >= 85 && overview.analyzedSubmissions >= 2) {
      insights.push({
        id: 'insight-compliance-rate-strong',
        severity: 'positive',
        title: `Strong ${overview.complianceRate}% compliance pass rate`,
        observation: `${overview.fullyCompliantSubmissions} of ${overview.analyzedSubmissions} analyzed submissions meet brand standards without unresolved violations.`,
        supportingData:
          overview.complianceRateDelta !== null
            ? `${overview.complianceRateDelta >= 0 ? '+' : ''}${overview.complianceRateDelta} pts vs previous period`
            : `Avg score: ${overview.averageComplianceScore ?? '—'}/100`,
        impact: 'Consistent adherence reduces manual revision loops and accelerates approvals.',
        suggestedAction: 'Maintain guideline coverage as new campaigns and visual templates launch.',
        targetPage: 'history',
      });
    }
  }

  return insights.slice(0, 5);
}

export async function getGovernanceAnalytics(
  user: AuthUser,
  rawFilters: AnalyticsFilterInput
): Promise<GovernanceAnalyticsResponse> {
  const filters = validateAnalyticsFilters(rawFilters);
  const isReviewerOrAdmin = user.role === 'reviewer' || user.role === 'admin';
  const scope = isReviewerOrAdmin ? 'organization' : 'personal';
  const cacheKey = `${user.companyId}:${user.role}:${user.id}:gov:${JSON.stringify(filters)}`;
  const cached = getCachedAnalytics<GovernanceAnalyticsResponse>(cacheKey);
  if (cached) return cached;

  const brandsRows = await db.all<{
    id: number;
    name: string;
    primary_color: string;
    secondary_color: string;
  }>(
    'SELECT id, name, primary_color, secondary_color FROM brands WHERE company_id = ? ORDER BY name ASC',
    user.companyId
  );

  const [currentData, previousData] = await Promise.all([
    fetchPeriodSubmissionAndIssueState({
      companyId: user.companyId,
      userId: user.id,
      isReviewerOrAdmin,
      startIso: filters.startIso,
      endIso: filters.endIso,
      brandId: filters.brandId,
      category: filters.category,
      status: filters.status,
    }),
    filters.prevStartIso && filters.prevEndIso
      ? fetchPeriodSubmissionAndIssueState({
          companyId: user.companyId,
          userId: user.id,
          isReviewerOrAdmin,
          startIso: filters.prevStartIso,
          endIso: filters.prevEndIso,
          brandId: filters.brandId,
          category: filters.category,
          status: filters.status,
        })
      : Promise.resolve({
          submissions: [] as ScopedSubmissionRow[],
          issues: [] as ScopedIssueRow[],
          issueCountsBySub: new Map<number, { total: number; open: number }>(),
        }),
  ]);

  const submissions = currentData.submissions;
  const issues = currentData.issues;
  const subIds = new Set(submissions.map((s) => s.id));

  // Query review events & analysis runs scoped cleanly via submissions
  const revWhereParts: string[] = ['s.company_id = ?'];
  const revArgs: unknown[] = [user.companyId];
  if (!isReviewerOrAdmin) {
    revWhereParts.push('s.submitted_by = ?');
    revArgs.push(user.id);
  }
  if (filters.brandId !== null) {
    revWhereParts.push('s.brand_id = ?');
    revArgs.push(filters.brandId);
  }
  if (filters.status !== null) {
    revWhereParts.push('s.status = ?');
    revArgs.push(filters.status);
  }
  const catFilter = buildCategoryExistsClause(filters.category);
  const revDateFilter = buildSqlDateRangeClause('re.created_at', filters.startIso, filters.endIso);
  const runsDateFilter = buildSqlDateRangeClause('ar.created_at', filters.startIso, filters.endIso);

  const [reviewEventsInWindow, firstFormalDecisions, analysisRunsInWindow] = await Promise.all([
    db.all<ScopedReviewEventRow>(
      `SELECT re.id, re.submission_id, re.reviewer_id, re.decision, re.created_at
       FROM review_events re
       JOIN submissions s ON s.id = re.submission_id AND s.company_id = re.company_id
       WHERE ${revWhereParts.join(' AND ')}${catFilter.clause}${revDateFilter.clause}
       ORDER BY re.created_at ASC, re.id ASC`,
      ...revArgs,
      ...catFilter.params,
      ...revDateFilter.params
    ),
    db.all<{ submission_id: number; submission_created_at: string | Date; first_decision_at: string | Date }>(
      `SELECT s.id AS submission_id,
              s.created_at AS submission_created_at,
              MIN(re.created_at) AS first_decision_at
       FROM submissions s
       JOIN review_events re
         ON re.submission_id = s.id
        AND re.company_id = s.company_id
        AND re.decision IN ('approved', 'rejected', 'changes_requested')
       WHERE ${revWhereParts.join(' AND ')}${catFilter.clause}${buildSqlDateRangeClause('s.created_at', filters.startIso, filters.endIso).clause}
       GROUP BY s.id, s.created_at`,
      ...revArgs,
      ...catFilter.params,
      ...buildSqlDateRangeClause('s.created_at', filters.startIso, filters.endIso).params
    ),
    db.all<ScopedAnalysisRunRow>(
      `SELECT ar.id, ar.submission_id, ar.run_type, ar.created_at
       FROM analysis_runs ar
       JOIN submissions s ON s.id = ar.submission_id AND s.company_id = ar.company_id
       WHERE ${revWhereParts.join(' AND ')}${catFilter.clause}${runsDateFilter.clause}
       ORDER BY ar.created_at ASC, ar.id ASC`,
      ...revArgs,
      ...catFilter.params,
      ...runsDateFilter.params
    ),
  ]);

  // Overview KPI computation (strictly distinct submission IDs)
  let analyzedSubmissions = 0;
  let fullyCompliantSubmissions = 0;
  let submissionsRequiringCorrections = 0;
  let awaitingReviewCount = 0;
  let pendingReviewCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let changesRequestedCount = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const sub of submissions) {
    const counts = currentData.issueCountsBySub.get(sub.id) || { total: 0, open: 0 };
    const cls = classifySubmissionCompliance(sub, counts);
    if (cls.analyzed) {
      analyzedSubmissions += 1;
      if (typeof sub.compliance_score === 'number') {
        scoreSum += sub.compliance_score;
        scoreCount += 1;
      }
      if (cls.fullyCompliant) fullyCompliantSubmissions += 1;
      if (cls.requiringCorrections) submissionsRequiringCorrections += 1;
    }

    if (
      sub.status === 'analyzed' ||
      sub.status === 'pending_review' ||
      sub.status === 'revision_saved' ||
      sub.status === 'changes_requested'
    ) {
      awaitingReviewCount += 1;
    }
    if (sub.status === 'pending_review' || sub.status === 'revision_saved') {
      pendingReviewCount += 1;
    }
    if (sub.status === 'approved') approvedCount += 1;
    else if (sub.status === 'rejected') rejectedCount += 1;
    else if (sub.status === 'changes_requested') changesRequestedCount += 1;
  }

  let prevAnalyzed = 0;
  let prevFullyCompliant = 0;
  for (const sub of previousData.submissions) {
    const counts = previousData.issueCountsBySub.get(sub.id) || { total: 0, open: 0 };
    const cls = classifySubmissionCompliance(sub, counts);
    if (cls.analyzed) {
      prevAnalyzed += 1;
      if (cls.fullyCompliant) prevFullyCompliant += 1;
    }
  }

  const complianceRate =
    analyzedSubmissions > 0 ? round1((fullyCompliantSubmissions / analyzedSubmissions) * 100) : null;
  const previousComplianceRate =
    filters.prevStartIso && prevAnalyzed > 0 ? round1((prevFullyCompliant / prevAnalyzed) * 100) : null;
  const complianceRateDelta =
    complianceRate !== null && previousComplianceRate !== null
      ? round1(complianceRate - previousComplianceRate)
      : null;

  const openViolationsCount = issues.filter((i) => i.resolution_status === 'open').length;
  const resolvedViolationsCount = issues.length - openViolationsCount;

  // Analysis runs tracking (uses analysis_runs table plus graceful fallback for legacy submissions without analysis_runs)
  const subsWithRunRows = new Set(analysisRunsInWindow.map((r) => Number(r.submission_id)));
  const legacyInitialRunsCount = submissions.filter((s) => !subsWithRunRows.has(s.id)).length;
  const legacyReanalysisEvents = reviewEventsInWindow.filter(
    (e) => e.decision === 'reanalyzed' && !subsWithRunRows.has(Number(e.submission_id))
  );
  const recordedReanalysisRuns = analysisRunsInWindow.filter((r) => r.run_type === 'reanalysis').length;
  const totalAnalysisRuns =
    analysisRunsInWindow.length + legacyInitialRunsCount + legacyReanalysisEvents.length;
  const reanalysisRunsCount = recordedReanalysisRuns + legacyReanalysisEvents.length;

  const overview: OverviewMetrics = {
    totalSubmissions: submissions.length,
    analyzedSubmissions,
    fullyCompliantSubmissions,
    submissionsRequiringCorrections,
    awaitingReviewCount,
    pendingReviewCount,
    approvedCount,
    rejectedCount,
    changesRequestedCount,
    complianceRate,
    previousComplianceRate,
    complianceRateDelta,
    averageComplianceScore: scoreCount > 0 ? round1(scoreSum / scoreCount) : null,
    openViolationsCount,
    resolvedViolationsCount,
    totalViolationsCount: issues.length,
    totalAnalysisRuns,
    reanalysisRunsCount,
  };

  // Determine timeline bounds for continuous trend buckets
  let trendStartMs = filters.startIso ? Date.parse(filters.startIso) : Number.POSITIVE_INFINITY;
  let trendEndMs = filters.endIso ? Date.parse(filters.endIso) : Number.NEGATIVE_INFINITY;
  if (!filters.startIso || !filters.endIso) {
    for (const s of submissions) {
      const ms = parseDbTimestampMs(s.created_at);
      if (ms !== null) {
        if (ms < trendStartMs) trendStartMs = ms;
        if (ms > trendEndMs) trendEndMs = ms;
      }
    }
    for (const ev of reviewEventsInWindow) {
      const ms = parseDbTimestampMs(ev.created_at);
      if (ms !== null) {
        if (ms < trendStartMs) trendStartMs = ms;
        if (ms > trendEndMs) trendEndMs = ms;
      }
    }
  }

  const continuousBuckets =
    Number.isFinite(trendStartMs) && Number.isFinite(trendEndMs) && trendStartMs <= trendEndMs
      ? buildContinuousBuckets(filters.granularity, trendStartMs, trendEndMs)
      : [];

  const trendMap = new Map<string, TrendBucketPoint>();
  const reviewSeriesMap = new Map<
    string,
    {
      bucketKey: string;
      label: string;
      approved: number;
      rejected: number;
      changesRequested: number;
      comments: number;
      reanalyzed: number;
    }
  >();

  for (const b of continuousBuckets) {
    trendMap.set(b.key, {
      bucketKey: b.key,
      label: b.label,
      startDate: b.startDate,
      endDate: b.endDate,
      submissionVolume: 0,
      analyzedSubmissions: 0,
      fullyCompliantCount: 0,
      complianceRate: null,
      violationVolume: 0,
      approvedCount: 0,
      rejectedCount: 0,
      changesRequestedCount: 0,
      analysisRunsCount: 0,
      reanalysisCount: 0,
    });
    reviewSeriesMap.set(b.key, {
      bucketKey: b.key,
      label: b.label,
      approved: 0,
      rejected: 0,
      changesRequested: 0,
      comments: 0,
      reanalyzed: 0,
    });
  }

  const ensureTrendBucket = (ms: number) => {
    const info = bucketForTimestamp(ms, filters.granularity);
    let entry = trendMap.get(info.key);
    if (!entry) {
      entry = {
        bucketKey: info.key,
        label: info.label,
        startDate: info.startDate,
        endDate: info.endDate,
        submissionVolume: 0,
        analyzedSubmissions: 0,
        fullyCompliantCount: 0,
        complianceRate: null,
        violationVolume: 0,
        approvedCount: 0,
        rejectedCount: 0,
        changesRequestedCount: 0,
        analysisRunsCount: 0,
        reanalysisCount: 0,
      };
      trendMap.set(info.key, entry);
    }
    if (!reviewSeriesMap.has(info.key)) {
      reviewSeriesMap.set(info.key, {
        bucketKey: info.key,
        label: info.label,
        approved: 0,
        rejected: 0,
        changesRequested: 0,
        comments: 0,
        reanalyzed: 0,
      });
    }
    return { trend: entry, review: reviewSeriesMap.get(info.key)! };
  };

  for (const sub of submissions) {
    const ms = parseDbTimestampMs(sub.created_at);
    if (ms === null) continue;
    const { trend } = ensureTrendBucket(ms);
    trend.submissionVolume += 1;
    const counts = currentData.issueCountsBySub.get(sub.id) || { total: 0, open: 0 };
    const cls = classifySubmissionCompliance(sub, counts);
    if (cls.analyzed) {
      trend.analyzedSubmissions += 1;
      if (cls.fullyCompliant) trend.fullyCompliantCount += 1;
    }
    if (!subsWithRunRows.has(sub.id)) {
      trend.analysisRunsCount += 1;
    }
  }

  for (const issue of issues) {
    const ms = parseDbTimestampMs(issue.created_at);
    if (ms === null) continue;
    const { trend } = ensureTrendBucket(ms);
    trend.violationVolume += 1;
  }

  for (const run of analysisRunsInWindow) {
    const ms = parseDbTimestampMs(run.created_at);
    if (ms === null) continue;
    const { trend } = ensureTrendBucket(ms);
    trend.analysisRunsCount += 1;
    if (run.run_type === 'reanalysis') {
      trend.reanalysisCount += 1;
    }
  }

  let approvedDecisions = 0;
  let rejectedDecisions = 0;
  let changesRequestedDecisions = 0;
  let commentsCount = 0;
  let reanalyzedEventsCount = 0;

  for (const ev of reviewEventsInWindow) {
    const ms = parseDbTimestampMs(ev.created_at);
    if (ev.decision === 'approved') approvedDecisions += 1;
    else if (ev.decision === 'rejected') rejectedDecisions += 1;
    else if (ev.decision === 'changes_requested') changesRequestedDecisions += 1;
    else if (ev.decision === 'comment') commentsCount += 1;
    else if (ev.decision === 'reanalyzed') reanalyzedEventsCount += 1;

    if (ms !== null) {
      const { trend, review } = ensureTrendBucket(ms);
      if (ev.decision === 'approved') {
        trend.approvedCount += 1;
        review.approved += 1;
      } else if (ev.decision === 'rejected') {
        trend.rejectedCount += 1;
        review.rejected += 1;
      } else if (ev.decision === 'changes_requested') {
        trend.changesRequestedCount += 1;
        review.changesRequested += 1;
      } else if (ev.decision === 'comment') {
        review.comments += 1;
      } else if (ev.decision === 'reanalyzed') {
        review.reanalyzed += 1;
        if (!subsWithRunRows.has(Number(ev.submission_id))) {
          trend.analysisRunsCount += 1;
          trend.reanalysisCount += 1;
        }
      }
    }
  }

  const trends = Array.from(trendMap.values())
    .sort((a, b) => a.bucketKey.localeCompare(b.bucketKey))
    .map((point) => ({
      ...point,
      complianceRate:
        point.analyzedSubmissions > 0
          ? round1((point.fullyCompliantCount / point.analyzedSubmissions) * 100)
          : null,
    }));

  // Recurring violations aggregation + pagination
  const allRecurring = buildRecurringViolationsList({
    currentIssues: issues,
    previousIssues: previousData.issues,
    hasPreviousPeriod: Boolean(filters.prevStartIso && filters.prevEndIso),
  });
  const totalRecurring = allRecurring.length;
  const totalPages = Math.max(1, Math.ceil(totalRecurring / filters.limit));
  const safePage = Math.min(filters.page, totalPages);
  const offset = (safePage - 1) * filters.limit;
  const recurringViolations: RecurringViolationsPage = {
    items: allRecurring.slice(offset, offset + filters.limit),
    pagination: {
      page: safePage,
      limit: filters.limit,
      total: totalRecurring,
      totalPages,
    },
  };

  // Issue breakdown: Text vs Visual + Category Breakdown + Visual Sub-check Breakdown
  let textViolations = 0;
  let visualViolations = 0;
  const categoryMap = new Map<
    string,
    {
      category: string;
      issueType: 'visual' | 'text';
      totalCount: number;
      openCount: number;
      resolvedCount: number;
      subIds: Set<number>;
      severityDistribution: SeverityDistribution;
    }
  >();

  for (const issue of issues) {
    const isVisual = issue.category === 'Visual Identity';
    if (isVisual) visualViolations += 1;
    else textViolations += 1;

    let catGroup = categoryMap.get(issue.category);
    if (!catGroup) {
      catGroup = {
        category: issue.category,
        issueType: isVisual ? 'visual' : 'text',
        totalCount: 0,
        openCount: 0,
        resolvedCount: 0,
        subIds: new Set<number>(),
        severityDistribution: emptySeverityDist(),
      };
      categoryMap.set(issue.category, catGroup);
    }
    catGroup.totalCount += 1;
    if (issue.resolution_status === 'open') catGroup.openCount += 1;
    else catGroup.resolvedCount += 1;
    catGroup.subIds.add(issue.submission_id);
    bumpSeverity(catGroup.severityDistribution, issue.severity);
  }

  const totalViolations = textViolations + visualViolations;
  const categoryBreakdown: CategoryBreakdownItem[] = Array.from(categoryMap.values())
    .map((c) => ({
      category: c.category,
      issueType: c.issueType,
      totalCount: c.totalCount,
      openCount: c.openCount,
      resolvedCount: c.resolvedCount,
      affectedSubmissions: c.subIds.size,
      sharePct: totalViolations > 0 ? round1((c.totalCount / totalViolations) * 100) : null,
      severityDistribution: c.severityDistribution,
    }))
    .sort((a, b) => b.totalCount - a.totalCount || a.category.localeCompare(b.category));

  // Visual sub-check breakdown from persisted visual_analysis_json + Visual Identity fallback issues
  const visualSubMap = new Map<
    string,
    {
      checkId: string;
      title: string;
      violationCount: number;
      passedCount: number;
      inconclusiveCount: number;
      notApplicableCount: number;
      affectedSubs: Set<number>;
      openIssueCount: number;
    }
  >();

  const subsWithStructuredVisual = new Set<number>();
  for (const sub of submissions) {
    if (!sub.visual_analysis_json) continue;
    try {
      const parsed = JSON.parse(sub.visual_analysis_json) as {
        checks?: Array<{ id?: string; title?: string; status?: string }>;
      };
      if (!Array.isArray(parsed.checks) || parsed.checks.length === 0) continue;
      subsWithStructuredVisual.add(sub.id);
      for (const chk of parsed.checks) {
        const checkId = String(chk.id || '').trim();
        if (!checkId) continue;
        const title = VISUAL_SUBCHECK_LABELS[checkId] || String(chk.title || checkId);
        let entry = visualSubMap.get(checkId);
        if (!entry) {
          entry = {
            checkId,
            title,
            violationCount: 0,
            passedCount: 0,
            inconclusiveCount: 0,
            notApplicableCount: 0,
            affectedSubs: new Set<number>(),
            openIssueCount: 0,
          };
          visualSubMap.set(checkId, entry);
        }
        if (chk.status === 'violation') {
          entry.violationCount += 1;
          entry.affectedSubs.add(sub.id);
        } else if (chk.status === 'passed') {
          entry.passedCount += 1;
        } else if (chk.status === 'inconclusive') {
          entry.inconclusiveCount += 1;
        } else if (chk.status === 'not_applicable') {
          entry.notApplicableCount += 1;
        }
      }
    } catch {
      // Skip malformed visual JSON safely
    }
  }

  for (const issue of issues) {
    if (issue.category !== 'Visual Identity') continue;
    const norm = normalizeViolationRule(issue);
    const subCheckId = norm.subCheckType || 'brand_colors';
    let entry = visualSubMap.get(subCheckId);
    if (!entry) {
      entry = {
        checkId: subCheckId,
        title: VISUAL_SUBCHECK_LABELS[subCheckId] || norm.ruleName,
        violationCount: 0,
        passedCount: 0,
        inconclusiveCount: 0,
        notApplicableCount: 0,
        affectedSubs: new Set<number>(),
        openIssueCount: 0,
      };
      visualSubMap.set(subCheckId, entry);
    }
    if (!subsWithStructuredVisual.has(issue.submission_id)) {
      entry.violationCount += 1;
      entry.affectedSubs.add(issue.submission_id);
    }
    if (issue.resolution_status === 'open') {
      entry.openIssueCount += 1;
    }
  }

  const visualSubCheckBreakdown: VisualSubCheckBreakdownItem[] = Array.from(visualSubMap.values())
    .filter((v) => v.violationCount + v.passedCount + v.inconclusiveCount > 0)
    .map((v) => ({
      checkId: v.checkId,
      title: v.title,
      violationCount: v.violationCount,
      passedCount: v.passedCount,
      inconclusiveCount: v.inconclusiveCount,
      notApplicableCount: v.notApplicableCount,
      affectedSubmissions: v.affectedSubs.size,
      openIssueCount: v.openIssueCount,
    }))
    .sort((a, b) => b.violationCount - a.violationCount || a.title.localeCompare(b.title));

  const issueBreakdown: IssueBreakdownMetrics = {
    textViolations,
    visualViolations,
    totalViolations,
    textSharePct: totalViolations > 0 ? round1((textViolations / totalViolations) * 100) : null,
    visualSharePct: totalViolations > 0 ? round1((visualViolations / totalViolations) * 100) : null,
    categoryBreakdown,
    visualSubCheckBreakdown,
  };

  // Review turnaround calculation from real timestamps (ignoring missing or invalid deltas safely)
  const turnaroundHoursSamples: number[] = [];
  let turnaroundExcludedCount = 0;
  for (const row of firstFormalDecisions) {
    const startMs = parseDbTimestampMs(row.submission_created_at);
    const decisionMs = parseDbTimestampMs(row.first_decision_at);
    if (startMs === null || decisionMs === null) {
      turnaroundExcludedCount += 1;
      continue;
    }
    const deltaHours = (decisionMs - startMs) / 3_600_000;
    if (!Number.isFinite(deltaHours) || deltaHours < 0 || deltaHours > 365 * 24) {
      turnaroundExcludedCount += 1;
      continue;
    }
    turnaroundHoursSamples.push(deltaHours);
  }
  turnaroundHoursSamples.sort((a, b) => a - b);

  let averageTurnaroundHours: number | null = null;
  let medianTurnaroundHours: number | null = null;
  if (turnaroundHoursSamples.length > 0) {
    const totalHrs = turnaroundHoursSamples.reduce((acc, v) => acc + v, 0);
    averageTurnaroundHours = round1(totalHrs / turnaroundHoursSamples.length);
    const mid = Math.floor(turnaroundHoursSamples.length / 2);
    const medianVal =
      turnaroundHoursSamples.length % 2 === 1
        ? turnaroundHoursSamples[mid]
        : (turnaroundHoursSamples[mid - 1] + turnaroundHoursSamples[mid]) / 2;
    medianTurnaroundHours = round1(medianVal);
  }

  const formalDecisionsCount = approvedDecisions + rejectedDecisions + changesRequestedDecisions;
  const decidedSubmissionsCount = submissions.filter(
    (s) => s.status === 'approved' || s.status === 'rejected'
  ).length;

  const reviewAnalytics: ReviewAnalyticsMetrics = {
    pendingReviewCount: awaitingReviewCount,
    decidedSubmissionsCount,
    formalDecisionsCount,
    approvedDecisions,
    rejectedDecisions,
    changesRequestedDecisions,
    commentsCount,
    reanalyzedEventsCount,
    approvalRate:
      formalDecisionsCount > 0 ? round1((approvedDecisions / formalDecisionsCount) * 100) : null,
    rejectionRate:
      formalDecisionsCount > 0 ? round1((rejectedDecisions / formalDecisionsCount) * 100) : null,
    changesRequestedRate:
      formalDecisionsCount > 0
        ? round1((changesRequestedDecisions / formalDecisionsCount) * 100)
        : null,
    averageTurnaroundHours,
    medianTurnaroundHours,
    turnaroundSampleSize: turnaroundHoursSamples.length,
    turnaroundExcludedCount,
    reviewActivitySeries: Array.from(reviewSeriesMap.values()).sort((a, b) =>
      a.bucketKey.localeCompare(b.bucketKey)
    ),
  };

  const teamActivity = isReviewerOrAdmin
    ? await getTeamAnalytics(user, {
        range: filters.range,
        startDate: filters.startDate,
        endDate: filters.endDate,
        brandId: filters.brandId,
        category: filters.category,
        status: filters.status,
      })
    : null;

  const insights = generateGroundedInsights({
    isReviewerOrAdmin,
    overview,
    recurring: allRecurring,
    issueBreakdown,
    reviewAnalytics,
  });

  const availableCategories = Array.from(new Set(issues.map((i) => i.category))).sort((a, b) =>
    a.localeCompare(b)
  );

  // Ensure subIds referenced for sanity (unused warning prevention)
  void subIds;

  const payload: GovernanceAnalyticsResponse = {
    scope,
    canViewTeamAnalytics: isReviewerOrAdmin,
    timezone: 'UTC',
    appliedFilters: {
      range: filters.range,
      startDate: filters.startDate,
      endDate: filters.endDate,
      brandId: filters.brandId,
      category: filters.category,
      status: filters.status,
      granularity: filters.granularity,
    },
    brands: brandsRows.map((b) => ({
      id: Number(b.id),
      name: b.name,
      primaryColor: b.primary_color,
      secondaryColor: b.secondary_color,
    })),
    availableCategories,
    overview,
    trends,
    recurringViolations,
    issueBreakdown,
    reviewAnalytics,
    teamActivity,
    insights,
    metricDefinitions: [
      {
        key: 'compliance_rate',
        label: 'Compliance Rate',
        formula: 'Fully Compliant Analyzed Submissions / Total Distinct Analyzed Submissions × 100',
        dataSource: 'submissions + compliance_issues',
      },
      {
        key: 'fully_compliant',
        label: 'Fully Compliant Submission',
        formula:
          'Analyzed submission (score present, not pending) with zero open violations and status not rejected or changes_requested.',
        dataSource: 'submissions + compliance_issues',
      },
      {
        key: 'recurring_violations',
        label: 'Recurring Violations',
        formula:
          'Violations grouped by normalized compliance rule, tracking total occurrences, distinct affected submissions, and period-over-period delta.',
        dataSource: 'compliance_issues',
      },
      {
        key: 'review_turnaround',
        label: 'Average & Median Turnaround',
        formula:
          'Hours elapsed between submission.created_at and earliest formal human decision (approved, rejected, or changes_requested). Missing or invalid timestamps are excluded.',
        dataSource: 'submissions + review_events',
      },
      {
        key: 'reanalysis_integrity',
        label: 'Re-analysis Anti-Double-Counting',
        formula:
          'Overview counts strictly track distinct submission records; historical re-analysis scans are tracked separately in analysis_runs.',
        dataSource: 'submissions + analysis_runs',
      },
    ],
  };

  setCachedAnalytics(cacheKey, payload);
  return payload;
}

export async function getRecurringViolationsAnalytics(
  user: AuthUser,
  rawFilters: AnalyticsFilterInput
): Promise<RecurringViolationsPage> {
  const filters = validateAnalyticsFilters(rawFilters);
  const isReviewerOrAdmin = user.role === 'reviewer' || user.role === 'admin';
  const cacheKey = `${user.companyId}:${user.role}:${user.id}:recurring:${JSON.stringify(filters)}`;
  const cached = getCachedAnalytics<RecurringViolationsPage>(cacheKey);
  if (cached) return cached;

  const [currentData, previousData] = await Promise.all([
    fetchPeriodSubmissionAndIssueState({
      companyId: user.companyId,
      userId: user.id,
      isReviewerOrAdmin,
      startIso: filters.startIso,
      endIso: filters.endIso,
      brandId: filters.brandId,
      category: filters.category,
      status: filters.status,
    }),
    filters.prevStartIso && filters.prevEndIso
      ? fetchPeriodSubmissionAndIssueState({
          companyId: user.companyId,
          userId: user.id,
          isReviewerOrAdmin,
          startIso: filters.prevStartIso,
          endIso: filters.prevEndIso,
          brandId: filters.brandId,
          category: filters.category,
          status: filters.status,
        })
      : Promise.resolve({
          submissions: [] as ScopedSubmissionRow[],
          issues: [] as ScopedIssueRow[],
          issueCountsBySub: new Map<number, { total: number; open: number }>(),
        }),
  ]);

  const allRecurring = buildRecurringViolationsList({
    currentIssues: currentData.issues,
    previousIssues: previousData.issues,
    hasPreviousPeriod: Boolean(filters.prevStartIso && filters.prevEndIso),
  });

  const total = allRecurring.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const safePage = Math.min(filters.page, totalPages);
  const offset = (safePage - 1) * filters.limit;

  const result: RecurringViolationsPage = {
    items: allRecurring.slice(offset, offset + filters.limit),
    pagination: {
      page: safePage,
      limit: filters.limit,
      total,
      totalPages,
    },
  };

  setCachedAnalytics(cacheKey, result);
  return result;
}

export async function getTeamAnalytics(
  user: AuthUser,
  rawFilters: AnalyticsFilterInput
): Promise<TeamAnalyticsResponse> {
  if (user.role !== 'reviewer' && user.role !== 'admin') {
    throw new AnalyticsValidationError('Team analytics are restricted to Reviewers and Admins.');
  }

  const filters = validateAnalyticsFilters(rawFilters);
  const cacheKey = `${user.companyId}:${user.role}:${user.id}:team:${JSON.stringify({
    range: filters.range,
    startIso: filters.startIso,
    endIso: filters.endIso,
    brandId: filters.brandId,
    category: filters.category,
    status: filters.status,
  })}`;
  const cached = getCachedAnalytics<TeamAnalyticsResponse>(cacheKey);
  if (cached) return cached;

  const subDateFilter = buildSqlDateRangeClause('s.created_at', filters.startIso, filters.endIso);
  const revDateFilter = buildSqlDateRangeClause('re.created_at', filters.startIso, filters.endIso);
  const catFilter = buildCategoryExistsClause(filters.category);

  const subWhere: string[] = ['s.company_id = ?'];
  const subArgs: unknown[] = [user.companyId];
  if (filters.brandId !== null) {
    subWhere.push('s.brand_id = ?');
    subArgs.push(filters.brandId);
  }
  if (filters.status !== null) {
    subWhere.push('s.status = ?');
    subArgs.push(filters.status);
  }

  const pendingWhere: string[] = [
    's.company_id = ?',
    "s.status IN ('analyzed', 'pending_review', 'revision_saved', 'changes_requested')",
  ];
  const pendingArgs: unknown[] = [user.companyId];
  if (filters.brandId !== null) {
    pendingWhere.push('s.brand_id = ?');
    pendingArgs.push(filters.brandId);
  }

  // Strictly safe non-PII columns (no email, no password_hash, no tokens)
  const [usersRows, createdRows, reviewRows, pendingRows] = await Promise.all([
    db.all<{ id: number; name: string; role: string; job_title: string | null }>(
      'SELECT id, name, role, job_title FROM users WHERE company_id = ? ORDER BY id ASC',
      user.companyId
    ),
    db.all<{ submitted_by: number; c: number | string }>(
      `SELECT s.submitted_by, CAST(COUNT(DISTINCT s.id) AS INTEGER) AS c
       FROM submissions s
       WHERE ${subWhere.join(' AND ')}${catFilter.clause}${subDateFilter.clause}
       GROUP BY s.submitted_by`,
      ...subArgs,
      ...catFilter.params,
      ...subDateFilter.params
    ),
    db.all<{
      reviewer_id: number;
      approved_cnt: number | string;
      rejected_cnt: number | string;
      changes_cnt: number | string;
      comment_cnt: number | string;
    }>(
      `SELECT re.reviewer_id,
              CAST(SUM(CASE WHEN re.decision = 'approved' THEN 1 ELSE 0 END) AS INTEGER) AS approved_cnt,
              CAST(SUM(CASE WHEN re.decision = 'rejected' THEN 1 ELSE 0 END) AS INTEGER) AS rejected_cnt,
              CAST(SUM(CASE WHEN re.decision = 'changes_requested' THEN 1 ELSE 0 END) AS INTEGER) AS changes_cnt,
              CAST(SUM(CASE WHEN re.decision = 'comment' THEN 1 ELSE 0 END) AS INTEGER) AS comment_cnt
       FROM review_events re
       JOIN submissions s ON s.id = re.submission_id AND s.company_id = re.company_id
       WHERE re.reviewer_id IS NOT NULL
         AND ${subWhere.join(' AND ')}${catFilter.clause}${revDateFilter.clause}
       GROUP BY re.reviewer_id`,
      ...subArgs,
      ...catFilter.params,
      ...revDateFilter.params
    ),
    db.all<{ submitted_by: number; c: number | string }>(
      `SELECT s.submitted_by, CAST(COUNT(*) AS INTEGER) AS c
       FROM submissions s
       WHERE ${pendingWhere.join(' AND ')}${catFilter.clause}
       GROUP BY s.submitted_by`,
      ...pendingArgs,
      ...catFilter.params
    ),
  ]);

  const createdMap = new Map<number, number>();
  for (const r of createdRows) {
    createdMap.set(Number(r.submitted_by), Number(r.c || 0));
  }

  const reviewMap = new Map<
    number,
    { approved: number; rejected: number; changesRequested: number; comments: number }
  >();
  for (const r of reviewRows) {
    reviewMap.set(Number(r.reviewer_id), {
      approved: Number(r.approved_cnt || 0),
      rejected: Number(r.rejected_cnt || 0),
      changesRequested: Number(r.changes_cnt || 0),
      comments: Number(r.comment_cnt || 0),
    });
  }

  const pendingByAuthor = new Map<number, number>();
  let totalPendingQueue = 0;
  for (const r of pendingRows) {
    const cnt = Number(r.c || 0);
    pendingByAuthor.set(Number(r.submitted_by), cnt);
    totalPendingQueue += cnt;
  }

  let totalSubmissionsCreated = 0;
  let totalReviewsCompleted = 0;
  let activeContributors = 0;
  let activeReviewers = 0;

  const members: TeamMemberActivityItem[] = usersRows.map((u) => {
    const uid = Number(u.id);
    const submissionsCreated = createdMap.get(uid) || 0;
    const rev = reviewMap.get(uid) || { approved: 0, rejected: 0, changesRequested: 0, comments: 0 };
    const reviewsCompleted = rev.approved + rev.rejected + rev.changesRequested;
    const isReviewer = u.role === 'reviewer' || u.role === 'admin';
    const outstandingWorkload = isReviewer ? totalPendingQueue : pendingByAuthor.get(uid) || 0;

    if (submissionsCreated > 0) activeContributors += 1;
    if (reviewsCompleted > 0 || rev.comments > 0) activeReviewers += 1;
    totalSubmissionsCreated += submissionsCreated;
    totalReviewsCompleted += reviewsCompleted;

    return {
      userId: uid,
      name: u.name,
      role: u.role,
      jobTitle: String(u.job_title || ''),
      submissionsCreated,
      reviewsCompleted,
      approvedCount: rev.approved,
      rejectedCount: rev.rejected,
      changesRequestedCount: rev.changesRequested,
      commentsCount: rev.comments,
      outstandingWorkload,
    };
  });

  members.sort((a, b) => {
    const scoreA = a.reviewsCompleted * 2 + a.submissionsCreated + a.commentsCount;
    const scoreB = b.reviewsCompleted * 2 + b.submissionsCreated + b.commentsCount;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.name.localeCompare(b.name);
  });

  const response: TeamAnalyticsResponse = {
    scope: 'organization',
    period: {
      range: filters.range,
      startDate: filters.startDate,
      endDate: filters.endDate,
    },
    summary: {
      activeContributors,
      activeReviewers,
      totalSubmissionsCreated,
      totalReviewsCompleted,
      pendingQueueSize: totalPendingQueue,
    },
    members,
  };

  setCachedAnalytics(cacheKey, response);
  return response;
}
