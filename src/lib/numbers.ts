/*
 * Numbers as parents type them: Latin or Arabic digits, a point, a comma or
 * the Arabic decimal mark, perhaps a unit after. A form field that is a plain
 * number box refuses "١٢٠٫٥", so the height fields are text boxes read here.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

/** Arabic-Indic and Persian digits as 0–9, and the Arabic decimal mark between them as a point. */
export function latinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(\d)٫(?=\d)/g, '$1.');
}

/**
 * A height from WHO's tables, always with its one decimal ("110.0", never
 * "110"), the way WHO prints them: in a column of 109.4, 110.0 and 115.1 the
 * points line up, and every figure says it was rounded to 0.1 cm.
 */
export function formatCm(cm: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(cm);
}

/** The number in a typed value, or null when there is none or it is not one number. */
export function parseNumber(raw: string): number | null {
  const s = latinDigits(raw)
    .replace(/[٫,]/g, '.')
    .replace(/\s*(cm|سم|سنتي(متر)?)\s*$/i, '')
    .trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}
