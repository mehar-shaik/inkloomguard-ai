import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000; // 40 MP decompression bomb guard
export const MAX_EXTRACTED_TEXT_CHARS = 300_000;

export const ALLOWED_DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

export interface DocumentExtractionResult {
  text: string;
  pageCount: number | null;
  isScannedOrEmpty: boolean;
  truncated: boolean;
}

export interface ImageAnalysisMetrics {
  width: number;
  height: number;
  dominantColors: string[];
  averageLuminance: number;
  /** Luminance dynamic range across sampled pixels ((Lmax + 0.05) / (Lmin + 0.05)). */
  contrastSpread: number;
  /** WCAG 2.1 contrast ratio between the primary foreground/background color pair among dominant colors. */
  wcagContrastRatio: number | null;
  wcagAA: boolean | null;
  wcagAALarge: boolean | null;
  wcagAAA: boolean | null;
  /** Perceptual CIELAB ΔE distance to brand primary color (0 = exact match). */
  brandPrimaryMatchDistance: number | null;
  /** Perceptual CIELAB ΔE distance to brand secondary color (0 = exact match). */
  brandSecondaryMatchDistance: number | null;
  closestBrandHexMatch: string | null;
}

export function validateFileExtension(originalName: string, allowed: Set<string>): string {
  const ext = path.extname(originalName).toLowerCase();
  if (!allowed.has(ext)) {
    throw new Error(`Unsupported file type "${ext || 'unknown'}". Allowed: ${Array.from(allowed).join(', ')}`);
  }
  return ext;
}

export function validateUploadedBufferContent(buffer: Buffer, originalName: string, allowed: Set<string>): string {
  const ext = validateFileExtension(originalName, allowed);
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded file exceeds the 10 MB size limit.');
  }

  if (ext === '.png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (buffer.length < 8 || !sig.every((b, i) => buffer[i] === b)) {
      throw new Error('File contents do not match a valid PNG image.');
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
      throw new Error('File contents do not match a valid JPEG image.');
    }
  } else if (ext === '.webp') {
    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      throw new Error('File contents do not match a valid WEBP image.');
    }
  } else if (ext === '.svg') {
    const svgText = buffer.toString('utf-8');
    if (!/<svg[\s>]/i.test(svgText)) {
      throw new Error('File contents do not match a valid SVG document.');
    }
    if (/<script\b|javascript:|data:text\/html|<foreignObject\b|\son[a-z]+\s*=/i.test(svgText)) {
      throw new Error('SVG contains disallowed scripting or active content.');
    }
  } else if (ext === '.pdf') {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('File contents do not match a valid PDF document.');
    }
  } else if (ext === '.docx') {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      throw new Error('File contents do not match a valid DOCX archive.');
    }
  } else if (ext === '.txt' || ext === '.md') {
    if (buffer.includes(0x00)) {
      throw new Error('Binary content is not allowed in text or Markdown uploads.');
    }
  }

  return ext;
}

export async function validateRasterImageBuffer(buffer: Buffer, ext: string): Promise<void> {
  if (ext === '.svg') return;
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) return;
  try {
    const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS }).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('missing image dimensions');
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'invalid image data';
    throw new Error(`Unable to decode image file: ${detail}`);
  }
}

export function validateUploadedFileContent(filePath: string, originalName: string, allowed: Set<string>): string {
  return validateUploadedBufferContent(fs.readFileSync(filePath), originalName, allowed);
}

function clampExtractedText(raw: string): { text: string; truncated: boolean } {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS).trimEnd(),
    truncated: true,
  };
}

