import React, { useMemo, useState } from 'react';
import type {
  AnalyticsCategoryBreakdownItem,
  AnalyticsReviewMetrics,
  AnalyticsTrendPoint,
  AnalyticsVisualSubCheckItem,
} from '../types';

type TrendChartMode = 'compliance' | 'volume' | 'outcomes';

export function ComplianceTrendsChart({
  trends,
}: {
  trends: AnalyticsTrendPoint[];
}) {
  const [mode, setMode] = useState<TrendChartMode>('compliance');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const visiblePoints = useMemo(() => {
    if (trends.length <= 40) return trends;
    return trends.slice(trends.length - 40);
  }, [trends]);

  const width = 760;
  const height = 248;
  const padLeft = 42;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxCount = useMemo(() => {
    let maxVal = 1;
    for (const pt of visiblePoints) {
      if (mode === 'volume') {
        maxVal = Math.max(maxVal, pt.submissionVolume, pt.violationVolume, pt.analysisRunsCount);
      } else if (mode === 'outcomes') {
        maxVal = Math.max(maxVal, pt.approvedCount + pt.rejectedCount + pt.changesRequestedCount);
      }
    }
    return maxVal;
  }, [visiblePoints, mode]);

  const activePoint =
    hoveredIndex !== null && visiblePoints[hoveredIndex] ? visiblePoints[hoveredIndex] : null;

  if (visiblePoints.length === 0) {
    return (
      <div className="clay-well rounded-2xl p-8 text-center">
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          No trend data recorded for the selected filters.
        </p>
      </div>
    );
  }

  const slotWidth = plotW / Math.max(1, visiblePoints.length);
  const labelStride = visiblePoints.length <= 8 ? 1 : visiblePoints.length <= 16 ? 2 : Math.ceil(visiblePoints.length / 8);

  // Build compliance rate polyline segments skipping null gaps honestly
  const rateSegments: string[] = [];
  let currentSeg: string[] = [];
  visiblePoints.forEach((pt, idx) => {
    if (pt.complianceRate === null) {
      if (currentSeg.length > 0) {
        rateSegments.push(currentSeg.join(' '));
        currentSeg = [];
      }
      return;
    }
    const cx = padLeft + slotWidth * (idx + 0.5);
    const cy = padTop + plotH - (pt.complianceRate / 100) * plotH;
    currentSeg.push(`${currentSeg.length === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`);
  });
  if (currentSeg.length > 0) {
    rateSegments.push(currentSeg.join(' '));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Compliance trend metric view"
          className="clay-well inline-flex items-center gap-1 rounded-full p-1"
        >
          {(
            [
              { id: 'compliance', label: 'Compliance Rate' },
              { id: 'volume', label: 'Submissions & Violations' },
              { id: 'outcomes', label: 'Approved vs Rejected' },
            ] as const
          ).map((tab) => {
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(tab.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm dark:bg-violet-500'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {mode === 'compliance' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-1 rounded-full bg-indigo-600 dark:bg-violet-400" />
                Compliance Rate (%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400/75" />
                Analyzed Submissions
              </span>
            </>
          )}
          {mode === 'volume' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                Submissions
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                Violations
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                Re-analysis Runs
              </span>
            </>
          )}
          {mode === 'outcomes' && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                Approved
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
                Changes Requested
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                Rejected
              </span>
            </>
          )}
        </div>
      </div>

      <div className="relative clay-well rounded-2xl p-3 sm:p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          role="img"
          aria-label="Compliance trends over time"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padTop + plotH - frac * plotH;
            const axisLabel =
              mode === 'compliance'
                ? `${Math.round(frac * 100)}%`
                : String(Math.round(frac * maxCount));
            return (
              <g key={frac}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeDasharray="4 4"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                >
                  {axisLabel}
                </text>
              </g>
            );
          })}

          {/* Hover column highlight */}
          {hoveredIndex !== null && visiblePoints[hoveredIndex] && (
            <rect
              x={padLeft + slotWidth * hoveredIndex}
              y={padTop}
              width={slotWidth}
              height={plotH}
              rx={6}
              className="fill-indigo-500/8 dark:fill-violet-400/10"
            />
          )}

          {/* Bars per mode */}
          {visiblePoints.map((pt, idx) => {
            const xCenter = padLeft + slotWidth * (idx + 0.5);
            const barW = Math.min(22, Math.max(5, slotWidth * 0.58));

            if (mode === 'compliance') {
              const volScaleMax = Math.max(
                1,
                ...visiblePoints.map((p) => p.analyzedSubmissions)
              );
              const barH = (pt.analyzedSubmissions / volScaleMax) * (plotH * 0.45);
              return (
                <rect
                  key={pt.bucketKey}
                  x={xCenter - barW / 2}
                  y={padTop + plotH - barH}
                  width={barW}
                  height={Math.max(0, barH)}
                  rx={4}
                  className="fill-sky-400/45 dark:fill-sky-400/35"
                />
              );
            }

            if (mode === 'volume') {
              const pairW = Math.min(12, Math.max(4, slotWidth * 0.34));
              const subH = (pt.submissionVolume / maxCount) * plotH;
              const vioH = (pt.violationVolume / maxCount) * plotH;
              return (
                <g key={pt.bucketKey}>
                  <rect
                    x={xCenter - pairW - 1}
                    y={padTop + plotH - subH}
                    width={pairW}
                    height={Math.max(0, subH)}
                    rx={3}
                    className="fill-indigo-500 dark:fill-violet-400"
                  />
                  <rect
                    x={xCenter + 1}
                    y={padTop + plotH - vioH}
                    width={pairW}
                    height={Math.max(0, vioH)}
                    rx={3}
                    className="fill-rose-500 dark:fill-rose-400"
                  />
                </g>
              );
            }

            // outcomes stacked bar
            const appH = (pt.approvedCount / maxCount) * plotH;
            const chgH = (pt.changesRequestedCount / maxCount) * plotH;
            const rejH = (pt.rejectedCount / maxCount) * plotH;
            const baseY = padTop + plotH;
            return (
              <g key={pt.bucketKey}>
                <rect
                  x={xCenter - barW / 2}
                  y={baseY - appH}
                  width={barW}
                  height={Math.max(0, appH)}
                  rx={2}
                  className="fill-emerald-500"
                />
                <rect
                  x={xCenter - barW / 2}
                  y={baseY - appH - chgH}
                  width={barW}
                  height={Math.max(0, chgH)}
                  rx={2}
                  className="fill-amber-500"
                />
                <rect
                  x={xCenter - barW / 2}
                  y={baseY - appH - chgH - rejH}
                  width={barW}
                  height={Math.max(0, rejH)}
                  rx={2}
                  className="fill-rose-500"
                />
              </g>
            );
          })}

          {/* Compliance rate line + points */}
          {mode === 'compliance' && (
            <>
              {rateSegments.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#4F46E5"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dark:stroke-violet-400"
                />
              ))}
              {visiblePoints.map((pt, idx) => {
                if (pt.complianceRate === null) return null;
                const cx = padLeft + slotWidth * (idx + 0.5);
                const cy = padTop + plotH - (pt.complianceRate / 100) * plotH;
                const isHovered = hoveredIndex === idx;
                return (
                  <circle
                    key={pt.bucketKey}
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 5.5 : 3.5}
                    className="fill-indigo-600 stroke-white dark:fill-violet-300 dark:stroke-slate-900"
                    strokeWidth={1.75}
                  />
                );
              })}
            </>
          )}

          {/* X-axis tick labels */}
          {visiblePoints.map((pt, idx) => {
            if (idx % labelStride !== 0 && idx !== visiblePoints.length - 1) return null;
            const cx = padLeft + slotWidth * (idx + 0.5);
            return (
              <text
                key={pt.bucketKey}
                x={cx}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
              >
                {pt.label}
              </text>
            );
          })}

          {/* Invisible pointer interaction overlay targets */}
          {visiblePoints.map((pt, idx) => (
            <rect
              key={`hit-${pt.bucketKey}`}
              x={padLeft + slotWidth * idx}
              y={padTop}
              width={slotWidth}
              height={plotH}
              fill="transparent"
              className="cursor-crosshair"
              onMouseEnter={() => setHoveredIndex(idx)}
              onFocus={() => setHoveredIndex(idx)}
              tabIndex={0}
              aria-label={`${pt.label}: ${pt.submissionVolume} submissions, compliance rate ${
                pt.complianceRate === null ? 'no analyzed items' : `${pt.complianceRate}%`
              }`}
            />
          ))}
        </svg>

        {/* Live numeric readout strip */}
        <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-violet-400/15 flex flex-wrap items-center justify-between gap-3 text-xs">
          {activePoint ? (
            <>
              <span className="font-bold text-slate-900 dark:text-white">
                {activePoint.startDate === activePoint.endDate
                  ? `${activePoint.label} (${activePoint.startDate} UTC)`
                  : `${activePoint.startDate} to ${activePoint.endDate} UTC`}
              </span>
              <div className="flex flex-wrap items-center gap-4 tabular-nums text-slate-700 dark:text-slate-200">
                <span>
                  Rate:{' '}
                  <strong>
                    {activePoint.complianceRate !== null ? `${activePoint.complianceRate}%` : '—'}
                  </strong>
                </span>
                <span>
                  Submissions: <strong>{activePoint.submissionVolume}</strong>
                </span>
                <span>
                  Violations: <strong>{activePoint.violationVolume}</strong>
                </span>
                <span>
                  Approved / Rej / Req: <strong>{activePoint.approvedCount}</strong> /{' '}
                  <strong>{activePoint.rejectedCount}</strong> /{' '}
                  <strong>{activePoint.changesRequestedCount}</strong>
                </span>
                <span>
                  Scan runs: <strong>{activePoint.analysisRunsCount}</strong>
                </span>
              </div>
            </>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">
              Hover or focus any period column to inspect exact UTC bucket metrics.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReviewActivityChart({
  series,
}: {
  series: AnalyticsReviewMetrics['reviewActivitySeries'];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const points = useMemo(
    () => (series.length <= 28 ? series : series.slice(series.length - 28)),
    [series]
  );

  const hasActivity = points.some(
    (p) => p.approved + p.rejected + p.changesRequested + p.comments > 0
  );

  if (points.length === 0 || !hasActivity) {
    return (
      <div className="clay-well rounded-2xl p-6 text-center">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          No human review decisions or comments recorded in this period yet.
        </p>
      </div>
    );
  }

  const width = 540;
  const height = 176;
  const padL = 32;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const slotW = plotW / points.length;
  const maxTotal = Math.max(
    1,
    ...points.map((p) => p.approved + p.rejected + p.changesRequested + p.comments)
  );
  const labelStride = points.length <= 7 ? 1 : Math.ceil(points.length / 6);
  const active = hovered !== null && points[hovered] ? points[hovered] : null;

  return (
    <div className="clay-well rounded-2xl p-3.5 space-y-2.5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        role="img"
        aria-label="Review activity over time"
        onMouseLeave={() => setHovered(null)}
      >
        {[0, 0.5, 1].map((frac) => {
          const y = padT + plotH - frac * plotH;
          return (
            <g key={frac}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray="3 3"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
              >
                {Math.round(frac * maxTotal)}
              </text>
            </g>
          );
        })}

        {points.map((p, idx) => {
          const cx = padL + slotW * (idx + 0.5);
          const barW = Math.min(18, Math.max(5, slotW * 0.55));
          const base = padT + plotH;
          const appH = (p.approved / maxTotal) * plotH;
          const chgH = (p.changesRequested / maxTotal) * plotH;
          const rejH = (p.rejected / maxTotal) * plotH;
          const comH = (p.comments / maxTotal) * plotH;
          return (
            <g
              key={p.bucketKey}
              onMouseEnter={() => setHovered(idx)}
              className="cursor-pointer"
            >
              <rect x={cx - barW / 2} y={base - appH} width={barW} height={appH} rx={2} className="fill-emerald-500" />
              <rect x={cx - barW / 2} y={base - appH - chgH} width={barW} height={chgH} rx={2} className="fill-amber-500" />
              <rect x={cx - barW / 2} y={base - appH - chgH - rejH} width={barW} height={rejH} rx={2} className="fill-rose-500" />
              <rect x={cx - barW / 2} y={base - appH - chgH - rejH - comH} width={barW} height={comH} rx={2} className="fill-sky-500" />
              {idx % labelStride === 0 && (
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono"
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 border-t border-slate-200/70 dark:border-violet-400/15 pt-2">
        {active ? (
          <>
            <span className="font-bold text-slate-900 dark:text-white">{active.label}</span>
            <span className="tabular-nums">
              Approved {active.approved} · Changes {active.changesRequested} · Rejected {active.rejected} · Comments {active.comments}
            </span>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-emerald-500" />Approved</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-amber-500" />Changes Req</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-rose-500" />Rejected</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-xs bg-sky-500" />Comments</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function IssueCategoryBars({
  categories,
  visualSubChecks,
}: {
  categories: AnalyticsCategoryBreakdownItem[];
  visualSubChecks: AnalyticsVisualSubCheckItem[];
}) {
  const maxCat = Math.max(1, ...categories.map((c) => c.totalCount));
  const maxSub = Math.max(1, ...visualSubChecks.map((s) => s.violationCount));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Violations by Compliance Category
          </h4>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Stored issue distribution
          </span>
        </div>
        {categories.length === 0 ? (
          <div className="clay-well rounded-2xl p-6 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Zero compliance violations recorded in this filter scope.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {categories.map((cat) => {
              const pctWidth = Math.max(4, Math.round((cat.totalCount / maxCat) * 100));
              const isVisual = cat.issueType === 'visual';
              return (
                <div key={cat.category} className="clay-well rounded-2xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isVisual ? 'bg-violet-500' : 'bg-indigo-500'
                        }`}
                      />
                      {cat.category}
                    </span>
                    <span className="font-mono-tabular text-slate-700 dark:text-slate-200 font-semibold">
                      {cat.totalCount} ({cat.sharePct ?? 0}%) · {cat.openCount} open
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        isVisual
                          ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                          : 'bg-gradient-to-r from-indigo-500 to-sky-500'
                      }`}
                      style={{ width: `${pctWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Visual Brand Detection Checks
          </h4>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Analyzed image checks
          </span>
        </div>
        {visualSubChecks.length === 0 ? (
          <div className="clay-well rounded-2xl p-6 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No structured visual brand detection checks recorded for this selection yet.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visualSubChecks.map((sub) => {
              const failBarW =
                sub.violationCount > 0 ? Math.max(6, Math.round((sub.violationCount / maxSub) * 100)) : 0;
              return (
                <div key={sub.checkId} className="clay-well rounded-2xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-900 dark:text-white truncate">
                      {sub.title}
                    </span>
                    <span className="font-mono-tabular text-slate-700 dark:text-slate-200 shrink-0">
                      <strong className={sub.violationCount > 0 ? 'text-rose-600 dark:text-rose-300' : ''}>
                        {sub.violationCount}
                      </strong>{' '}
                      fail · {sub.passedCount} pass
                      {sub.inconclusiveCount > 0 ? ` · ${sub.inconclusiveCount} inc` : ''}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500"
                      style={{ width: `${failBarW}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
