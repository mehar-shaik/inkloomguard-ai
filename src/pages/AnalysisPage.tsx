import React, { useEffect, useState } from 'react';
import { ArrowRight, FileSearch, ShieldAlert, Image as ImageIcon } from 'lucide-react';
import { api } from '../api';
import type { CheckAreaSummary, ComplianceIssue, ImageMetrics, PageKey, Submission } from '../types';
import { EmptyState, LoadingPanel, ProtectedImage, SeverityBadge, StatusBadge } from '../components/ClayUI';

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

  return (
    <div className="space-y-6">
      {/* Submission Picker & Header */}
      <section className="clay-surface rounded-[28px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{submission.title}</h2>
            <StatusBadge status={submission.status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Brand: <strong className="text-slate-700 dark:text-slate-200">{submission.brand_name}</strong> · Input:{' '}
            {submission.input_type} · Submitted {new Date(submission.created_at + 'Z').toLocaleString()}
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
            onClick={() => onNavigate('corrections')}
            className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            Open Corrections
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

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
                <p className="text-slate-500 dark:text-slate-400">Contrast Spread</p>
                <p className="font-mono-tabular font-bold text-slate-900 dark:text-white mt-0.5">
                  {imageMetrics.contrastSpread}:1
                </p>
              </div>
              <div className="clay-well rounded-xl p-3">
                <p className="text-slate-500 dark:text-slate-400">Brand Color Dist.</p>
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
