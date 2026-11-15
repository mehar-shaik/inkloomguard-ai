import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Save, X, RotateCcw } from 'lucide-react';
import { api } from '../api';
import type { ComplianceIssue, PageKey, Submission } from '../types';
import { EmptyState, LoadingPanel, SeverityBadge, StatusBadge } from '../components/ClayUI';

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
        onSelectSubmission(idToLoad);
        const detail = await api.getSubmissionDetail(idToLoad);
        setSubmission(detail.submission);
        setIssues(detail.issues);
        setWorkingText(detail.submission.revised_content || detail.submission.original_content || '');
      } else {
        setSubmission(null);
        setIssues([]);
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

  function handleCopy() {
    navigator.clipboard.writeText(workingText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) return <LoadingPanel label="Loading side-by-side correction workspace..." />;

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
            {issues.map((issue) => (
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
                  <p className="text-xs text-slate-700 dark:text-slate-200">
                    <span className="line-through text-red-700 dark:text-rose-300 mr-2">{issue.original_text}</span>
                    <span className="text-slate-400 mr-2">→</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">
                      {issue.suggested_correction}
                    </span>
                  </p>
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
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
