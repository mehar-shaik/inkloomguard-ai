import crypto from 'node:crypto';
import sharp from 'sharp';
import { GoogleGenAI, Type } from '@google/genai';
import {
  MAX_IMAGE_INPUT_PIXELS,
  computeDeltaE,
  hexToRgb,
  rgbToLab,
  wcagContrastRatio,
  type ImageAnalysisMetrics,
} from './parsers.ts';

export type VisualCheckStatus = 'passed' | 'violation' | 'inconclusive' | 'not_applicable';
export type VisualConfidenceLevel = 'high' | 'medium' | 'low';
export type VisualSeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface VisualBoundingBox {
  /** Normalized left coordinate [0..1] */
  x: number;
  /** Normalized top coordinate [0..1] */
  y: number;
  /** Normalized width [0..1] */
  width: number;
  /** Normalized height [0..1] */
  height: number;
  /** Pixel coordinates in original submission image */
  pixelBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  label?: string;
}

export interface VisualColorSwatch {
  hex: string;
  areaPct: number;
  role: 'primary' | 'secondary' | 'accent' | 'approved_background' | 'neutral' | 'unauthorized' | 'matched_brand';
  closestExpectedHex: string | null;
  closestExpectedRole: string | null;
  deltaE: number | null;
}

export interface BrandLogoRulesConfig {
  logoRequired: boolean | null;
  minWidthPx: number | null;
  clearSpaceRatio: number | null;
  allowedPlacements: string[];
  prohibitedMisuse: string[];
  notes: string;
}

export interface BrandTypographyRulesConfig {
  primaryFont: string;
  secondaryFont: string;
  headingStyle: string;
  bodyStyle: string;
  notes: string;
}

export interface BrandVisualGuidelinesConfig {
  accentColors: string[];
  approvedBackgrounds: string[];
  logoRules: BrandLogoRulesConfig;
  typographyRules: BrandTypographyRulesConfig;
  sourceDocumentId?: number | null;
  updatedAt?: string;
}

export interface LogoReferenceProfile {
  width: number;
  height: number;
  fgWidth: number;
  fgHeight: number;
  aspectRatio: number;
  hasRecognizablePattern: boolean;
  dominantColors: string[];
  /** Normalized 24x24 zero-mean unit-variance intensity patch (576 floats) */
  norm24: number[];
  /** Normalized 24x24 Sobel edge gradient magnitude patch (576 floats) */
  edge24: number[];
  /** Precomputed 90/180/270-degree rotated norm24 patches for rotation check */
  rotated90Norm24?: number[];
  rotated180Norm24?: number[];
  rotated270Norm24?: number[];
}

export interface BrandLogoVariantInput {
  id: number;
  label: string;
  variant_type: string;
  filename: string;
  original_name: string;
  width: number;
  height: number;
  aspect_ratio: number;
  dominant_colors: string[];
  profile: LogoReferenceProfile | null;
  buffer?: Buffer | null;
}

export interface VisualCheckResult {
  id:
    | 'logo_matching'
    | 'logo_distortion'
    | 'logo_placement_clear_space'
    | 'brand_colors'
    | 'typography_consistency';
  title: string;
  status: VisualCheckStatus;
  confidence: VisualConfidenceLevel;
  severity: VisualSeverityLevel | null;
  category: string;
  explanation: string;
  evidence: string;
  affectedRegion: VisualBoundingBox | null;
  recommendedCorrection: string;
  referenceUsed?: string | null;
  details?: Record<string, unknown>;
}

export interface VisualDetectionOverlayItem {
  id: string;
  label: string;
  kind: 'matched_logo' | 'logo_violation' | 'clear_space_zone' | 'typography_region' | 'color_region';
  status: VisualCheckStatus;
  confidence: VisualConfidenceLevel;
  bbox: VisualBoundingBox;
  notes: string;
}

export interface VisualBrandAnalysisResult {
  analyzedAt: string;
  imageWidth: number;
  imageHeight: number;
  visionStatus: 'completed' | 'unavailable' | 'failed';
  visionNote: string | null;
  cached?: boolean;
  overallStatus: 'passed' | 'issues_found' | 'warning' | 'not_performed';
  summary: string;
  matchedLogoVariant: {
    id: number | 'primary';
    label: string;
    variantType: string;
    filename: string;
    similarityScore: number;
    detectedAspectRatio: number;
    expectedAspectRatio: number;
    aspectRatioDeviation: number;
    estimatedWidthPx: number;
    estimatedHeightPx: number;
    placementZone: string;
    bbox: VisualBoundingBox;
    backgroundHex: string | null;
    backgroundContrastRatio: number | null;
  } | null;
  expectedPalette: Array<{ hex: string; role: string }>;
  detectedPalette: VisualColorSwatch[];
  referenceLogos: Array<{
    id: number | 'primary';
    label: string;
    variantType: string;
    filename: string;
    width: number;
    height: number;
    aspectRatio: number;
  }>;
  overlays: VisualDetectionOverlayItem[];
  checks: VisualCheckResult[];
}

export const DEFAULT_VISUAL_GUIDELINES: BrandVisualGuidelinesConfig = {
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

export function normalizeHexColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const expanded = trimmed
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return null;
}

export function normalizeHexList(raw: unknown, maxItems = 12): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const norm = normalizeHexColor(item);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

export function sanitizeVisualGuidelinesConfig(raw: unknown): BrandVisualGuidelinesConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const lrRaw = obj.logoRules && typeof obj.logoRules === 'object' ? (obj.logoRules as Record<string, unknown>) : {};
  const trRaw =
    obj.typographyRules && typeof obj.typographyRules === 'object'
      ? (obj.typographyRules as Record<string, unknown>)
      : {};

  const minW =
    typeof lrRaw.minWidthPx === 'number' && Number.isFinite(lrRaw.minWidthPx) && lrRaw.minWidthPx > 0
      ? Math.round(Math.min(4000, Math.max(8, lrRaw.minWidthPx)))
      : null;
  const csr =
    typeof lrRaw.clearSpaceRatio === 'number' && Number.isFinite(lrRaw.clearSpaceRatio) && lrRaw.clearSpaceRatio > 0
      ? Number(Math.min(3, Math.max(0.05, lrRaw.clearSpaceRatio)).toFixed(2))
      : null;

  const allowedPlacements = Array.isArray(lrRaw.allowedPlacements)
    ? Array.from(
        new Set(
          lrRaw.allowedPlacements
            .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .map((p) => p.trim().toLowerCase().slice(0, 40))
        )
      ).slice(0, 12)
    : [];

  const prohibitedMisuse = Array.isArray(lrRaw.prohibitedMisuse)
    ? Array.from(
        new Set(
          lrRaw.prohibitedMisuse
            .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .map((p) => p.trim().slice(0, 200))
        )
      ).slice(0, 15)
    : [];

  return {
    accentColors: normalizeHexList(obj.accentColors, 10),
    approvedBackgrounds: normalizeHexList(obj.approvedBackgrounds, 10),
    logoRules: {
      logoRequired: typeof lrRaw.logoRequired === 'boolean' ? lrRaw.logoRequired : null,
      minWidthPx: minW,
      clearSpaceRatio: csr,
      allowedPlacements,
      prohibitedMisuse,
      notes: typeof lrRaw.notes === 'string' ? lrRaw.notes.trim().slice(0, 600) : '',
    },
    typographyRules: {
      primaryFont: typeof trRaw.primaryFont === 'string' ? trRaw.primaryFont.trim().slice(0, 120) : '',
      secondaryFont: typeof trRaw.secondaryFont === 'string' ? trRaw.secondaryFont.trim().slice(0, 120) : '',
      headingStyle: typeof trRaw.headingStyle === 'string' ? trRaw.headingStyle.trim().slice(0, 250) : '',
      bodyStyle: typeof trRaw.bodyStyle === 'string' ? trRaw.bodyStyle.trim().slice(0, 250) : '',
      notes: typeof trRaw.notes === 'string' ? trRaw.notes.trim().slice(0, 600) : '',
    },
    sourceDocumentId:
      typeof obj.sourceDocumentId === 'number' && Number.isInteger(obj.sourceDocumentId)
        ? obj.sourceDocumentId
        : null,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function computeChroma(r: number, g: number, b: number): number {
  const lab = rgbToLab(r, g, b);
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, Number(val.toFixed(4))));
}

function normalizeBoundingBox(
  box: { x: number; y: number; width: number; height: number; label?: string },
  origW: number,
  origH: number
): VisualBoundingBox | null {
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const maxW = 1 - x;
  const maxH = 1 - y;
  const width = clamp01(Math.min(maxW, box.width));
  const height = clamp01(Math.min(maxH, box.height));
  if (width < 0.01 || height < 0.01) return null;
  return {
    x,
    y,
    width,
    height,
    pixelBox: {
      x: Math.round(x * origW),
      y: Math.round(y * origH),
      width: Math.max(1, Math.round(width * origW)),
      height: Math.max(1, Math.round(height * origH)),
    },
    label: box.label,
  };
}

function zeroMeanUnitNorm(values: Float64Array | number[]): { vec: number[]; std: number } {
  const n = values.length;
  if (n === 0) return { vec: [], std: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  let sqSum = 0;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    out[i] = d;
    sqSum += d * d;
  }
  const std = Math.sqrt(sqSum / n);
  if (std < 1e-6) {
    return { vec: new Array<number>(n).fill(0), std: 0 };
  }
  for (let i = 0; i < n; i++) {
    out[i] = Number((out[i] / (std * Math.sqrt(n))).toFixed(5));
  }
  return { vec: out, std };
}

