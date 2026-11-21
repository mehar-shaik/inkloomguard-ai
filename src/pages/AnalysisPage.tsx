import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  FileSearch,
  ShieldAlert,
  Image as ImageIcon,
  RefreshCw,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  HelpCircle,
  MinusCircle,
} from 'lucide-react';
import { api } from '../api';
import type {
  BrandLogoVariant,
  CheckAreaSummary,
  ComplianceIssue,
  ImageMetrics,
  PageKey,
  Submission,
  VisualBrandAnalysisResult,
  VisualCheckStatus,
} from '../types';
import { EmptyState, LoadingPanel, ProtectedImage, SeverityBadge, StatusBadge } from '../components/ClayUI';
import { formatDateTime } from '../utils/date';

function VisualCheckStatusLabel({ status }: { status: VisualCheckStatus }) {
  if (status === 'passed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Passed
      </span>
    );
  }
  if (status === 'violation') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 dark:text-rose-300">
        <XCircle className="w-3.5 h-3.5" />
        Violation
      </span>
    );
  }
  if (status === 'inconclusive') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300">
        <HelpCircle className="w-3.5 h-3.5" />
        Inconclusive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
      <MinusCircle className="w-3.5 h-3.5" />
      Not Applicable
    </span>
  );
}

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
  const [logoVariants, setLogoVariants] = useState<BrandLogoVariant[]>([]);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
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
        setLogoVariants(detail.logoVariants || []);
        setActiveOverlayId(null);
      } else {
        setSubmission(null);
        setIssues([]);
        setLogoVariants([]);
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

  let visualAnalysis: VisualBrandAnalysisResult | null = null;
  try {
    visualAnalysis = submission.visual_analysis_json
      ? (JSON.parse(submission.visual_analysis_json) as VisualBrandAnalysisResult)
      : null;
  } catch {
    visualAnalysis = null;
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

      {/* Advanced Visual Brand Detection & Evidence (only if an image was uploaded) */}
      {submission.image_filename && (visualAnalysis || imageMetrics) && (
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
                Advanced Visual Brand Detection &amp; Evidence
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {visualAnalysis
                  ? visualAnalysis.summary
                  : 'Deterministic pixel & color telemetry for attached image asset.'}
                {visualAnalysis?.cached ? ' · Cached visual evaluation' : ''}
              </p>
            </div>
            {visualAnalysis && visualAnalysis.overlays.length > 0 && (
              <button
                type="button"
                onClick={() => setShowOverlays((v) => !v)}
                className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {showOverlays ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showOverlays ? 'Hide Region Overlays' : `Show Region Overlays (${visualAnalysis.overlays.length})`}
              </button>
            )}
          </div>

          {visualAnalysis && visualAnalysis.visionStatus !== 'completed' && visualAnalysis.visionNote && (
            <div className="rounded-2xl px-4 py-3 text-xs bg-amber-50/90 text-amber-900 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{visualAnalysis.visionNote}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Submitted Visual Asset + Grounded Bounding-Box Overlays */}
            <div className="lg:col-span-5 space-y-3">
              <div className="clay-well rounded-2xl p-4 flex flex-col items-center justify-center">
                <div className="relative inline-block max-w-full overflow-hidden rounded-xl border border-slate-200/70 dark:border-violet-400/20 bg-white/60 dark:bg-slate-950/60">
                  <ProtectedImage
                    filename={submission.image_filename}
                    alt={submission.image_alt_text || 'Submitted visual asset'}
                    className="block max-w-full max-h-72 w-auto h-auto rounded-xl"
                  />
                  {showOverlays &&
                    visualAnalysis?.overlays.map((ov) => {
                      const isActive = activeOverlayId === ov.id;
                      const styleByKind =
                        ov.kind === 'clear_space_zone'
                          ? 'border-2 border-dashed border-amber-500 bg-amber-500/10'
                          : ov.status === 'violation' || ov.kind === 'logo_violation'
                            ? 'border-2 border-red-500 bg-red-500/15'
                            : ov.kind === 'typography_region'
                              ? 'border-2 border-indigo-500 bg-indigo-500/15'
                              : 'border-2 border-emerald-500 bg-emerald-500/15';
                      return (
                        <button
                          key={ov.id}
                          type="button"
                          onClick={() => setActiveOverlayId(isActive ? null : ov.id)}
                          title={`${ov.label}: ${ov.notes}`}
                          style={{
                            left: `${ov.bbox.x * 100}%`,
                            top: `${ov.bbox.y * 100}%`,
                            width: `${ov.bbox.width * 100}%`,
                            height: `${ov.bbox.height * 100}%`,
                          }}
                          className={`absolute transition-all cursor-pointer ${styleByKind} ${
                            isActive ? 'ring-2 ring-white shadow-lg z-10' : 'hover:z-10'
                          }`}
                        >
                          <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-900/85 text-white whitespace-nowrap pointer-events-none">
                            {ov.label}
                          </span>
                        </button>
                      );
                    })}
                </div>
                {visualAnalysis && visualAnalysis.overlays.length > 0 && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2.5 text-center">
                    Overlays mark grounded regions only (green = passed logo, red = violation, dashed amber = clear space, indigo = typography).
                  </p>
                )}
              </div>

              {imageMetrics && (
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="clay-well rounded-xl p-3">
                    <p className="text-slate-500 dark:text-slate-400">Image Dimensions</p>
                    <p className="font-mono-tabular font-bold text-slate-900 dark:text-white mt-0.5">
                      {imageMetrics.width} × {imageMetrics.height} px
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
                  <div className="clay-well rounded-xl p-3 col-span-2">
                    <p className="text-slate-500 dark:text-slate-400">Submitted Alt Text</p>
                    <p className="font-semibold text-slate-900 dark:text-white truncate mt-0.5">
                      {submission.image_alt_text || '(Missing)'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Approved Logo Reference Comparison & Color Palette Analysis */}
            <div className="lg:col-span-7 space-y-4">
              {/* Matched Logo & Approved Reference Strip */}
              <div className="clay-well rounded-2xl p-4 space-y-3">
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Logo Reference Comparison
                </p>

                {visualAnalysis?.matchedLogoVariant ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="w-20 h-20 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-violet-400/25 flex items-center justify-center p-2 shrink-0">
                      <ProtectedImage
                        filename={visualAnalysis.matchedLogoVariant.filename}
                        alt={visualAnalysis.matchedLogoVariant.label}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs flex-1">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Matched Reference</p>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {visualAnalysis.matchedLogoVariant.label}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Match Similarity</p>
                        <p className="font-mono-tabular font-bold text-slate-900 dark:text-white">
                          {Math.round(visualAnalysis.matchedLogoVariant.similarityScore * 100)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Detected Size</p>
                        <p className="font-mono-tabular font-bold text-slate-900 dark:text-white">
                          {visualAnalysis.matchedLogoVariant.estimatedWidthPx} × {visualAnalysis.matchedLogoVariant.estimatedHeightPx} px
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Aspect Ratio (Det / Exp)</p>
                        <p className="font-mono-tabular font-bold text-slate-900 dark:text-white">
                          {visualAnalysis.matchedLogoVariant.detectedAspectRatio} / {visualAnalysis.matchedLogoVariant.expectedAspectRatio} ({visualAnalysis.matchedLogoVariant.aspectRatioDeviation}×)
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Placement Zone</p>
                        <p className="font-semibold text-slate-900 dark:text-white capitalize">
                          {visualAnalysis.matchedLogoVariant.placementZone}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400">Local Bg Contrast</p>
                        <p className="font-mono-tabular font-bold text-slate-900 dark:text-white">
                          {visualAnalysis.matchedLogoVariant.backgroundContrastRatio !== null
                            ? `${visualAnalysis.matchedLogoVariant.backgroundContrastRatio}:1 (${visualAnalysis.matchedLogoVariant.backgroundHex})`
                            : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                    {submission.brand_logo_filename && (
                      <div className="inline-flex items-center gap-2 rounded-xl bg-white/70 dark:bg-slate-900/60 px-3 py-2 border border-slate-200/70 dark:border-violet-400/20">
                        <ProtectedImage
                          filename={submission.brand_logo_filename}
                          alt="Primary brand logo"
                          className="w-8 h-8 object-contain"
                        />
                        <span className="font-semibold">Primary Reference</span>
                      </div>
                    )}
                    {logoVariants.map((v) => (
                      <div
                        key={v.id}
                        className="inline-flex items-center gap-2 rounded-xl bg-white/70 dark:bg-slate-900/60 px-3 py-2 border border-slate-200/70 dark:border-violet-400/20"
                      >
                        <ProtectedImage filename={v.filename} alt={v.label} className="w-8 h-8 object-contain" />
                        <span className="font-semibold">{v.label}</span>
                      </div>
                    ))}
                    {!submission.brand_logo_filename && logoVariants.length === 0 && (
                      <span>No reference brand logo uploaded for this brand yet.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Expected vs Detected Palette */}
              <div className="clay-well rounded-2xl p-4 space-y-3">
                <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Brand Palette Comparison (CIELAB ΔE &amp; Area Coverage)
                </p>

                {visualAnalysis ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300 mr-1">Expected:</span>
                      {visualAnalysis.expectedPalette.map((ep, idx) => (
                        <span
                          key={`${ep.hex}-${ep.role}-${idx}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-violet-400/20 px-2 py-1 font-mono-tabular text-[11px]"
                        >
                          <span className="w-3 h-3 rounded-sm border border-slate-300" style={{ backgroundColor: ep.hex }} />
                          {ep.hex}
                          <span className="text-slate-400 capitalize font-sans">({ep.role.replace('_', ' ')})</span>
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300 mr-1">Detected:</span>
                      {visualAnalysis.detectedPalette.map((dp, idx) => {
                        const isOffBrand = dp.role === 'unauthorized';
                        return (
                          <span
                            key={`${dp.hex}-${idx}`}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono-tabular text-[11px] border ${
                              isOffBrand
                                ? 'bg-red-50 text-red-900 border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/35'
                                : 'bg-white/80 text-slate-800 border-slate-200 dark:bg-slate-900/70 dark:text-slate-200 dark:border-violet-400/20'
                            }`}
                          >
                            <span className="w-3 h-3 rounded-sm border border-slate-300" style={{ backgroundColor: dp.hex }} />
                            {dp.hex} · {dp.areaPct}%
                            {dp.deltaE !== null && <span className="opacity-75">ΔE {dp.deltaE}</span>}
                            {isOffBrand && <span className="font-sans font-bold">Off-Brand</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  imageMetrics && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1">
                        Measured Palette:
                      </span>
                      {imageMetrics.dominantColors.map((hex) => (
                        <span
                          key={hex}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-900/70 px-2.5 py-1 font-mono-tabular text-[11px] font-semibold"
                        >
                          <span className="w-3 h-3 rounded-full border border-white/60" style={{ backgroundColor: hex }} />
                          {hex}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          {/* 5 Structured Visual Brand Checks */}
          {visualAnalysis && visualAnalysis.checks.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Visual Brand Check Breakdown
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {visualAnalysis.checks.map((vc) => (
                  <article
                    key={vc.id}
                    className={`clay-well rounded-2xl p-4 space-y-2.5 border ${
                      vc.status === 'violation'
                        ? 'border-red-200/90 dark:border-rose-500/35'
                        : vc.status === 'inconclusive'
                          ? 'border-amber-200/80 dark:border-amber-500/30'
                          : 'border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h5 className="text-sm font-extrabold text-slate-900 dark:text-white">{vc.title}</h5>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                          Confidence: <span className="font-semibold">{vc.confidence}</span>
                          {vc.referenceUsed ? ` · Ref: ${vc.referenceUsed}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {vc.severity && vc.status === 'violation' && <SeverityBadge severity={vc.severity} />}
                        <VisualCheckStatusLabel status={vc.status} />
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{vc.explanation}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      <strong className="font-semibold text-slate-700 dark:text-slate-300">Evidence:</strong> {vc.evidence}
                    </p>
                    {vc.status === 'violation' && vc.recommendedCorrection && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                        <strong>Recommended Fix:</strong> {vc.recommendedCorrection}
                      </p>
                    )}
                    {vc.affectedRegion?.pixelBox && (
                      <p className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                        Region: x={vc.affectedRegion.pixelBox.x}, y={vc.affectedRegion.pixelBox.y}, {vc.affectedRegion.pixelBox.width}×{vc.affectedRegion.pixelBox.height} px
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}
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
