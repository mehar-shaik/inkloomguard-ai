import React, { useEffect, useState } from 'react';
import {
  FileUp,
  BookOpen,
  Sparkles,
  Plus,
  Trash2,
  Save,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api';
import type { ApprovedFact, Brand, GuidelineDocument, PageKey, TerminologyRule } from '../types';
import { BrandAvatar, EmptyState, LoadingPanel } from '../components/ClayUI';

export function GuidelinesPage({
  selectedBrandId,
  onSelectBrand,
  onNavigate,
}: {
  selectedBrandId: number | null;
  onSelectBrand: (brandId: number) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<number | null>(selectedBrandId);
  const [documents, setDocuments] = useState<GuidelineDocument[]>([]);
  const [facts, setFacts] = useState<ApprovedFact[]>([]);
  const [terminology, setTerminology] = useState<TerminologyRule[]>([]);
  const [toneRules, setToneRules] = useState('');
  const [messagingRules, setMessagingRules] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [autoExtract, setAutoExtract] = useState(true);
  const [extractingDocId, setExtractingDocId] = useState<number | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);

  // New fact form
  const [factKey, setFactKey] = useState('');
  const [factValue, setFactValue] = useState('');
  const [factSource, setFactSource] = useState('Brand Fact Sheet');

  // New terminology form
  const [prohibitedTerm, setProhibitedTerm] = useState('');
  const [preferredTerm, setPreferredTerm] = useState('');
  const [termSeverity, setTermSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('high');
  const [termNotes, setTermNotes] = useState('');
  const [savingRules, setSavingRules] = useState(false);

  async function loadBrandList() {
    setLoading(true);
    try {
      const res = await api.getBrands();
      setBrands(res.brands);
      const targetId =
        selectedBrandId && res.brands.some((b) => b.id === selectedBrandId)
          ? selectedBrandId
          : res.brands[0]?.id || null;
      setActiveBrandId(targetId);
      if (targetId) {
        onSelectBrand(targetId);
        await loadBrandGuidelines(targetId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brands.');
    } finally {
      setLoading(false);
    }
  }

  async function loadBrandGuidelines(brandId: number) {
    setError('');
    try {
      const res = await api.getGuidelines(brandId);
      setDocuments(res.documents);
      setFacts(res.facts);
      setTerminology(res.terminology);
      setToneRules(res.rules.tone_rules || '');
      setMessagingRules(res.rules.messaging_rules || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guidelines.');
    }
  }

  useEffect(() => {
    loadBrandList();
  }, []);

  async function handleSelectBrand(brandId: number) {
    setActiveBrandId(brandId);
    onSelectBrand(brandId);
    setMessage('');
    await loadBrandGuidelines(brandId);
  }

  async function applyExtractedRules(
    brandId: number,
    extracted: {
      toneRules: string;
      messagingRules: string;
      facts: Array<{ fact_key: string; fact_value: string }>;
      terminology: Array<{ prohibited_term: string; preferred_term: string; severity: string; notes: string }>;
    },
    sourceName: string
  ) {
    const nextTone = extracted.toneRules || toneRules;
    const nextMsg = extracted.messagingRules || messagingRules;
    if (extracted.toneRules || extracted.messagingRules) {
      await api.saveBrandRules(brandId, nextTone, nextMsg);
    }
    for (const f of extracted.facts.slice(0, 12)) {
      if (f.fact_key && f.fact_value) {
        await api.addFact(brandId, {
          fact_key: f.fact_key,
          fact_value: f.fact_value,
          source_doc: sourceName,
        });
      }
    }
    for (const t of extracted.terminology.slice(0, 15)) {
      if (t.prohibited_term && t.preferred_term) {
        await api.addTerminology(brandId, {
          prohibited_term: t.prohibited_term,
          preferred_term: t.preferred_term,
          severity: t.severity || 'high',
          notes: t.notes || '',
        });
      }
    }
    await loadBrandGuidelines(brandId);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeBrandId) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('autoExtract', autoExtract ? 'true' : 'false');
      const res = await api.uploadGuidelineDoc(activeBrandId, fd);

      if (res.autoExtracted) {
        await applyExtractedRules(activeBrandId, res.autoExtracted, file.name);
        setMessage(`Uploaded "${file.name}" and extracted structured tone, messaging, facts, and terminology rules.`);
      } else {
        await loadBrandGuidelines(activeBrandId);
        setMessage(`Uploaded "${file.name}" and saved extracted text.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Guideline upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleAiExtractDoc(doc: GuidelineDocument) {
    if (!activeBrandId) return;
    setExtractingDocId(doc.id);
    setError('');
    setMessage('');
    try {
      const res = await api.aiExtractDoc(activeBrandId, doc.id);
      await applyExtractedRules(activeBrandId, res.extracted, doc.original_name);
      setMessage(`Extracted structured compliance rules from "${doc.original_name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI extraction failed.');
    } finally {
      setExtractingDocId(null);
    }
  }

  async function handleSaveToneMessaging(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBrandId) return;
    setSavingRules(true);
    setError('');
    setMessage('');
    try {
      await api.saveBrandRules(activeBrandId, toneRules, messagingRules);
      setMessage('Brand tone and messaging rules saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rules.');
    } finally {
      setSavingRules(false);
    }
  }

  async function handleAddFact(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBrandId || !factKey.trim() || !factValue.trim()) return;
    try {
      await api.addFact(activeBrandId, {
        fact_key: factKey,
        fact_value: factValue,
        source_doc: factSource,
      });
      setFactKey('');
      setFactValue('');
      await loadBrandGuidelines(activeBrandId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add approved fact.');
    }
  }

  async function handleAddTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBrandId || !prohibitedTerm.trim() || !preferredTerm.trim()) return;
    try {
      await api.addTerminology(activeBrandId, {
        prohibited_term: prohibitedTerm,
        preferred_term: preferredTerm,
        severity: termSeverity,
        notes: termNotes,
      });
      setProhibitedTerm('');
      setPreferredTerm('');
      setTermNotes('');
      await loadBrandGuidelines(activeBrandId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add terminology rule.');
    }
  }

  if (loading) return <LoadingPanel label="Loading brand guidelines..." />;

  if (brands.length === 0) {
    return (
      <EmptyState
        title="Add a brand before configuring guidelines"
        description="Create your first brand profile from the Dashboard to upload PDF/DOCX guidelines, approved facts, and terminology rules."
        actionLabel="Go to Dashboard"
        onAction={() => onNavigate('dashboard')}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Brand Selector Strip */}
      <section className="clay-surface rounded-[26px] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {brands.map((b) => {
            const active = b.id === activeBrandId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelectBrand(b.id)}
                className={`rounded-full px-4 py-2 text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer whitespace-nowrap ${
                  active ? 'clay-btn-primary' : 'clay-btn-secondary'
                }`}
              >
                <BrandAvatar brand={b} size="sm" />
                {b.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onNavigate('submit')}
          className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold cursor-pointer whitespace-nowrap"
        >
          Audit Content for Brand
        </button>
      </section>

      {message && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-400/30 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30">
          {error}
        </div>
      )}

      {/* Upload Guideline PDF / DOCX */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
              Upload Brand Guideline Documents
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Upload PDF, DOCX, or TXT files (max 10 MB). InkloomGuard AI extracts raw text and populates compliance rules.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autoExtract}
              onChange={(e) => setAutoExtract(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            Auto-extract rules on upload
          </label>
        </div>

        <label className="clay-well rounded-3xl p-8 border-2 border-dashed border-indigo-300 dark:border-violet-400/35 flex flex-col items-center justify-center text-center cursor-pointer hover:border-indigo-500 transition-colors">
          <div className="w-12 h-12 rounded-2xl clay-btn-primary flex items-center justify-center mb-3">
            <FileUp className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {uploading ? 'Extracting document text & rules...' : 'Click to upload PDF, DOCX, or TXT guideline'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Supports PDF, Word (.docx), Markdown, and Plain Text up to 10 MB
          </p>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            disabled={uploading}
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        {documents.length > 0 && (
          <div className="mt-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Uploaded Documents ({documents.length})
            </h3>
            {documents.map((doc) => (
              <div key={doc.id} className="clay-well rounded-2xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-5 h-5 text-indigo-600 dark:text-violet-300 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{doc.original_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                        {doc.file_type} · {doc.extracted_text.length.toLocaleString()} chars · {new Date(doc.created_at + 'Z').toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                      className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {expandedDocId === doc.id ? 'Hide Text' : 'Inspect Text'}
                    </button>
                    <button
                      type="button"
                      disabled={extractingDocId === doc.id}
                      onClick={() => handleAiExtractDoc(doc)}
                      className="clay-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      {extractingDocId === doc.id ? 'Extracting...' : 'Extract Rules'}
                    </button>
                  </div>
                </div>
                {expandedDocId === doc.id && (
                  <pre className="mt-3 p-3.5 rounded-xl bg-white/80 dark:bg-slate-950/60 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto font-mono-tabular">
                    {doc.extracted_text}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tone & Messaging Rules */}
      <form onSubmit={handleSaveToneMessaging} className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Brand Tone & Messaging Rules</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Used directly by the AI compliance engine to audit tone, voice, and core messaging alignment.
            </p>
          </div>
          <button
            type="submit"
            disabled={savingRules}
            className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {savingRules ? 'Saving...' : 'Save Tone & Messaging'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              Approved Brand Tone Rules
            </label>
            <textarea
              rows={5}
              value={toneRules}
              onChange={(e) => setToneRules(e.target.value)}
              placeholder="Describe approved voice, formality, emotional tone, and prohibited stylistic patterns..."
              className="clay-well w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              Approved Brand Messaging Pillars
            </label>
            <textarea
              rows={5}
              value={messagingRules}
              onChange={(e) => setMessagingRules(e.target.value)}
              placeholder="Define key value propositions, positioning statements, and audience messaging priorities..."
              className="clay-well w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
        </div>
      </form>

      {/* Approved Facts & Terminology Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Approved Company Facts */}
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Approved Company Facts</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Verified SLAs, certifications, dates, and metrics. Claims contradicting these are flagged.
            </p>
          </div>

          <form onSubmit={handleAddFact} className="space-y-3 clay-well rounded-2xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={factKey}
                onChange={(e) => setFactKey(e.target.value)}
                placeholder="Fact label (e.g. SLA Uptime)"
                className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <input
                type="text"
                value={factSource}
                onChange={(e) => setFactSource(e.target.value)}
                placeholder="Source document"
                className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={factValue}
                onChange={(e) => setFactValue(e.target.value)}
                placeholder="Verified fact statement (e.g. 99.95% contractual uptime SLA)"
                className="flex-1 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <button type="submit" className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </form>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {facts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">No approved facts added yet.</p>
            ) : (
              facts.map((f) => (
                <div key={f.id} className="clay-well rounded-2xl p-3.5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-indigo-700 dark:text-violet-300">{f.fact_key}</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">{f.fact_value}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Source: {f.source_doc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!activeBrandId) return;
                      await api.deleteFact(activeBrandId, f.id);
                      await loadBrandGuidelines(activeBrandId);
                    }}
                    aria-label="Delete fact"
                    className="text-slate-400 hover:text-red-600 dark:hover:text-rose-300 p-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Preferred & Prohibited Terminology */}
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Preferred & Prohibited Terminology</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enforced deterministically with exact pattern matching across all submitted drafts.
            </p>
          </div>

          <form onSubmit={handleAddTerm} className="space-y-3 clay-well rounded-2xl p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={prohibitedTerm}
                onChange={(e) => setProhibitedTerm(e.target.value)}
                placeholder="Prohibited word / phrase"
                className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <input
                type="text"
                required
                value={preferredTerm}
                onChange={(e) => setPreferredTerm(e.target.value)}
                placeholder="Preferred replacement"
                className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={termSeverity}
                onChange={(e) => setTermSeverity(e.target.value as 'critical' | 'high' | 'medium' | 'low')}
                className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="text"
                value={termNotes}
                onChange={(e) => setTermNotes(e.target.value)}
                placeholder="Optional rationale"
                className="flex-1 min-w-[140px] rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3.5 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
              />
              <button type="submit" className="clay-btn-primary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </form>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {terminology.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">No terminology rules added yet.</p>
            ) : (
              terminology.map((t) => (
                <div key={t.id} className="clay-well rounded-2xl p-3.5 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-red-700 dark:text-rose-300 line-through">{t.prohibited_term}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">{t.preferred_term}</span>
                      <span className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        · {t.severity}
                      </span>
                    </div>
                    {t.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!activeBrandId) return;
                      await api.deleteTerminology(activeBrandId, t.id);
                      await loadBrandGuidelines(activeBrandId);
                    }}
                    aria-label="Delete terminology rule"
                    className="text-slate-400 hover:text-red-600 dark:hover:text-rose-300 p-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
