import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import type { ImageAnalysisMetrics } from './parsers.ts';

export interface ApprovedFactInput {
  id: number;
  fact_key: string;
  fact_value: string;
  source_doc: string;
}

export interface TerminologyRuleInput {
  id: number;
  prohibited_term: string;
  preferred_term: string;
  severity: string;
  notes: string;
}

export interface BrandContext {
  brandId: number;
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  logoPath?: string | null;
  toneRules: string;
  messagingRules: string;
  facts: ApprovedFactInput[];
  terminology: TerminologyRuleInput[];
}

export interface CheckAreaSummary {
  area:
    | 'Brand Tone'
    | 'Terminology'
    | 'Brand Messaging'
    | 'Facts'
    | 'Promotional Claims'
    | 'Visual Identity'
    | 'Accessibility'
    | 'Governance';
  status: 'passed' | 'issues_found' | 'warning' | 'not_performed';
  summary: string;
}

export interface DetectedIssue {
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  original_text: string;
  explanation: string;
  evidence: string;
  suggested_correction: string;
}

export interface ComplianceAnalysisResult {
  checks: CheckAreaSummary[];
  issues: DetectedIssue[];
  suggestedRevisedContent: string;
  aiError?: string;
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 20_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|ECONNRESET)\b/i.test(msg);
}