export async function extractDocumentDetailsFromBuffer(
  buffer: Buffer,
  originalName: string
): Promise<DocumentExtractionResult> {
  const ext = validateFileExtension(originalName, ALLOWED_DOC_EXTENSIONS);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const pages = Array.isArray(result.pages) ? result.pages : [];
      const pageCount = typeof result.total === 'number' && result.total > 0 ? result.total : pages.length || 1;

      let combined = '';
      if (pages.length > 0) {
        const nonEmptyPages = pages
          .map((p) => ({ num: p.num, text: (p.text || '').trim() }))
          .filter((p) => p.text.length > 0);
        if (nonEmptyPages.length > 0) {
          combined = nonEmptyPages.map((p) => `[Page ${p.num}]\n${p.text}`).join('\n\n');
        } else {
          combined = (result.text || '').trim();
        }
      } else {
        combined = (result.text || '').trim();
      }

      const plainNonWs = combined.replace(/\[Page \d+\]/g, '').replace(/\s+/g, '');
      const isScannedOrEmpty = plainNonWs.length < 15;
      const { text, truncated } = clampExtractedText(isScannedOrEmpty ? '' : combined);
      return {
        text,
        pageCount,
        isScannedOrEmpty,
        truncated,
      };
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    const raw = (result.value || '').trim();
    const { text, truncated } = clampExtractedText(raw);
    return {
      text,
      pageCount: null,
      isScannedOrEmpty: raw.replace(/\s+/g, '').length === 0,
      truncated,
    };
  }

  const raw = buffer.toString('utf-8').trim();
  const { text, truncated } = clampExtractedText(raw);
  return {
    text,
    pageCount: null,
    isScannedOrEmpty: raw.replace(/\s+/g, '').length === 0,
    truncated,
  };
}

export async function extractDocumentTextFromBuffer(buffer: Buffer, originalName: string): Promise<string> {
  const details = await extractDocumentDetailsFromBuffer(buffer, originalName);
  return details.text;
}

export async function extractDocumentText(filePath: string, originalName: string): Promise<string> {
  const buf = await fsPromises.readFile(filePath);
  return extractDocumentTextFromBuffer(buf, originalName);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
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

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const rs = srgbToLinear(r);
  const gs = srgbToLinear(g);
  const bs = srgbToLinear(b);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function wcagContrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(a.r, a.g, a.b);
  const l2 = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // sRGB D65 -> XYZ
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / 1.0;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function computeDeltaE(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number }
): number {
  const lab1 = rgbToLab(c1.r, c1.g, c1.b);
  const lab2 = rgbToLab(c2.r, c2.g, c2.b);
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Number(Math.sqrt(dL * dL + da * da + db * db).toFixed(1));
}

export async function resizeImageBuffer(
  buffer: Buffer,
  options: { maxWidth: number; maxHeight: number; format?: 'png' | 'jpeg' | 'webp' }
): Promise<{ buffer: Buffer; width: number; height: number; mimeType: string }> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Image buffer is empty.');
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded file exceeds the 10 MB size limit.');
  }

  const format = options.format ?? 'png';
  try {
    let pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
      .rotate()
      .resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });

    if (format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 88 });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality: 88 });
    } else {
      pipeline = pipeline.png();
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    const mimeType =
      format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    return {
      buffer: data,
      width: info.width,
      height: info.height,
      mimeType,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'invalid image data';
    throw new Error(`Unable to resize image: ${detail}`);
  }
}

