export function parseSafeTimestamp(value: string | Date | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  let normalized = trimmed;

  // Already has timezone suffix (e.g., Z, +00:00, -08:00, +0000)
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);

  if (!hasTimezone) {
    // SQLite CURRENT_TIMESTAMP / datetime('now') format: "YYYY-MM-DD HH:MM:SS" (optional .sss)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      normalized = `${trimmed.replace(' ', 'T')}Z`;
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      normalized = `${trimmed}Z`;
    }
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTime(
  value: string | Date | number | null | undefined,
  fallback = '—'
): string {
  const date = parseSafeTimestamp(value);
  return date ? date.toLocaleString() : fallback;
}

export function formatDate(
  value: string | Date | number | null | undefined,
  fallback = '—'
): string {
  const date = parseSafeTimestamp(value);
  return date ? date.toLocaleDateString() : fallback;
}
