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
  Palette,
  Image as ImageIcon,
  Type as TypeIcon,
  Shield,
} from 'lucide-react';
import { api } from '../api';
import type {
  ApprovedFact,
  Brand,
  BrandLogoVariant,
  BrandVisualGuidelinesConfig,
  ExtractedGuidelinesPayload,
  GuidelineConflict,
  GuidelineDocument,
  PageKey,
  TerminologyRule,
} from '../types';
import { BrandAvatar, EmptyState, LoadingPanel, ProtectedImage } from '../components/ClayUI';
import { formatDate } from '../utils/date';

const EMPTY_VISUAL_GUIDELINES: BrandVisualGuidelinesConfig = {
  accentColors: [],
  approvedBackgrounds: [],
  logoRules: {
    logoRequired: null,
    minWidthPx: null,
    clearSpaceRatio: null,
    allowedPlacements: [],
    prohibitedMisuse: [],
    notes: '',
  },
  typographyRules: {
    primaryFont: '',
    secondaryFont: '',
    headingStyle: '',
    bodyStyle: '',
    notes: '',
  },
};

const PLACEMENT_ZONES = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

function hasExtractedVisualData(vg?: BrandVisualGuidelinesConfig | null): boolean {
  if (!vg) return false;
  return Boolean(
    vg.accentColors?.length ||
      vg.approvedBackgrounds?.length ||
      vg.logoRules?.logoRequired !== null ||
      vg.logoRules?.minWidthPx !== null ||
      vg.logoRules?.clearSpaceRatio !== null ||
      vg.logoRules?.allowedPlacements?.length ||
      vg.logoRules?.prohibitedMisuse?.length ||
      vg.logoRules?.notes ||
      vg.typographyRules?.primaryFont ||
      vg.typographyRules?.secondaryFont ||
      vg.typographyRules?.headingStyle ||
      vg.typographyRules?.bodyStyle ||
      vg.typographyRules?.notes
  );
}

interface PendingProposalState {
  docId: number;
  docName: string;
  extracted: ExtractedGuidelinesPayload;
  conflicts: GuidelineConflict[];
  includeTone: boolean;
  includeMessaging: boolean;
  includeVisual: boolean;
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
  const canEdit = userRole === 'reviewer' || userRole === 'admin';
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

