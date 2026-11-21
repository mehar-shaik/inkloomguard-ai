import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Save, X, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { api } from '../api';
import type { BrandLogoVariant, ComplianceIssue, PageKey, Submission, VisualBrandAnalysisResult } from '../types';
import { EmptyState, LoadingPanel, ProtectedImage, SeverityBadge, StatusBadge } from '../components/ClayUI';

export function CorrectionsPage({
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
  const [logoVariants, setLogoVariants] = useState<BrandLogoVariant[]>([]);
  const [workingText, setWorkingText] = useState('');
  const [revisionNote, setRevisionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load(targetId?: number | null) {
    setLoading(true);
    setError('');
    try {
      const listRes = await api.getSubmissions();
      setSubmissions(listRes.submissions);

      const idToLoad =
        targetId && listRes.submissions.some((s) => s.id === targetId)
          ? targetId
          : listRes.submissions[0]?.id || null;

      if (idToLoad) {
        if (idToLoad !== selectedSubmissionId) {
          onSelectSubmission(idToLoad);
        }
        const detail = await api.getSubmissionDetail(idToLoad);
        setSubmission(detail.submission);
        setIssues(detail.issues);
        setLogoVariants(detail.logoVariants || []);
        setWorkingText(detail.submission.revised_content || detail.submission.original_content || '');
      } else {
        setSubmission(null);
        setIssues([]);
        setLogoVariants([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load correction workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(selectedSubmissionId);
  }, [selectedSubmissionId]);

  async function handleIssueResolution(issue: ComplianceIssue, action: 'accepted' | 'rejected' | 'open') {
    if (!submission) return;
    setError('');
    try {
      const res = await api.resolveIssue(submission.id, issue.id, action);
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? res.issue : i)));

      if (action === 'accepted' && issue.original_text && issue.suggested_correction) {
        if (workingText.includes(issue.original_text)) {
          setWorkingText((prev) => prev.split(issue.original_text).join(issue.suggested_correction));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update suggestion status.');
    }
  }

  async function handleSaveRevision(e: React.FormEvent) {
    e.preventDefault();
    if (!submission) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await api.saveRevision(
        submission.id,
        workingText,
        revisionNote.trim() || 'Applied brand compliance edits'
      );
      setSubmission((prev) => (prev ? { ...prev, ...res.submission } : res.submission));
      setRevisionNote('');
      setMessage('Revision saved to history and ready for human reviewer approval.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save revision.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(workingText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard copy is unavailable in this browser context.');
    }
  }

  if (loading) return <LoadingPanel label="Loading side-by-side correction workspace..." />;

  if (error && !submission) {
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
        title="No submissions to revise"
        description="Submit content for compliance checking to review side-by-side correction suggestions."
        actionLabel="Submit Content"
        onAction={() => onNavigate('submit')}
      />
    );
  }

  let visualAnalysis: VisualBrandAnalysisResult | null = null;
  try {
    visualAnalysis = submission.visual_analysis_json
      ? (JSON.parse(submission.visual_analysis_json) as VisualBrandAnalysisResult)
      : null;
  } catch {
    visualAnalysis = null;
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <section className="clay-surface rounded-[28px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{submission.title}</h2>
            <StatusBadge status={submission.status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Compare original text against suggested revisions, accept or reject fixes, and edit manually before saving.
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
            onClick={() => onNavigate('review')}
            className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            Review & Approve
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {message && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30">
          {error}
        </div>
      )}

      {/* Side-by-Side Comparison Panels */}
      <form onSubmit={handleSaveRevision} className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Original Content */}
          <section className="lg:col-span-5 clay-surface rounded-[28px] p-6 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-200">Original Content</h3>
              <span className="text-[11px] font-mono-tabular text-slate-400">Read-Only</span>
            </div>
            <div className="clay-well flex-1 rounded-2xl p-4 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed min-h-[240px]">
              {submission.original_content || '(Image-only submission — no text copy provided)'}
            </div>
          </section>

          {/* Center Transition Pill */}
          <div className="lg:col-span-2 flex items-center justify-center py-1">
            <div className="clay-raised rounded-full px-4 py-2 text-xs font-bold text-indigo-600 dark:text-violet-300 inline-flex items-center gap-1.5">
              <span>Rewrite</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>

          {/* Editable Revised Version */}
          <section className="lg:col-span-5 clay-surface rounded-[28px] p-6 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-extrabold text-indigo-700 dark:text-violet-300">
                Suggested / Revised Version
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorkingText(submission.original_content || '')}
                  className="clay-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="clay-btn-secondary rounded-full px-3 py-1 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <textarea
              rows={10}
              value={workingText}
              onChange={(e) => setWorkingText(e.target.value)}
              className="clay-well flex-1 w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[240px]"
            />
          </section>
        </div>

        <div className="clay-surface rounded-3xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input
            type="text"
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="Optional revision summary note (e.g. Updated SLA claim and removed superlatives)"
            className="clay-well flex-1 rounded-full px-4 py-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={saving}
            className="clay-btn-primary rounded-full px-6 py-2.5 text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Revision...' : 'Save Revision'}
          </button>
        </div>
      </form>

      {/* Visual Asset Reference Panel for Image Submissions */}
      {submission.image_filename && (visualAnalysis || issues.some((i) => i.category === 'Visual Identity')) && (
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                Visual Asset Reference &amp; Corrective Context
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Review flagged visual regions alongside approved brand logos and palette targets before accepting or rejecting corrections.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analysis')}
              className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold cursor-pointer self-start sm:self-auto"
            >
              Inspect Full Visual Report
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-5 clay-well rounded-2xl p-3 flex items-center justify-center">
              <div className="relative inline-block max-w-full overflow-hidden rounded-xl">
                <ProtectedImage
                  filename={submission.image_filename}
                  alt={submission.image_alt_text || 'Submitted visual asset'}
                  className="block max-w-full max-h-56 w-auto h-auto rounded-xl"
                />
                {visualAnalysis?.overlays.map((ov) => (
                  <div
                    key={ov.id}
                    title={`${ov.label}: ${ov.notes}`}
                    style={{
                      left: `${ov.bbox.x * 100}%`,
                      top: `${ov.bbox.y * 100}%`,
                      width: `${ov.bbox.width * 100}%`,
                      height: `${ov.bbox.height * 100}%`,
                    }}
                    className={`absolute pointer-events-none ${
                      ov.kind === 'clear_space_zone'
                        ? 'border-2 border-dashed border-amber-500 bg-amber-500/10'
                        : ov.status === 'violation' || ov.kind === 'logo_violation'
                          ? 'border-2 border-red-500 bg-red-500/15'
                          : 'border-2 border-emerald-500 bg-emerald-500/10'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="md:col-span-7 space-y-3 text-xs">
              {visualAnalysis && (
                <div className="clay-well rounded-2xl p-3.5 space-y-2">
                  <p className="font-bold text-slate-800 dark:text-slate-100">{visualAnalysis.summary}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">Approved Palette:</span>
                    {visualAnalysis.expectedPalette.map((ep, idx) => (
                      <span
                        key={`${ep.hex}-${idx}`}
                        className="inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-slate-900/70 px-2 py-0.5 font-mono-tabular text-[11px]"
                      >
                        <span className="w-2.5 h-2.5 rounded-sm border border-slate-300" style={{ backgroundColor: ep.hex }} />
                        {ep.hex}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(submission.brand_logo_filename || logoVariants.length > 0) && (
                <div className="clay-well rounded-2xl p-3.5 space-y-2">
                  <p className="font-bold text-slate-700 dark:text-slate-200">Approved Reference Logo(s)</p>
                  <div className="flex flex-wrap items-center gap-3">
                    {submission.brand_logo_filename && (
                      <div className="inline-flex items-center gap-2 rounded-xl bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5">
                        <ProtectedImage
                          filename={submission.brand_logo_filename}
                          alt="Primary reference logo"
                          className="w-8 h-8 object-contain"
                        />
                        <span>Primary</span>
                      </div>
                    )}
                    {logoVariants.map((v) => (
                      <div
                        key={v.id}
                        className="inline-flex items-center gap-2 rounded-xl bg-white/80 dark:bg-slate-900/70 px-2.5 py-1.5"
                      >
                        <ProtectedImage filename={v.filename} alt={v.label} className="w-8 h-8 object-contain" />
                        <span>{v.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Suggestion Cards */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-4">
        <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
          Individual Correction Suggestions ({issues.length})
        </h3>

        {issues.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
            No pending issues for this submission. You can still manually refine the copy above and save a revision.
          </p>
        ) : (
          <div className="space-y-3">
            {issues.map((issue) => {
              const isVisual = issue.category === 'Visual Identity';
              return (
                <div
                  key={issue.id}
                  className="clay-well rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-extrabold text-slate-900 dark:text-white">{issue.category}</span>
                      <SeverityBadge severity={issue.severity} />
                      <span className="text-xs font-semibold text-indigo-600 dark:text-violet-300 capitalize">
                        · {issue.resolution_status}
                      </span>
                    </div>
                    {isVisual ? (
                      <div className="space-y-1 text-xs">
                        <p className="font-bold text-slate-900 dark:text-white">{issue.original_text}</p>
                        <p className="text-slate-600 dark:text-slate-300">{issue.explanation}</p>
                        <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                          Recommended Action: {issue.suggested_correction}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-700 dark:text-slate-200">
                        <span className="line-through text-red-700 dark:text-rose-300 mr-2">{issue.original_text}</span>
                        <span className="text-slate-400 mr-2">→</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">
                          {issue.suggested_correction}
                        </span>
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Evidence: {issue.evidence}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleIssueResolution(issue, 'accepted')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        issue.resolution_status === 'accepted'
                          ? 'bg-emerald-600 text-white'
                          : 'clay-btn-secondary text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleIssueResolution(issue, 'rejected')}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        issue.resolution_status === 'rejected'
                          ? 'bg-red-600 text-white'
                          : 'clay-btn-secondary text-red-700 dark:text-rose-300'
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    {issue.resolution_status !== 'open' && (
                      <button
                        type="button"
                        onClick={() => handleIssueResolution(issue, 'open')}
                        className="clay-btn-secondary rounded-full px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
