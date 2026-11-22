// Påmindelser som Web Push. Beskederne sendes uden indhold (ingen kryptering nødvendig): service
// workeren viser selv teksten "Husk mobilitet". Push-tjenesten (Apple, Google, Mozilla) kræver kun en
// VAPID-signatur. Nøglen laves første gang og gemmes i app_keys, så der intet skal sættes op.
import { z } from 'zod';
import type { Plan } from '../../shared/plan.schema';
import type { ScheduleOverride } from '../../shared/records.schema';
import { getSession, weekForDate } from '../../shared/resolve';
import { effectiveSessions } from '../../shared/schedule';
import { todayInCopenhagen } from './clock';
import { ValidationError } from './errors';
import { getScheduleOverrides, findActivePlan } from './plan';

// ─── Nøgler og VAPID ────────────────────────────────────────────────────────

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

export interface VapidKeys {
  /** Offentlig nøgle (rå P-256-punkt, base64url) — det appen giver til pushManager.subscribe. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** Serverens VAPID-nøgle. Laves og gemmes første gang. */
export async function getVapidKeys(db: D1Database, now = new Date().toISOString()): Promise<VapidKeys> {
  const stored = await db.prepare("SELECT value FROM app_keys WHERE name = 'vapid'").first<string>('value');
  if (stored) return JSON.parse(stored) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const keys: VapidKeys = {
    publicKey: b64url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey,
  };
  // To samtidige kald: kun den første gemmes, og begge bruger den gemte.
  await db.prepare("INSERT INTO app_keys (name, value, created_at) VALUES ('vapid', ?, ?) ON CONFLICT (name) DO NOTHING").bind(JSON.stringify(keys), now).run();
  return JSON.parse((await db.prepare("SELECT value FROM app_keys WHERE name = 'vapid'").first<string>('value'))!) as VapidKeys;
}

/** Authorization-headeren til push-tjenesten: en ES256-signeret JWT for tjenestens origin. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64urlText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** Afsenderen i JWT'en: appens adresse (Apple kræver en gyldig https- eller mailto-adresse). */
const subjectOf = (appOrigin: string | undefined) => appOrigin ?? 'mailto:push@traeningsnav.invalid';

export type PushResult = 'sendt' | 'udløbet' | 'fejl';

/** Sender en tom push-besked. 'udløbet': enheden har opsagt abonnementet (fjernes). */
export async function sendPush(endpoint: string, keys: VapidKeys, appOrigin: string | undefined, fetcher: typeof fetch = fetch): Promise<PushResult> {
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(endpoint, keys, subjectOf(appOrigin)),
      // En morgenpåmindelse, der ikke er nået frem efter fire timer, er ikke længere relevant.
      TTL: String(4 * 3600),
      Urgency: 'normal',
      'Content-Length': '0',
    },
  });
  if (res.status === 404 || res.status === 410) return 'udløbet';
  if (!res.ok) {
    console.error('push fejlede', res.status, await res.text().catch(() => ''));
    return 'fejl';
  }
  return 'sendt';
}

// ─── Abonnementer ───────────────────────────────────────────────────────────

/** Kun kendte push-tjenester, så serveren ikke kan bruges til at kalde vilkårlige adresser. */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.mozilla\.com$/, /\.mozaws\.net$/, /\.notify\.windows\.com$/];

export const PushEndpoint = z
  .url()
  .max(1000)
  .refine((u) => {
    const url = new URL(u);
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname));
  }, 'Ukendt push-tjeneste');

export async function subscribePush(db: D1Database, userId: number, athleteId: number, endpoint: string, now = new Date().toISOString()) {
  const parsed = PushEndpoint.safeParse(endpoint);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Ugyldigt endpoint');
  await db
    .prepare('INSERT INTO push_subscriptions (endpoint, user_id, athlete_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, athlete_id = excluded.athlete_id')
    .bind(parsed.data, userId, athleteId, now)
    .run();
}

export async function unsubscribePush(db: D1Database, userId: number, endpoint: string) {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).run();
}

export async function isSubscribed(db: D1Database, userId: number, endpoint: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).first());
}

// ─── Morgenpåmindelsen ──────────────────────────────────────────────────────

/** Klokkeslættet (time) i Danmark. */
const hourInCopenhagen = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(now));

/** Påmindelsen sendes kl. 6 dansk tid. Cron kører kl. 4 og 5 UTC (sommer- og vintertid). */
export const REMINDER_HOUR = 6;

/** 1 = mandag … 7 = søndag. */
const weekdayOf = (date: string) => ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;

/**
 * Skal atleten mindes om mobilitet på datoen? Kun når planen har en mobilitetsblok, datoen ligger i
 * planen, og dagen ikke har styrketræning (mobilitet og core tages på dage uden styrke).
 */
export function mobilityDay(plan: Plan, date: string, overrides: ScheduleOverride[]): boolean {
  if (!plan.mobility && !getSession(plan, 'mobilitet')) return false;
  const week = weekForDate(plan, date);
  if (!week) return false;
  const today = effectiveSessions(week, overrides).filter((s) => s.day === weekdayOf(date));
  return !today.some((s) => getSession(plan, s.sessionId)?.kind === 'styrke');
}

/** Cron-jobbet: sender morgenpåmindelsen til alle enheder, der har slået den til. */
export async function sendMorningReminders(db: D1Database, appOrigin: string | undefined, now = new Date(), fetcher: typeof fetch = fetch) {
  if (hourInCopenhagen(now) !== REMINDER_HOUR) return { sendt: 0 };
  const date = todayInCopenhagen(now);
  const { results } = await db
    .prepare('SELECT endpoint, athlete_id FROM push_subscriptions WHERE last_sent_on IS NULL OR last_sent_on <> ?')
    .bind(date)
    .all<{ endpoint: string; athlete_id: number }>();
  if (!results.length) return { sendt: 0 };
  const keys = await getVapidKeys(db);
  const due = new Map<number, boolean>();
  let sent = 0;
  for (const sub of results) {
    if (!due.has(sub.athlete_id)) {
      const active = await findActivePlan(db, sub.athlete_id);
      const week = active && weekForDate(active.plan, date);
      const overrides = active && week ? await getScheduleOverrides(db, sub.athlete_id, week.weekNo, active.startedAt) : [];
      due.set(sub.athlete_id, !!active && mobilityDay(active.plan, date, overrides));
    }
    if (!due.get(sub.athlete_id)) continue;
    const result = await sendPush(sub.endpoint, keys, appOrigin, fetcher).catch(() => 'fejl' as const);
    if (result === 'udløbet') await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
    if (result === 'sendt') {
      await db.prepare('UPDATE push_subscriptions SET last_sent_on = ? WHERE endpoint = ?').bind(date, sub.endpoint).run();
      sent++;
    }
  }
  return { sendt: sent };
}
