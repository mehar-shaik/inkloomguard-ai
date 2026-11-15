import React, { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Send, UploadCloud, Loader2 } from 'lucide-react';
import { api } from '../api';
import type { Brand, PageKey } from '../types';
import { BrandAvatar, EmptyState, LoadingPanel } from '../components/ClayUI';

export function SubmitPage({
  selectedBrandId,
  onSelectBrand,
  onSubmitted,
  onNavigate,
}: {
  selectedBrandId: number | null;
  onSelectBrand: (brandId: number) => void;
  onSubmitted: (submissionId: number) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<number | null>(selectedBrandId);
  const [title, setTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageAltText, setImageAltText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function loadBrands() {
    setLoading(true);
    setError('');
    try {
      const res = await api.getBrands();
      const validBrands = res.brands.filter(
        (b): b is Brand => Boolean(b && typeof b.id === 'number')
      );
      setBrands(validBrands);
      const target =
        selectedBrandId && validBrands.some((b) => b.id === selectedBrandId)
          ? selectedBrandId
          : validBrands[0]?.id ?? null;
      setBrandId(target);
      if (target !== null) {
        onSelectBrand(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brands.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBrands();
  }, []);

  useEffect(() => {
    if (selectedBrandId && brands.some((b) => b.id === selectedBrandId)) {
      setBrandId(selectedBrandId);
    }
  }, [selectedBrandId, brands]);

  function handleImageSelect(file: File | null) {
    setImageFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!brandId || !brands.some((b) => b.id === brandId)) {
      setError('Please select a valid brand profile before submitting content.');
      return;
    }
    if (!title.trim()) {
      setError('Please enter a submission title.');
      return;
    }
    if (!pastedText.trim() && !docFile && !imageFile) {
      setError('Please paste text, upload a PDF/DOCX document, or attach an image.');
      return;
    }

    setSubmitting(true);

    try {
      const fd = new FormData();
      fd.append('brandId', String(brandId));
      fd.append('title', title.trim());
      fd.append('pastedText', pastedText);
      fd.append('imageAltText', imageAltText);
      if (docFile) fd.append('document', docFile);
      if (imageFile) fd.append('image', imageFile);

      const res = await api.createSubmission(fd);
      const createdId = res?.submission?.id;
      if (typeof createdId !== 'number' || createdId <= 0) {
        throw new Error('Submission could not be opened because the server did not return a valid submission ID.');
      }
      onSelectBrand(brandId);
      onSubmitted(createdId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingPanel label="Loading brand profiles..." />;

  if (error && brands.length === 0) {
    return (
      <div className="clay-surface rounded-3xl p-8 text-center space-y-4">
        <p className="text-sm font-semibold text-red-600 dark:text-rose-300">{error}</p>
        <button
          type="button"
          onClick={loadBrands}
          className="clay-btn-primary rounded-full px-5 py-2 text-sm font-semibold cursor-pointer"
        >
          Retry Loading Brands
        </button>
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <EmptyState
        title="No brands available for auditing"
        description="Create a brand profile on the Dashboard before submitting content for compliance analysis."
        actionLabel="Create Brand"
        onAction={() => onNavigate('dashboard')}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl">
      {/* Brand & Title Selection */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-8 space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Submit Content for Brand Audit</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Paste marketing copy, upload PDF/DOCX documents, or attach an image asset to run all 8 InkloomGuard AI compliance checks.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
            Target Brand Profile
          </label>
          <div className="flex flex-wrap gap-3">
            {brands.map((b) => {
              const active = b.id === brandId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBrandId(b.id);
                    onSelectBrand(b.id);
                  }}
                  className={`rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-2.5 cursor-pointer transition-all whitespace-nowrap ${
                    active ? 'clay-btn-primary' : 'clay-btn-secondary'
                  }`}
                >
                  <BrandAvatar brand={b} size="sm" />
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
            Submission Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q1 Product Release Announcement / LinkedIn Carousel Copy"
            className="clay-well w-full rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>
      </section>

      {/* Text & Document Input */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section className="lg:col-span-7 clay-surface rounded-[28px] p-6 sm:p-7 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <label className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              Paste Content Copy
            </label>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
              {pastedText.length.toLocaleString()} chars
            </span>
          </div>
          <textarea
            rows={10}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste article draft, landing page copy, press release, or Markdown headings (# H1, ## H2)..."
            className="clay-well flex-1 w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </section>

        {/* File & Image Upload Zones */}
        <section className="lg:col-span-5 clay-surface rounded-[28px] p-6 sm:p-7 space-y-5">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              Upload Document (Optional)
            </h3>
            <label className="clay-well rounded-2xl p-4 border-2 border-dashed border-indigo-300/70 dark:border-violet-400/30 flex items-center justify-between gap-3 cursor-pointer hover:border-indigo-500 transition-colors">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                {docFile ? docFile.name : 'Choose PDF, DOCX, or TXT (max 10 MB)'}
              </span>
              {docFile && (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.preventDefault();
                    setDocFile(null);
                  }}
                  className="text-xs font-bold text-red-600 dark:text-rose-300 shrink-0 cursor-pointer"
                >
                  Remove
                </button>
              )}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              Upload Visual Asset (Optional)
            </h3>
            <label className="clay-well rounded-2xl p-4 border-2 border-dashed border-indigo-300/70 dark:border-violet-400/30 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-indigo-500 transition-colors text-center">
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="max-h-32 rounded-xl object-contain"
                />
              ) : (
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Attach PNG, JPG, or WEBP for Visual Identity & Contrast audit
                </span>
              )}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={(e) => handleImageSelect(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>

            {imageFile && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300 truncate">{imageFile.name}</span>
                  <button
                    type="button"
                    onClick={() => handleImageSelect(null)}
                    className="font-bold text-red-600 dark:text-rose-300 cursor-pointer"
                  >
                    Remove Image
                  </button>
                </div>
                <input
                  type="text"
                  value={imageAltText}
                  onChange={(e) => setImageAltText(e.target.value)}
                  placeholder="Image alt-text description (checked for accessibility)"
                  className="clay-well w-full rounded-2xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-4">
        <button
          type="submit"
          disabled={submitting}
          className="clay-btn-primary rounded-full px-7 py-3.5 text-sm font-bold inline-flex items-center gap-2.5 cursor-pointer disabled:opacity-65"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing across 8 brand compliance areas...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Save & Run Compliance Analysis
            </>
          )}
        </button>
      </div>
    </form>
  );
}