function computeSobel24(gray24: Float64Array | number[]): number[] {
  const S = 24;
  const mag = new Float64Array(S * S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const gx =
        -gray24[(y - 1) * S + (x - 1)] +
        gray24[(y - 1) * S + (x + 1)] -
        2 * gray24[y * S + (x - 1)] +
        2 * gray24[y * S + (x + 1)] -
        gray24[(y + 1) * S + (x - 1)] +
        gray24[(y + 1) * S + (x + 1)];
      const gy =
        -gray24[(y - 1) * S + (x - 1)] -
        2 * gray24[(y - 1) * S + x] -
        gray24[(y - 1) * S + (x + 1)] +
        gray24[(y + 1) * S + (x - 1)] +
        2 * gray24[(y + 1) * S + x] +
        gray24[(y + 1) * S + (x + 1)];
      mag[y * S + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return zeroMeanUnitNorm(mag).vec;
}

function rotate24Clockwise(src: number[], times = 1): number[] {
  let curr = src.slice();
  const S = 24;
  for (let t = 0; t < times; t++) {
    const next = new Array<number>(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        next[x * S + (S - 1 - y)] = curr[y * S + x];
      }
    }
    curr = next;
  }
  return curr;
}

function dotSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function decodePatch24Features(
  rgbaBuffer: Buffer,
  imgW: number,
  imgH: number,
  crop: { left: number; top: number; width: number; height: number }
): Promise<{ norm24: number[]; edge24: number[]; stdDev: number }> {
  const safeLeft = Math.max(0, Math.min(imgW - 1, Math.floor(crop.left)));
  const safeTop = Math.max(0, Math.min(imgH - 1, Math.floor(crop.top)));
  const safeW = Math.max(1, Math.min(imgW - safeLeft, Math.round(crop.width)));
  const safeH = Math.max(1, Math.min(imgH - safeTop, Math.round(crop.height)));

  const { data } = await sharp(rgbaBuffer, {
    raw: { width: imgW, height: imgH, channels: 4 },
  })
    .extract({ left: safeLeft, top: safeTop, width: safeW, height: safeH })
    .resize(24, 24, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = new Float64Array(24 * 24);
  for (let i = 0; i < 24 * 24; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    // Composite over neutral mid-bright canvas so transparent edges retain contrast shape
    const cr = r * a + 255 * (1 - a);
    const cg = g * a + 255 * (1 - a);
    const cb = b * a + 255 * (1 - a);
    gray[i] = 0.299 * cr + 0.587 * cg + 0.114 * cb;
  }

  const { vec: norm24, std } = zeroMeanUnitNorm(gray);
  const edge24 = computeSobel24(gray);
  return { norm24, edge24, stdDev: std };
}

function estimateBorderBackgroundRgb(data: Buffer, w: number, h: number): { r: number; g: number; b: number } {
  const samples: Array<[number, number, number]> = [];
  const stepX = Math.max(1, Math.floor(w / 12));
  const stepY = Math.max(1, Math.floor(h / 12));
  const addPx = (x: number, y: number) => {
    const off = (y * w + x) * 4;
    const a = data[off + 3] / 255;
    samples.push([
      Math.round(data[off] * a + 255 * (1 - a)),
      Math.round(data[off + 1] * a + 255 * (1 - a)),
      Math.round(data[off + 2] * a + 255 * (1 - a)),
    ]);
  };
  for (let x = 0; x < w; x += stepX) {
    addPx(x, 0);
    if (h > 1) addPx(x, h - 1);
  }
  for (let y = 0; y < h; y += stepY) {
    addPx(0, y);
    if (w > 1) addPx(w - 1, y);
  }
  if (samples.length === 0) return { r: 255, g: 255, b: 255 };
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = samples[Math.floor(samples.length / 2)];
  return { r: mid[0], g: mid[1], b: mid[2] };
}

export async function extractLogoReferenceProfile(
  buffer: Buffer,
  filenameHint = 'logo.png'
): Promise<LogoReferenceProfile> {
  const isSvg = filenameHint.toLowerCase().endsWith('.svg');
  const sharpInput = isSvg
    ? sharp(buffer, { density: 180, limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
    : sharp(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS }).rotate();

  const decoded = await sharpInput
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const metaOrig = await (isSvg
    ? sharp(buffer, { density: 180, limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
    : sharp(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS }).rotate()
  ).metadata();

  const origW = metaOrig.width || decoded.info.width;
  const origH = metaOrig.height || decoded.info.height;
  const w = decoded.info.width;
  const h = decoded.info.height;
  const data = decoded.data;

  // Check transparency presence
  let transparentCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 220) transparentCount++;
  }
  const hasTransparency = transparentCount > w * h * 0.05;
  const bg = estimateBorderBackgroundRgb(data, w, h);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const fgBuckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      const r = data[off];
      const g = data[off + 1];
      const b = data[off + 2];
      const a = data[off + 3];

      let isFg = false;
      if (hasTransparency) {
        isFg = a >= 32;
      } else {
        const diff = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
        isFg = diff > 36;
      }

      if (isFg) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const qr = Math.round(r / 24) * 24;
        const qg = Math.round(g / 24) * 24;
        const qb = Math.round(b / 24) * 24;
        const key = `${qr},${qg},${qb}`;
        const prev = fgBuckets.get(key);
        if (prev) {
          prev.rSum += r;
          prev.gSum += g;
          prev.bSum += b;
          prev.count++;
        } else {
          fgBuckets.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
        }
      }
    }
  }

  const foundFg = maxX >= minX && maxY >= minY;
  const cropBox = foundFg
    ? { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { left: 0, top: 0, width: w, height: h };

  const patch = await decodePatch24Features(data, w, h, cropBox);
  const scaleFactorX = w > 0 ? origW / w : 1;
  const scaleFactorY = h > 0 ? origH / h : 1;
  const fgWidth = Math.max(1, Math.round(cropBox.width * scaleFactorX));
  const fgHeight = Math.max(1, Math.round(cropBox.height * scaleFactorY));
  const aspectRatio = Number((fgWidth / fgHeight).toFixed(3));
  const hasRecognizablePattern = foundFg && patch.stdDev > 4.5 && cropBox.width >= 4 && cropBox.height >= 4;

  const dominantColors = Array.from(fgBuckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((bucket) =>
      rgbToHex(bucket.rSum / bucket.count, bucket.gSum / bucket.count, bucket.bSum / bucket.count)
    );

  return {
    width: origW,
    height: origH,
    fgWidth,
    fgHeight,
    aspectRatio,
    hasRecognizablePattern,
    dominantColors,
    norm24: patch.norm24,
    edge24: patch.edge24,
    rotated90Norm24: rotate24Clockwise(patch.norm24, 1),
    rotated180Norm24: rotate24Clockwise(patch.norm24, 2),
    rotated270Norm24: rotate24Clockwise(patch.norm24, 3),
  };
}

interface ColorCluster {
  r: number;
  g: number;
  b: number;
  hex: string;
  count: number;
  areaPct: number;
  chroma: number;
}

function clusterSubmissionPalette(rgba: Buffer, w: number, h: number): ColorCluster[] {
  const stepX = Math.max(1, Math.floor(w / 72));
  const stepY = Math.max(1, Math.floor(h / 72));
  const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();
  let total = 0;

  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const off = (y * w + x) * 4;
      const a = rgba[off + 3];
      if (a < 16) continue;
      const alpha = a / 255;
      const r = Math.round(rgba[off] * alpha + 255 * (1 - alpha));
      const g = Math.round(rgba[off + 1] * alpha + 255 * (1 - alpha));
      const b = Math.round(rgba[off + 2] * alpha + 255 * (1 - alpha));

      total++;
      const qr = Math.round(r / 20) * 20;
      const qg = Math.round(g / 20) * 20;
      const qb = Math.round(b / 20) * 20;
      const key = `${qr},${qg},${qb}`;
      const prev = buckets.get(key);
      if (prev) {
        prev.rSum += r;
        prev.gSum += g;
        prev.bSum += b;
        prev.count++;
      } else {
        buckets.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
      }
    }
  }

  if (total === 0) return [];

  const rawClusters = Array.from(buckets.values())
    .map((b) => ({
      rSum: b.rSum,
      gSum: b.gSum,
      bSum: b.bSum,
      count: b.count,
      r: b.rSum / b.count,
      g: b.gSum / b.count,
      b: b.bSum / b.count,
    }))
    .sort((a, b) => b.count - a.count);

  // Merge perceptually similar clusters (CIELAB ΔE <= 10) to avoid JPEG/antialiasing fragmentation
  const merged: Array<typeof rawClusters[number]> = [];
  for (const c of rawClusters) {
    let target: typeof rawClusters[number] | null = null;
    for (const m of merged) {
      if (computeDeltaE({ r: c.r, g: c.g, b: c.b }, { r: m.r, g: m.g, b: m.b }) <= 10) {
        target = m;
        break;
      }
    }
    if (target) {
      target.rSum += c.rSum;
      target.gSum += c.gSum;
      target.bSum += c.bSum;
      target.count += c.count;
      target.r = target.rSum / target.count;
      target.g = target.gSum / target.count;
      target.b = target.bSum / target.count;
    } else {
      merged.push({ ...c });
    }
  }

  return merged
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((m) => {
      const r = Math.round(m.r);
      const g = Math.round(m.g);
      const b = Math.round(m.b);
      return {
        r,
        g,
        b,
        hex: rgbToHex(r, g, b),
        count: m.count,
        areaPct: Number(((m.count / total) * 100).toFixed(1)),
        chroma: Number(computeChroma(r, g, b).toFixed(1)),
      };
    });
}

interface CandidateBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fgPixels: number;
}

