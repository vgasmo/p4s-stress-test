// Datas de calendário (YYYY-MM-DD) sem fuso horário. Os prazos contam a partir do
// dia de Lisboa em que o diagnóstico é feito. Sem dependências de Node.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function todayInLisbon(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) throw new RangeError(`Data inválida: ${isoDate}`);
  if (!Number.isInteger(days)) throw new RangeError('O número de dias tem de ser inteiro.');
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days)).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) throw new RangeError('Data inválida.');
  const ms = Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d);
  return Math.round(ms / 86_400_000);
}

/** dd/mm/aaaa */
export function formatDatePt(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parsed = parseIsoDate(isoDate.slice(0, 10));
  if (!parsed) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(parsed.d)}/${pad(parsed.m)}/${parsed.y}`;
}
