// Datoer som 'YYYY-MM-DD' i lokal tid. Træningsdagen følger telefonens ur, ikke UTC.

const pad = (n: number) => String(n).padStart(2, '0');

export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayIso = () => toIsoDate(new Date());

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 1 = mandag … 7 = søndag. */
export const weekday = (iso: string) => ((fromIsoDate(iso).getDay() + 6) % 7) + 1;

export const WEEKDAYS = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
export const WEEKDAYS_SHORT = ['', 'man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

const long = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
const short = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });
const withYear = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });

/** "onsdag 7. oktober" */
export const formatLong = (iso: string) => long.format(fromIsoDate(iso));
/** "7. okt." */
export const formatShort = (iso: string) => short.format(fromIsoDate(iso));
/** "7. okt. 2026" — tager også et fuldt tidsstempel. */
export const formatWithYear = (isoOrTimestamp: string) =>
  withYear.format(isoOrTimestamp.length > 10 ? new Date(isoOrTimestamp) : fromIsoDate(isoOrTimestamp));
