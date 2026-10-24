const nf2 = new Intl.NumberFormat('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 });

/** 1258.37 -> "1.258,37", 90 -> "90" (Greek number style) */
export function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  const s = Number.isInteger(r) ? nf0.format(Math.abs(r)) : nf2.format(Math.abs(r));
  return (r < 0 ? '−' : '') + s;
}

export function money(n: number): string {
  return num(n) + ' €';
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function relativeDay(s: string): string {
  const t = todayISO();
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  if (s === addDays(t, 1)) return 'Tomorrow';
  return dayFmt.format(fromISO(s));
}

export const monthYear = (s: string) => monthYearFmt.format(fromISO(s));
export const shortDate = (s: string) => shortFmt.format(fromISO(s));

export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

/** Evaluates a keypad expression like "12,5+3-1" safely. */
export function evalExpr(expr: string): number {
  const s = expr.replace(/,/g, '.').replace(/[+\-]$/, '');
  if (!s) return 0;
  const parts = s.match(/[+\-]?[^+\-]+/g) || [];
  let total = 0;
  for (const p of parts) {
    const v = parseFloat(p);
    if (!Number.isNaN(v)) total += v;
  }
  return round2(total);
}