function findCandidateGraphicRegions(
  rgba: Buffer,
  imgW: number,
  imgH: number
): { candidates: CandidateBox[]; bgRgb: { r: number; g: number; b: number }; workW: number; workH: number; fgMask: Uint8Array } {
  const maxDim = Math.max(imgW, imgH);
  const scale = maxDim > 200 ? 200 / maxDim : 1;
  const workW = Math.max(1, Math.round(imgW * scale));
  const workH = Math.max(1, Math.round(imgH * scale));

  // Sample border from resized grid
  const workRgb = new Uint8Array(workW * workH * 3);
  const borderSamples: Array<[number, number, number]> = [];
  for (let wy = 0; wy < workH; wy++) {
    const sy = Math.min(imgH - 1, Math.floor((wy / workH) * imgH));
    for (let wx = 0; wx < workW; wx++) {
      const sx = Math.min(imgW - 1, Math.floor((wx / workW) * imgW));
      const soff = (sy * imgW + sx) * 4;
      const a = rgba[soff + 3] / 255;
      const r = Math.round(rgba[soff] * a + 255 * (1 - a));
      const g = Math.round(rgba[soff + 1] * a + 255 * (1 - a));
      const b = Math.round(rgba[soff + 2] * a + 255 * (1 - a));
      const woff = (wy * workW + wx) * 3;
      workRgb[woff] = r;
      workRgb[woff + 1] = g;
      workRgb[woff + 2] = b;
      if (wx === 0 || wy === 0 || wx === workW - 1 || wy === workH - 1) {
        borderSamples.push([r, g, b]);
      }
    }
  }

  borderSamples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = borderSamples[Math.floor(borderSamples.length / 2)] || [255, 255, 255];
  const bgRgb = { r: mid[0], g: mid[1], b: mid[2] };

  // Build foreground mask (pixels differing noticeably from canvas border background)
  const rawMask = new Uint8Array(workW * workH);
  for (let i = 0; i < workW * workH; i++) {
    const diff =
      Math.abs(workRgb[i * 3] - bgRgb.r) +
      Math.abs(workRgb[i * 3 + 1] - bgRgb.g) +
      Math.abs(workRgb[i * 3 + 2] - bgRgb.b);
    if (diff > 34) {
      rawMask[i] = 1;
    }
  }

  // Morphologically bridge tiny gaps (radius 2) to keep multi-part logo marks together
  const bridged = new Uint8Array(workW * workH);
  const gap = workW >= 80 && workH >= 80 ? 2 : 1;
  for (let y = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++) {
      if (rawMask[y * workW + x] === 1) {
        for (let dy = -gap; dy <= gap; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= workH) continue;
          for (let dx = -gap; dx <= gap; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < workW) {
              bridged[ny * workW + nx] = 1;
            }
          }
        }
      }
    }
  }

  // BFS Connected components on bridged mask, recording tight unbridged bounding box inside each component
  const visited = new Uint8Array(workW * workH);
  const candidates: CandidateBox[] = [];
  const queue = new Int32Array(workW * workH);

  for (let y = 0; y < workH; y++) {
    for (let x = 0; x < workW; x++) {
      const startIdx = y * workW + x;
      if (bridged[startIdx] === 0 || visited[startIdx] === 1) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      let minX = workW;
      let minY = workH;
      let maxX = -1;
      let maxY = -1;
      let fgCount = 0;

      while (head < tail) {
        const idx = queue[head++];
        const cx = idx % workW;
        const cy = (idx - cx) / workW;

        if (rawMask[idx] === 1) {
          fgCount++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
        }

        const neighbors = [idx - 1, idx + 1, idx - workW, idx + workW];
        for (const nIdx of neighbors) {
          if (nIdx < 0 || nIdx >= workW * workH) continue;
          const nx = nIdx % workW;
          if (Math.abs(nx - cx) > 1) continue;
          if (bridged[nIdx] === 1 && visited[nIdx] === 0) {
            visited[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }

      if (maxX >= minX && maxY >= minY && fgCount >= 8) {
        const bw = (maxX - minX + 1) / workW;
        const bh = (maxY - minY + 1) / workH;
        const areaRatio = bw * bh;
        if (bw >= 0.03 && bh >= 0.03 && areaRatio <= 0.85) {
          candidates.push({
            x: minX / workW,
            y: minY / workH,
            width: bw,
            height: bh,
            fgPixels: fgCount,
          });
        }
      }
    }
  }

  // Also propose composite candidates for closely aligned multi-part or stretched marks
  const baseCount = candidates.length;
  for (let i = 0; i < baseCount; i++) {
    for (let j = i + 1; j < baseCount; j++) {
      const a = candidates[i];
      const b = candidates[j];

      const vOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const minH = Math.min(a.height, b.height);
      const hGap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);

      const hOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const minW = Math.min(a.width, b.width);
      const vGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);

      const closeHorizontalParts = vOverlap >= 0.45 * minH && hGap <= Math.max(0.05, 0.55 * minH);
      const closeVerticalParts = hOverlap >= 0.45 * minW && vGap <= Math.max(0.05, 0.55 * minW);

      if (closeHorizontalParts || closeVerticalParts) {
        const ux0 = Math.min(a.x, b.x);
        const uy0 = Math.min(a.y, b.y);
        const ux1 = Math.max(a.x + a.width, b.x + b.width);
        const uy1 = Math.max(a.y + a.height, b.y + b.height);
        const uw = ux1 - ux0;
        const uh = uy1 - uy0;
        if (uw * uh <= 0.85) {
          candidates.push({
            x: ux0,
            y: uy0,
            width: uw,
            height: uh,
            fgPixels: a.fgPixels + b.fgPixels,
          });
        }
      }
    }
  }

  // Sort largest / clearest candidates first (cap at top 14 to bound compute)
  candidates.sort((a, b) => b.fgPixels - a.fgPixels);
  return { candidates: candidates.slice(0, 14), bgRgb, workW, workH, fgMask: rawMask };
}

function classifyPlacementZone(cx: number, cy: number): string {
  const vertical = cy < 0.33 ? 'top' : cy > 0.67 ? 'bottom' : 'middle';
  const horizontal = cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'center';
  if (vertical === 'middle' && horizontal === 'center') return 'center';
  return `${vertical}-${horizontal}`;
}

function sampleRingBackgroundRgb(
  rgba: Buffer,
  imgW: number,
  imgH: number,
  pixelBox: { x: number; y: number; width: number; height: number }
): { r: number; g: number; b: number } | null {
  const pad = Math.max(3, Math.round(Math.min(pixelBox.width, pixelBox.height) * 0.08));
  const x0 = Math.max(0, pixelBox.x - pad);
  const y0 = Math.max(0, pixelBox.y - pad);
  const x1 = Math.min(imgW - 1, pixelBox.x + pixelBox.width + pad);
  const y1 = Math.min(imgH - 1, pixelBox.y + pixelBox.height + pad);
  const samples: Array<[number, number, number]> = [];

  const pushSample = (px: number, py: number) => {
    const off = (py * imgW + px) * 4;
    const a = rgba[off + 3] / 255;
    samples.push([
      Math.round(rgba[off] * a + 255 * (1 - a)),
      Math.round(rgba[off + 1] * a + 255 * (1 - a)),
      Math.round(rgba[off + 2] * a + 255 * (1 - a)),
    ]);
  };

  for (let x = x0; x <= x1; x += Math.max(1, Math.floor((x1 - x0) / 16))) {
    if (pixelBox.y - 2 >= 0) pushSample(x, y0);
    if (pixelBox.y + pixelBox.height + 2 < imgH) pushSample(x, y1);
  }
  for (let y = y0; y <= y1; y += Math.max(1, Math.floor((y1 - y0) / 16))) {
    if (pixelBox.x - 2 >= 0) pushSample(x0, y);
    if (pixelBox.x + pixelBox.width + 2 < imgW) pushSample(x1, y);
  }
  if (samples.length === 0) return null;
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const mid = samples[Math.floor(samples.length / 2)];
  return { r: mid[0], g: mid[1], b: mid[2] };
}

function measureClearSpaceIntrusion(
  rgba: Buffer,
  imgW: number,
  imgH: number,
  pixelBox: { x: number; y: number; width: number; height: number },
  clearSpaceRatio: number,
  localBg: { r: number; g: number; b: number }
): { violatedByEdge: boolean; edgeReason: string; intrusionRatio: number } {
  const marginPx = Math.max(4, Math.round(Math.min(pixelBox.width, pixelBox.height) * clearSpaceRatio));
  const minRequired = Math.round(marginPx * 0.8);

  const leftSpace = pixelBox.x;
  const topSpace = pixelBox.y;
  const rightSpace = imgW - (pixelBox.x + pixelBox.width);
  const bottomSpace = imgH - (pixelBox.y + pixelBox.height);

  const edgeViolations: string[] = [];
  if (leftSpace < minRequired) edgeViolations.push(`left (${leftSpace}px < ${minRequired}px)`);
  if (topSpace < minRequired) edgeViolations.push(`top (${topSpace}px < ${minRequired}px)`);
  if (rightSpace < minRequired) edgeViolations.push(`right (${rightSpace}px < ${minRequired}px)`);
  if (bottomSpace < minRequired) edgeViolations.push(`bottom (${bottomSpace}px < ${minRequired}px)`);

  // Check halo ring outside logo box (up to marginPx away, 2px gap outside logo border)
  const hx0 = Math.max(0, pixelBox.x - marginPx);
  const hy0 = Math.max(0, pixelBox.y - marginPx);
  const hx1 = Math.min(imgW - 1, pixelBox.x + pixelBox.width + marginPx);
  const hy1 = Math.min(imgH - 1, pixelBox.y + pixelBox.height + marginPx);

  let ringSamples = 0;
  let intrudingSamples = 0;
  const step = Math.max(1, Math.floor(Math.min(pixelBox.width, pixelBox.height) / 24));
  for (let y = hy0; y <= hy1; y += step) {
    for (let x = hx0; x <= hx1; x += step) {
      const insideLogo =
        x >= pixelBox.x - 2 &&
        x <= pixelBox.x + pixelBox.width + 2 &&
        y >= pixelBox.y - 2 &&
        y <= pixelBox.y + pixelBox.height + 2;
      if (insideLogo) continue;
      ringSamples++;
      const off = (y * imgW + x) * 4;
      const a = rgba[off + 3] / 255;
      const r = Math.round(rgba[off] * a + 255 * (1 - a));
      const g = Math.round(rgba[off + 1] * a + 255 * (1 - a));
      const b = Math.round(rgba[off + 2] * a + 255 * (1 - a));
      const dRgb = Math.abs(r - localBg.r) + Math.abs(g - localBg.g) + Math.abs(b - localBg.b);
      if (dRgb > 42) {
        intrudingSamples++;
      }
    }
  }

  const intrusionRatio = ringSamples > 0 ? Number((intrudingSamples / ringSamples).toFixed(3)) : 0;
  return {
    violatedByEdge: edgeViolations.length > 0,
    edgeReason: edgeViolations.join(', '),
    intrusionRatio,
  };
}

function measureEdgeClipping(
  rgba: Buffer,
  imgW: number,
  imgH: number,
  pixelBox: { x: number; y: number; width: number; height: number },
  localBg: { r: number; g: number; b: number }
): { isClipped: boolean; clippedEdges: string[] } {
  const clippedEdges: string[] = [];
  const checkEdgeLine = (coords: Array<[number, number]>) => {
    if (coords.length === 0) return 0;
    let fg = 0;
    for (const [x, y] of coords) {
      const off = (y * imgW + x) * 4;
      const a = rgba[off + 3] / 255;
      const r = Math.round(rgba[off] * a + 255 * (1 - a));
      const g = Math.round(rgba[off + 1] * a + 255 * (1 - a));
      const b = Math.round(rgba[off + 2] * a + 255 * (1 - a));
      if (Math.abs(r - localBg.r) + Math.abs(g - localBg.g) + Math.abs(b - localBg.b) > 36) {
        fg++;
      }
    }
    return fg / coords.length;
  };

  if (pixelBox.x <= 2) {
    const pts: Array<[number, number]> = [];
    for (let y = pixelBox.y; y < pixelBox.y + pixelBox.height; y++) pts.push([0, y]);
    if (checkEdgeLine(pts) > 0.12) clippedEdges.push('left edge');
  }
  if (pixelBox.y <= 2) {
    const pts: Array<[number, number]> = [];
    for (let x = pixelBox.x; x < pixelBox.x + pixelBox.width; x++) pts.push([x, 0]);
    if (checkEdgeLine(pts) > 0.12) clippedEdges.push('top edge');
  }
  if (pixelBox.x + pixelBox.width >= imgW - 2) {
    const pts: Array<[number, number]> = [];
    for (let y = pixelBox.y; y < pixelBox.y + pixelBox.height; y++) pts.push([imgW - 1, y]);
    if (checkEdgeLine(pts) > 0.12) clippedEdges.push('right edge');
  }
  if (pixelBox.y + pixelBox.height >= imgH - 2) {
    const pts: Array<[number, number]> = [];
    for (let x = pixelBox.x; x < pixelBox.x + pixelBox.width; x++) pts.push([x, imgH - 1]);
    if (checkEdgeLine(pts) > 0.12) clippedEdges.push('bottom edge');
  }

  return { isClipped: clippedEdges.length > 0, clippedEdges };
}