export async function analyzeImageBuffer(
  buffer: Buffer,
  brandPrimaryHex?: string,
  brandSecondaryHex?: string
): Promise<ImageAnalysisMetrics> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Image buffer is empty.');
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error('Uploaded file exceeds the 10 MB size limit.');
  }

  let data: Buffer;
  let width: number;
  let height: number;
  try {
    const decoded = await sharp(buffer, { limitInputPixels: MAX_IMAGE_INPUT_PIXELS })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = decoded.data;
    width = decoded.info.width;
    height = decoded.info.height;
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'invalid image data';
    throw new Error(`Unable to decode image buffer: ${detail}`);
  }

  if (!width || !height || data.length < width * height * 4) {
    throw new Error('Decoded image buffer has invalid dimensions.');
  }

  // Sample pixels across grid for deterministic color & luminance analysis
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));

  const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();
  let lumSum = 0;
  let lumMin = 1;
  let lumMax = 0;
  let sampleCount = 0;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const offset = (y * width + x) * 4;
      const rawR = data[offset];
      const rawG = data[offset + 1];
      const rawB = data[offset + 2];
      const a = data[offset + 3];
      if (a < 16) continue;

      // Composite semi-transparent pixels over crisp white canvas (#FFFFFF)
      const alphaNorm = a / 255;
      const r = Math.round(rawR * alphaNorm + 255 * (1 - alphaNorm));
      const g = Math.round(rawG * alphaNorm + 255 * (1 - alphaNorm));
      const b = Math.round(rawB * alphaNorm + 255 * (1 - alphaNorm));

      sampleCount++;
      const lum = relativeLuminance(r, g, b);
      lumSum += lum;
      if (lum < lumMin) lumMin = lum;
      if (lum > lumMax) lumMax = lum;

      // Quantize to 16-step buckets for dominant palette while tracking centroid RGB
      const qr = Math.round(r / 16) * 16;
      const qg = Math.round(g / 16) * 16;
      const qb = Math.round(b / 16) * 16;
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

  const sortedColors = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((bucket) => ({
      r: Math.round(bucket.rSum / bucket.count),
      g: Math.round(bucket.gSum / bucket.count),
      b: Math.round(bucket.bSum / bucket.count),
      count: bucket.count,
    }));

  const dominantColors = sortedColors.map((c) => rgbToHex(c.r, c.g, c.b));
  const primaryRgb = brandPrimaryHex ? hexToRgb(brandPrimaryHex) : null;
  const secondaryRgb = brandSecondaryHex ? hexToRgb(brandSecondaryHex) : null;

  let brandPrimaryMatchDistance: number | null = null;
  let brandSecondaryMatchDistance: number | null = null;
  let closestBrandHexMatch: string | null = null;

  if (primaryRgb && sortedColors.length > 0) {
    let best = Infinity;
    for (const c of sortedColors) {
      const d = computeDeltaE(c, primaryRgb);
      if (d < best) {
        best = d;
        closestBrandHexMatch = rgbToHex(c.r, c.g, c.b);
      }
    }
    brandPrimaryMatchDistance = Math.round(best);
  }

  if (secondaryRgb && sortedColors.length > 0) {
    let best = Infinity;
    for (const c of sortedColors) {
      const d = computeDeltaE(c, secondaryRgb);
      if (d < best) best = d;
    }
    brandSecondaryMatchDistance = Math.round(best);
  }

  const contrastSpread = sampleCount > 0 ? Number(((lumMax + 0.05) / (lumMin + 0.05)).toFixed(2)) : 1;

  // Compute genuine WCAG 2.1 contrast ratio between distinct dominant palette colors
  // (e.g. primary canvas vs primary foreground mark/text). Returns null for solid-fill single-color images.
  let wcagRatio: number | null = null;
  if (sortedColors.length >= 2) {
    let maxRatio = 1;
    for (let i = 0; i < sortedColors.length; i++) {
      for (let j = i + 1; j < sortedColors.length; j++) {
        const ratio = wcagContrastRatio(sortedColors[i], sortedColors[j]);
        if (ratio > maxRatio) {
          maxRatio = ratio;
        }
      }
    }
    wcagRatio = maxRatio;
  }

  return {
    width,
    height,
    dominantColors,
    averageLuminance: sampleCount > 0 ? Number((lumSum / sampleCount).toFixed(3)) : 0,
    contrastSpread,
    wcagContrastRatio: wcagRatio,
    wcagAA: wcagRatio !== null ? wcagRatio >= 4.5 : null,
    wcagAALarge: wcagRatio !== null ? wcagRatio >= 3.0 : null,
    wcagAAA: wcagRatio !== null ? wcagRatio >= 7.0 : null,
    brandPrimaryMatchDistance,
    brandSecondaryMatchDistance,
    closestBrandHexMatch,
  };
}
