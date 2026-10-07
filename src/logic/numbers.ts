/** "12,5" → 12.5. Tom eller ugyldig → null. Accepterer både komma og punktum. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (s === '' || s === '.') return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseWhole(input: string): number | null {
  const s = input.trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** 12.5 → "12,5", 10 → "10". */
export const formatDecimal = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ','));

/** Kun tegn der kan blive et decimaltal (iOS' decimaltastatur giver komma). */
export const sanitizeDecimal = (s: string) => s.replace(/[^\d,.]/g, '').replace(/([,.].*)[,.]/g, '$1');
export const sanitizeWhole = (s: string) => s.replace(/\D/g, '');
