import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileCheck2,
  Filter,
  Info,
  Layers,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../api';
import type {
  AnalyticsQueryParams,
  AnalyticsRange,
  AnalyticsRecurringViolationsPage,
  GovernanceAnalyticsResponse,
  GovernanceInsightItem,
  PageKey,
} from '../types';
import { formatUserRoleLabel } from '../utils/roles';
import { EmptyState, LoadingPanel } from '../components/ClayUI';
import {
  ComplianceTrendsChart,
  IssueCategoryBars,
  ReviewActivityChart,
} from '../components/AnalyticsCharts';

const RANGE_OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '12m', label: '12M' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

const CATEGORY_FILTER_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'Visual Identity', label: 'Visual Identity' },
  { value: 'Text', label: 'All Text Categories' },
  { value: 'Terminology', label: 'Terminology' },
  { value: 'Brand Tone', label: 'Brand Tone' },
  { value: 'Brand Messaging', label: 'Brand Messaging' },
  { value: 'Facts', label: 'Facts' },
  { value: 'Promotional Claims', label: 'Promotional Claims' },
  { value: 'Accessibility', label: 'Accessibility' },
  { value: 'Governance', label: 'Governance' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'analyzed', label: 'Analyzed' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'revision_saved', label: 'Revision Saved' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function formatHoursDisplay(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '—';
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} min`;
  }
  return `${hours} hrs`;
}

function getInsightColors(severity: GovernanceInsightItem['severity']) {
  if (severity === 'critical') {
    return {
      border: 'border-rose-300/80 dark:border-rose-400/35',
      iconBg: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
      Icon: AlertTriangle,
    };
  }
  if (severity === 'warning') {
    return {
      border: 'border-amber-300/80 dark:border-amber-400/35',
      iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
      Icon: AlertCircle,
    };
  }
  if (severity === 'positive') {
    return {
      border: 'border-emerald-300/80 dark:border-emerald-400/35',
      iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
      Icon: CheckCircle2,
    };
  }
  return {
    border: 'border-indigo-200/80 dark:border-violet-400/30',
    iconBg: 'bg-indigo-100 text-indigo-700 dark:bg-violet-500/20 dark:text-violet-300',
    Icon: Sparkles,
  };
}

export function AnalyticsPage({
  userRole,
  onNavigate,
  onSelectBrand,
  onSelectSubmission,
}: {
  userRole: string;
  onNavigate: (page: PageKey) => void;
  onSelectBrand: (brandId: number) => void;
  onSelectSubmission: (submissionId: number, page: PageKey) => void;
}) {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [brandId, setBrandId] = useState<number | null>(null);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [recurringPage, setRecurringPage] = useState(1);

  const [data, setData] = useState<GovernanceAnalyticsResponse | null>(null);
  const [recurringOverride, setRecurringOverride] = useState<AnalyticsRecurringViolationsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pagingRecurring, setPagingRecurring] = useState(false);
  const [error, setError] = useState('');
  const [filterValidationError, setFilterValidationError] = useState('');
  const [showDefinitions, setShowDefinitions] = useState(false);

  const requestSeqRef = useRef(0);

  const buildQueryParams = useCallback(
    (pageOverride?: number): AnalyticsQueryParams | null => {
      if (range === 'custom') {
        if (!customStart || !customEnd) {
          setFilterValidationError('Select both start and end dates for a custom range.');
          return null;
        }
        if (customStart > customEnd) {
          setFilterValidationError('Start date must be earlier than or equal to end date.');
          return null;
        }
      }
      setFilterValidationError('');
      return {
        range,
        startDate: range === 'custom' ? customStart : undefined,
        endDate: range === 'custom' ? customEnd : undefined,
        brandId,
        category: category || null,
        status: status || null,
        page: pageOverride ?? 1,
        limit: 8,
      };
    },
    [range, customStart, customEnd, brandId, category, status]
  );

  const loadAnalytics = useCallback(
    async (isInitial = false) => {
      const params = buildQueryParams(1);
      if (!params) return;

      const seq = ++requestSeqRef.current;
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      setError('');

      try {
        const res = await api.getGovernanceAnalytics(params);
        if (seq !== requestSeqRef.current) return;
        setData(res);
        setRecurringOverride(null);
        setRecurringPage(1);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'Unable to load governance analytics.');
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [buildQueryParams]
  );

  useEffect(() => {
    void loadAnalytics(!data);
  }, [loadAnalytics]);

  async function handleChangeRecurringPage(nextPage: number) {
    const params = buildQueryParams(nextPage);
    if (!params) return;
    setPagingRecurring(true);
    try {
      const pageData = await api.getRecurringViolations(params);
      setRecurringOverride(pageData);
      setRecurringPage(pageData.pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recurring violations page.');
    } finally {
      setPagingRecurring(false);
    }
  }

  function handleResetFilters() {
    setRange('30d');
    setCustomStart('');
    setCustomEnd('');
    setBrandId(null);
    setCategory('');
    setStatus('');
    setRecurringPage(1);
    setFilterValidationError('');
  }

  function handleInsightNavigate(insight: GovernanceInsightItem) {
    if (insight.targetBrandId) {
      onSelectBrand(insight.targetBrandId);
    }
    if (insight.targetSubmissionId && (insight.targetPage === 'analysis' || insight.targetPage === 'corrections' || insight.targetPage === 'review')) {
      onSelectSubmission(insight.targetSubmissionId, insight.targetPage);
      return;
    }
    if (insight.targetPage) {
      if (insight.targetPage === 'review' && userRole !== 'reviewer' && userRole !== 'admin') {
        onNavigate('history');
        return;
      }
      onNavigate(insight.targetPage);
    }
  }

  if (loading && !data) {
    return <LoadingPanel label="Aggregating compliance trends, violations, and review telemetry..." />;
  }

  if (error && !data) {
    return (
      <div className="clay-surface rounded-3xl p-8 text-center space-y-4">
        <p className="text-sm font-semibold text-red-600 dark:text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => void loadAnalytics(true)}
          className="clay-btn-primary rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const recurring = recurringOverride ?? data.recurringViolations;
  const { overview, issueBreakdown, reviewAnalytics } = data;
  const hasActiveNarrowingFilters =
    range !== '30d' || brandId !== null || Boolean(category) || Boolean(status);
  const isWorkspaceEmpty = overview.totalSubmissions === 0 && !hasActiveNarrowingFilters;
  const isFilteredEmpty = overview.totalSubmissions === 0 && hasActiveNarrowingFilters;

  const complianceRateDisplay =
    overview.complianceRate !== null ? `${overview.complianceRate}%` : '—';
  const deltaSign =
    overview.complianceRateDelta !== null && overview.complianceRateDelta > 0 ? '+' : '';
  const rateDeltaText =
    overview.complianceRateDelta !== null
      ? `${deltaSign}${overview.complianceRateDelta} pts vs prev period`
      : 'No prior period comparison';

  return (
    <div className="space-y-6">
      {/* Page Header & Scope */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300">
              <BarChart3 className="w-4 h-4" />
              {data.scope === 'organization' ? 'Organization Governance Scope' : 'Personal Submissions Scope'}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">·</span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              UTC Timeline Buckets · {formatUserRoleLabel(userRole)} View
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Governance Analytics Dashboard
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-3xl">
            Track compliance rates, recurring guideline violations, visual versus textual risk distribution, review turnaround performance, and actionable governance recommendations from live persisted audits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowDefinitions((prev) => !prev)}
            className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Info className="w-3.5 h-3.5" />
            {showDefinitions ? 'Hide Definitions' : 'Metric Definitions'}
          </button>
          <button
            type="button"
            onClick={() => void loadAnalytics(false)}
            disabled={refreshing}
            className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </section>

      {/* Collapsible Metric Definitions Reference */}
      {showDefinitions && (
        <section className="clay-surface rounded-[26px] p-5 sm:p-6 space-y-3 border border-indigo-200/70 dark:border-violet-400/25">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Transparent Metric Formulas &amp; Data Sources
            </h3>
            <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
              Aggregated in {data.timezone}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.metricDefinitions.map((def) => (
              <div key={def.key} className="clay-well rounded-2xl p-3.5 space-y-1">
                <p className="text-xs font-bold text-slate-900 dark:text-white">{def.label}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{def.formula}</p>
                <p className="text-[11px] font-mono-tabular text-indigo-600 dark:text-violet-300">
                  Source: {def.dataSource}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter Bar */}
      <section className="clay-surface rounded-[26px] p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Filter className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
            <span>Filters</span>
            {refreshing && (
              <span className="text-[11px] font-medium text-indigo-600 dark:text-violet-300">
                Updating metrics...
              </span>
            )}
          </div>

          <div className="clay-well inline-flex flex-wrap items-center gap-1 rounded-full p-1">
            {RANGE_OPTIONS.map((opt) => {
              const active = range === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setRange(opt.value);
                    if (opt.value === 'custom' && (!customStart || !customEnd)) {
                      const today = new Date().toISOString().slice(0, 10);
                      const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
                      if (!customStart) setCustomStart(weekAgo);
                      if (!customEnd) setCustomEnd(today);
                    }
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm dark:bg-violet-500'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="analytics-brand-filter" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Brand Profile
            </label>
            <select
              id="analytics-brand-filter"
              value={brandId ?? ''}
              onChange={(e) => setBrandId(e.target.value ? Number(e.target.value) : null)}
              className="clay-well w-full rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              <option value="">All Brands ({data.brands.length})</option>
              {data.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="analytics-category-filter" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Compliance Category
            </label>
            <select
              id="analytics-category-filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="clay-well w-full rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              {CATEGORY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="analytics-status-filter" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              Review Status
            </label>
            <select
              id="analytics-status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="clay-well w-full rounded-2xl px-3.5 py-2.5 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            {range === 'custom' ? (
              <div className="grid grid-cols-2 gap-2 w-full">
                <div>
                  <label htmlFor="analytics-start-date" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    From (UTC)
                  </label>
                  <input
                    id="analytics-start-date"
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="clay-well w-full rounded-2xl px-2.5 py-2 text-xs font-mono-tabular text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="analytics-end-date" className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                    To (UTC)
                  </label>
                  <input
                    id="analytics-end-date"
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="clay-well w-full rounded-2xl px-2.5 py-2 text-xs font-mono-tabular text-slate-800 dark:text-slate-100 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleResetFilters}
                disabled={!hasActiveNarrowingFilters}
                className="clay-btn-secondary w-full rounded-2xl px-4 py-2.5 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {(filterValidationError || error) && (
          <div
            role="alert"
            className="rounded-2xl px-4 py-2.5 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
          >
            {filterValidationError || error}
          </div>
        )}
      </section>

      {isWorkspaceEmpty ? (
        <EmptyState
          title="No compliance analytics available yet"
          description="Submit copy, documents, or visual assets for brand compliance auditing. All Governance Analytics metrics, trends, and insights will populate automatically from real persisted scans."
          actionLabel="Submit Content for Audit"
          onAction={() => onNavigate('submit')}
        />
      ) : (
        <>
          {isFilteredEmpty && (
            <section className="clay-surface rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-amber-200/80 dark:border-amber-400/25">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  No submissions matched the active filter criteria
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                  Try broadening your date range, brand profile, category, or status filter.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetFilters}
                className="clay-btn-primary rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Reset Filters
              </button>
            </section>
          )}

          {/* Section A: Compliance Overview */}
          <section aria-label="Compliance Overview" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <div className="clay-surface rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Compliance Rate
                </p>
                <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {complianceRateDisplay}
              </p>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {rateDeltaText}
                {overview.averageComplianceScore !== null
                  ? ` · Avg score ${overview.averageComplianceScore}`
                  : ''}
              </p>
            </div>

            <div className="clay-surface rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Submissions Analyzed
                </p>
                <FileCheck2 className="w-4 h-4 text-sky-600 dark:text-sky-300" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {overview.analyzedSubmissions}
              </p>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {overview.totalSubmissions} distinct total · {overview.reanalysisRunsCount} re-analyses
              </p>
            </div>

            <div className="clay-surface rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Compliant vs Corrections
                </p>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {overview.fullyCompliantSubmissions}{' '}
                <span className="text-lg font-bold text-slate-400 dark:text-slate-500">
                  / {overview.submissionsRequiringCorrections}
                </span>
              </p>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                Compliant / needing fixes
              </p>
            </div>

            <div className="clay-surface rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Review Outcomes
                </p>
                <Clock className="w-4 h-4 text-amber-600 dark:text-amber-300" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {overview.awaitingReviewCount}
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1.5">
                  awaiting
                </span>
              </p>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {overview.approvedCount} approved · {overview.rejectedCount} rejected
              </p>
            </div>

            <div className="clay-surface rounded-3xl p-5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Open Violations
                </p>
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-300" />
              </div>
              <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {overview.openViolationsCount}
              </p>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {overview.resolvedViolationsCount} resolved · {overview.totalViolationsCount} total
              </p>
            </div>
          </section>

          {/* Section B: Compliance Trends + Actionable Insights Split */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            <section className="xl:col-span-8 clay-surface rounded-[28px] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Compliance Trends Over Time
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Continuous {data.appliedFilters.granularity}ly aggregation across distinct submissions, violations, and review decisions.
                  </p>
                </div>
                {data.appliedFilters.startDate && data.appliedFilters.endDate && (
                  <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                    {data.appliedFilters.startDate} → {data.appliedFilters.endDate} (UTC)
                  </span>
                )}
              </div>

              <ComplianceTrendsChart trends={data.trends} />
            </section>

            {/* Actionable Governance Insights */}
            <section className="xl:col-span-4 clay-surface rounded-[28px] p-6 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Actionable Insights
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Recommendations derived directly from aggregated violations and review performance.
                </p>
              </div>

              {data.insights.length === 0 ? (
                <div className="clay-well rounded-2xl p-6 text-center space-y-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    No recurring risk patterns triggered for this selection.
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Insights appear automatically once repeated violations, visual hotspots, or review queue bottlenecks occur.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.insights.map((insight) => {
                    const style = getInsightColors(insight.severity);
                    const Icon = style.Icon;
                    return (
                      <div
                        key={insight.id}
                        className={`clay-well rounded-2xl p-4 border space-y-2 ${style.border}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${style.iconBg}`}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                              {insight.title}
                            </h4>
                            <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                              {insight.supportingData}
                            </p>
                          </div>
                        </div>

                        <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                          {insight.observation}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          <strong className="text-slate-700 dark:text-slate-200">Action:</strong>{' '}
                          {insight.suggestedAction}
                        </p>

                        {insight.targetPage && (
                          <button
                            type="button"
                            onClick={() => handleInsightNavigate(insight)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-violet-300 hover:underline cursor-pointer"
                          >
                            Open {insight.targetPage === 'guidelines' ? 'Brand Guidelines' : insight.targetPage === 'review' ? 'Review Queue' : insight.targetPage === 'corrections' ? 'Corrections' : insight.targetPage === 'analysis' ? 'Analysis' : 'History'}
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Section C: Recurring Violations */}
          <section className="clay-surface rounded-[28px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Recurring Brand Guideline Violations
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Normalized rules ranked by occurrence frequency, affected submission count, and period-over-period change.
                </p>
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-slate-500 dark:text-slate-400">
                {recurring.pagination.total} distinct rule{recurring.pagination.total === 1 ? '' : 's'}
              </span>
            </div>

            {recurring.items.length === 0 ? (
              <div className="clay-well rounded-2xl p-8 text-center">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Zero guideline violations recorded for the active filter scope.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[760px]">
                    <thead>
                      <tr className="border-b border-slate-200/80 dark:border-violet-400/20 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <th className="py-3 pr-4">Normalized Rule</th>
                        <th className="py-3 px-3">Category</th>
                        <th className="py-3 px-3 text-right">Occurrences</th>
                        <th className="py-3 px-3 text-right">Affected Audits</th>
                        <th className="py-3 px-3">Open / Resolved</th>
                        <th className="py-3 px-3">Severity (C/H/M/L)</th>
                        <th className="py-3 px-3 text-right">Period Change</th>
                        <th className="py-3 pl-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-violet-400/10 text-xs">
                      {recurring.items.map((item) => {
                        const delta = item.deltaOccurrences;
                        const deltaDisplay =
                          delta === null
                            ? '—'
                            : delta > 0
                              ? `+${delta}${item.changePct !== null ? ` (+${item.changePct}%)` : ''}`
                              : delta < 0
                                ? `${delta}${item.changePct !== null ? ` (${item.changePct}%)` : ''}`
                                : '0';
                        return (
                          <tr
                            key={item.ruleKey}
                            className="hover:bg-indigo-50/40 dark:hover:bg-violet-500/10 transition-colors"
                          >
                            <td className="py-3.5 pr-4 font-bold text-slate-900 dark:text-white max-w-xs">
                              <p className="truncate" title={item.ruleName}>
                                {item.ruleName}
                              </p>
                              {item.latestBrandName && (
                                <p className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate">
                                  Latest: {item.latestBrandName}
                                </p>
                              )}
                            </td>
                            <td className="py-3.5 px-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {item.category}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-tabular font-bold text-slate-900 dark:text-white">
                              {item.occurrences}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-200">
                              {item.affectedSubmissions}
                            </td>
                            <td className="py-3.5 px-3 font-mono-tabular whitespace-nowrap text-slate-700 dark:text-slate-200">
                              <span className={item.openOccurrences > 0 ? 'font-bold text-rose-600 dark:text-rose-300' : ''}>
                                {item.openOccurrences} open
                              </span>{' '}
                              / {item.resolvedOccurrences} res
                            </td>
                            <td className="py-3.5 px-3 font-mono-tabular whitespace-nowrap text-slate-700 dark:text-slate-200">
                              {item.severityDistribution.critical}/{item.severityDistribution.high}/
                              {item.severityDistribution.medium}/{item.severityDistribution.low}
                            </td>
                            <td
                              className={`py-3.5 px-3 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                                delta !== null && delta > 0
                                  ? 'text-rose-600 dark:text-rose-300'
                                  : delta !== null && delta < 0
                                    ? 'text-emerald-600 dark:text-emerald-300'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {deltaDisplay}
                            </td>
                            <td className="py-3.5 pl-3 text-right whitespace-nowrap">
                              {item.latestSubmissionId ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectSubmission(item.latestSubmissionId!, 'analysis')}
                                  className="clay-btn-secondary rounded-full px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  Audit
                                </button>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {recurring.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 dark:border-violet-400/15 text-xs">
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                      Page {recurringPage} of {recurring.pagination.totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pagingRecurring || recurringPage <= 1}
                        onClick={() => void handleChangeRecurringPage(recurringPage - 1)}
                        className="clay-btn-secondary rounded-full px-3 py-1.5 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={pagingRecurring || recurringPage >= recurring.pagination.totalPages}
                        onClick={() => void handleChangeRecurringPage(recurringPage + 1)}
                        className="clay-btn-secondary rounded-full px-3 py-1.5 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Section D: Visual vs Textual Issue Breakdown */}
          <section className="clay-surface rounded-[28px] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Text vs. Visual Identity Issue Breakdown
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Distribution across textual brand compliance categories and Visual Brand Detection sub-checks.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono-tabular text-slate-700 dark:text-slate-200">
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  Text: <strong>{issueBreakdown.textViolations}</strong> (
                  {issueBreakdown.textSharePct !== null ? `${issueBreakdown.textSharePct}%` : '—'})
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-violet-500" />
                  Visual: <strong>{issueBreakdown.visualViolations}</strong> (
                  {issueBreakdown.visualSharePct !== null ? `${issueBreakdown.visualSharePct}%` : '—'})
                </span>
              </div>
            </div>

            {issueBreakdown.totalViolations > 0 && (
              <div className="clay-well rounded-full h-3.5 p-0.5 flex overflow-hidden">
                <div
                  className="h-full rounded-l-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all"
                  style={{ width: `${issueBreakdown.textSharePct ?? 0}%` }}
                  title={`Text violations: ${issueBreakdown.textViolations}`}
                />
                <div
                  className="h-full rounded-r-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                  style={{ width: `${issueBreakdown.visualSharePct ?? 0}%` }}
                  title={`Visual Identity violations: ${issueBreakdown.visualViolations}`}
                />
              </div>
            )}

            <IssueCategoryBars
              categories={issueBreakdown.categoryBreakdown}
              visualSubChecks={issueBreakdown.visualSubCheckBreakdown}
            />
          </section>

          {/* Section E: Review & Approval Performance */}
          <section className="clay-surface rounded-[28px] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Review &amp; Approval Performance
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Turnaround times, human decision ratios, and review volume from persisted submission and audit event timestamps.
                </p>
              </div>
              {reviewAnalytics.turnaroundExcludedCount > 0 && (
                <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                  {reviewAnalytics.turnaroundExcludedCount} incomplete timestamp pair
                  {reviewAnalytics.turnaroundExcludedCount === 1 ? '' : 's'} excluded from turnaround
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="clay-well rounded-2xl p-4 space-y-1">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Average Turnaround
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {formatHoursDisplay(reviewAnalytics.averageTurnaroundHours)}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Median: {formatHoursDisplay(reviewAnalytics.medianTurnaroundHours)} ({reviewAnalytics.turnaroundSampleSize} samples)
                </p>
              </div>

              <div className="clay-well rounded-2xl p-4 space-y-1">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Approval Rate
                </p>
                <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {reviewAnalytics.approvalRate !== null ? `${reviewAnalytics.approvalRate}%` : '—'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {reviewAnalytics.approvedDecisions} of {reviewAnalytics.formalDecisionsCount} formal decisions
                </p>
              </div>

              <div className="clay-well rounded-2xl p-4 space-y-1">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Rejection &amp; Revision Rate
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {reviewAnalytics.rejectionRate !== null ? `${reviewAnalytics.rejectionRate}%` : '—'}
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-300 ml-2">
                    ({reviewAnalytics.changesRequestedRate !== null
                      ? `${reviewAnalytics.changesRequestedRate}% req`
                      : '—'})
                  </span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {reviewAnalytics.rejectedDecisions} rejected · {reviewAnalytics.changesRequestedDecisions} changes req
                </p>
              </div>

              <div className="clay-well rounded-2xl p-4 space-y-1">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Pending Queue &amp; Collaboration
                </p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  {reviewAnalytics.pendingReviewCount}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {reviewAnalytics.commentsCount} review comments · {reviewAnalytics.reanalyzedEventsCount} re-scans
                </p>
              </div>
            </div>

            <ReviewActivityChart series={reviewAnalytics.reviewActivitySeries} />
          </section>

          {/* Section F: Team Activity (RBAC-Gated: Reviewer/Admin Only) */}
          {data.canViewTeamAnalytics && data.teamActivity && (
            <section className="clay-surface rounded-[28px] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      Team Review Activity
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Contributor submissions, reviewer decisions, and active queue workload across your organization.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular text-slate-700 dark:text-slate-200">
                  <span>
                    Contributors: <strong>{data.teamActivity.summary.activeContributors}</strong>
                  </span>
                  <span>
                    Active Reviewers: <strong>{data.teamActivity.summary.activeReviewers}</strong>
                  </span>
                  <span>
                    Reviews Completed: <strong>{data.teamActivity.summary.totalReviewsCompleted}</strong>
                  </span>
                  <span>
                    Pending Queue: <strong>{data.teamActivity.summary.pendingQueueSize}</strong>
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[680px]">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-violet-400/20 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <th className="py-3 pr-4">Team Member</th>
                      <th className="py-3 px-3">Role</th>
                      <th className="py-3 px-3 text-right">Submissions Created</th>
                      <th className="py-3 px-3 text-right">Reviews Completed</th>
                      <th className="py-3 px-3 text-right">App / Chg / Rej</th>
                      <th className="py-3 px-3 text-right">Comments</th>
                      <th className="py-3 pl-3 text-right">Pending Workload</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-violet-400/10 text-xs">
                    {data.teamActivity.members.map((member) => (
                      <tr key={member.userId}>
                        <td className="py-3 pr-4">
                          <p className="font-bold text-slate-900 dark:text-white">{member.name}</p>
                          {member.jobTitle && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {member.jobTitle}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-700 dark:text-slate-200 whitespace-nowrap">
                          {formatUserRoleLabel(member.role)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {member.submissionsCreated}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {member.reviewsCompleted}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-200">
                          {member.approvedCount} / {member.changesRequestedCount} / {member.rejectedCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono-tabular text-slate-700 dark:text-slate-200">
                          {member.commentsCount}
                        </td>
                        <td className="py-3 pl-3 text-right font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {member.outstandingWorkload}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
