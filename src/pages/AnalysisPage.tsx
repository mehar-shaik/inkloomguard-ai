import React, { useEffect, useState } from 'react';
import { ArrowRight, FileSearch, ShieldAlert, Image as ImageIcon, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import type { CheckAreaSummary, ComplianceIssue, ImageMetrics, PageKey, Submission } from '../types';
import { EmptyState, LoadingPanel, ProtectedImage, SeverityBadge, StatusBadge } from '../components/ClayUI';
import { formatDateTime } from '../utils/date';

export function AnalysisPage({
  selectedSubmissionId,
  onSelectSubmission,
  onNavigate,
}: {
  selectedSubmissionId: number | null;
  onSelectSubmission: (id: number) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [issues, setIssues] = useState<ComplianceIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeNotice, setReanalyzeNotice] = useState('');
  const [reanalyzeError, setReanalyzeError] = useState('');
  const [error, setError] = useState('');

  async function load(targetId?: number | null) {
    setLoading(true);
    setError('');
    try {
      const listRes = await api.getSubmissions();
      const validSubs = listRes.submissions.filter(
        (s): s is Submission => Boolean(s && typeof s.id === 'number')
      );
      setSubmissions(validSubs);

      const idToLoad =
        targetId && validSubs.some((s) => s.id === targetId)
          ? targetId
          : validSubs[0]?.id ?? null;

      if (idToLoad) {
        if (idToLoad !== selectedSubmissionId) {
          onSelectSubmission(idToLoad);
        }
        const detail = await api.getSubmissionDetail(idToLoad);
        setSubmission(detail.submission);
        setIssues(detail.issues);
      } else {
        setSubmission(null);
        setIssues([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analysis results.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(selectedSubmissionId);
  }, [selectedSubmissionId]);

  async function handleReanalyze() {
    if (!submission || reanalyzing) return;
    setReanalyzing(true);
    setReanalyzeNotice('');
    setReanalyzeError('');
    try {
      const res = await api.reanalyzeSubmission(submission.id);
      setSubmission(res.submission);
      setIssues(res.issues);
      setSubmissions((prev) =>
        prev.map((s) => (s.id === res.submission.id ? { ...s, ...res.submission } : s))
      );
      if (res.aiError) {
        setReanalyzeError(res.aiError);
      } else {
        setReanalyzeNotice('Compliance analysis refreshed across all active brand rules.');
      }
    } catch (err) {
      setReanalyzeError(err instanceof Error ? err.message : 'Failed to re-run compliance analysis.');
    } finally {
      setReanalyzing(false);
    }
  }

  if (loading) return <LoadingPanel label="Loading 8-area compliance report..." />;

  if (error) {
    return (
      <div className="clay-surface rounded-3xl p-8 text-center space-y-4">
        <p className="text-sm font-semibold text-red-600 dark:text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => load(selectedSubmissionId)}
          className="clay-btn-primary rounded-full px-5 py-2 text-sm font-semibold cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!submission) {
    return (
      <EmptyState
        title="No analyzed submissions yet"
        description="Submit marketing copy, a PDF/DOCX document, or a visual asset to view eight-area brand compliance results."
        actionLabel="Submit Content"
        onAction={() => onNavigate('submit')}
      />
    );
  }

  let checks: CheckAreaSummary[] = [];
  try {
    checks = JSON.parse(submission.checks_summary_json || '[]');
  } catch {
    checks = [];
  }

  let imageMetrics: ImageMetrics | null = null;
  try {
    imageMetrics = submission.image_metrics_json ? JSON.parse(submission.image_metrics_json) : null;
  } catch {
    imageMetrics = null;
  }

  const aiStatus = submission.ai_status || 'completed';
  const showAiBanner = aiStatus === 'partial' || aiStatus === 'failed' || Boolean(submission.ai_error);

  return (
    <div className="space-y-6">
      {/* Submission Picker & Header */}
      <section className="clay-surface rounded-[28px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{submission.title}</h2>
            <StatusBadge status={submission.status} />
            {typeof submission.compliance_score === 'number' && (
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold font-mono-tabular bg-indigo-50 text-indigo-800 border border-indigo-200/80 dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-400/35">
                Score: {submission.compliance_score}/100
              </span>
            )}
            {typeof submission.analysis_coverage === 'number' && (
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold font-mono-tabular bg-slate-100 text-slate-700 border border-slate-200/80 dark:bg-slate-800/70 dark:text-slate-200 dark:border-slate-700">
                Coverage: {submission.analysis_coverage}%
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Brand: <strong className="text-slate-700 dark:text-slate-200">{submission.brand_name}</strong> · Input:{' '}
            {submission.input_type} · Submitted {formatDateTime(submission.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={submission.id}
            onChange={(e) => load(Number(e.target.value))}
            aria-label="Select submission"
            className="clay-well rounded-full px-4 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
          >
            {submissions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} · {s.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={reanalyzing}
            onClick={handleReanalyze}
            className="clay-btn-secondary rounded-full px-4 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
            {reanalyzing ? 'Analyzing...' : 'Re-run Analysis'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('corrections')}
            className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            Open Corrections
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {reanalyzeNotice && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30">
          {reanalyzeNotice}
        </div>
      )}

      {reanalyzeError && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30">
          {reanalyzeError}
        </div>
      )}

      {showAiBanner && (
        <section
          role="status"
          className={`rounded-[24px] p-4 sm:p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
            aiStatus === 'failed'
              ? 'bg-red-50/90 text-red-900 border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30'
              : 'bg-amber-50/90 text-amber-900 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider">
                  {aiStatus === 'failed' ? 'AI Compliance Evaluation Failed' : 'Partial Compliance Evaluation'}
                </span>
                <StatusBadge status={aiStatus} />
              </div>
              <p className="text-xs leading-relaxed">
                {submission.ai_error ||
                  'AI tone and messaging evaluation could not be completed. Deterministic terminology, fact, and accessibility checks remain available.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={reanalyzing}
            onClick={handleReanalyze}
            className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reanalyzing ? 'animate-spin' : ''}`} />
            {reanalyzing ? 'Retrying...' : 'Retry AI Analysis'}
          </button>
        </section>
      )}

      {/* 8-Area Compliance Grid */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
              Eight-Area Brand Compliance Audit
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unrun checks are explicitly reported as Not Performed rather than falsely marked Passed.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {checks.map((c) => (
            <div key={c.area} className="clay-well rounded-2xl p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{c.area}</h4>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{c.summary}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Visual Asset Inspection (only if an image was uploaded) */}
      {submission.image_filename && imageMetrics && (
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-4 clay-well rounded-2xl p-3 flex items-center justify-center">
            <ProtectedImage
              filename={submission.image_filename}
              alt={submission.image_alt_text || 'Submitted visual asset'}
              className="max-h-52 rounded-xl object-contain"
            />
          </div>
          <div className="md:col-span-8 space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              Visual Asset Pixel & Color Telemetry
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="clay-well rounded-xl p-3">
                <p className="text-slate-500 dark:text-slate-400">Dimensions</p>
                <p className="font-mono-tabular font-bold text-slate-900 dark:text-white mt-0.5">
                  {imageMetrics.width} × {imageMetrics.height}
                </p>
              </div>
              <div className="clay-well rounded-xl p-3">
                <p className="text-slate-500 dark:text-slate-400">
                  {typeof imageMetrics.wcagContrastRatio === 'number' ? 'WCAG Contrast' : 'Luminance Spread'}
                </p>
                <p className="font-mono-tabular font-bold text-slate-900 dark:text-white mt-0.5">
                  {typeof imageMetrics.wcagContrastRatio === 'number'
                    ? `${imageMetrics.wcagContrastRatio}:1 (${imageMetrics.wcagAA ? 'AA' : imageMetrics.wcagAALarge ? 'AA Large' : 'Low'})`
                    : `${imageMetrics.contrastSpread}:1`}
                </p>
              </div>
              <div className="clay-well rounded-xl p-3">
                <p className="text-slate-500 dark:text-slate-400">Brand Delta-E</p>
                <p className="font-mono-tabular font-bold text-slate-900 dark:text-white mt-0.5">
                  {imageMetrics.brandPrimaryMatchDistance ?? 'N/A'}
                </p>
              </div>
              <div className="clay-well rounded-xl p-3">
                <p className="text-slate-500 dark:text-slate-400">Alt Text</p>
                <p className="font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                  {submission.image_alt_text || '(Missing)'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">
                Measured Palette:
              </span>
              {imageMetrics.dominantColors.map((hex) => (
                <span
                  key={hex}
                  className="inline-flex items-center gap-1.5 clay-well rounded-full px-2.5 py-1 font-mono-tabular text-[11px] font-semibold"
                >
                  <span className="w-3 h-3 rounded-full border border-white/60" style={{ backgroundColor: hex }} />
                  {hex}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Detected Issues with Verbatim Evidence */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600 dark:text-rose-300" />
            Detected Compliance Issues ({issues.length})
          </h3>
          <button
            type="button"
            onClick={() => onNavigate('review')}
            className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            Proceed to Human Review
          </button>
        </div>

        {issues.length === 0 ? (
          <div className="clay-well rounded-2xl p-6 text-center text-sm text-emerald-700 dark:text-emerald-300 font-semibold">
            Zero compliance issues detected across the checked rules. Proceed to Human Review to record final approval.
          </div>
        ) : (
          <div className="space-y-4">
            {issues.map((issue) => (
              <article key={issue.id} className="clay-well rounded-2xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white">{issue.category}</span>
                    <SeverityBadge severity={issue.severity} />
                  </div>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 capitalize">
                    Status: {issue.resolution_status}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-white/80 dark:bg-slate-950/60 p-3.5 border border-red-200/70 dark:border-rose-500/25">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-rose-300 mb-1">
                      Original Problematic Text
                    </p>
                    <p className="text-sm text-slate-900 dark:text-slate-100 font-medium">{issue.original_text}</p>
                  </div>

                  <div className="rounded-xl bg-white/80 dark:bg-slate-950/60 p-3.5 border border-emerald-200/70 dark:border-emerald-500/25">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 mb-1">
                      Suggested Correction
                    </p>
                    <p className="text-sm text-slate-900 dark:text-slate-100 font-medium">
                      {issue.suggested_correction || 'Manual revision recommended'}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  <strong className="font-bold">Explanation:</strong> {issue.explanation}
                </p>

                <div className="rounded-xl bg-indigo-50/70 dark:bg-violet-950/50 px-3.5 py-2.5 text-xs text-indigo-950 dark:text-violet-200 border border-indigo-200/60 dark:border-violet-400/20">
                  <strong className="font-bold">Guideline / Approved-Fact Evidence:</strong> {issue.evidence}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