function measureSharpnessLaplacian(rgba: Buffer, imgW: number, imgH: number, box: { x: number; y: number; width: number; height: number }): number {
  const x0 = Math.max(1, box.x);
  const y0 = Math.max(1, box.y);
  const x1 = Math.min(imgW - 2, box.x + box.width - 2);
  const y1 = Math.min(imgH - 2, box.y + box.height - 2);
  if (x1 <= x0 || y1 <= y0) return 0;

  const stepX = Math.max(1, Math.floor((x1 - x0) / 40));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 40));
  const lum = (x: number, y: number) => {
    const off = (y * imgW + x) * 4;
    return 0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2];
  };
  let sumSq = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += stepY) {
    for (let x = x0; x <= x1; x += stepX) {
      const lap = -4 * lum(x, y) + lum(x - 1, y) + lum(x + 1, y) + lum(x, y - 1) + lum(x, y + 1);
      sumSq += lap * lap;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

export function computeVisualCacheHash(params: {
  imageBuffer: Buffer;
  brandId: number;
  primaryColor: string;
  secondaryColor: string;
  primaryLogoFilename?: string | null;
  logoVariants: Array<{ id: number; filename: string; variant_type: string }>;
  visualGuidelines: BrandVisualGuidelinesConfig;
  hasAiClient: boolean;
}): string {
  const h = crypto.createHash('sha256');
  h.update(params.imageBuffer);
  h.update(
    JSON.stringify({
      brandId: params.brandId,
      primaryColor: params.primaryColor,
      secondaryColor: params.secondaryColor,
      primaryLogoFilename: params.primaryLogoFilename || null,
      logoVariants: params.logoVariants.map((v) => ({
        id: v.id,
        filename: v.filename,
        variant_type: v.variant_type,
      })),
      visualGuidelines: params.visualGuidelines,
      hasAiClient: params.hasAiClient,
    })
  );
  return h.digest('hex');
}

export interface RunVisualDetectionParams {
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  primaryLogoFilename?: string | null;
  primaryLogoBuffer?: Buffer | null;
  primaryLogoProfile?: LogoReferenceProfile | null;
  logoVariants: BrandLogoVariantInput[];
  visualGuidelines: BrandVisualGuidelinesConfig;
  submissionImageBuffer: Buffer;
  submissionImageMimeType?: string | null;
  imageMetrics: ImageAnalysisMetrics | null;
  aiClient: GoogleGenAI | null;
  geminiModel: string;
  generateWithRetry: <T>(fn: () => Promise<T>) => Promise<T>;
  formatAiError: (err: unknown) => string;
}

interface ReferenceLogoEntry {
  id: number | 'primary';
  label: string;
  variantType: string;
  filename: string;
  originalName?: string;
  buffer: Buffer | null;
  profile: LogoReferenceProfile;
}

export async function runVisualBrandDetection(
  params: RunVisualDetectionParams
): Promise<VisualBrandAnalysisResult> {
  const {
    brandName,
    primaryColor,
    secondaryColor,
    primaryLogoFilename,
    primaryLogoBuffer,
    primaryLogoProfile,
    logoVariants,
    visualGuidelines,
    submissionImageBuffer,
    aiClient,
    geminiModel,
    generateWithRetry,
    formatAiError,
  } = params;

  // 1. Decode submission image safely (preserving aspect ratio, bounded to 1200px)
  const origMeta = await sharp(submissionImageBuffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
    .rotate()
    .metadata();
  const origWidth = origMeta.width || params.imageMetrics?.width || 1;
  const origHeight = origMeta.height || params.imageMetrics?.height || 1;

  const workPipeline = sharp(submissionImageBuffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
    .rotate()
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();

  const { data: workRgba, info: workInfo } = await workPipeline.raw().toBuffer({ resolveWithObject: true });
  const workW = workInfo.width;
  const workH = workInfo.height;
  const scaleToOrigX = origWidth / Math.max(1, workW);
  const scaleToOrigY = origHeight / Math.max(1, workH);

  // 2. Build Reference Logos list
  const refEntries: ReferenceLogoEntry[] = [];
  if (primaryLogoFilename && (primaryLogoProfile || primaryLogoBuffer)) {
    try {
      const profile =
        primaryLogoProfile ||
        (primaryLogoBuffer ? await extractLogoReferenceProfile(primaryLogoBuffer, primaryLogoFilename) : null);
      if (profile) {
        refEntries.push({
          id: 'primary',
          label: 'Primary Brand Logo',
          variantType: 'primary',
          filename: primaryLogoFilename,
          originalName: primaryLogoFilename,
          buffer: primaryLogoBuffer || null,
          profile,
        });
      }
    } catch {
      // Ignore corrupt reference
    }
  }
  for (const v of logoVariants) {
    try {
      const profile =
        v.profile || (v.buffer ? await extractLogoReferenceProfile(v.buffer, v.filename) : null);
      if (profile) {
        refEntries.push({
          id: v.id,
          label: v.label,
          variantType: v.variant_type,
          filename: v.filename,
          originalName: v.original_name,
          buffer: v.buffer || null,
          profile,
        });
      }
    } catch {
      // Ignore corrupt variant
    }
  }

  // 3. Expected Brand Palette & Color Compliance Check
  const expectedPalette: Array<{ hex: string; role: string }> = [];
  const pushExpected = (rawHex: string | undefined, role: string) => {
    const hex = normalizeHexColor(rawHex);
    if (hex && !expectedPalette.some((e) => e.hex === hex)) {
      expectedPalette.push({ hex, role });
    }
  };
  pushExpected(primaryColor, 'primary');
  pushExpected(secondaryColor, 'secondary');
  for (const acc of visualGuidelines.accentColors) pushExpected(acc, 'accent');
  for (const bgHex of visualGuidelines.approvedBackgrounds) pushExpected(bgHex, 'approved_background');

  const clusters = clusterSubmissionPalette(workRgba, workW, workH);
  const expectedRgbs = expectedPalette
    .map((e) => ({ ...e, rgb: hexToRgb(e.hex) }))
    .filter((e): e is { hex: string; role: string; rgb: { r: number; g: number; b: number } } => e.rgb !== null);

  const detectedPalette: VisualColorSwatch[] = clusters.map((cluster) => {
    let bestDelta = Infinity;
    let closestExpectedHex: string | null = null;
    let closestExpectedRole: string | null = null;

    for (const exp of expectedRgbs) {
      const d = computeDeltaE(cluster, exp.rgb);
      if (d < bestDelta) {
        bestDelta = d;
        closestExpectedHex = exp.hex;
        closestExpectedRole = exp.role;
      }
    }

    const roundedDelta = Number.isFinite(bestDelta) ? Number(bestDelta.toFixed(1)) : null;
    const isNeutral = cluster.chroma < 10;
    let role: VisualColorSwatch['role'] = 'neutral';

    if (roundedDelta !== null && roundedDelta <= 22) {
      if (closestExpectedRole === 'primary') role = 'primary';
      else if (closestExpectedRole === 'secondary') role = 'secondary';
      else if (closestExpectedRole === 'accent') role = 'accent';
      else if (closestExpectedRole === 'approved_background') role = 'approved_background';
      else role = 'matched_brand';
    } else if (!isNeutral && cluster.areaPct >= 2.5 && roundedDelta !== null && roundedDelta > 32) {
      role = 'unauthorized';
    } else if (
      isNeutral &&
      visualGuidelines.approvedBackgrounds.length > 0 &&
      cluster.areaPct >= 30 &&
      roundedDelta !== null &&
      roundedDelta > 32
    ) {
      role = 'unauthorized';
    }

    return {
      hex: cluster.hex,
      areaPct: cluster.areaPct,
      role,
      closestExpectedHex,
      closestExpectedRole,
      deltaE: roundedDelta,
    };
  });

  const matchedBrandSwatches = detectedPalette.filter((s) =>
    ['primary', 'secondary', 'accent', 'matched_brand'].includes(s.role)
  );
  const unauthorizedSwatches = detectedPalette.filter(
    (s) => s.role === 'unauthorized' && s.areaPct >= 4.0
  );

  let colorCheck: VisualCheckResult;
  if (expectedPalette.length === 0) {
    colorCheck = {
      id: 'brand_colors',
      title: 'Brand Color Palette Compliance',
      status: 'not_applicable',
      confidence: 'high',
      severity: null,
      category: 'Visual Identity',
      explanation: 'No brand palette hex colors are configured for this brand.',
      evidence: 'Brand Visual Profile contains no configured color hex values.',
      affectedRegion: null,
      recommendedCorrection: 'Configure Primary, Secondary, or Accent colors on the Brand Profile to enable color checking.',
    };
  } else if (unauthorizedSwatches.length > 0) {
    const totalUnauthPct = unauthorizedSwatches.reduce((acc, s) => acc + s.areaPct, 0);
    const worst = unauthorizedSwatches[0];
    const hasNoBrandMatch = matchedBrandSwatches.length === 0;
    const severity: VisualSeverityLevel =
      hasNoBrandMatch && totalUnauthPct >= 25 ? 'high' : totalUnauthPct >= 15 ? 'medium' : 'low';
    colorCheck = {
      id: 'brand_colors',
      title: 'Brand Color Palette Compliance',
      status: 'violation',
      confidence: totalUnauthPct >= 15 ? 'high' : 'medium',
      severity,
      category: 'Visual Identity',
      explanation: `Detected prominent off-brand color${unauthorizedSwatches.length > 1 ? 's' : ''} (${unauthorizedSwatches.map((s) => `${s.hex} at ${s.areaPct}%`).join(', ')}) exceeding perceptual tolerance (closest brand color ${worst.closestExpectedHex || 'N/A'}, CIELAB ΔE ${worst.deltaE ?? 'N/A'}).${hasNoBrandMatch ? ' No approved primary, secondary, or accent brand colors were detected.' : ''}`,
      evidence: `Expected brand colors: ${expectedPalette.map((e) => `${e.hex} (${e.role})`).join(', ')}. Detected off-brand swatches (filtering < 2.5% antialiasing fringe): ${unauthorizedSwatches.map((s) => `${s.hex} [${s.areaPct}%, ΔE ${s.deltaE}]`).join(', ')}.`,
      affectedRegion: null,
      recommendedCorrection: `Replace off-brand color ${worst.hex} with approved brand colors (${expectedPalette.filter((e) => e.role !== 'approved_background').map((e) => e.hex).join(', ') || expectedPalette[0].hex}).`,
      details: {
        unauthorizedColors: unauthorizedSwatches,
        matchedBrandColors: matchedBrandSwatches,
      },
    };
  } else if (matchedBrandSwatches.length > 0) {
    colorCheck = {
      id: 'brand_colors',
      title: 'Brand Color Palette Compliance',
      status: 'passed',
      confidence: 'high',
      severity: null,
      category: 'Visual Identity',
      explanation: `Submitted visual colors align with the approved brand palette (${matchedBrandSwatches.map((s) => `${s.hex} matches ${s.closestExpectedRole} ${s.closestExpectedHex} at ΔE ${s.deltaE}`).join('; ')}).`,
      evidence: `Expected: ${expectedPalette.map((e) => e.hex).join(', ')}. Measured dominant coverage matches within perceptual tolerance.`,
      affectedRegion: null,
      recommendedCorrection: '',
      details: { matchedBrandColors: matchedBrandSwatches },
    };
  } else {
    // Only neutrals detected (e.g., grayscale / black & white image)
    colorCheck = {
      id: 'brand_colors',
      title: 'Brand Color Palette Compliance',
      status: 'inconclusive',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: `Image consists primarily of neutral grayscale tones (${detectedPalette.slice(0, 3).map((s) => `${s.hex} (${s.areaPct}%)`).join(', ')}); no brand accent colors were detected, though no chromatic off-brand fills were introduced either.`,
      evidence: `Expected brand colors: ${expectedPalette.map((e) => e.hex).join(', ')}.`,
      affectedRegion: null,
      recommendedCorrection: 'Verify if monochrome usage is intentional or incorporate primary/secondary brand accents.',
    };
  }

  // 4. Deterministic Candidate Region Search & Logo Matching
  const { candidates } = findCandidateGraphicRegions(workRgba, workW, workH);
  const recognizableRefs = refEntries.filter((r) => r.profile.hasRecognizablePattern);

  interface MatchEvaluation {
    ref: ReferenceLogoEntry;
    candidate: CandidateBox;
    bbox: VisualBoundingBox;
    similarity: number;
    rotatedAngle: 0 | 90 | 180 | 270;
    bestRotSimilarity: number;
    detectedAspectRatio: number;
    aspectRatioDeviation: number;
    estimatedWidthPx: number;
    estimatedHeightPx: number;
    placementZone: string;
    localBgHex: string | null;
    localBgRgb: { r: number; g: number; b: number } | null;
    contrastRatio: number | null;
  }

  let bestMatch: MatchEvaluation | null = null;
  let bestRogueCandidate: {
    candidate: CandidateBox;
    bbox: VisualBoundingBox;
    bestSim: number;
    placementZone: string;
  } | null = null;

  if (recognizableRefs.length > 0 && candidates.length > 0) {
    for (const cand of candidates) {
      const workCrop = {
        left: Math.round(cand.x * workW),
        top: Math.round(cand.y * workH),
        width: Math.max(2, Math.round(cand.width * workW)),
        height: Math.max(2, Math.round(cand.height * workH)),
      };
      const candPatch = await decodePatch24Features(workRgba, workW, workH, workCrop);
      if (candPatch.stdDev < 3.5) continue;

      const bbox = normalizeBoundingBox(
        { x: cand.x, y: cand.y, width: cand.width, height: cand.height, label: 'Detected Graphic Region' },
        origWidth,
        origHeight
      );
      if (!bbox || !bbox.pixelBox) continue;

      const detAspect = Number((bbox.pixelBox.width / Math.max(1, bbox.pixelBox.height)).toFixed(3));
      const zone = classifyPlacementZone(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);

      for (const ref of recognizableRefs) {
        const directInt = dotSimilarity(candPatch.norm24, ref.profile.norm24);
        const invInt = -directInt;
        const bestPolarity = Math.max(directInt, invInt);
        const edgeSim = dotSimilarity(candPatch.edge24, ref.profile.edge24);
        const blendedScore = 0.58 * bestPolarity + 0.42 * edgeSim;
        const stretchResilientScore =
          edgeSim >= 0.35 ? 0.75 * bestPolarity + 0.25 * edgeSim : blendedScore;
        const directScore = Number(Math.max(blendedScore, stretchResilientScore).toFixed(3));

        // Check 90/180/270 rotations for rotation violation detection (using rotated intensity + rotated Sobel edges)
        const rotAngles: Array<{ angle: 90 | 180 | 270; steps: number; vec?: number[] }> = [
          { angle: 90, steps: 1, vec: ref.profile.rotated90Norm24 },
          { angle: 180, steps: 2, vec: ref.profile.rotated180Norm24 },
          { angle: 270, steps: 3, vec: ref.profile.rotated270Norm24 },
        ];
        let bestRotAngle: 0 | 90 | 180 | 270 = 0;
        let bestRotScore = directScore;
        for (const ra of rotAngles) {
          if (!ra.vec) continue;
          const rInt = Math.abs(dotSimilarity(candPatch.norm24, ra.vec));
          const rEdgeVec = rotate24Clockwise(ref.profile.edge24, ra.steps);
          const rEdge = dotSimilarity(candPatch.edge24, rEdgeVec);
          const rScore = 0.58 * rInt + 0.42 * rEdge;
          if (rScore > directScore + 0.14 && rScore > bestRotScore) {
            bestRotScore = Number(rScore.toFixed(3));
            bestRotAngle = ra.angle;
          }
        }

        const expectedAr = ref.profile.aspectRatio || 1;
        const arDeviation = Number(Math.max(detAspect / expectedAr, expectedAr / detAspect).toFixed(2));

        const localBg = sampleRingBackgroundRgb(workRgba, workW, workH, {
          x: workCrop.left,
          y: workCrop.top,
          width: workCrop.width,
          height: workCrop.height,
        });
        const localBgHex = localBg ? rgbToHex(localBg.r, localBg.g, localBg.b) : null;

        let contrastRatio: number | null = null;
        if (localBg && ref.profile.dominantColors.length > 0) {
          const fgRgb = hexToRgb(ref.profile.dominantColors[0]);
          if (fgRgb) {
            contrastRatio = wcagContrastRatio(fgRgb, localBg);
          }
        }

        const candidateScore = Math.max(directScore, bestRotScore);
        if (!bestMatch || candidateScore > Math.max(bestMatch.similarity, bestMatch.bestRotSimilarity)) {
          bestMatch = {
            ref,
            candidate: cand,
            bbox,
            similarity: directScore,
            rotatedAngle: bestRotAngle,
            bestRotSimilarity: bestRotScore,
            detectedAspectRatio: detAspect,
            aspectRatioDeviation: arDeviation,
            estimatedWidthPx: bbox.pixelBox.width,
            estimatedHeightPx: bbox.pixelBox.height,
            placementZone: zone,
            localBgHex,
            localBgRgb: localBg,
            contrastRatio,
          };
        }

        // Track compact candidate marks in case nothing matches the brand logo
        if (
          detAspect >= 0.25 &&
          detAspect <= 6.5 &&
          (!bestRogueCandidate || cand.fgPixels > bestRogueCandidate.candidate.fgPixels)
        ) {
          bestRogueCandidate = {
            candidate: cand,
            bbox,
            bestSim: candidateScore,
            placementZone: zone,
          };
        }
      }
    }
  }

  const MATCH_THRESHOLD = 0.66;
  const matchedLogo =
    bestMatch && Math.max(bestMatch.similarity, bestMatch.bestRotSimilarity) >= MATCH_THRESHOLD
      ? bestMatch
      : null;

  let logoMatchCheck: VisualCheckResult;
  let distortionCheck: VisualCheckResult;
  let placementCheck: VisualCheckResult;
  const overlays: VisualDetectionOverlayItem[] = [];

  if (refEntries.length === 0) {
    logoMatchCheck = {
      id: 'logo_matching',
      title: 'Logo Identification & Variant Matching',
      status: visualGuidelines.logoRules.logoRequired ? 'inconclusive' : 'not_applicable',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: visualGuidelines.logoRules.logoRequired
        ? 'Guidelines indicate a brand logo is required, but no official brand logo image asset has been uploaded to compare against.'
        : 'No official brand logo reference image is uploaded for this brand.',
      evidence: 'Brand Profile has no uploaded logo or logo variant reference image.',
      affectedRegion: null,
      recommendedCorrection: 'Upload the official brand logo (and optional monochrome/dark variants) under Brand Guidelines.',
    };
    distortionCheck = {
      id: 'logo_distortion',
      title: 'Logo Integrity, Proportions & Distortion',
      status: 'not_applicable',
      confidence: 'high',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Skipped — requires a verified brand logo reference to measure aspect-ratio distortion or clipping.',
      evidence: 'No reference logo profile available.',
      affectedRegion: null,
      recommendedCorrection: '',
    };
    placementCheck = {
      id: 'logo_placement_clear_space',
      title: 'Logo Placement, Clear Space & Contrast',
      status: 'not_applicable',
      confidence: 'high',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Skipped — requires a localized brand logo region to measure clear-space and placement compliance.',
      evidence: 'No reference logo profile available.',
      affectedRegion: null,
      recommendedCorrection: '',
    };
  } else if (recognizableRefs.length === 0) {
    logoMatchCheck = {
      id: 'logo_matching',
      title: 'Logo Identification & Variant Matching',
      status: 'inconclusive',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation:
        'Uploaded brand logo asset does not contain sufficient foreground contrast or structural detail for reliable visual template matching.',
      evidence: `Reference asset "${refEntries[0].filename}" appears uniform without distinct vector/graphic contours.`,
      affectedRegion: null,
      recommendedCorrection: 'Upload a crisp transparent PNG or SVG brand logo mark for reliable automated detection.',
    };
    distortionCheck = {
      id: 'logo_distortion',
      title: 'Logo Integrity, Proportions & Distortion',
      status: 'inconclusive',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Unable to measure logo distortion without a distinct logo reference mark.',
      evidence: 'Logo identification was inconclusive.',
      affectedRegion: null,
      recommendedCorrection: '',
    };
    placementCheck = {
      id: 'logo_placement_clear_space',
      title: 'Logo Placement, Clear Space & Contrast',
      status: 'inconclusive',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Unable to evaluate clear-space or placement without a localized logo region.',
      evidence: 'Logo identification was inconclusive.',
      affectedRegion: null,
      recommendedCorrection: '',
    };
  } else if (matchedLogo) {
    // Logo detected! Evaluate variant correctness, distortion, resolution, clipping, placement, clear space
    const simPct = Math.round(Math.max(matchedLogo.similarity, matchedLogo.bestRotSimilarity) * 100);
    const matchedBox: VisualBoundingBox = {
      ...matchedLogo.bbox,
      label: `${matchedLogo.ref.label} (${simPct}% match)`,
    };

    logoMatchCheck = {
      id: 'logo_matching',
      title: 'Logo Identification & Variant Matching',
      status: 'passed',
      confidence: simPct >= 75 ? 'high' : 'medium',
      severity: null,
      category: 'Visual Identity',
      explanation: `Detected "${matchedLogo.ref.label}" (${matchedLogo.ref.variantType}) in the ${matchedLogo.placementZone} zone with ${simPct}% structural similarity.`,
      evidence: `Matched against brand asset "${matchedLogo.ref.originalName || matchedLogo.ref.filename}" (${matchedLogo.ref.profile.fgWidth}x${matchedLogo.ref.profile.fgHeight}px, aspect ${matchedLogo.ref.profile.aspectRatio}:1).`,
      affectedRegion: matchedBox,
      recommendedCorrection: '',
      referenceUsed: matchedLogo.ref.filename,
      details: {
        variantId: matchedLogo.ref.id,
        variantLabel: matchedLogo.ref.label,
        similarityPct: simPct,
      },
    };

    overlays.push({
      id: 'matched-logo',
      label: matchedBox.label || matchedLogo.ref.label,
      kind: 'matched_logo',
      status: 'passed',
      confidence: simPct >= 75 ? 'high' : 'medium',
      bbox: matchedBox,
      notes: `Matched ${matchedLogo.ref.label} (${simPct}%)`,
    });

    // Check Distortion, Rotation, Clipping, Resolution
    const distortionProblems: string[] = [];
    let distortionSeverity: VisualSeverityLevel = 'medium';

    if (matchedLogo.aspectRatioDeviation > 1.25) {
      const pctStretch = Math.round((matchedLogo.aspectRatioDeviation - 1) * 100);
      distortionProblems.push(
        `non-proportional ${matchedLogo.detectedAspectRatio > matchedLogo.ref.profile.aspectRatio ? 'horizontal stretch' : 'vertical stretch / horizontal compression'} (${pctStretch}% aspect ratio deviation: detected ${matchedLogo.detectedAspectRatio}:1 vs expected ${matchedLogo.ref.profile.aspectRatio}:1)`
      );
      if (matchedLogo.aspectRatioDeviation >= 1.6) distortionSeverity = 'high';
    }

    if (matchedLogo.rotatedAngle !== 0) {
      distortionProblems.push(`excessive ${matchedLogo.rotatedAngle}° rotation relative to upright reference orientation`);
      distortionSeverity = 'high';
    }

    const workCropPx = {
      x: Math.round(matchedLogo.bbox.x * workW),
      y: Math.round(matchedLogo.bbox.y * workH),
      width: Math.max(1, Math.round(matchedLogo.bbox.width * workW)),
      height: Math.max(1, Math.round(matchedLogo.bbox.height * workH)),
    };

    if (matchedLogo.localBgRgb) {
      const clipRes = measureEdgeClipping(workRgba, workW, workH, workCropPx, matchedLogo.localBgRgb);
      if (clipRes.isClipped) {
        distortionProblems.push(`logo mark is clipped along the canvas ${clipRes.clippedEdges.join(' and ')}`);
        distortionSeverity = 'high';
      }
    }

    const minConfiguredWidth = visualGuidelines.logoRules.minWidthPx;
    if (minConfiguredWidth && matchedLogo.estimatedWidthPx < minConfiguredWidth) {
      distortionProblems.push(
        `logo width (${matchedLogo.estimatedWidthPx}px) is below documented minimum size (${minConfiguredWidth}px)`
      );
    } else if (matchedLogo.estimatedWidthPx < 24) {
      distortionProblems.push(`logo width (${matchedLogo.estimatedWidthPx}px) is too small for legible reproduction`);
    }

    // Check low-resolution blur/upscaling only when dimensions are very small
    const lapSharpness = measureSharpnessLaplacian(workRgba, workW, workH, workCropPx);
    if (matchedLogo.estimatedWidthPx < 48 && lapSharpness < 6) {
      distortionProblems.push(`degraded/low-resolution rendering detected (sharpness index ${lapSharpness.toFixed(1)})`);
    }

    if (distortionProblems.length > 0) {
      const violationLabel = `Logo Distortion / Integrity Issue`;
      distortionCheck = {
        id: 'logo_distortion',
        title: 'Logo Integrity, Proportions & Distortion',
        status: 'violation',
        confidence: 'high',
        severity: distortionSeverity,
        category: 'Visual Identity',
        explanation: `Logo integrity violation: ${distortionProblems.join('; ')}.`,
        evidence: `Reference logo aspect ratio ${matchedLogo.ref.profile.aspectRatio}:1 (${matchedLogo.ref.profile.fgWidth}x${matchedLogo.ref.profile.fgHeight}px)${minConfiguredWidth ? `, minimum width ${minConfiguredWidth}px` : ''}. Measured in submission: ${matchedLogo.estimatedWidthPx}x${matchedLogo.estimatedHeightPx}px (aspect ${matchedLogo.detectedAspectRatio}:1).`,
        affectedRegion: { ...matchedLogo.bbox, label: violationLabel },
        recommendedCorrection: `Restore the official "${matchedLogo.ref.label}" lockup with locked ${matchedLogo.ref.profile.aspectRatio}:1 proportions, upright orientation, and full unclipped bounds${minConfiguredWidth ? ` at least ${minConfiguredWidth}px wide` : ''}.`,
        referenceUsed: matchedLogo.ref.filename,
        details: {
          aspectRatioDeviation: matchedLogo.aspectRatioDeviation,
          rotatedAngle: matchedLogo.rotatedAngle,
          estimatedWidthPx: matchedLogo.estimatedWidthPx,
          estimatedHeightPx: matchedLogo.estimatedHeightPx,
        },
      };
      overlays.push({
        id: 'logo-distortion',
        label: violationLabel,
        kind: 'logo_violation',
        status: 'violation',
        confidence: 'high',
        bbox: { ...matchedLogo.bbox, label: violationLabel },
        notes: distortionProblems.join('; '),
      });
    } else {
      distortionCheck = {
        id: 'logo_distortion',
        title: 'Logo Integrity, Proportions & Distortion',
        status: 'passed',
        confidence: 'high',
        severity: null,
        category: 'Visual Identity',
        explanation: `Logo proportions (${matchedLogo.detectedAspectRatio}:1 vs ${matchedLogo.ref.profile.aspectRatio}:1 reference), orientation, resolution (${matchedLogo.estimatedWidthPx}px wide), and edge bounds are intact.`,
        evidence: `Aspect ratio deviation ${matchedLogo.aspectRatioDeviation}x (within 1.25x tolerance), zero clipping detected.`,
        affectedRegion: matchedBox,
        recommendedCorrection: '',
      };
    }

    // Check Placement, Clear-Space, Background Contrast
    const placementProblems: string[] = [];
    let placementSeverity: VisualSeverityLevel = 'medium';

    if (
      visualGuidelines.logoRules.allowedPlacements.length > 0 &&
      !visualGuidelines.logoRules.allowedPlacements.includes(matchedLogo.placementZone)
    ) {
      placementProblems.push(
        `logo is positioned at "${matchedLogo.placementZone}", outside documented placement zones (${visualGuidelines.logoRules.allowedPlacements.join(', ')})`
      );
    }

    const csr = visualGuidelines.logoRules.clearSpaceRatio;
    if (csr && matchedLogo.localBgRgb) {
      const clearCheck = measureClearSpaceIntrusion(
        workRgba,
        workW,
        workH,
        workCropPx,
        csr,
        matchedLogo.localBgRgb
      );
      if (clearCheck.violatedByEdge) {
        placementProblems.push(
          `insufficient clear space from canvas edge (${clearCheck.edgeReason}; minimum ${Math.round(csr * 100)}% clear-space ratio required)`
        );
      }
      if (clearCheck.intrusionRatio > 0.14) {
        placementProblems.push(
          `visual elements/text intrude into the required ${Math.round(csr * 100)}% logo clear-space zone (${Math.round(clearCheck.intrusionRatio * 100)}% perimeter overlap)`
        );
        placementSeverity = 'high';
      }

      const marginNormX = matchedLogo.bbox.width * csr;
      const marginNormY = matchedLogo.bbox.height * csr;
      const csBox = normalizeBoundingBox(
        {
          x: matchedLogo.bbox.x - marginNormX,
          y: matchedLogo.bbox.y - marginNormY,
          width: matchedLogo.bbox.width + marginNormX * 2,
          height: matchedLogo.bbox.height + marginNormY * 2,
          label: `Required Clear Space (${Math.round(csr * 100)}%)`,
        },
        origWidth,
        origHeight
      );
      if (csBox) {
        overlays.push({
          id: 'logo-clear-space',
          label: csBox.label || 'Clear Space Zone',
          kind: 'clear_space_zone',
          status: clearCheck.violatedByEdge || clearCheck.intrusionRatio > 0.14 ? 'violation' : 'passed',
          confidence: 'high',
          bbox: csBox,
          notes: `Minimum ${Math.round(csr * 100)}% padding halo around logo`,
        });
      }
    }

    // Check approved background color around logo if configured
    if (visualGuidelines.approvedBackgrounds.length > 0 && matchedLogo.localBgRgb) {
      let minBgDelta = Infinity;
      for (const hex of visualGuidelines.approvedBackgrounds) {
        const bgRefRgb = hexToRgb(hex);
        if (bgRefRgb) {
          const d = computeDeltaE(matchedLogo.localBgRgb, bgRefRgb);
          if (d < minBgDelta) minBgDelta = d;
        }
      }
      if (minBgDelta > 28) {
        placementProblems.push(
          `logo sits on unapproved background color ${matchedLogo.localBgHex} (closest approved background CIELAB ΔE: ${minBgDelta.toFixed(1)})`
        );
      }
    }

    if (matchedLogo.contrastRatio !== null && matchedLogo.contrastRatio < 2.2) {
      placementProblems.push(
        `low contrast between logo mark and surrounding canvas (${matchedLogo.contrastRatio}:1 against ${matchedLogo.localBgHex || 'background'})`
      );
      placementSeverity = 'high';
    }

    if (placementProblems.length > 0) {
      placementCheck = {
        id: 'logo_placement_clear_space',
        title: 'Logo Placement, Clear Space & Contrast',
        status: 'violation',
        confidence: 'high',
        severity: placementSeverity,
        category: 'Visual Identity',
        explanation: `Logo placement/clear-space violation: ${placementProblems.join('; ')}.`,
        evidence: `Logo located in "${matchedLogo.placementZone}" on background ${matchedLogo.localBgHex || 'N/A'}${csr ? `, configured clear-space ratio ${csr}x` : ''}${visualGuidelines.logoRules.allowedPlacements.length > 0 ? `, allowed placements: ${visualGuidelines.logoRules.allowedPlacements.join(', ')}` : ''}.`,
        affectedRegion: matchedBox,
        recommendedCorrection: `Reposition logo inside an approved zone${visualGuidelines.logoRules.allowedPlacements.length > 0 ? ` (${visualGuidelines.logoRules.allowedPlacements.join(' / ')})` : ''} with unobstructed clear-space margins and sufficient background contrast.`,
        referenceUsed: matchedLogo.ref.filename,
      };
    } else if (
      csr ||
      visualGuidelines.logoRules.allowedPlacements.length > 0 ||
      visualGuidelines.approvedBackgrounds.length > 0 ||
      matchedLogo.contrastRatio !== null
    ) {
      placementCheck = {
        id: 'logo_placement_clear_space',
        title: 'Logo Placement, Clear Space & Contrast',
        status: 'passed',
        confidence: 'high',
        severity: null,
        category: 'Visual Identity',
        explanation: `Logo placement ("${matchedLogo.placementZone}"), clear-space padding, and background contrast${matchedLogo.contrastRatio ? ` (${matchedLogo.contrastRatio}:1)` : ''} comply with brand specifications.`,
        evidence: `Verified unobstructed surrounding margin and compatible backdrop (${matchedLogo.localBgHex || 'verified'}).`,
        affectedRegion: matchedBox,
        recommendedCorrection: '',
      };
    } else {
      placementCheck = {
        id: 'logo_placement_clear_space',
        title: 'Logo Placement, Clear Space & Contrast',
        status: 'passed',
        confidence: 'medium',
        severity: null,
        category: 'Visual Identity',
        explanation: `Logo sits cleanly inside canvas bounds in the ${matchedLogo.placementZone} area; no specific clear-space ratio or restricted placement zones were configured.`,
        evidence: `Located in ${matchedLogo.placementZone} on ${matchedLogo.localBgHex || 'canvas'} backdrop.`,
        affectedRegion: matchedBox,
        recommendedCorrection: '',
      };
    }
  } else {
    // No brand logo matched deterministically!
    const rogue = bestRogueCandidate;
    if (rogue) {
      const rogueSimPct = Math.round(rogue.bestSim * 100);
      const rogueLabel = 'Unrecognized Graphic / Non-Brand Logo Candidate';
      const rogueBox = { ...rogue.bbox, label: rogueLabel };
      overlays.push({
        id: 'rogue-logo-candidate',
        label: rogueLabel,
        kind: 'logo_violation',
        status: 'violation',
        confidence: 'medium',
        bbox: rogueBox,
        notes: `Low structural match against approved brand logos (${rogueSimPct}% max similarity)`,
      });

      logoMatchCheck = {
        id: 'logo_matching',
        title: 'Logo Identification & Variant Matching',
        status: visualGuidelines.logoRules.logoRequired === false ? 'inconclusive' : 'violation',
        confidence: 'medium',
        severity: visualGuidelines.logoRules.logoRequired === false ? null : 'high',
        category: 'Visual Identity',
        explanation: `Detected a prominent graphic mark in the ${rogue.placementZone} region that does not match any approved "${brandName}" logo reference (highest structural similarity: ${rogueSimPct}%).${visualGuidelines.logoRules.logoRequired ? ' Official brand logo appears missing or replaced by an unauthorized variant.' : ''}`,
        evidence: `Compared against ${recognizableRefs.length} approved brand logo reference(s) (${recognizableRefs.map((r) => r.label).join(', ')}).`,
        affectedRegion: rogueBox,
        recommendedCorrection: `Replace the unrecognized graphic mark with an approved "${brandName}" logo asset from Brand Guidelines.`,
      };
    } else if (visualGuidelines.logoRules.logoRequired) {
      logoMatchCheck = {
        id: 'logo_matching',
        title: 'Logo Identification & Variant Matching',
        status: 'violation',
        confidence: 'medium',
        severity: 'high',
        category: 'Visual Identity',
        explanation: `Brand guidelines require an official "${brandName}" logo, but no matching brand mark was detected in the submitted image.`,
        evidence: `Checked against ${recognizableRefs.length} approved logo reference(s); Logo Required rule is active.`,
        affectedRegion: null,
        recommendedCorrection: `Include an approved "${brandName}" logo lockup with clear-space margins in the creative.`,
      };
    } else {
      logoMatchCheck = {
        id: 'logo_matching',
        title: 'Logo Identification & Variant Matching',
        status: 'inconclusive',
        confidence: 'low',
        severity: null,
        category: 'Visual Identity',
        explanation: `No approved "${brandName}" logo mark was positively localized in this asset (and brand guidelines do not strictly mandate a logo on every graphic).`,
        evidence: `Checked against ${recognizableRefs.length} approved brand logo reference(s).`,
        affectedRegion: null,
        recommendedCorrection: 'Verify manually whether this asset is a photographic/background element or requires the official brand logo.',
      };
    }

    distortionCheck = {
      id: 'logo_distortion',
      title: 'Logo Integrity, Proportions & Distortion',
      status: logoMatchCheck.status === 'violation' ? 'inconclusive' : 'not_applicable',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Logo distortion checks require a positively matched official brand logo lockup.',
      evidence: 'No matching brand logo localized.',
      affectedRegion: null,
      recommendedCorrection: '',
    };

    placementCheck = {
      id: 'logo_placement_clear_space',
      title: 'Logo Placement, Clear Space & Contrast',
      status: logoMatchCheck.status === 'violation' ? 'inconclusive' : 'not_applicable',
      confidence: 'low',
      severity: null,
      category: 'Visual Identity',
      explanation: 'Clear-space and placement checks require a positively matched official brand logo lockup.',
      evidence: 'No matching brand logo localized.',
      affectedRegion: null,
      recommendedCorrection: '',
    };
  }

  // 5. Typography Check Initialization (honest baseline before optional Vision AI)
  const hasTypographyRules = Boolean(
    visualGuidelines.typographyRules.primaryFont ||
      visualGuidelines.typographyRules.secondaryFont ||
      visualGuidelines.typographyRules.headingStyle ||
      visualGuidelines.typographyRules.bodyStyle ||
      visualGuidelines.typographyRules.notes
  );

  let typographyCheck: VisualCheckResult = hasTypographyRules
    ? {
        id: 'typography_consistency',
        title: 'Typography & Visual Hierarchy',
        status: 'inconclusive',
        confidence: 'low',
        severity: null,
        category: 'Visual Identity',
        explanation:
          'Font family identification cannot be reliably confirmed on flattened raster images using pixel heuristics alone.',
        evidence: `Documented brand typography rules: ${[visualGuidelines.typographyRules.primaryFont && `Primary: ${visualGuidelines.typographyRules.primaryFont}`, visualGuidelines.typographyRules.secondaryFont && `Secondary: ${visualGuidelines.typographyRules.secondaryFont}`, visualGuidelines.typographyRules.headingStyle && `Headings: ${visualGuidelines.typographyRules.headingStyle}`].filter(Boolean).join('; ')}.`,
        affectedRegion: null,
        recommendedCorrection: 'Verify embedded typography manually against brand font files or run visual inspection with AI Vision enabled.',
      }
    : {
        id: 'typography_consistency',
        title: 'Typography & Visual Hierarchy',
        status: 'not_applicable',
        confidence: 'high',
        severity: null,
        category: 'Visual Identity',
        explanation: 'No typography or font rules are configured in Brand Visual Guidelines.',
        evidence: 'Typography rules are empty in the Brand Visual Profile.',
        affectedRegion: null,
        recommendedCorrection: '',
      };

  // 6. Optional Gemini Vision Augmentation (passes submission + primary/variant reference logo)
  let visionStatus: VisualBrandAnalysisResult['visionStatus'] = 'unavailable';
  let visionNote: string | null = aiClient
    ? null
    : 'AI Vision analysis skipped (GEMINI_API_KEY not configured on server); deterministic pixel, color, and template geometry checks completed.';

  if (aiClient) {
    try {
      const resizedSub = await sharp(submissionImageBuffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { inlineData: { mimeType: 'image/png', data: resizedSub.toString('base64') } },
      ];

      const includedRefs: Array<{ label: string; variantType: string; filename: string }> = [];
      for (const ref of refEntries.slice(0, 3)) {
        if (!ref.buffer) continue;
        try {
          const refPng = await sharp(
            ref.filename.toLowerCase().endsWith('.svg')
              ? Buffer.from(ref.buffer)
              : ref.buffer,
            { density: ref.filename.toLowerCase().endsWith('.svg') ? 150 : undefined, limitInputPixels: MAX_IMAGE_INPUT_PIXELS }
          )
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
          parts.push({ inlineData: { mimeType: 'image/png', data: refPng.toString('base64') } });
          includedRefs.push({ label: ref.label, variantType: ref.variantType, filename: ref.filename });
        } catch {
          // skip invalid ref buffer
        }
      }

      const systemInstruction = `You are a visual brand compliance inspector for "${brandName}".
Image 1 is the SUBMITTED CREATIVE to inspect (${origWidth}x${origHeight}).
${includedRefs.length > 0 ? `Subsequent image(s) are OFFICIAL BRAND LOGO REFERENCES: ${includedRefs.map((r, i) => `Image ${i + 2}: ${r.label} (${r.variantType})`).join('; ')}.` : 'No official brand logo reference image was provided.'}
STRICT ACCURACY RULES:
1. NEVER invent rules not provided in the Visual Brand Guidelines below.
2. NEVER pretend an exact font family or exact logo match is certain if raster detail is blurry or ambiguous — use status="inconclusive" with clear reasoning.
3. For bounding boxes, use normalized 0..1000 integer coordinates [ymin, xmin, ymax, xmax] ONLY for regions clearly visible in Image 1; omit or leave null if uncertain. NEVER fabricate boxes.
4. For font/typography verification on flattened raster images without obvious text or unmistakable style clashes (e.g., handwritten/comic script vs geometric sans rule), mark typographyStatus="inconclusive".`;

      const visionPrompt = `VISUAL BRAND GUIDELINES FOR "${brandName}":
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}
- Accent Colors: ${visualGuidelines.accentColors.join(', ') || '(none)'}
- Approved Backgrounds: ${visualGuidelines.approvedBackgrounds.join(', ') || '(none)'}
- Logo Required: ${visualGuidelines.logoRules.logoRequired === null ? '(unspecified)' : String(visualGuidelines.logoRules.logoRequired)}
- Logo Allowed Placements: ${visualGuidelines.logoRules.allowedPlacements.join(', ') || '(unspecified)'}
- Logo Prohibited Misuse: ${visualGuidelines.logoRules.prohibitedMisuse.join('; ') || '(none)'}
- Typography Primary Font: ${visualGuidelines.typographyRules.primaryFont || '(unspecified)'}
- Typography Secondary Font: ${visualGuidelines.typographyRules.secondaryFont || '(unspecified)'}
- Typography Heading/Body Rules: ${[visualGuidelines.typographyRules.headingStyle, visualGuidelines.typographyRules.bodyStyle, visualGuidelines.typographyRules.notes].filter(Boolean).join(' | ') || '(none)'}

DETERMINISTIC PRE-CHECK OBSERVATIONS:
- Logo detection: ${logoMatchCheck.status} — ${logoMatchCheck.explanation}
- Color detection: ${colorCheck.status} — ${colorCheck.explanation}

Evaluate:
1) Logo presence, variant authenticity/recoloring/misuse vs Image 2+, rotation/distortion/cropping;
2) Visible typography consistency & contrast hierarchy ONLY if rules are configured and visible text exists;
Return strict JSON.`;

      parts.push({ text: visionPrompt });

      const response = await generateWithRetry(() =>
        aiClient.models.generateContent({
          model: geminiModel,
          contents: { parts },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                logoStatus: { type: Type.STRING, description: 'passed | violation | inconclusive | not_applicable' },
                logoExplanation: { type: Type.STRING },
                logoConfidence: { type: Type.STRING, description: 'high | medium | low' },
                logoSeverity: { type: Type.STRING, description: 'critical | high | medium | low' },
                logoMisuseDetected: { type: Type.BOOLEAN },
                logoMisuseDetail: { type: Type.STRING },
                logoBbox1000: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                  description: 'Optional [ymin, xmin, ymax, xmax] in 0..1000 ONLY if logo is visibly localized',
                },
                typographyStatus: { type: Type.STRING, description: 'passed | violation | inconclusive | not_applicable' },
                typographyExplanation: { type: Type.STRING },
                typographyConfidence: { type: Type.STRING, description: 'high | medium | low' },
                typographySeverity: { type: Type.STRING, description: 'critical | high | medium | low' },
                typographyCorrection: { type: Type.STRING },
                typographyBbox1000: {
                  type: Type.ARRAY,
                  items: { type: Type.NUMBER },
                },
              },
              required: ['logoStatus', 'logoExplanation', 'typographyStatus', 'typographyExplanation'],
            },
          },
        })
      );

      const rawText = ((response as { text?: string })?.text || '').trim();
      if (rawText) {
        const parsed = JSON.parse(rawText) as Record<string, unknown>;
        visionStatus = 'completed';

        const parseBox1000 = (arr: unknown, label: string): VisualBoundingBox | null => {
          if (!Array.isArray(arr) || arr.length !== 4) return null;
          const nums = arr.map((n) => Number(n));
          if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) return null;
          const [ymin, xmin, ymax, xmax] = nums;
          if (ymax <= ymin || xmax <= xmin) return null;
          return normalizeBoundingBox(
            {
              x: xmin / 1000,
              y: ymin / 1000,
              width: (xmax - xmin) / 1000,
              height: (ymax - ymin) / 1000,
              label,
            },
            origWidth,
            origHeight
          );
        };

        const vLogoStatus = String(parsed.logoStatus || '').toLowerCase();
        const vLogoConf = (['high', 'medium', 'low'].includes(String(parsed.logoConfidence || '').toLowerCase())
          ? String(parsed.logoConfidence).toLowerCase()
          : 'medium') as VisualConfidenceLevel;
        const vLogoSev = (['critical', 'high', 'medium', 'low'].includes(String(parsed.logoSeverity || '').toLowerCase())
          ? String(parsed.logoSeverity).toLowerCase()
          : 'high') as VisualSeverityLevel;
        const vLogoBbox = parseBox1000(parsed.logoBbox1000, 'AI Vision Localized Mark');

        // Merge Gemini Vision semantic logo misuse/missing detection cleanly without overriding high-confidence deterministic distortion measurements
        if (parsed.logoMisuseDetected === true || vLogoStatus === 'violation') {
          const detail =
            (typeof parsed.logoMisuseDetail === 'string' && parsed.logoMisuseDetail.trim()) ||
            (typeof parsed.logoExplanation === 'string' && parsed.logoExplanation.trim()) ||
            'Visual logo misuse or missing required brand logo detected.';
          if (logoMatchCheck.status !== 'violation') {
            logoMatchCheck = {
              ...logoMatchCheck,
              status: 'violation',
              confidence: vLogoConf,
              severity: vLogoSev,
              explanation: detail,
              affectedRegion: logoMatchCheck.affectedRegion || vLogoBbox,
              recommendedCorrection:
                logoMatchCheck.recommendedCorrection ||
                `Use the unmodified, approved "${brandName}" logo lockup consistent with Brand Guidelines.`,
            };
          } else {
            logoMatchCheck.explanation = `${logoMatchCheck.explanation} Vision note: ${detail}`;
          }
          if (!logoMatchCheck.affectedRegion && vLogoBbox) {
            logoMatchCheck.affectedRegion = vLogoBbox;
            overlays.push({
              id: 'vision-logo-violation',
              label: vLogoBbox.label || 'Logo Violation Region',
              kind: 'logo_violation',
              status: 'violation',
              confidence: vLogoConf,
              bbox: vLogoBbox,
              notes: detail,
            });
          }
        } else if (vLogoStatus === 'passed' && logoMatchCheck.status === 'inconclusive' && refEntries.length > 0) {
          // If Vision saw a logo when template score was borderline, keep transparent note unless matched
          if (typeof parsed.logoExplanation === 'string' && parsed.logoExplanation.trim()) {
            logoMatchCheck.explanation = `${logoMatchCheck.explanation} AI Vision observation: ${parsed.logoExplanation.trim()}`;
          }
        }

        // Merge Typography Assessment ONLY when typography rules exist
        if (hasTypographyRules) {
          const tStatusRaw = String(parsed.typographyStatus || 'inconclusive').toLowerCase();
          const tStatus: VisualCheckStatus =
            tStatusRaw === 'violation'
              ? 'violation'
              : tStatusRaw === 'passed'
                ? 'passed'
                : tStatusRaw === 'not_applicable'
                  ? 'not_applicable'
                  : 'inconclusive';
          const tConf = (['high', 'medium', 'low'].includes(String(parsed.typographyConfidence || '').toLowerCase())
            ? String(parsed.typographyConfidence).toLowerCase()
            : 'low') as VisualConfidenceLevel;
          const tSev = (['critical', 'high', 'medium', 'low'].includes(String(parsed.typographySeverity || '').toLowerCase())
            ? String(parsed.typographySeverity).toLowerCase()
            : 'medium') as VisualSeverityLevel;
          const tBbox = parseBox1000(parsed.typographyBbox1000, 'Typography / Headline Region');
          const tExp =
            typeof parsed.typographyExplanation === 'string' && parsed.typographyExplanation.trim()
              ? parsed.typographyExplanation.trim()
              : typographyCheck.explanation;

          typographyCheck = {
            ...typographyCheck,
            status: tStatus,
            confidence: tConf,
            severity: tStatus === 'violation' ? tSev : null,
            explanation: tExp,
            affectedRegion: tBbox,
            recommendedCorrection:
              typeof parsed.typographyCorrection === 'string' && parsed.typographyCorrection.trim()
                ? parsed.typographyCorrection.trim()
                : typographyCheck.recommendedCorrection,
          };
          if (tBbox) {
            overlays.push({
              id: 'vision-typography',
              label: tBbox.label || 'Typography Region',
              kind: 'typography_region',
              status: tStatus,
              confidence: tConf,
              bbox: tBbox,
              notes: tExp,
            });
          }
        }
      }
    } catch (err) {
      visionStatus = 'failed';
      visionNote = `AI Vision evaluation encountered an error (${formatAiError(err)}). Deterministic pixel, palette, and logo geometry results remain intact.`;
    }
  }

  const checks: VisualCheckResult[] = [
    logoMatchCheck,
    distortionCheck,
    placementCheck,
    colorCheck,
    typographyCheck,
  ];

  const violations = checks.filter((c) => c.status === 'violation');
  const inconclusives = checks.filter((c) => c.status === 'inconclusive');
  const passedCount = checks.filter((c) => c.status === 'passed').length;

  let overallStatus: VisualBrandAnalysisResult['overallStatus'] = 'passed';
  let summary = '';

  if (violations.length > 0) {
    overallStatus = 'issues_found';
    summary = `${violations.length} visual brand violation${violations.length > 1 ? 's' : ''} detected (${violations.map((v) => v.title).join(', ')}).`;
  } else if (passedCount === 0 && inconclusives.length === 0) {
    overallStatus = 'not_performed';
    summary = 'Visual brand checks not applicable — no visual guidelines or reference assets configured.';
  } else if (inconclusives.length > 0) {
    overallStatus = passedCount > 0 ? 'warning' : 'warning';
    summary = `${passedCount} visual check${passedCount === 1 ? '' : 's'} passed; ${inconclusives.length} marked inconclusive due to limited visual/guideline evidence.`;
  } else {
    overallStatus = 'passed';
    summary = `All ${passedCount} applicable visual brand checks passed for "${brandName}".`;
  }

  return {
    analyzedAt: new Date().toISOString(),
    imageWidth: origWidth,
    imageHeight: origHeight,
    visionStatus,
    visionNote,
    overallStatus,
    summary,
    matchedLogoVariant: matchedLogo
      ? {
          id: matchedLogo.ref.id,
          label: matchedLogo.ref.label,
          variantType: matchedLogo.ref.variantType,
          filename: matchedLogo.ref.filename,
          similarityScore: Number(Math.max(matchedLogo.similarity, matchedLogo.bestRotSimilarity).toFixed(3)),
          detectedAspectRatio: matchedLogo.detectedAspectRatio,
          expectedAspectRatio: matchedLogo.ref.profile.aspectRatio,
          aspectRatioDeviation: matchedLogo.aspectRatioDeviation,
          estimatedWidthPx: matchedLogo.estimatedWidthPx,
          estimatedHeightPx: matchedLogo.estimatedHeightPx,
          placementZone: matchedLogo.placementZone,
          bbox: matchedLogo.bbox,
          backgroundHex: matchedLogo.localBgHex,
          backgroundContrastRatio: matchedLogo.contrastRatio,
        }
      : null,
    expectedPalette,
    detectedPalette,
    referenceLogos: refEntries.map((r) => ({
      id: r.id,
      label: r.label,
      variantType: r.variantType,
      filename: r.filename,
      width: r.profile.fgWidth,
      height: r.profile.fgHeight,
      aspectRatio: r.profile.aspectRatio,
    })),
    overlays,
    checks,
  };
}
