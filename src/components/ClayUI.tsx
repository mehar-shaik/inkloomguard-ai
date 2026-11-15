import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Sun,
  Moon,
  ShieldCheck,
} from 'lucide-react';
import { fetchProtectedAssetBlobUrl } from '../api';
import type { Brand } from '../types';

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === 'approved' || normalized === 'passed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 bg-emerald-50 text-emerald-800 border border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/35">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {normalized === 'passed' ? 'Passed' : 'Approved'}
      </span>
    );
  }
  if (normalized === 'rejected' || normalized === 'issues_found') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 bg-red-50 text-red-800 border border-red-200/80 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/35">
        <XCircle className="w-3.5 h-3.5" />
        {normalized === 'issues_found' ? 'Issues Found' : 'Rejected'}
      </span>
    );
  }
  if (normalized === 'changes_requested' || normalized === 'warning') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 bg-amber-50 text-amber-800 border border-amber-200/80 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/35">
        <AlertTriangle className="w-3.5 h-3.5" />
        {normalized === 'warning' ? 'Attention' : 'Changes Requested'}
      </span>
    );
  }
  if (normalized === 'not_performed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700">
        <MinusCircle className="w-3.5 h-3.5" />
        Not Performed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0 bg-indigo-50 text-indigo-800 border border-indigo-200/80 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-400/35">
      <Clock className="w-3.5 h-3.5" />
      {normalized === 'analyzed' ? 'Analyzed' : 'Pending Review'}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  if (s === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 bg-red-100 text-red-900 dark:bg-rose-500/20 dark:text-rose-200">
        Critical
      </span>
    );
  }
  if (s === 'high') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 bg-orange-100 text-orange-900 dark:bg-amber-500/20 dark:text-amber-200">
        High
      </span>
    );
  }
  if (s === 'medium') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 bg-amber-100 text-amber-900 dark:bg-yellow-500/20 dark:text-yellow-200">
        Medium
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0 bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200">
      Low
    </span>
  );
}

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: 'light' | 'dark';
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === 'dark' ? 'Switch to light clay mode' : 'Switch to dark clay mode'}
      className="clay-btn-secondary relative inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
    >
      {theme === 'dark' ? (
        <>
          <Sun className="w-4 h-4 text-amber-300" />
          <span className="hidden sm:inline">Light Clay</span>
        </>
      ) : (
        <>
          <Moon className="w-4 h-4 text-indigo-600" />
          <span className="hidden sm:inline">Dark Clay</span>
        </>
      )}
    </button>
  );
}

export function ProtectedImage({
  filename,
  alt,
  className,
  fallback,
}: {
  filename: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setFailed(false);
    setBlobUrl(null);

    fetchProtectedAssetBlobUrl(filename)
      .then((url) => {
        createdUrl = url;
        if (active) setBlobUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [filename]);

  if (failed) {
    return <>{fallback ?? null}</>;
  }

  if (!blobUrl) {
    return <div className={`${className || ''} animate-pulse bg-indigo-100/60 dark:bg-violet-900/40`} />;
  }

  return <img src={blobUrl} alt={alt} referrerPolicy="no-referrer" className={className} />;
}

export function BrandAvatar({ brand, size = 'md' }: { brand: Brand; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'w-9 h-9 rounded-xl' : size === 'lg' ? 'w-14 h-14 rounded-2xl' : 'w-11 h-11 rounded-2xl';
  const monogramFallback = (
    <div
      className={`${dims} flex items-center justify-center font-bold text-white shadow-sm shrink-0`}
      style={{
        background: `linear-gradient(135deg, ${brand.primary_color || '#4F46E5'}, ${brand.secondary_color || '#06B6D4'})`,
      }}
    >
      {brand.name.slice(0, 2).toUpperCase()}
    </div>
  );

  if (brand.logo_filename) {
    return (
      <ProtectedImage
        filename={brand.logo_filename}
        alt={`${brand.name} logo`}
        className={`${dims} object-cover border border-white/80 dark:border-violet-400/30 shadow-sm bg-white shrink-0`}
        fallback={monogramFallback}
      />
    );
  }
  return monogramFallback;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="clay-surface rounded-3xl p-10 text-center flex flex-col items-center justify-center max-w-xl mx-auto">
      <div className="w-14 h-14 rounded-2xl clay-well flex items-center justify-center mb-4 text-indigo-600 dark:text-violet-300">
        <ShieldCheck className="w-7 h-7" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mb-6">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="clay-btn-primary rounded-full px-6 py-2.5 text-sm font-semibold cursor-pointer whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function LoadingPanel({ label = 'Loading workspace data...' }: { label?: string }) {
  return (
    <div className="clay-surface rounded-3xl p-8 space-y-4 animate-pulse">
      <div className="h-5 w-48 rounded-full bg-indigo-100 dark:bg-violet-900/50" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-24 rounded-2xl bg-indigo-50 dark:bg-violet-950/60" />
        <div className="h-24 rounded-2xl bg-indigo-50 dark:bg-violet-950/60" />
        <div className="h-24 rounded-2xl bg-indigo-50 dark:bg-violet-950/60" />
      </div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
