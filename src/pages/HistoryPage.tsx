import React, { useEffect, useState } from 'react';
import { Search, Eye, X, ArrowUpRight } from 'lucide-react';
import { api } from '../api';
import type { ComplianceIssue, PageKey, ReviewEvent, Revision, Submission } from '../types';
import { EmptyState, LoadingPanel, SeverityBadge, StatusBadge } from '../components/ClayUI';

export function HistoryPage({
  onSelectSubmission,
  onNavigate,
}: {
  onSelectSubmission: (id: number, page: PageKey) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Detail modal state
  const [inspecting, setInspecting] = useState<{
    submission: Submission;
    issues: ComplianceIssue[];
    revisions: Revision[];
    reviewEvents: ReviewEvent[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    api
      .getSubmissions()
      .then((res) => setSubmissions(res.submissions))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load review history.'))
      .finally(() => setLoading(false));
  }, []);

  async function openInspect(subId: number) {
    setLoadingDetail(true);
    try {
      const detail = await api.getSubmissionDetail(subId);
      setInspecting(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load submission details.');
    } finally {
      setLoadingDetail(false);
    }
  }

  if (loading) return <LoadingPanel label="Loading review history..." />;

  const filtered = submissions.filter((s) => {
    const matchesSearch =
      !searchQuery.trim() ||
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.brand_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filterTabs = [
    { key: 'all', label: 'All' },
    { key: 'pending_review', label: 'Pending Review' },
    { key: 'approved', label: 'Approved' },
    { key: 'changes_requested', label: 'Changes Requested' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="space-y-6">
      {/* Filter Controls */}
      <section className="clay-surface rounded-[28px] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search submissions by title or brand..."
            className="clay-well w-full rounded-full pl-11 pr-4 py-2.5 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1.5 clay-well rounded-full">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatusFilter(t.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                statusFilter === t.key
                  ? 'clay-btn-primary'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 dark:bg-rose-500/15 dark:text-rose-200">
          {error}
        </div>
      )}

      {submissions.length === 0 ? (
        <EmptyState
          title="No audit history recorded"
          description="Submitted content, compliance findings, saved revisions, and reviewer decisions will appear here."
          actionLabel="Submit Content"
          onAction={() => onNavigate('submit')}
        />
      ) : (
        <section className="clay-surface rounded-[28px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/70 dark:border-violet-400/20 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-4 px-6">Submission</th>
                  <th className="py-4 px-4">Brand</th>
                  <th className="py-4 px-4">Date</th>
                  <th className="py-4 px-4 text-right">Issues</th>
                  <th className="py-4 px-4">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-violet-400/15 text-sm">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-indigo-50/40 dark:hover:bg-violet-900/20 transition-colors"
                  >
                    <td className="py-4 px-6">
                      <p className="font-bold text-slate-900 dark:text-white">{s.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        By {s.submitted_by_name} · {s.input_type}
                      </p>
                    </td>
                    <td className="py-4 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {s.brand_name}
                    </td>
                    <td className="py-4 px-4 font-mono-tabular text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(s.created_at + 'Z').toLocaleDateString()}
                    </td>
                    <td className="py-4 px-4 font-mono-tabular text-xs font-bold text-right text-slate-900 dark:text-slate-100">
                      {s.open_issues ?? 0} open / {s.total_issues ?? 0}
                    </td>
                    <td className="py-4 px-4">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openInspect(s.id)}
                          disabled={loadingDetail}
                          className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectSubmission(s.id, 'analysis')}
                          className="clay-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          Open
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              No submissions match your current search or filter.
            </p>
          )}
        </section>
      )}

      {/* Full Audit Record Inspection Modal */}
      {inspecting && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="clay-surface rounded-[28px] max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-200/70 dark:border-violet-400/20 flex items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {inspecting.submission.title}
                  </h3>
                  <StatusBadge status={inspecting.submission.status} />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {inspecting.submission.brand_name} · Submitted {new Date(inspecting.submission.created_at + 'Z').toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspecting(null)}
                aria-label="Close inspection modal"
                className="clay-btn-secondary rounded-full p-2 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Original Submitted Content
                  </h4>
                  <div className="clay-well rounded-2xl p-4 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {inspecting.submission.original_content || '(Image-only submission)'}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300 mb-2">
                    Latest Revised Content
                  </h4>
                  <div className="clay-well rounded-2xl p-4 text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {inspecting.submission.revised_content || '(Image-only submission)'}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Findings & Evidence ({inspecting.issues.length})
                </h4>
                <div className="space-y-2.5">
                  {inspecting.issues.map((issue) => (
                    <div key={issue.id} className="clay-well rounded-2xl p-3.5 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{issue.category}</span>
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={issue.severity} />
                          <span className="capitalize text-slate-500 dark:text-slate-400">{issue.resolution_status}</span>
                        </div>
                      </div>
                      <p className="text-slate-700 dark:text-slate-200">{issue.explanation}</p>
                      <p className="text-indigo-700 dark:text-violet-300">Evidence: {issue.evidence}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Saved Revisions ({inspecting.revisions.length}) & Reviewer Decisions ({inspecting.reviewEvents.length})
                </h4>
                <div className="space-y-2.5">
                  {inspecting.reviewEvents.map((ev) => (
                    <div key={ev.id} className="clay-well rounded-2xl p-3.5 text-xs flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {ev.reviewer_name} · <span className="capitalize">{ev.decision.replace('_', ' ')}</span>
                        </p>
                        {ev.comment && <p className="text-slate-600 dark:text-slate-300 mt-0.5">{ev.comment}</p>}
                      </div>
                      <span className="font-mono-tabular text-[11px] text-slate-400 whitespace-nowrap">
                        {new Date(ev.created_at + 'Z').toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200/70 dark:border-violet-400/20 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const id = inspecting.submission.id;
                  setInspecting(null);
                  onSelectSubmission(id, 'corrections');
                }}
                className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold cursor-pointer"
              >
                Edit Corrections
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = inspecting.submission.id;
                  setInspecting(null);
                  onSelectSubmission(id, 'review');
                }}
                className="clay-btn-primary rounded-full px-5 py-2 text-xs font-semibold cursor-pointer"
              >
                Open Human Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
