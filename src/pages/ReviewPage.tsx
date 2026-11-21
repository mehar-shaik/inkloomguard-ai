import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, MessageSquarePlus } from 'lucide-react';
import { api } from '../api';
import type { ComplianceIssue, PageKey, ReviewEvent, Submission } from '../types';
import { EmptyState, LoadingPanel, ProtectedImage, StatusBadge } from '../components/ClayUI';
import { formatDateTime } from '../utils/date';

export function ReviewPage({
  userRole = 'reviewer',
  selectedSubmissionId,
  onSelectSubmission,
  onNavigate,
}: {
  userRole?: string;
  selectedSubmissionId: number | null;
  onSelectSubmission: (id: number) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [issues, setIssues] = useState<ComplianceIssue[]>([]);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingDecision, setSubmittingDecision] = useState(false);
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
        setReviewEvents(detail.reviewEvents);
      } else {
        setSubmission(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review workspace.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(selectedSubmissionId);
  }, [selectedSubmissionId]);

  async function handleDecision(decision: 'approved' | 'rejected' | 'changes_requested' | 'comment') {
    if (!submission) return;
    if ((decision === 'rejected' || decision === 'changes_requested' || decision === 'comment') && !comment.trim()) {
      setError('Please enter a reviewer comment explaining your feedback or decision.');
      return;
    }

    setSubmittingDecision(true);
    setError('');
    setMessage('');
    try {
      const res = await api.submitReview(submission.id, decision, comment);
      setSubmission((prev) => (prev ? { ...prev, ...res.submission } : res.submission));
      setReviewEvents(res.reviewEvents);
      setComment('');
      setMessage(
        decision === 'comment'
          ? 'Reviewer comment recorded.'
          : `Submission marked as "${decision.replace('_', ' ')}" and recorded in Review History.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reviewer decision.');
    } finally {
      setSubmittingDecision(false);
    }
  }

  if (loading) return <LoadingPanel label="Loading human governance review queue..." />;

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
        title="No submissions awaiting review"
        description="Submit and analyze content first to perform human reviewer sign-off."
        actionLabel="Submit Content"
        onAction={() => onNavigate('submit')}
      />
    );
  }

  const canReviewDecisions = userRole === 'reviewer' || userRole === 'admin';
  const openIssues = issues.filter((i) => i.resolution_status === 'open').length;
  const acceptedIssues = issues.filter((i) => i.resolution_status === 'accepted').length;

  return (
    <div className="space-y-6">
      {/* Submission Selector */}
      <section className="clay-surface rounded-[28px] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{submission.title}</h2>
            <StatusBadge status={submission.status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            Brand: {submission.brand_name} · {openIssues} open issues · {acceptedIssues} accepted suggestions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={submission.id}
            onChange={(e) => load(Number(e.target.value))}
            aria-label="Select submission to review"
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
            onClick={() => onNavigate('history')}
            className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            View Review History
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Content Preview */}
        <section className="lg:col-span-7 clay-surface rounded-[28px] p-6 sm:p-7 space-y-5">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-2">
              Latest Revised Draft for Approval
            </h3>
            <div className="clay-well rounded-2xl p-5 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed min-h-[180px]">
              {submission.revised_content || submission.original_content || '(Image-only submission)'}
            </div>
          </div>

          {submission.image_filename && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Attached Visual Asset
              </h4>
              <div className="clay-well rounded-2xl p-4 flex items-center gap-4">
                <ProtectedImage
                  filename={submission.image_filename}
                  alt={submission.image_alt_text || 'Visual asset'}
                  className="w-24 h-24 rounded-xl object-cover shrink-0"
                />
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <strong>Alt-Text:</strong> {submission.image_alt_text || '(None provided)'}
                </p>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Original Submitted Content
            </h4>
            <div className="clay-well rounded-2xl p-4 text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto">
              {submission.original_content || '(None)'}
            </div>
          </div>
        </section>

        {/* Right: Decision Controls & Timeline */}
        <section className="lg:col-span-5 space-y-6">
          <div className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-4">
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">Reviewer Decision</h3>
            {!canReviewDecisions && (
              <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30">
                Author role: you can post review comments below. Formal approval, change requests, and rejection require a Reviewer role.
              </div>
            )}
            <textarea
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add governance review notes, sign-off justification, or requested edits..."
              className="clay-well w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {canReviewDecisions && (
                <>
                  <button
                    type="button"
                    disabled={submittingDecision}
                    onClick={() => handleDecision('approved')}
                    className="rounded-full py-2.5 px-4 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve Content
                  </button>
                  <button
                    type="button"
                    disabled={submittingDecision}
                    onClick={() => handleDecision('changes_requested')}
                    className="rounded-full py-2.5 px-4 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 shadow-md inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Request Changes
                  </button>
                  <button
                    type="button"
                    disabled={submittingDecision}
                    onClick={() => handleDecision('rejected')}
                    className="rounded-full py-2.5 px-4 text-xs font-bold text-white bg-red-600 hover:bg-red-700 shadow-md inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject Content
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={submittingDecision}
                onClick={() => handleDecision('comment')}
                className={`clay-btn-secondary rounded-full py-2.5 px-4 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                  !canReviewDecisions ? 'sm:col-span-2' : ''
                }`}
              >
                <MessageSquarePlus className="w-4 h-4" />
                Post Comment
              </button>
            </div>
          </div>

          <div className="clay-surface rounded-[28px] p-6 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Governance Audit Trail</h3>
            {reviewEvents.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No review events logged yet.</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {reviewEvents.map((ev) => (
                  <div key={ev.id} className="clay-well rounded-2xl p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{ev.reviewer_name}</span>
                      <StatusBadge status={ev.decision === 'submitted' ? 'pending_review' : ev.decision} />
                    </div>
                    {ev.comment && <p className="text-xs text-slate-600 dark:text-slate-300">{ev.comment}</p>}
                    <p className="font-mono-tabular text-[11px] text-slate-400 mt-1.5">
                      {formatDateTime(ev.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
