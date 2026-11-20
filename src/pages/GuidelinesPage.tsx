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
  Lock,
  AlertTriangle,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  ApprovedFact,
  Brand,
  ExtractedGuidelinesPayload,
  GuidelineConflict,
  GuidelineDocument,
  PageKey,
  TerminologyRule,
} from '../types';
import { BrandAvatar, EmptyState, LoadingPanel } from '../components/ClayUI';
import { formatDate } from '../utils/date';

interface PendingProposalState {
  docId: number;
  docName: string;
  extracted: ExtractedGuidelinesPayload;
  conflicts: GuidelineConflict[];
  includeTone: boolean;
  includeMessaging: boolean;
  selectedFactIndices: number[];
  selectedTermIndices: number[];
  cached?: boolean;
}

export function GuidelinesPage({
  userRole = 'reviewer',
  selectedBrandId,
  onSelectBrand,
  onNavigate,
}: {
  userRole?: string;
  selectedBrandId: number | null;
  onSelectBrand: (brandId: number) => void;
  onNavigate: (page: PageKey) => void;
}) {
  const canEdit = userRole === 'reviewer';
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

  // Upload & proposal review state
  const [uploading, setUploading] = useState(false);
  const [autoExtract, setAutoExtract] = useState(true);
  const [extractingDocId, setExtractingDocId] = useState<number | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<number | null>(null);
  const [pendingProposal, setPendingProposal] = useState<PendingProposalState | null>(null);
  const [applyingProposal, setApplyingProposal] = useState(false);

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
    setPendingProposal(null);
    await loadBrandGuidelines(brandId);
  }

  function stageExtractionProposal(
    docId: number,
    docName: string,
    extracted: ExtractedGuidelinesPayload,
    conflicts: GuidelineConflict[] = [],
    cached = false
  ) {
    setPendingProposal({
      docId,
      docName,
      extracted,
      conflicts,
      includeTone: Boolean(extracted.toneRules?.trim()),
      includeMessaging: Boolean(extracted.messagingRules?.trim()),
      selectedFactIndices: extracted.facts.map((_, idx) => idx),
      selectedTermIndices: extracted.terminology.map((_, idx) => idx),
      cached,
    });
  }

  async function handleApproveProposal() {
    if (!activeBrandId || !pendingProposal || applyingProposal) return;
    setApplyingProposal(true);
    setError('');
    setMessage('');
    try {
      const { docId, docName, extracted, includeTone, includeMessaging, selectedFactIndices, selectedTermIndices } =
        pendingProposal;
      const chosenFacts = extracted.facts.filter((_, i) => selectedFactIndices.includes(i));
      const chosenTerms = extracted.terminology.filter((_, i) => selectedTermIndices.includes(i));

      const res = await api.applyExtractedGuidelines(activeBrandId, {
        sourceDocId: docId,
        sourceDoc: docName,
        toneRules: includeTone ? extracted.toneRules : '',
        messagingRules: includeMessaging ? extracted.messagingRules : '',
        facts: chosenFacts,
        terminology: chosenTerms,
      });

      setFacts(res.facts);
      setTerminology(res.terminology);
      setToneRules(res.rules.tone_rules || '');
      setMessagingRules(res.rules.messaging_rules || '');
      setPendingProposal(null);
      setMessage(
        `Applied rules from "${docName}": +${res.summary.factsAdded} facts, +${res.summary.terminologyAdded} terminology rules` +
          (res.summary.factsSkipped + res.summary.terminologySkipped > 0
            ? ` (${res.summary.factsSkipped + res.summary.terminologySkipped} duplicates or conflicts skipped).`
            : '.')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply extracted guidelines.');
    } finally {
      setApplyingProposal(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeBrandId || !canEdit) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('document', file);
      fd.append('autoExtract', autoExtract ? 'true' : 'false');
      const res = await api.uploadGuidelineDoc(activeBrandId, fd);
      await loadBrandGuidelines(activeBrandId);

      if (res.autoExtracted) {
        stageExtractionProposal(res.document.id, res.document.original_name, res.autoExtracted, res.conflicts || []);
        setMessage(
          `Uploaded "${file.name}" and extracted proposed rules below. Review and approve before applying to this brand.`
        );
      } else if (res.extractionError) {
        setMessage(`Uploaded "${file.name}" (document saved). AI extraction could not complete: ${res.extractionError}`);
      } else {
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
    if (!activeBrandId || !canEdit) return;
    setExtractingDocId(doc.id);
    setError('');
    setMessage('');
    try {
      const res = await api.aiExtractDoc(activeBrandId, doc.id);
      stageExtractionProposal(doc.id, doc.original_name, res.extracted, res.conflicts || [], Boolean(res.cached));
      setMessage(
        `Extracted candidate rules from "${doc.original_name}"${res.cached ? ' (cached)' : ''}. Review and approve below before saving.`
      );
    } catch (err) {
      await loadBrandGuidelines(activeBrandId).catch(() => {});
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

      {!canEdit && (
        <div className="rounded-2xl px-4 py-3 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30 flex items-center gap-2">
          <Lock className="w-4 h-4 shrink-0" />
          Read-only view: Author role can inspect approved brand guidelines, facts, and terminology. Reviewer permissions are required to upload documents or edit rules.
        </div>
      )}

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

      {/* Review-Before-Apply Extraction Proposal */}
      {canEdit && pendingProposal && (
        <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-5 border-2 border-indigo-300/80 dark:border-violet-400/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
                Review Extracted Rules — {pendingProposal.docName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Inspect AI-extracted guidelines, facts, and terminology rules before committing them to your brand profile.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPendingProposal(null)}
                className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Discard
              </button>
              <button
                type="button"
                disabled={applyingProposal}
                onClick={handleApproveProposal}
                className="clay-btn-primary rounded-full px-5 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {applyingProposal ? 'Applying...' : 'Approve & Apply Selected'}
              </button>
            </div>
          </div>

          {pendingProposal.conflicts.length > 0 && (
            <div className="rounded-2xl p-4 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 space-y-1.5">
              <p className="text-xs font-extrabold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {pendingProposal.conflicts.length} Potential Rule Conflict{pendingProposal.conflicts.length > 1 ? 's' : ''} Detected
              </p>
              <ul className="text-xs text-amber-800/90 dark:text-amber-200/90 list-disc pl-5 space-y-0.5">
                {pendingProposal.conflicts.map((c, idx) => (
                  <li key={idx}>{c.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {pendingProposal.extracted.toneRules && (
              <label className="clay-well rounded-2xl p-4 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pendingProposal.includeTone}
                  onChange={(e) =>
                    setPendingProposal((p) => (p ? { ...p, includeTone: e.target.checked } : p))
                  }
                  className="mt-1 w-4 h-4 rounded accent-indigo-600"
                />
                <div className="min-w-0 text-xs space-y-1">
                  <p className="font-bold text-slate-900 dark:text-white">Proposed Tone Rules</p>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {pendingProposal.extracted.toneRules}
                  </p>
                </div>
              </label>
            )}
            {pendingProposal.extracted.messagingRules && (
              <label className="clay-well rounded-2xl p-4 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pendingProposal.includeMessaging}
                  onChange={(e) =>
                    setPendingProposal((p) => (p ? { ...p, includeMessaging: e.target.checked } : p))
                  }
                  className="mt-1 w-4 h-4 rounded accent-indigo-600"
                />
                <div className="min-w-0 text-xs space-y-1">
                  <p className="font-bold text-slate-900 dark:text-white">Proposed Messaging Pillars</p>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {pendingProposal.extracted.messagingRules}
                  </p>
                </div>
              </label>
            )}
          </div>

          {pendingProposal.extracted.facts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Extracted Company Facts ({pendingProposal.selectedFactIndices.length}/{pendingProposal.extracted.facts.length} selected)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                {pendingProposal.extracted.facts.map((f, idx) => {
                  const checked = pendingProposal.selectedFactIndices.includes(idx);
                  return (
                    <label key={idx} className="clay-well rounded-xl p-3 flex items-start gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setPendingProposal((p) => {
                            if (!p) return p;
                            const next = e.target.checked
                              ? [...p.selectedFactIndices, idx]
                              : p.selectedFactIndices.filter((i) => i !== idx);
                            return { ...p, selectedFactIndices: next };
                          });
                        }}
                        className="mt-0.5 w-4 h-4 rounded accent-indigo-600"
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-indigo-700 dark:text-violet-300">{f.fact_key}</p>
                        <p className="text-slate-800 dark:text-slate-200">{f.fact_value}</p>
                        {(f.source_page || f.source_section) && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {f.source_page ? `Page ${f.source_page}` : ''}
                            {f.source_page && f.source_section ? ' · ' : ''}
                            {f.source_section || ''}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {pendingProposal.extracted.terminology.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Extracted Terminology Rules ({pendingProposal.selectedTermIndices.length}/{pendingProposal.extracted.terminology.length} selected)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                {pendingProposal.extracted.terminology.map((t, idx) => {
                  const checked = pendingProposal.selectedTermIndices.includes(idx);
                  return (
                    <label key={idx} className="clay-well rounded-xl p-3 flex items-start gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setPendingProposal((p) => {
                            if (!p) return p;
                            const next = e.target.checked
                              ? [...p.selectedTermIndices, idx]
                              : p.selectedTermIndices.filter((i) => i !== idx);
                            return { ...p, selectedTermIndices: next };
                          });
                        }}
                        className="mt-0.5 w-4 h-4 rounded accent-indigo-600"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold">
                          <span className="line-through text-red-700 dark:text-rose-300 mr-1.5">{t.prohibited_term}</span>
                          <span className="text-slate-400 mr-1.5">→</span>
                          <span className="text-emerald-700 dark:text-emerald-300 font-bold">{t.preferred_term}</span>
                        </p>
                        {t.notes && <p className="text-slate-500 dark:text-slate-400 mt-0.5">{t.notes}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Upload Guideline PDF / DOCX */}
      <section className="clay-surface rounded-[28px] p-6 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
              {canEdit ? 'Upload Brand Guideline Documents' : 'Brand Guideline Documents'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {canEdit
                ? 'Upload PDF, DOCX, or TXT files (max 10 MB). InkloomGuard AI extracts raw text and stages compliance rules for review.'
                : 'Official uploaded guideline documents and extracted policy text for this brand.'}
            </p>
          </div>
          {canEdit && (
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoExtract}
                onChange={(e) => setAutoExtract(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              Stage extracted rules on upload
            </label>
          )}
        </div>

        {canEdit && (
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
        )}

        {documents.length === 0 && !canEdit && (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
            No guideline documents uploaded for this brand yet.
          </p>
        )}

        {documents.length > 0 && (
          <div className={`${canEdit ? 'mt-5' : ''} space-y-3`}>
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
                        {doc.file_type}
                        {doc.page_count ? ` · ${doc.page_count} page${doc.page_count > 1 ? 's' : ''}` : ''} ·{' '}
                        {doc.extracted_text.length.toLocaleString()} chars · {formatDate(doc.created_at)}
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
                    {canEdit && (
                      <button
                        type="button"
                        disabled={extractingDocId === doc.id}
                        onClick={() => handleAiExtractDoc(doc)}
                        className="clay-btn-primary rounded-full px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {extractingDocId === doc.id ? 'Extracting...' : 'Extract Rules'}
                      </button>
                    )}
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
          {canEdit && (
            <button
              type="submit"
              disabled={savingRules}
              className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {savingRules ? 'Saving...' : 'Save Tone & Messaging'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              Approved Brand Tone Rules
            </label>
            <textarea
              rows={5}
              readOnly={!canEdit}
              value={toneRules}
              onChange={(e) => setToneRules(e.target.value)}
              placeholder={canEdit ? 'Describe approved voice, formality, emotional tone, and prohibited stylistic patterns...' : 'No tone rules configured.'}
              className="clay-well w-full rounded-2xl p-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
              Approved Brand Messaging Pillars
            </label>
            <textarea
              rows={5}
              readOnly={!canEdit}
              value={messagingRules}
              onChange={(e) => setMessagingRules(e.target.value)}
              placeholder={canEdit ? 'Define key value propositions, positioning statements, and audience messaging priorities...' : 'No messaging rules configured.'}
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

          {canEdit && (
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
          )}

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {facts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">No approved facts added yet.</p>
            ) : (
              facts.map((f) => (
                <div key={f.id} className="clay-well rounded-2xl p-3.5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-indigo-700 dark:text-violet-300">{f.fact_key}</p>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5">{f.fact_value}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Source: {f.source_doc}
                      {f.source_page ? ` · p.${f.source_page}` : ''}
                      {f.source_section ? ` · ${f.source_section}` : ''}
                    </p>
                  </div>
                  {canEdit && (
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
                  )}
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

          {canEdit && (
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
          )}

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
                  {canEdit && (
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
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
