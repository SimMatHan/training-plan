// Lille iCalendar-serializer (RFC 5545) til kalenderfeedet. Ingen afhængigheder,
// så den kører i Workers: CRLF, linjefoldning ved 75 oktetter, escaping af TEXT.

/** Egenskab: navn, færdigformateret værdi og evt. parametre. TEXT-værdier escapes med `text()`. */
export type Prop = [name: string, value: string, params?: Record<string, string>];

export interface Component {
  name: string;
  props: Prop[];
  components?: Component[];
}

/** Escaper en TEXT-værdi: \ ; , og linjeskift. */
export const text = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Parameterværdier med : ; , skal i anførselstegn (og må ikke indeholde "). */
const paramValue = (v: string) => (/[:;,]/.test(v) ? `"${v.replace(/"/g, '')}"` : v);

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

/**
 * Folder en indholdslinje, så ingen fysisk linje er over 75 oktetter (uden CRLF).
 * Fortsættelseslinjer starter med ét mellemrum. Der deles kun mellem tegn, aldrig
 * midt i en UTF-8-sekvens.
 */
export function foldLine(line: string, limit = 75): string[] {
  if (octets(line) <= limit) return [line];
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = octets(ch);
    // Første linje må have `limit` oktetter; fortsættelser har et mellemrum foran.
    const max = out.length === 0 ? limit : limit - 1;
    if (size + n > max) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ' ' + l));
}

function contentLines(c: Component): string[] {
  const lines = [`BEGIN:${c.name}`];
  for (const [name, value, params] of c.props) {
    const p = params ? Object.entries(params).map(([k, v]) => `;${k}=${paramValue(v)}`).join('') : '';
    lines.push(`${name}${p}:${value}`);
  }
  for (const child of c.components ?? []) lines.push(...contentLines(child));
  lines.push(`END:${c.name}`);
  return lines;
}

/** Hele objektet som iCalendar-tekst med CRLF og foldede linjer. */
export function serialize(c: Component): string {
  return contentLines(c).flatMap((l) => foldLine(l)).join('\r\n') + '\r\n';
}

// ─── Værdiformater ──────────────────────────────────────────────────────────

/** '2026-10-29' → '20261029' (VALUE=DATE). */
export const icalDate = (iso: string) => iso.replace(/-/g, '');

/** '2026-10-29', '07:30' → '20261029T073000' (lokal tid, bruges med TZID). */
export const icalLocal = (iso: string, hhmm: string) => `${icalDate(iso)}T${hhmm.replace(':', '')}00`;

/** Tidspunkt i ms → '20261007T120000Z' (UTC). */
export const icalUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ─── Europe/Copenhagen ──────────────────────────────────────────────────────

export const TZID = 'Europe/Copenhagen';

/** VTIMEZONE med EU's sommertidsregler (sidste søndag i marts og oktober kl. 01:00 UTC). */
export const copenhagenTimezone: Component = {
  name: 'VTIMEZONE',
  props: [
    ['TZID', TZID],
    ['X-LIC-LOCATION', TZID],
  ],
  components: [
    {
      name: 'DAYLIGHT',
      props: [
        ['TZOFFSETFROM', '+0100'],
        ['TZOFFSETTO', '+0200'],
        ['TZNAME', 'CEST'],
        ['DTSTART', '19700329T020000'],
        ['RRULE', 'FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'],
      ],
    },
    {
      name: 'STANDARD',
      props: [
        ['TZOFFSETFROM', '+0200'],
        ['TZOFFSETTO', '+0100'],
        ['TZNAME', 'CET'],
        ['DTSTART', '19701025T030000'],
        ['RRULE', 'FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'],
      ],
    },
  ],
};

/** Sidste søndag i en måned (0-baseret) kl. 01:00 UTC. */
const lastSundayAt1Utc = (year: number, month: number) => {
  const last = new Date(Date.UTC(year, month + 1, 0, 1));
  return last.getTime() - last.getUTCDay() * 86_400_000;
};

/** Københavns UTC-offset i minutter på et tidspunkt (60 om vinteren, 120 om sommeren). */
export function copenhagenOffsetMin(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  return ms >= lastSundayAt1Utc(year, 2) && ms < lastSundayAt1Utc(year, 9) ? 120 : 60;
}

/** Dagens dato i København ('YYYY-MM-DD'). */
export const copenhagenDate = (ms: number) => new Date(ms + copenhagenOffsetMin(ms) * 60_000).toISOString().slice(0, 10);

/** Midnat (lokal tid) i København på en dato, som UTC-ms. */
export function copenhagenMidnight(iso: string): number {
  const local = Date.parse(iso + 'T00:00:00Z');
  const winter = local - 60 * 60_000;
  return copenhagenOffsetMin(winter) === 60 ? winter : local - 120 * 60_000;
}