  // Visual brand guidelines & logo variants
  const [visualGuidelines, setVisualGuidelines] = useState<BrandVisualGuidelinesConfig>(EMPTY_VISUAL_GUIDELINES);
  const [logoVariants, setLogoVariants] = useState<BrandLogoVariant[]>([]);
  const [savingVisual, setSavingVisual] = useState(false);
  const [uploadingVariant, setUploadingVariant] = useState(false);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantType, setVariantType] = useState('secondary');
  const [newAccentHex, setNewAccentHex] = useState('#4F46E5');
  const [newBgHex, setNewBgHex] = useState('#FFFFFF');
  const [newMisuseRule, setNewMisuseRule] = useState('');

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
      setVisualGuidelines(res.visualGuidelines || EMPTY_VISUAL_GUIDELINES);
      setLogoVariants(res.logoVariants || []);
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
      includeVisual: hasExtractedVisualData(extracted.visualGuidelines),
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
      const {
        docId,
        docName,
        extracted,
        includeTone,
        includeMessaging,
        includeVisual,
        selectedFactIndices,
        selectedTermIndices,
      } = pendingProposal;
      const chosenFacts = extracted.facts.filter((_, i) => selectedFactIndices.includes(i));
      const chosenTerms = extracted.terminology.filter((_, i) => selectedTermIndices.includes(i));

      const res = await api.applyExtractedGuidelines(activeBrandId, {
        sourceDocId: docId,
        sourceDoc: docName,
        toneRules: includeTone ? extracted.toneRules : '',
        messagingRules: includeMessaging ? extracted.messagingRules : '',
        facts: chosenFacts,
        terminology: chosenTerms,
        visualGuidelines: includeVisual ? extracted.visualGuidelines : undefined,
      });

      setFacts(res.facts);
      setTerminology(res.terminology);
      setToneRules(res.rules.tone_rules || '');
      setMessagingRules(res.rules.messaging_rules || '');
      if (res.visualGuidelines) {
        setVisualGuidelines(res.visualGuidelines);
      }
      setPendingProposal(null);
      setMessage(
        `Applied rules from "${docName}": +${res.summary.factsAdded} facts, +${res.summary.terminologyAdded} terminology rules` +
          (res.summary.visualUpdated ? ', +visual brand specs' : '') +
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

  async function handleSaveVisualGuidelines() {
    if (!activeBrandId || !canEdit) return;
    setSavingVisual(true);
    setError('');
    setMessage('');
    try {
      const res = await api.saveVisualGuidelines(activeBrandId, visualGuidelines);
      setVisualGuidelines(res.visualGuidelines);
      setMessage('Visual brand guidelines, logo rules, and typography rules saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save visual guidelines.');
    } finally {
      setSavingVisual(false);
    }
  }

  async function handleUploadLogoVariant(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeBrandId || !canEdit) return;
    setUploadingVariant(true);
    setError('');
    setMessage('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      fd.append('label', variantLabel.trim() || file.name.replace(/\.[^.]+$/, ''));
      fd.append('variantType', variantType);
      const res = await api.uploadLogoVariant(activeBrandId, fd);
      setLogoVariants((prev) => [...prev, res.variant]);
      setVariantLabel('');
      setMessage(`Uploaded logo reference variant "${res.variant.label}" (${res.variant.width}×${res.variant.height}px).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload logo variant.');
    } finally {
      setUploadingVariant(false);
      e.target.value = '';
    }
  }

  async function handleDeleteLogoVariant(variantId: number) {
    if (!activeBrandId || !canEdit) return;
    setError('');
    try {
      await api.deleteLogoVariant(activeBrandId, variantId);
      setLogoVariants((prev) => prev.filter((v) => v.id !== variantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete logo variant.');
    }
  }

  function addHexToList(field: 'accentColors' | 'approvedBackgrounds', rawHex: string) {
    const clean = rawHex.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(clean) && !/^#[0-9A-F]{3}$/.test(clean)) {
      setError(`Invalid hex color "${rawHex}". Use #RRGGBB format.`);
      return;
    }
    const expanded =
      clean.length === 4
        ? `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`
        : clean;
    setError('');
    setVisualGuidelines((prev) => ({
      ...prev,
      [field]: prev[field].includes(expanded) ? prev[field] : [...prev[field], expanded],
    }));
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

          {hasExtractedVisualData(pendingProposal.extracted.visualGuidelines) && pendingProposal.extracted.visualGuidelines && (
            <label className="clay-well rounded-2xl p-4 flex items-start gap-3 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={pendingProposal.includeVisual}
                onChange={(e) =>
                  setPendingProposal((p) => (p ? { ...p, includeVisual: e.target.checked } : p))
                }
                className="mt-0.5 w-4 h-4 rounded accent-indigo-600"
              />
              <div className="min-w-0 space-y-1.5">
                <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Palette className="w-3.5 h-3.5 text-indigo-600 dark:text-violet-300" />
                  Proposed Visual Brand Guidelines
                </p>
                <div className="flex flex-wrap gap-3 text-slate-600 dark:text-slate-300">
                  {pendingProposal.extracted.visualGuidelines.accentColors.length > 0 && (
                    <span>Accents: {pendingProposal.extracted.visualGuidelines.accentColors.join(', ')}</span>
                  )}
                  {pendingProposal.extracted.visualGuidelines.approvedBackgrounds.length > 0 && (
                    <span>Backgrounds: {pendingProposal.extracted.visualGuidelines.approvedBackgrounds.join(', ')}</span>
                  )}
                  {pendingProposal.extracted.visualGuidelines.logoRules.minWidthPx && (
                    <span>Min Logo Width: {pendingProposal.extracted.visualGuidelines.logoRules.minWidthPx}px</span>
                  )}
                  {pendingProposal.extracted.visualGuidelines.logoRules.clearSpaceRatio && (
                    <span>Clear Space: {pendingProposal.extracted.visualGuidelines.logoRules.clearSpaceRatio}×</span>
                  )}
                  {pendingProposal.extracted.visualGuidelines.typographyRules.primaryFont && (
                    <span>Primary Font: {pendingProposal.extracted.visualGuidelines.typographyRules.primaryFont}</span>
                  )}
                </div>
              </div>
            </label>
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

      {/* Visual Brand Guidelines & Official Logo Variants */}
      {(() => {
        const activeBrand = brands.find((b) => b.id === activeBrandId) || null;
        return (
          <section className="clay-surface rounded-[28px] p-6 sm:p-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Palette className="w-5 h-5 text-indigo-600 dark:text-violet-300" />
                  Visual Brand Guidelines &amp; Logo References
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Separate visual brand specs &amp; approved logo variants evaluated by the visual compliance detector on submitted images.
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  disabled={savingVisual}
                  onClick={handleSaveVisualGuidelines}
                  className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {savingVisual ? 'Saving Visual Rules...' : 'Save Visual Guidelines'}
                </button>
              )}
            </div>

            {/* Brand Core & Extended Palette */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="clay-well rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Core &amp; Accent Colors</p>
                  {activeBrand && (
                    <div className="flex items-center gap-2 text-[11px] font-mono-tabular text-slate-600 dark:text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full border border-white/70" style={{ backgroundColor: activeBrand.primary_color }} />
                        Primary {activeBrand.primary_color}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-3 h-3 rounded-full border border-white/70" style={{ backgroundColor: activeBrand.secondary_color }} />
                        Secondary {activeBrand.secondary_color}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {visualGuidelines.accentColors.length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">No accent colors specified.</span>
                  ) : (
                    visualGuidelines.accentColors.map((hex) => (
                      <span
                        key={hex}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-violet-400/25 px-2.5 py-1 text-xs font-mono-tabular"
                      >
                        <span className="w-3.5 h-3.5 rounded-md border border-slate-300" style={{ backgroundColor: hex }} />
                        {hex}
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={`Remove accent color ${hex}`}
                            onClick={() =>
                              setVisualGuidelines((prev) => ({
                                ...prev,
                                accentColors: prev.accentColors.filter((c) => c !== hex),
                              }))
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(newAccentHex) ? newAccentHex : '#4F46E5'}
                      onChange={(e) => setNewAccentHex(e.target.value.toUpperCase())}
                      aria-label="Pick accent color"
                      className="w-8 h-8 rounded-lg border border-slate-200 dark:border-violet-400/30 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={newAccentHex}
                      onChange={(e) => setNewAccentHex(e.target.value)}
                      placeholder="#0EA5E9"
                      className="flex-1 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-1.5 text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => addHexToList('accentColors', newAccentHex)}
                      className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Accent
                    </button>
                  </div>
                )}
              </div>

              <div className="clay-well rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Approved Background Colors</p>
                <div className="flex flex-wrap gap-2">
                  {visualGuidelines.approvedBackgrounds.length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">No restricted backgrounds configured.</span>
                  ) : (
                    visualGuidelines.approvedBackgrounds.map((hex) => (
                      <span
                        key={hex}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-violet-400/25 px-2.5 py-1 text-xs font-mono-tabular"
                      >
                        <span className="w-3.5 h-3.5 rounded-md border border-slate-300" style={{ backgroundColor: hex }} />
                        {hex}
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={`Remove background color ${hex}`}
                            onClick={() =>
                              setVisualGuidelines((prev) => ({
                                ...prev,
                                approvedBackgrounds: prev.approvedBackgrounds.filter((c) => c !== hex),
                              }))
                            }
                            className="text-slate-400 hover:text-red-600 cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(newBgHex) ? newBgHex : '#FFFFFF'}
                      onChange={(e) => setNewBgHex(e.target.value.toUpperCase())}
                      aria-label="Pick background color"
                      className="w-8 h-8 rounded-lg border border-slate-200 dark:border-violet-400/30 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={newBgHex}
                      onChange={(e) => setNewBgHex(e.target.value)}
                      placeholder="#FFFFFF"
                      className="flex-1 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-1.5 text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => addHexToList('approvedBackgrounds', newBgHex)}
                      className="clay-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Background
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Official Logo Reference Variants */}
            <div className="clay-well rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                    Official Brand Logo &amp; Approved Variants
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Upload secondary, dark-mode, light-mode, monochrome, or icon lockup variants for multi-variant matching.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeBrand?.logo_filename && (
                  <div className="rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-violet-400/20 p-3 flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center p-1.5 shrink-0">
                      <ProtectedImage
                        filename={activeBrand.logo_filename}
                        alt={`${activeBrand.name} primary logo`}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">Primary Brand Logo</p>
                      <p className="text-[11px] text-indigo-700 dark:text-violet-300 font-semibold">Primary · From Brand Profile</p>
                    </div>
                  </div>
                )}

                {logoVariants.map((variant) => (
                  <div
                    key={variant.id}
                    className="rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-violet-400/20 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center p-1.5 shrink-0">
                        <ProtectedImage
                          filename={variant.filename}
                          alt={variant.label}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{variant.label}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                          {variant.variant_type} · <span className="font-mono-tabular">{variant.width}×{variant.height} ({variant.aspect_ratio}:1)</span>
                        </p>
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteLogoVariant(variant.id)}
                        aria-label={`Delete logo variant ${variant.label}`}
                        className="text-slate-400 hover:text-red-600 dark:hover:text-rose-300 p-1.5 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200/70 dark:border-violet-400/20">
                  <input
                    type="text"
                    value={variantLabel}
                    onChange={(e) => setVariantLabel(e.target.value)}
                    placeholder="Variant label (e.g. Monochrome White Lockup)"
                    className="flex-1 min-w-[180px] rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                  <select
                    value={variantType}
                    onChange={(e) => setVariantType(e.target.value)}
                    aria-label="Logo variant type"
                    className="rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="secondary">Secondary</option>
                    <option value="dark">Dark Surface</option>
                    <option value="light">Light Surface</option>
                    <option value="monochrome">Monochrome</option>
                    <option value="icon">Icon Mark</option>
                    <option value="primary">Primary Alternate</option>
                  </select>
                  <label className="clay-btn-secondary rounded-full px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                    <FileUp className="w-3.5 h-3.5" />
                    {uploadingVariant ? 'Uploading...' : 'Upload Logo Variant'}
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg"
                      disabled={uploadingVariant}
                      onChange={handleUploadLogoVariant}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Logo Usage Rules & Typography Rules */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="clay-well rounded-2xl p-4 space-y-4">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                  Logo Usage &amp; Proportion Rules
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Logo Requirement
                    </label>
                    <select
                      disabled={!canEdit}
                      value={
                        visualGuidelines.logoRules.logoRequired === true
                          ? 'required'
                          : visualGuidelines.logoRules.logoRequired === false
                            ? 'optional'
                            : 'unspecified'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setVisualGuidelines((prev) => ({
                          ...prev,
                          logoRules: {
                            ...prev.logoRules,
                            logoRequired: v === 'required' ? true : v === 'optional' ? false : null,
                          },
                        }));
                      }}
                      className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="unspecified">Not specified</option>
                      <option value="required">Required on assets</option>
                      <option value="optional">Optional</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Min Logo Width (px)
                    </label>
                    <input
                      type="number"
                      min={8}
                      max={4000}
                      readOnly={!canEdit}
                      value={visualGuidelines.logoRules.minWidthPx ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setVisualGuidelines((prev) => ({
                          ...prev,
                          logoRules: {
                            ...prev.logoRules,
                            minWidthPx: val ? Number(val) : null,
                          },
                        }));
                      }}
                      placeholder="e.g. 64"
                      className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Clear Space Ratio (× height)
                    </label>
                    <input
                      type="number"
                      min={0.05}
                      max={3}
                      step={0.05}
                      readOnly={!canEdit}
                      value={visualGuidelines.logoRules.clearSpaceRatio ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setVisualGuidelines((prev) => ({
                          ...prev,
                          logoRules: {
                            ...prev.logoRules,
                            clearSpaceRatio: val ? Number(val) : null,
                          },
                        }));
                      }}
                      placeholder="e.g. 0.25"
                      className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs font-mono-tabular text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">
                    Allowed Placement Zones (leave unchecked for any zone)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PLACEMENT_ZONES.map((zone) => {
                      const active = visualGuidelines.logoRules.allowedPlacements.includes(zone);
                      return (
                        <label
                          key={zone}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold border cursor-pointer ${
                            active
                              ? 'bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-violet-500/20 dark:text-violet-200 dark:border-violet-400/40'
                              : 'bg-white/70 text-slate-600 border-slate-200 dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={active}
                            onChange={(e) => {
                              setVisualGuidelines((prev) => ({
                                ...prev,
                                logoRules: {
                                  ...prev.logoRules,
                                  allowedPlacements: e.target.checked
                                    ? [...prev.logoRules.allowedPlacements, zone]
                                    : prev.logoRules.allowedPlacements.filter((z) => z !== zone),
                                },
                              }));
                            }}
                            className="w-3.5 h-3.5 accent-indigo-600"
                          />
                          {zone}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">Prohibited Logo Misuse</p>
                  {visualGuidelines.logoRules.prohibitedMisuse.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-slate-900/50 rounded-lg px-2.5 py-1.5">
                      <span>{rule}</span>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            setVisualGuidelines((prev) => ({
                              ...prev,
                              logoRules: {
                                ...prev.logoRules,
                                prohibitedMisuse: prev.logoRules.prohibitedMisuse.filter((_, i) => i !== idx),
                              },
                            }))
                          }
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newMisuseRule}
                        onChange={(e) => setNewMisuseRule(e.target.value)}
                        placeholder="e.g. Never stretch, rotate, or place drop-shadows on the wordmark"
                        className="flex-1 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newMisuseRule.trim()) return;
                          setVisualGuidelines((prev) => ({
                            ...prev,
                            logoRules: {
                              ...prev.logoRules,
                              prohibitedMisuse: [...prev.logoRules.prohibitedMisuse, newMisuseRule.trim()],
                            },
                          }));
                          setNewMisuseRule('');
                        }}
                        className="clay-btn-secondary rounded-full px-3 py-1.5 text-xs font-bold cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="clay-well rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <TypeIcon className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
                  Typography &amp; Visual Hierarchy Rules
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Primary Brand Font
                    </label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={visualGuidelines.typographyRules.primaryFont}
                      onChange={(e) =>
                        setVisualGuidelines((prev) => ({
                          ...prev,
                          typographyRules: { ...prev.typographyRules, primaryFont: e.target.value },
                        }))
                      }
                      placeholder="e.g. Inter / Plus Jakarta Sans"
                      className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                      Secondary / Accent Font
                    </label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={visualGuidelines.typographyRules.secondaryFont}
                      onChange={(e) =>
                        setVisualGuidelines((prev) => ({
                          ...prev,
                          typographyRules: { ...prev.typographyRules, secondaryFont: e.target.value },
                        }))
                      }
                      placeholder="e.g. JetBrains Mono"
                      className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Heading Style &amp; Hierarchy
                  </label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={visualGuidelines.typographyRules.headingStyle}
                    onChange={(e) =>
                      setVisualGuidelines((prev) => ({
                        ...prev,
                        typographyRules: { ...prev.typographyRules, headingStyle: e.target.value },
                      }))
                    }
                    placeholder="e.g. Bold geometric sans, sentence case, tight tracking"
                    className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">
                    Body Copy &amp; Contrast Notes
                  </label>
                  <textarea
                    rows={3}
                    readOnly={!canEdit}
                    value={visualGuidelines.typographyRules.bodyStyle}
                    onChange={(e) =>
                      setVisualGuidelines((prev) => ({
                        ...prev,
                        typographyRules: { ...prev.typographyRules, bodyStyle: e.target.value },
                      }))
                    }
                    placeholder="e.g. High contrast sans-serif, avoid decorative script fonts"
                    className="w-full rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-violet-400/25 px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </section>
        );
      })()}

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
                        setError('');
                        try {
                          await api.deleteFact(activeBrandId, f.id);
                          await loadBrandGuidelines(activeBrandId);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to delete approved fact.');
                        }
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
                        setError('');
                        try {
                          await api.deleteTerminology(activeBrandId, t.id);
                          await loadBrandGuidelines(activeBrandId);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to delete terminology rule.');
                        }
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
