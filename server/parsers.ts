import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { Jimp, intToRGBA } from 'jimp';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

export interface ImageAnalysisMetrics {
  width: number;
  height: number;
  dominantColors: string[];
  averageLuminance: number;
  contrastSpread: number;
  brandPrimaryMatchDistance: number | null;
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

export function validateUploadedFileContent(filePath: string, originalName: string, allowed: Set<string>): string {
  return validateUploadedBufferContent(fs.readFileSync(filePath), originalName, allowed);
}

export async function extractDocumentTextFromBuffer(buffer: Buffer, originalName: string): Promise<string> {
  const ext = validateFileExtension(originalName, ALLOWED_DOC_EXTENSIONS);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return (result.text || '').trim();
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value || '').trim();
  }

  return buffer.toString('utf-8').trim();
}

export async function extractDocumentText(filePath: string, originalName: string): Promise<string> {
  return extractDocumentTextFromBuffer(fs.readFileSync(filePath), originalName);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
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

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.round(Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2));
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export async function analyzeImageBuffer(
  buffer: Buffer,
  brandPrimaryHex?: string,
  brandSecondaryHex?: string
): Promise<ImageAnalysisMetrics> {
  const image = await Jimp.fromBuffer(buffer);
  const width = image.width;
  const height = image.height;

  // Sample pixels across grid for fast deterministic color & luminance analysis
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));

  const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
  let lumSum = 0;
  let lumMin = 1;
  let lumMax = 0;
  let sampleCount = 0;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const pixelInt = image.getPixelColor(x, y);
      const { r, g, b, a } = intToRGBA(pixelInt);
      if (a < 30) continue;

      sampleCount++;
      const lum = relativeLuminance(r, g, b);
      lumSum += lum;
      if (lum < lumMin) lumMin = lum;
      if (lum > lumMax) lumMax = lum;

      // Quantize to 24-step buckets for dominant palette
      const qr = Math.round(r / 24) * 24;
      const qg = Math.round(g / 24) * 24;
      const qb = Math.round(b / 24) * 24;
      const key = `${qr},${qg},${qb}`;
      const prev = buckets.get(key);
      if (prev) {
        prev.count++;
      } else {
        buckets.set(key, { r: qr, g: qg, b: qb, count: 1 });
      }
    }
  }

  const sortedColors = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const dominantColors = sortedColors.map((c) => rgbToHex(c.r, c.g, c.b));
  const primaryRgb = brandPrimaryHex ? hexToRgb(brandPrimaryHex) : null;
  const secondaryRgb = brandSecondaryHex ? hexToRgb(brandSecondaryHex) : null;

  let brandPrimaryMatchDistance: number | null = null;
  let brandSecondaryMatchDistance: number | null = null;
  let closestBrandHexMatch: string | null = null;

  if (primaryRgb && sortedColors.length > 0) {
    let best = Infinity;
    for (const c of sortedColors) {
      const d = colorDistance(c, primaryRgb);
      if (d < best) {
        best = d;
        closestBrandHexMatch = rgbToHex(c.r, c.g, c.b);
      }
    }
    brandPrimaryMatchDistance = best;
  }

  if (secondaryRgb && sortedColors.length > 0) {
    let best = Infinity;
    for (const c of sortedColors) {
      const d = colorDistance(c, secondaryRgb);
      if (d < best) best = d;
    }
    brandSecondaryMatchDistance = best;
  }

  const contrastRatio = sampleCount > 0 ? Number(((lumMax + 0.05) / (lumMin + 0.05)).toFixed(2)) : 1;

  return {
    width,
    height,
    dominantColors,
    averageLuminance: sampleCount > 0 ? Number((lumSum / sampleCount).toFixed(3)) : 0,
    contrastSpread: contrastRatio,
    brandPrimaryMatchDistance,
    brandSecondaryMatchDistance,
    closestBrandHexMatch,
  };
}
