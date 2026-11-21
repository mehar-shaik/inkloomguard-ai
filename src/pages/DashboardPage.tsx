import React, { useEffect, useState } from 'react';
import {
  FileCheck2,
  AlertOctagon,
  Clock,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  ArrowUpRight,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Brand, DashboardData, PageKey } from '../types';
import { BrandAvatar, EmptyState, LoadingPanel, StatusBadge } from '../components/ClayUI';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatDateTime } from '../utils/date';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';

export function DashboardPage({
  userRole = 'reviewer',
  onNavigate,
  onSelectBrand,
  onSelectSubmission,
}: {
  userRole?: string;
  onNavigate: (page: PageKey) => void;
  onSelectBrand: (brandId: number) => void;
  onSelectSubmission: (submissionId: number, page: PageKey) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Brand Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [brandName, setBrandName] = useState('');
  const [industry, setIndustry] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#4F46E5');
  const [secondaryColor, setSecondaryColor] = useState('#06B6D4');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandError, setBrandError] = useState('');
  const [brandToDelete, setBrandToDelete] = useState<Brand | null>(null);
  const [deletingBrand, setDeletingBrand] = useState(false);
  const canManageBrands = userRole === 'reviewer' || userRole === 'admin';

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const res = await api.getDashboard();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function openCreateModal() {
    setEditingBrand(null);
    setBrandName('');
    setIndustry('');
    setPrimaryColor('#4F46E5');
    setSecondaryColor('#06B6D4');
    setLogoFile(null);
    setBrandError('');
    setModalOpen(true);
  }

  function openEditModal(brand: Brand) {
    setEditingBrand(brand);
    setBrandName(brand.name);
    setIndustry(brand.industry || '');
    setPrimaryColor(brand.primary_color || '#4F46E5');
    setSecondaryColor(brand.secondary_color || '#06B6D4');
    setLogoFile(null);
    setBrandError('');
    setModalOpen(true);
  }

  async function handleSaveBrand(e: React.FormEvent) {
    e.preventDefault();
    setBrandError('');
    setSavingBrand(true);
    try {
      const fd = new FormData();
      fd.append('name', brandName);
      fd.append('industry', industry);
      fd.append('primaryColor', primaryColor);
      fd.append('secondaryColor', secondaryColor);
      if (logoFile) fd.append('logo', logoFile);

      if (editingBrand) {
        await api.updateBrand(editingBrand.id, fd);
      } else {
        await api.createBrand(fd);
      }
      setModalOpen(false);
      await loadDashboard();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : 'Could not save brand.');
    } finally {
      setSavingBrand(false);
    }
  }

  async function handleConfirmDeleteBrand() {
    if (!brandToDelete) return;
    setDeletingBrand(true);
    try {
      await api.deleteBrand(brandToDelete.id);
      setBrandToDelete(null);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete brand.');
      setBrandToDelete(null);
    } finally {
      setDeletingBrand(false);
    }
  }

  if (loading) return <LoadingPanel label="Loading compliance metrics and brands..." />;

  if (error || !data) {
    return (
      <div className="clay-surface rounded-3xl p-8 text-center">
        <p className="text-sm font-semibold text-red-600 dark:text-rose-300 mb-4">{error || 'Unable to load data.'}</p>
        <button type="button" onClick={loadDashboard} className="clay-btn-primary rounded-full px-5 py-2 text-sm font-semibold cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Total Submissions',
      value: data.metrics.totalSubmissions,
      icon: FileCheck2,
      tint: 'bg-indigo-100 text-indigo-700 dark:bg-violet-500/20 dark:text-violet-300',
    },
    {
      label: 'Open Issues Found',
      value: data.metrics.issuesFound,
      icon: AlertOctagon,
      tint: 'bg-red-100 text-red-700 dark:bg-rose-500/20 dark:text-rose-300',
    },
    {
      label: 'Pending Reviews',
      value: data.metrics.pendingReviews,
      icon: Clock,
      tint: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    },
    {
      label: 'Approved Content',
      value: data.metrics.approvedContent,
      icon: CheckCircle2,
      tint: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    },
  ];

  return (
    <div className="space-y-7">
      {/* Hero Banner */}
      <section className="clay-surface rounded-[30px] p-6 sm:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <img
            src={shieldEmblem}
            alt="InkloomGuard AI Shield"
            referrerPolicy="no-referrer"
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover shadow-md border border-white/80 dark:border-violet-400/30 shrink-0"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300 mb-1">
              InkloomGuard AI Workspace
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white [text-wrap:balance]">
              Brand Compliance Command Center
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
              Manage your brand profiles, upload official guidelines, and audit copy or visual creatives across eight compliance dimensions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {canManageBrands && (
            <button
              type="button"
              onClick={openCreateModal}
              className="clay-btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              Add Brand
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('submit')}
            className="clay-btn-primary rounded-full px-6 py-2.5 text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            Submit Content
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* 4-Column KPI Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="clay-surface rounded-3xl p-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1.5">{kpi.label}</p>
                <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white tabular-nums">
                  {kpi.value}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${kpi.tint}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Brands & Recent Activity Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* User's Brands */}
        <section className="lg:col-span-7 clay-surface rounded-[28px] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Your Brands</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {canManageBrands
                  ? 'Manage logos, brand hex palettes, and jump straight to guideline rules.'
                  : 'Inspect brand profiles and view read-only guideline rules configured by reviewers.'}
              </p>
            </div>
            {canManageBrands && (
              <button
                type="button"
                onClick={openCreateModal}
                className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New Brand
              </button>
            )}
          </div>

          {data.brands.length === 0 ? (
            <EmptyState
              title="No brands configured yet"
              description={
                canManageBrands
                  ? 'Add your first brand profile with a logo and brand palette to begin uploading guidelines.'
                  : 'Awaiting a Brand Reviewer to configure the first brand profile for your organization.'
              }
              actionLabel={canManageBrands ? 'Add First Brand' : undefined}
              onAction={canManageBrands ? openCreateModal : undefined}
            />
          ) : (
            <div className="space-y-3">
              {data.brands.map((brand) => (
                <div
                  key={brand.id}
                  className="clay-well rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <BrandAvatar brand={brand} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">{brand.name}</h4>
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-white/70 shadow-xs shrink-0"
                          style={{ backgroundColor: brand.primary_color }}
                          title={`Primary: ${brand.primary_color}`}
                        />
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-white/70 shadow-xs shrink-0"
                          style={{ backgroundColor: brand.secondary_color }}
                          title={`Secondary: ${brand.secondary_color}`}
                        />
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        {brand.industry || 'General'} · {brand.factsCount ?? 0} facts · {brand.terminologyCount ?? 0} terms · {brand.submissionsCount ?? 0} audits
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectBrand(brand.id);
                        onNavigate('guidelines');
                      }}
                      className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Guidelines
                    </button>
                    {canManageBrands && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(brand)}
                          aria-label={`Edit ${brand.name}`}
                          className="clay-btn-secondary rounded-full p-2 text-slate-600 dark:text-slate-300 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setBrandToDelete(brand)}
                          aria-label={`Delete ${brand.name}`}
                          className="clay-btn-secondary rounded-full p-2 text-red-600 dark:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <section className="lg:col-span-5 clay-surface rounded-[28px] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Recent Activity</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Latest compliance scans and governance events.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-semibold text-indigo-600 dark:text-violet-300 hover:underline cursor-pointer whitespace-nowrap"
            >
              View All
            </button>
          </div>

          {data.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
              No submissions audited yet. Submit content to start your audit log.
            </p>
          ) : (
            <div className="space-y-3">
              {data.recentActivity.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSubmission(item.submission_id, 'analysis')}
                  className="w-full text-left clay-well rounded-2xl p-3.5 hover:ring-2 hover:ring-indigo-400/40 transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {item.submission_title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {item.brand_name} · {item.reviewer_name}
                      </p>
                    </div>
                    <StatusBadge status={item.decision === 'submitted' ? 'pending_review' : item.decision} />
                  </div>
                  {item.comment && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-2">{item.comment}</p>
                  )}
                  <p className="font-mono-tabular text-[11px] text-slate-400 mt-2">
                    {formatDateTime(item.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Add / Edit Brand Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="clay-surface rounded-[28px] max-w-lg w-full p-6 sm:p-8 relative">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              aria-label="Close modal"
              className="absolute right-5 top-5 clay-btn-secondary rounded-full p-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-xl font-extrabold text-slate-900 dark:text-white mb-1">
              {editingBrand ? 'Edit Brand Profile' : 'Add New Brand'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
              Configure your brand identity, official palette hex codes, and company logo.
            </p>

            <form onSubmit={handleSaveBrand} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                  Brand Name
                </label>
                <input
                  type="text"
                  required
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="e.g. AetherFlow Cloud"
                  className="clay-well w-full rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                  Industry / Category
                </label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Enterprise Software, FinTech, Healthcare"
                  className="clay-well w-full rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                    Primary Brand Color
                  </label>
                  <div className="clay-well rounded-2xl px-3 py-2 flex items-center gap-2.5">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#4F46E5'}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-full bg-transparent font-mono-tabular text-xs text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                    Secondary Accent Color
                  </label>
                  <div className="clay-well rounded-2xl px-3 py-2 flex items-center gap-2.5">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(secondaryColor) ? secondaryColor : '#06B6D4'}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 bg-transparent"
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-full bg-transparent font-mono-tabular text-xs text-slate-800 dark:text-slate-100 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                  Company Logo (PNG, JPG, WEBP, SVG — max 10 MB)
                </label>
                <label className="clay-well rounded-2xl p-4 border-2 border-dashed border-indigo-300/70 dark:border-violet-400/30 flex items-center justify-center gap-3 cursor-pointer hover:border-indigo-500 transition-colors">
                  <Upload className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {logoFile ? logoFile.name : editingBrand?.logo_original_name || 'Choose company logo file'}
                  </span>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.svg"
                    className="hidden"
                    onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              {brandError && (
                <div className="rounded-2xl px-4 py-2.5 text-xs font-semibold bg-red-50 text-red-800 dark:bg-rose-500/15 dark:text-rose-200">
                  {brandError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="clay-btn-secondary rounded-full px-5 py-2.5 text-sm font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBrand}
                  className="clay-btn-primary rounded-full px-6 py-2.5 text-sm font-semibold cursor-pointer disabled:opacity-60"
                >
                  {savingBrand ? 'Saving...' : editingBrand ? 'Save Changes' : 'Create Brand'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(brandToDelete)}
        title={brandToDelete ? `Delete "${brandToDelete.name}"?` : 'Delete Brand?'}
        message="This will permanently remove the brand profile and all associated guidelines, facts, terminology rules, and compliance submissions."
        confirmLabel="Delete Brand"
        variant="danger"
        loading={deletingBrand}
        onConfirm={handleConfirmDeleteBrand}
        onCancel={() => {
          if (!deletingBrand) setBrandToDelete(null);
        }}
      />
    </div>
  );
}