export function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Gemini AI request failed.');
  if (/AbortError|TimeoutError|timed out|aborted/i.test(raw)) {
    return 'Gemini AI request timed out. Deterministic compliance checks were still completed.';
  }
  if (/\b503\b|UNAVAILABLE|high demand/i.test(raw)) {
    return 'Gemini AI service is temporarily experiencing high demand (503). Please try again shortly.';
  }
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return 'Gemini AI rate limit or quota reached (429). Please retry in a moment.';
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED|\b403\b|\b401\b/i.test(raw)) {
    return 'Gemini API authentication failed. Please verify the server GEMINI_API_KEY configuration.';
  }
  return raw.length > 220 ? raw.slice(0, 220) + '...' : raw;
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  maxAttempts = 2,
  timeoutMs = 20_000
) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const mergedConfig = {
        ...params.config,
        abortSignal: params.config?.abortSignal ?? AbortSignal.timeout(timeoutMs),
      };
      return await ai.models.generateContent({
        ...params,
        config: mergedConfig,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts && isTransientGeminiError(err)) {
        const delayMs = 800 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runDeterministicTerminologyChecks(
  content: string,
  rules: TerminologyRuleInput[]
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  if (!content.trim() || rules.length === 0) return issues;

  for (const rule of rules) {
    const term = rule.prohibited_term.trim();
    if (!term) continue;

    // If preferred term differs only by casing from prohibited term, use case-sensitive match
    const caseOnlyDiff =
      term.toLowerCase() === rule.preferred_term.trim().toLowerCase() &&
      term !== rule.preferred_term.trim();

    const flags = caseOnlyDiff ? 'g' : 'gi';
    const regex = new RegExp(`(?<!\\w)${escapeRegExp(term)}(?!\\w)`, flags);
    const matches = content.match(regex);

    if (matches && matches.length > 0) {
      issues.push({
        category: 'Terminology',
        severity: (['critical', 'high', 'medium', 'low'].includes(rule.severity)
          ? rule.severity
          : 'high') as DetectedIssue['severity'],
        original_text: matches[0],
        explanation: `Prohibited or non-standard term "${matches[0]}" detected (${matches.length} occurrence${matches.length > 1 ? 's' : ''}).${rule.notes ? ` ${rule.notes}` : ''}`,
        evidence: `Terminology Rule #${rule.id}: Prohibited "${rule.prohibited_term}" -> Preferred "${rule.preferred_term}"`,
        suggested_correction: rule.preferred_term,
      });
    }
  }

  return issues;
}

function runDeterministicFactAndClaimChecks(
  content: string,
  facts: ApprovedFactInput[]
): { factIssues: DetectedIssue[]; claimIssues: DetectedIssue[] } {
  const factIssues: DetectedIssue[] = [];
  const claimIssues: DetectedIssue[] = [];
  if (!content.trim()) return { factIssues, claimIssues };

  // Check percentage / SLA contradictions against approved facts containing percentages
  const contentPercentages: string[] = content.match(/\b\d{1,3}(?:\.\d+)?%\b/g) || [];
  for (const fact of facts) {
    const factPercentages: string[] = fact.fact_value.match(/\b\d{1,3}(?:\.\d+)?%\b/g) || [];
    if (factPercentages.length > 0 && /uptime|sla|availability|guarantee/i.test(fact.fact_key + ' ' + fact.fact_value)) {
      for (const pct of contentPercentages) {
        if (!factPercentages.includes(pct) && /uptime|availability|sla/i.test(content)) {
          // Check nearby context
          const idx = content.indexOf(pct);
          const windowText = content.slice(Math.max(0, idx - 30), Math.min(content.length, idx + 45));
          if (/uptime|sla|availability/i.test(windowText)) {
            factIssues.push({
              category: 'Facts',
              severity: 'critical',
              original_text: windowText.trim(),
              explanation: `Numeric figure "${pct}" conflicts with approved company fact "${fact.fact_key}".`,
              evidence: `Approved Fact [${fact.fact_key}] (${fact.source_doc}): "${fact.fact_value}"`,
              suggested_correction: fact.fact_value,
            });
          }
        }
      }
    }
  }

  // Deterministic promotional superlative / absolute claims check
  const claimPatterns: Array<{ pattern: RegExp; reason: string; suggestion: string }> = [
    {
      pattern: /\b(#1|number one|best in the world|world's best|unbeatable|zero-risk|zero risk|risk-free|100% guaranteed|guaranteed results?)\b/gi,
      reason: 'Absolute superlative or unsubstantiated guarantee creates regulatory and brand trust risk.',
      suggestion: 'Replace absolute claim with verifiable, measured product capabilities.',
    },
  ];

  for (const cp of claimPatterns) {
    const matches = content.match(cp.pattern);
    if (matches && matches.length > 0) {
      const uniqueMatches = Array.from(new Set(matches.map((m) => m.trim())));
      for (const match of uniqueMatches) {
        claimIssues.push({
          category: 'Promotional Claims',
          severity: 'high',
          original_text: match,
          explanation: cp.reason,
          evidence: 'Promotional Claims Standard: Unsubstantiated superlatives and absolute guarantees are prohibited unless directly backed by approved evidence.',
          suggested_correction: cp.suggestion,
        });
      }
    }
  }

  return { factIssues, claimIssues };
}

function runDeterministicAccessibilityChecks(
  content: string,
  hasImage: boolean,
  imageAltText: string,
  imageMetrics: ImageAnalysisMetrics | null
): { issues: DetectedIssue[]; status: CheckAreaSummary['status']; summary: string } {
  const issues: DetectedIssue[] = [];

  if (hasImage) {
    const cleanAlt = imageAltText.trim();
    if (!cleanAlt) {
      issues.push({
        category: 'Accessibility',
        severity: 'high',
        original_text: '[Attached Image: Missing Alt-Text]',
        explanation: 'Submitted visual asset has no alternative text description for screen readers.',
        evidence: 'Accessibility Standard (WCAG 2.1 AA 1.1.1): All non-decorative images require descriptive alt text.',
        suggested_correction: 'Provide a concise, descriptive alt-text summarizing the visual content and any embedded headline.',
      });
    } else if (cleanAlt.length < 10 || /^(image|photo|banner|graphic|picture)$/i.test(cleanAlt)) {
      issues.push({
        category: 'Accessibility',
        severity: 'medium',
        original_text: cleanAlt,
        explanation: 'Alt-text is too brief or generic to meaningfully describe the visual asset.',
        evidence: 'Accessibility Standard (WCAG 2.1 AA 1.1.1): Alt text must convey the purpose and content of the graphic.',
        suggested_correction: 'Expand alt-text to describe the visual subject, brand context, and any visible headline text.',
      });
    }

    if (imageMetrics && imageMetrics.contrastSpread < 3.0) {
      issues.push({
        category: 'Accessibility',
        severity: 'medium',
        original_text: `Image Luminance Contrast Spread: ${imageMetrics.contrastSpread}:1`,
        explanation: `Measured dynamic luminance contrast (${imageMetrics.contrastSpread}:1) is low, which can impair legibility for text overlays or foreground marks.`,
        evidence: `Accessibility Contrast Measurement (WCAG AA recommends >= 4.5:1 for normal text / >= 3.0:1 for large graphics).`,
        suggested_correction: 'Increase foreground-to-background luminance separation in the graphic asset.',
      });
    }
  }

  if (content.trim()) {
    // Heading hierarchy check (Markdown or HTML headings)
    const mdHeadings = Array.from(content.matchAll(/^(#{1,6})\s+(.+)$/gm)).map((m) => m[1].length);
    const htmlHeadings = Array.from(content.matchAll(/<h([1-6])\b[^>]*>/gi)).map((m) => Number(m[1]));
    const levels = mdHeadings.length > 0 ? mdHeadings : htmlHeadings;

    if (levels.length > 0) {
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] - levels[i - 1] > 1) {
          issues.push({
            category: 'Accessibility',
            severity: 'low',
            original_text: `Heading jump H${levels[i - 1]} -> H${levels[i]}`,
            explanation: `Heading hierarchy skips a level (H${levels[i - 1]} followed directly by H${levels[i]}), disrupting assistive navigation.`,
            evidence: 'Accessibility Standard (WCAG 1.3.1): Headings should follow a sequential hierarchy without skipping levels.',
            suggested_correction: `Adjust H${levels[i]} to H${levels[i - 1] + 1}.`,
          });
          break;
        }
      }
    }

    // Long sentence readability check
    const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    const overlyLong = sentences.find((s) => s.split(/\s+/).length > 45);
    if (overlyLong) {
      issues.push({
        category: 'Accessibility',
        severity: 'low',
        original_text: overlyLong.slice(0, 120) + (overlyLong.length > 120 ? '...' : ''),
        explanation: `Sentence exceeds 45 words (${overlyLong.split(/\s+/).length} words), reducing readability for cognitive accessibility.`,
        evidence: 'Accessibility Readability Guideline: Keep sentences concise (under 35-40 words) for clear comprehension.',
        suggested_correction: 'Split into two shorter, direct sentences.',
      });
    }
  }

  if (!hasImage && !content.trim()) {
    return {
      issues,
      status: 'not_performed',
      summary: 'Not performed — no text or image payload provided.',
    };
  }

  return {
    issues,
    status: issues.length > 0 ? 'issues_found' : 'passed',
    summary:
      issues.length > 0
        ? `${issues.length} accessibility issue${issues.length > 1 ? 's' : ''} detected.`
        : hasImage
          ? 'Alt-text, luminance contrast spread, and structure checks passed.'
          : 'Heading structure and readability checks passed.',
  };
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

export async function runFullComplianceAnalysis(params: {
  content: string;
  brand: BrandContext;
  hasImage: boolean;
  imagePath?: string | null;
  imageBuffer?: Buffer | null;
  imageMimeType?: string | null;
  imageAltText: string;
  imageMetrics: ImageAnalysisMetrics | null;
}): Promise<ComplianceAnalysisResult> {
  const { content, brand, hasImage, imagePath, imageBuffer, imageMimeType, imageAltText, imageMetrics } = params;

  const deterministicTermIssues = runDeterministicTerminologyChecks(content, brand.terminology);
  const { factIssues: detFactIssues, claimIssues: detClaimIssues } = runDeterministicFactAndClaimChecks(
    content,
    brand.facts
  );
  const a11y = runDeterministicAccessibilityChecks(content, hasImage, imageAltText, imageMetrics);

  const allIssues: DetectedIssue[] = [
    ...deterministicTermIssues,
    ...detFactIssues,
    ...detClaimIssues,
    ...a11y.issues,
  ];

  // Visual Identity deterministic color check when image is attached
  let visualStatus: CheckAreaSummary['status'] = 'not_performed';
  let visualSummary = 'Not performed — text-only submission with no image asset attached.';
  const visualIssues: DetectedIssue[] = [];

  if (hasImage && imageMetrics) {
    const dist = imageMetrics.brandPrimaryMatchDistance;
    if (dist !== null && dist > 110) {
      visualIssues.push({
        category: 'Visual Identity',
        severity: 'medium',
        original_text: `Dominant palette: ${imageMetrics.dominantColors.slice(0, 4).join(', ')}`,
        explanation: `Image palette lacks close alignment with brand primary color ${brand.primaryColor} (closest RGB distance: ${dist}).`,
        evidence: `Brand Visual Profile [${brand.brandName}]: Primary Color ${brand.primaryColor}, Secondary Color ${brand.secondaryColor}.`,
        suggested_correction: `Incorporate brand primary (${brand.primaryColor}) or secondary (${brand.secondaryColor}) accents in foreground or key graphic elements.`,
      });
    }
    visualStatus = visualIssues.length > 0 ? 'issues_found' : 'passed';
    visualSummary =
      visualIssues.length > 0
        ? `Color palette deviation detected from ${brand.primaryColor}.`
        : `Image (${imageMetrics.width}x${imageMetrics.height}) aligns with brand palette ${brand.primaryColor}.`;
  }

  let toneStatus: CheckAreaSummary['status'] = brand.toneRules.trim() ? 'passed' : 'not_performed';
  let toneSummary = brand.toneRules.trim()
    ? 'Content aligns with saved brand tone rules.'
    : 'Not performed — no Brand Tone rules configured for this brand.';

  let messagingStatus: CheckAreaSummary['status'] = brand.messagingRules.trim() ? 'passed' : 'not_performed';
  let messagingSummary = brand.messagingRules.trim()
    ? 'Content aligns with saved brand messaging pillars.'
    : 'Not performed — no Brand Messaging rules configured for this brand.';

  let aiError: string | undefined;
  let suggestedRevisedContent = content;

  // Apply deterministic terminology replacements as baseline
  for (const rule of brand.terminology) {
    if (!rule.prohibited_term.trim()) continue;
    const caseOnly =
      rule.prohibited_term.trim().toLowerCase() === rule.preferred_term.trim().toLowerCase() &&
      rule.prohibited_term.trim() !== rule.preferred_term.trim();
    const regex = new RegExp(`(?<!\\w)${escapeRegExp(rule.prohibited_term.trim())}(?!\\w)`, caseOnly ? 'g' : 'gi');
    suggestedRevisedContent = suggestedRevisedContent.replace(regex, rule.preferred_term.trim());
  }

  const ai = getAiClient();
  const shouldRunTextAI = Boolean(content.trim());
  const hasVisionPayload = Boolean(imageBuffer && imageBuffer.length > 0) || Boolean(imagePath && fs.existsSync(imagePath));
  const shouldRunVisionAI = Boolean(hasImage && hasVisionPayload);

  if (ai && (shouldRunTextAI || shouldRunVisionAI)) {
    try {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      if (shouldRunVisionAI) {
        const imgDataBuffer =
          imageBuffer && imageBuffer.length > 0
            ? imageBuffer
            : imagePath
              ? fs.readFileSync(imagePath)
              : null;
        if (imgDataBuffer) {
          parts.push({
            inlineData: {
              mimeType: imageMimeType || (imagePath ? getMimeType(imagePath) : 'image/png'),
              data: imgDataBuffer.toString('base64'),
            },
          });
        }
      }

      const promptText = `You are InkloomGuard AI, an enterprise brand compliance auditor for "${brand.brandName}".

STRICT GROUNDING RULES (CRITICAL):
1. NEVER invent, fabricate, or paraphrase non-existent guideline rules or company facts.
2. Every issue's "evidence" field MUST cite verbatim from the provided Tone Rules, Messaging Rules, Approved Facts, or Brand Visual Profile below—or if flagging an unsupported promotional superlative, explicitly cite "Promotional Claims Policy".
3. Do NOT duplicate issues already obvious from exact single-word prohibited terminology unless needed for sentence-level rewrite coherence.
4. If Tone Rules are empty, do NOT evaluate Brand Tone. If Messaging Rules are empty, do NOT evaluate Brand Messaging.
5. For "suggestedRevisedContent", rewrite the submitted content cleanly preserving its structure while fixing all tone, messaging, terminology, fact, and promotional claim issues using ONLY approved facts.

BRAND PROFILE:
- Brand Name: ${brand.brandName}
- Brand Primary Color: ${brand.primaryColor}
- Brand Secondary Color: ${brand.secondaryColor}
- Brand Tone Rules: ${brand.toneRules.trim() || '(NONE CONFIGURED)'}
- Brand Messaging Rules: ${brand.messagingRules.trim() || '(NONE CONFIGURED)'}
- Approved Company Facts:
${brand.facts.length > 0 ? brand.facts.map((f) => `  * [${f.fact_key}]: ${f.fact_value} (Source: ${f.source_doc})`).join('\n') : '  (NONE CONFIGURED)'}
- Prohibited -> Preferred Terminology:
${brand.terminology.length > 0 ? brand.terminology.map((t) => `  * "${t.prohibited_term}" -> "${t.preferred_term}"`).join('\n') : '  (NONE CONFIGURED)'}

${
  shouldRunVisionAI && imageMetrics
    ? `IMAGE METRICS:
- Dimensions: ${imageMetrics.width}x${imageMetrics.height}
- Dominant Hex Colors: ${imageMetrics.dominantColors.join(', ')}
- Alt-Text Provided: "${imageAltText || '(none)'}"
Evaluate logo/brand mark visibility, visual tone consistency, and any visible text inside the image against the Brand Profile.`
    : ''
}

SUBMITTED CONTENT TO AUDIT:
"""
${content || '(Image-only submission)'}
"""`;

      parts.push({ text: promptText });

      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              toneCompliant: { type: Type.BOOLEAN },
              toneSummary: { type: Type.STRING },
              messagingCompliant: { type: Type.BOOLEAN },
              messagingSummary: { type: Type.STRING },
              visualCompliant: { type: Type.BOOLEAN },
              visualSummary: { type: Type.STRING },
              issues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: 'One of: Brand Tone, Brand Messaging, Facts, Promotional Claims, Visual Identity',
                    },
                    severity: {
                      type: Type.STRING,
                      description: 'One of: critical, high, medium, low',
                    },
                    original_text: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    evidence: { type: Type.STRING },
                    suggested_correction: { type: Type.STRING },
                  },
                  required: ['category', 'severity', 'original_text', 'explanation', 'evidence', 'suggested_correction'],
                },
              },
              suggestedRevisedContent: { type: Type.STRING },
            },
            required: ['toneCompliant', 'toneSummary', 'messagingCompliant', 'messagingSummary', 'issues', 'suggestedRevisedContent'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        toneCompliant?: boolean;
        toneSummary?: string;
        messagingCompliant?: boolean;
        messagingSummary?: string;
        visualCompliant?: boolean;
        visualSummary?: string;
        issues?: DetectedIssue[];
        suggestedRevisedContent?: string;
      };

      if (brand.toneRules.trim()) {
        toneStatus = parsed.toneCompliant ? 'passed' : 'issues_found';
        if (parsed.toneSummary) toneSummary = parsed.toneSummary;
      }

      if (brand.messagingRules.trim()) {
        messagingStatus = parsed.messagingCompliant ? 'passed' : 'issues_found';
        if (parsed.messagingSummary) messagingSummary = parsed.messagingSummary;
      }

      if (shouldRunVisionAI) {
        if (parsed.visualSummary) visualSummary = parsed.visualSummary;
        if (parsed.visualCompliant === false) visualStatus = 'issues_found';
      }

      if (Array.isArray(parsed.issues)) {
        for (const item of parsed.issues) {
          const dup = allIssues.some(
            (existing) =>
              existing.category.toLowerCase() === item.category.toLowerCase() &&
              existing.original_text.toLowerCase() === item.original_text.toLowerCase()
          );
          if (!dup && item.original_text && item.explanation) {
            allIssues.push({
              category: item.category,
              severity: (['critical', 'high', 'medium', 'low'].includes(item.severity)
                ? item.severity
                : 'medium') as DetectedIssue['severity'],
              original_text: item.original_text,
              explanation: item.explanation,
              evidence: item.evidence || 'Brand Guidelines Reference',
              suggested_correction: item.suggested_correction || '',
            });
          }
        }
      }

      if (parsed.suggestedRevisedContent && parsed.suggestedRevisedContent.trim() && content.trim()) {
        suggestedRevisedContent = parsed.suggestedRevisedContent.trim();
      }
    } catch (err) {
      aiError = formatGeminiError(err);
      if (brand.toneRules.trim()) {
        toneStatus = 'not_performed';
        toneSummary = `Not performed — AI evaluation error: ${aiError}`;
      }
      if (brand.messagingRules.trim()) {
        messagingStatus = 'not_performed';
        messagingSummary = `Not performed — AI evaluation error: ${aiError}`;
      }
    }
  } else if (!ai) {
    if (brand.toneRules.trim()) {
      toneStatus = 'not_performed';
      toneSummary = 'Not performed — Gemini API key not configured on server.';
    }
    if (brand.messagingRules.trim()) {
      messagingStatus = 'not_performed';
      messagingSummary = 'Not performed — Gemini API key not configured on server.';
    }
  }

  for (const vi of visualIssues) {
    allIssues.push(vi);
  }

  const termIssuesCount = allIssues.filter((i) => i.category === 'Terminology').length;
  const factIssuesCount = allIssues.filter((i) => i.category === 'Facts').length;
  const claimIssuesCount = allIssues.filter((i) => i.category === 'Promotional Claims').length;

  const checks: CheckAreaSummary[] = [
    { area: 'Brand Tone', status: toneStatus, summary: toneSummary },
    {
      area: 'Terminology',
      status:
        brand.terminology.length === 0
          ? 'not_performed'
          : termIssuesCount > 0
            ? 'issues_found'
            : 'passed',
      summary:
        brand.terminology.length === 0
          ? 'Not performed — no terminology rules configured for this brand.'
          : termIssuesCount > 0
            ? `${termIssuesCount} prohibited or non-standard term${termIssuesCount > 1 ? 's' : ''} matched.`
            : `Checked against ${brand.terminology.length} terminology rules — zero violations.`,
    },
    { area: 'Brand Messaging', status: messagingStatus, summary: messagingSummary },
    {
      area: 'Facts',
      status:
        brand.facts.length === 0
          ? 'not_performed'
          : factIssuesCount > 0
            ? 'issues_found'
            : 'passed',
      summary:
        brand.facts.length === 0
          ? 'Not performed — no approved company facts configured for this brand.'
          : factIssuesCount > 0
            ? `${factIssuesCount} factual contradiction${factIssuesCount > 1 ? 's' : ''} against approved company facts.`
            : `Verified against ${brand.facts.length} approved company facts.`,
    },
    {
      area: 'Promotional Claims',
      status: !content.trim() ? 'not_performed' : claimIssuesCount > 0 ? 'issues_found' : 'passed',
      summary: !content.trim()
        ? 'Not performed — no copy text submitted.'
        : claimIssuesCount > 0
          ? `${claimIssuesCount} unsupported promotional claim${claimIssuesCount > 1 ? 's' : ''} flagged.`
          : 'No unsubstantiated superlatives or absolute promises detected.',
    },
    { area: 'Visual Identity', status: visualStatus, summary: visualSummary },
    { area: 'Accessibility', status: a11y.status, summary: a11y.summary },
    {
      area: 'Governance',
      status: 'warning',
      summary: 'Analysis saved. Ready for revision and human reviewer approval.',
    },
  ];

  return {
    checks,
    issues: allIssues,
    suggestedRevisedContent,
    aiError,
  };
}

