// Dato i Danmark. Træningsdagen følger dansk tid, ikke UTC (som appen følger telefonens ur).
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' i Europe/Copenhagen. */
export const todayInCopenhagen = (now = new Date()) => fmt.format(now);

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