export async function extractStructuredGuidelinesFromText(rawText: string, sourceName: string): Promise<{
  toneRules: string;
  messagingRules: string;
  facts: Array<{ fact_key: string; fact_value: string }>;
  terminology: Array<{ prohibited_term: string; preferred_term: string; severity: string; notes: string }>;
}> {
  const ai = getAiClient();
  if (!ai) {
    throw new Error('Gemini API key is not configured on the server.');
  }

  const response = await generateContentWithRetry(ai, {
    model: 'gemini-4-hydrogen',
    contents: `Extract structured brand compliance rules ONLY from the following uploaded brand guideline document ("${sourceName}").
Do NOT invent any facts, terminology, or rules that are not present in the document.

DOCUMENT TEXT:
"""
${rawText.slice(0, 24000)}
"""`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          toneRules: { type: Type.STRING, description: 'Concise summary of voice & tone rules stated in the document' },
          messagingRules: { type: Type.STRING, description: 'Concise summary of brand messaging pillars stated in the document' },
          facts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fact_key: { type: Type.STRING },
                fact_value: { type: Type.STRING },
              },
              required: ['fact_key', 'fact_value'],
            },
          },
          terminology: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                prohibited_term: { type: Type.STRING },
                preferred_term: { type: Type.STRING },
                severity: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ['prohibited_term', 'preferred_term'],
            },
          },
        },
        required: ['toneRules', 'messagingRules', 'facts', 'terminology'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    toneRules?: string;
    messagingRules?: string;
    facts?: Array<{ fact_key: string; fact_value: string }>;
    terminology?: Array<{ prohibited_term: string; preferred_term: string; severity?: string; notes?: string }>;
  };

  return {
    toneRules: parsed.toneRules || '',
    messagingRules: parsed.messagingRules || '',
    facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    terminology: Array.isArray(parsed.terminology)
      ? parsed.terminology.map((t) => ({
          prohibited_term: t.prohibited_term,
          preferred_term: t.preferred_term,
          severity: ['critical', 'high', 'medium', 'low'].includes(t.severity || '') ? (t.severity as string) : 'high',
          notes: t.notes || '',
        }))
      : [],
  };
}
