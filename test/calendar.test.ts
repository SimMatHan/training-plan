import ICAL from 'ical.js';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { app } from '../worker/index';
import { buildEvents } from '../worker/calendar/feed';
import { copenhagenDate, copenhagenMidnight, copenhagenOffsetMin, foldLine, serialize, text } from '../worker/calendar/ical';
import { buildCalendarFeed, setCalendarSetting } from '../worker/services/calendar';
import { activatePlanVersion, getActivePlan } from '../worker/services/plan';
import { pushChanges } from '../worker/services/sync';
import { createSeededD1 } from './d1';

// ─── Serializer ─────────────────────────────────────────────────────────────

const octets = (s: string) => new TextEncoder().encode(s).length;

describe('iCalendar-serializer', () => {
  it('escaper komma, semikolon, backslash og linjeskift', () => {
    expect(text('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf');
  });

  it('folder ved 75 oktetter uden at dele UTF-8-tegn', () => {
    const line = 'DESCRIPTION:' + 'Æblegrød med øl og 🏃 — '.repeat(12);
    const folded = foldLine(line);
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(octets(l)).toBeLessThanOrEqual(75);
    folded.slice(1).forEach((l) => expect(l.startsWith(' ')).toBe(true));
    // Ingen erstatningstegn: hver linje er gyldig UTF-8 for sig.
    for (const l of folded) expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new TextEncoder().encode(l))).toBe(l);
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(line);
  });

  it('bruger CRLF og lader korte linjer være', () => {
    const out = serialize({ name: 'VCALENDAR', props: [['VERSION', '2.0']] });
    expect(out).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
  });

  it('kender sommertid i København (skift 25. oktober 2026)', () => {
    expect(copenhagenOffsetMin(Date.parse('2026-10-25T00:59:00Z'))).toBe(120);
    expect(copenhagenOffsetMin(Date.parse('2026-10-25T01:00:00Z'))).toBe(60);
    expect(copenhagenOffsetMin(Date.parse('2027-03-28T01:00:00Z'))).toBe(120);
    expect(copenhagenDate(Date.parse('2026-10-11T22:30:00Z'))).toBe('2026-10-12');
    expect(new Date(copenhagenMidnight('2026-10-12')).toISOString()).toBe('2026-10-11T22:00:00.000Z');
    expect(new Date(copenhagenMidnight('2026-10-26')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});

// ─── Feed ───────────────────────────────────────────────────────────────────

const ORIGIN = 'https://traeningsnav.example.workers.dev';
const NOW = new Date('2026-10-14T10:00:00Z'); // onsdag i uge 3
const T = (s: string) => `2026-${s}.000Z`;

let db: D1Database;

const uuid = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function workout(n: number, fields: Record<string, unknown>) {
  return {
    uuid: uuid(n),
    planned_session_id: null,
    plan_version: 1,
    week_no: null,
    date: '2026-10-05',
    started_at: null,
    finished_at: null,
    type: 'styrke',
    rpe: null,
    note: null,
    groin_during: null,
    source: 'app',
    external_id: null,
    distance_km: null,
    duration_sec: null,
    avg_hr: null,
    updated_at: T('10-05T18:00:00'),
    ...fields,
  };
}

const set = (n: number, workoutN: number, exercise_id: string, set_no: number, side: 'H' | 'V' | null, weight_kg: number | null, reps: number | null) => ({
  uuid: uuid(1000 + n),
  workout_uuid: uuid(workoutN),
  exercise_id,
  set_no,
  side,
  weight_kg,
  reps,
  seconds: null,
  rpe: null,
  done: true,
  updated_at: T('10-05T17:30:00'),
});

const override = (n: number, week_no: number, session_id: string, day: number, updated_at: string, deleted_at: string | null = null) => ({
  uuid: uuid(2000 + n),
  week_no,
  session_id,
  day,
  updated_at,
  deleted_at,
});

/** Kendt tilstand: uge 2 med lavet, flyttet-ved-logning, sprunget over og misset; uge 3 med en flytning. */
async function seedLogs() {
  // Seed sætter created_at til "nu"; fastlås den, så feedet er deterministisk.
  await db.prepare(`UPDATE plan_versions SET created_at = ?`).bind(T('09-27T12:00:00')).run();
  await pushChanges(db, {
    workouts: [
      // Rehab A mandag, lavet med sæt og lyske 2/10, 0/10 næste morgen.
      workout(1, {
        planned_session_id: 'rehab-a',
        week_no: 2,
        date: '2026-10-05',
        started_at: T('10-05T16:30:00'),
        finished_at: T('10-05T17:40:00'),
        rpe: 6,
        groin_during: 2,
        updated_at: T('10-05T17:40:00'),
      }),
      // Rehab B står torsdag, men logges fredag.
      workout(2, {
        planned_session_id: 'rehab-b',
        week_no: 2,
        date: '2026-10-09',
        started_at: T('10-09T16:00:00'),
        finished_at: T('10-09T17:00:00'),
        groin_during: 1,
        updated_at: T('10-09T17:00:00'),
      }),
      // RH sprunget over med årsag.
      workout(3, {
        planned_session_id: 'rh',
        week_no: 2,
        date: '2026-10-07',
        type: 'løb',
        skipped_at: T('10-07T15:00:00'),
        skip_reason: 'Lyske/smerte',
        note: 'Stram efter mandag',
        updated_at: T('10-07T15:00:00'),
      }),
      // Løb i uge 3 er lavet (tirsdag, flyttet fra onsdag).
      workout(4, {
        planned_session_id: 'rh',
        week_no: 3,
        date: '2026-10-13',
        type: 'løb',
        started_at: T('10-13T05:00:00'),
        finished_at: T('10-13T05:40:00'),
        distance_km: 6.2,
        duration_sec: 2046,
        avg_hr: 141,
        groin_during: 0,
        updated_at: T('10-13T05:45:00'),
      }),
    ],
    set_logs: [
      set(1, 1, 'enbens-rdl', 1, 'H', 20, 8),
      set(2, 1, 'enbens-rdl', 1, 'V', 20, 8),
      set(3, 1, 'enbens-rdl', 2, 'H', 24, 8),
      set(4, 1, 'enbens-rdl', 2, 'V', 24, 7),
      set(5, 1, 'adduktorklem', 1, null, null, null),
      set(6, 2, 'rows', 1, null, 30, 10),
      set(7, 2, 'nordic-hamstring-curl', 1, null, null, 5),
    ],
    groin_checks: [{ uuid: uuid(3001), date: '2026-10-06', morning_score: 0, workout_uuid: uuid(1), updated_at: T('10-06T07:00:00') }],
    schedule_overrides: [override(1, 3, 'rh', 2, T('10-12T19:00:00'))],
  });
  // Løb med fast tidspunkt; styrke og crosstrainer er heldag (standard).
  await setCalendarSetting(db, 'løb', { all_day: false, start_time: '07:00', duration_min: 60 }, T('10-01T12:00:00'));
}

const feed = (now = NOW) => buildCalendarFeed(db, { origin: ORIGIN, now });

/** Parser feedet med ical.js og returnerer eventene. Kaster ved ugyldig iCalendar. */
function parse(ics: string) {
  const cal = new ICAL.Component(ICAL.parse(ics));
  const tz = cal.getFirstSubcomponent('vtimezone')!;
  ICAL.TimezoneService.register(tz);
  return cal.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
}

const byUid = (events: ICAL.Event[], uid: string) => events.find((e) => e.uid === uid)!;

describe('kalenderfeed', () => {
  beforeEach(async () => {
    db = await createSeededD1();
    await seedLogs();
  });

  it('matcher snapshot for en kendt plan og et par logs', async () => {
    await expect(await feed()).toMatchFileSnapshot('./__snapshots__/kalender.ics');
  });

  it('er gyldig iCalendar med ét event pr. planlagt session og et for løbet', async () => {
    const ics = await feed();
    expect(ics.split('\r\n').every((l) => octets(l) <= 75)).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    const events = parse(ics);
    const { plan } = await getActivePlan(db);
    const sessions = plan.weeks.reduce((n, w) => n + w.sessions.length, 0);
    expect(events).toHaveLength(sessions + 1);
    expect(new Set(events.map((e) => e.uid)).size).toBe(events.length);
    for (const e of events) expect(e.component.getFirstPropertyValue('sequence')).toBeGreaterThan(0);

    const cal = new ICAL.Component(ICAL.parse(ics));
    expect(cal.getFirstPropertyValue('x-wr-calname')).toBe('Træningsplan');
    expect(cal.getFirstProperty('refresh-interval')!.getFirstValue()!.toString()).toBe('PT6H');
  });

  it('placerer lavede, sprungne og missede sessioner rigtigt', async () => {
    const events = parse(await feed());
    const rehabA = byUid(events, 'rehab-a-uge2@traeningsnav');
    expect(rehabA.summary).toBe('✓ Rehab A');
    expect(rehabA.description).toContain('Uge 2 af 14 — Rehab');
    expect(rehabA.description).toContain('Enbens RDL — 3 × 8/side, RPE 6, 75 s');
    expect(rehabA.description).toContain('Enbens RDL: 24 kg × 8');
    expect(rehabA.description).toContain('Lyske: 2/10 under, 0/10 næste morgen');
    expect(rehabA.description).toContain(`${ORIGIN}/session/rehab-a?uge=2`);

    // Torsdagens session logget fredag: står fredag med ✓, og torsdag er tom.
    const rehabB = byUid(events, 'rehab-b-uge2@traeningsnav');
    expect(rehabB.summary).toBe('✓ Rehab B');
    expect(rehabB.startDate.toString()).toBe('2026-10-09');
    expect(rehabB.startDate.isDate).toBe(true);
    expect(events.filter((e) => e.startDate.toString().startsWith('2026-10-08'))).toEqual([]);

    expect(byUid(events, 'rh-uge2@traeningsnav').summary).toBe('– Løb — 5 km roligt');
    expect(byUid(events, 'rh-uge2@traeningsnav').description).toContain('Sprunget over: Lyske/smerte');
    // Ugen er passeret uden crosstrainer.
    expect(byUid(events, 'ct-uge2@traeningsnav').summary).toBe('– Crosstrainer — 45 min');
    // Uge 3 er i gang: ikke lavet endnu, intet mærke.
    expect(byUid(events, 'rehab-b-uge3@traeningsnav').summary).toBe('Rehab B');
    // Løbet som heldagsevent.
    const race = byUid(events, 'maal-loebet@traeningsnav');
    expect(race.summary).toBe('Mål: 5 km – sub 20');
    expect(race.startDate.toString()).toBe('2026-12-31');
    expect(race.startDate.isDate).toBe(true);
  });

  it('bruger tidspunkt og sommertid i Europe/Copenhagen', async () => {
    const events = parse(await feed());
    // Uge 3: løbet flyttet til tirsdag 13/10 kl. 07:00 sommertid = 05:00 UTC.
    const before = byUid(events, 'rh-uge3@traeningsnav');
    expect(before.startDate.zone!.tzid).toBe('Europe/Copenhagen');
    expect(before.startDate.toJSDate().toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(before.endDate.toJSDate().toISOString()).toBe('2026-10-13T06:00:00.000Z');
    // Uge 5: onsdag 28/10 kl. 07:00 vintertid = 06:00 UTC.
    expect(byUid(events, 't1-uge5@traeningsnav').startDate.toJSDate().toISOString()).toBe('2026-10-28T06:00:00.000Z');
  });

  it('en flyttet session beholder sit UID og får højere SEQUENCE', async () => {
    const seq = (ics: string) => byUid(parse(ics), 'styrke-b-uge5@traeningsnav');
    const before = seq(await feed());
    expect(before.startDate.toString()).toBe('2026-10-29');

    await pushChanges(db, { schedule_overrides: [override(2, 5, 'styrke-b', 5, T('10-14T08:00:00'))] });
    const moved = seq(await feed());
    expect(moved.uid).toBe(before.uid);
    expect(moved.startDate.toString()).toBe('2026-10-30');
    expect(moved.sequence).toBeGreaterThan(before.sequence);
    expect(moved.description).toContain('Flyttet fra torsdag til fredag');

    // Fortrydes flytningen (tombstone), kommer den tilbage med endnu højere SEQUENCE.
    await pushChanges(db, { schedule_overrides: [override(2, 5, 'styrke-b', 5, T('10-14T09:00:00'), T('10-14T09:00:00'))] });
    const back = seq(await feed());
    expect(back.startDate.toString()).toBe('2026-10-29');
    expect(back.sequence).toBeGreaterThan(moved.sequence);
  });

  it('en logning flytter eventet til den faktiske dag og hæver SEQUENCE', async () => {
    const before = byUid(parse(await feed()), 'rehab-b-uge3@traeningsnav');
    expect(before.startDate.toString()).toBe('2026-10-15');
    await pushChanges(db, {
      workouts: [workout(5, { planned_session_id: 'rehab-b', week_no: 3, date: '2026-10-16', finished_at: T('10-16T17:00:00'), updated_at: T('10-16T17:00:00') })],
    });
    const after = byUid(parse(await feed(new Date('2026-10-17T08:00:00Z'))), 'rehab-b-uge3@traeningsnav');
    expect(after.summary).toBe('✓ Rehab B');
    expect(after.startDate.toString()).toBe('2026-10-16');
    expect(after.sequence).toBeGreaterThan(before.sequence);
  });

  it('en passeret uge giver "– " og højere SEQUENCE uden ny data', async () => {
    const during = byUid(parse(await feed()), 'ct-uge3@traeningsnav');
    expect(during.summary).toBe('Crosstrainer — 50 min');
    const after = byUid(parse(await feed(new Date('2026-10-19T08:00:00Z'))), 'ct-uge3@traeningsnav');
    expect(after.summary).toBe('– Crosstrainer — 50 min');
    expect(after.sequence).toBeGreaterThan(during.sequence);
    // Ugen er passeret ved midnat dansk tid (søndag 22:00 UTC).
    expect(after.component.getFirstPropertyValue('last-modified')!.toString()).toBe('2026-10-18T22:00:00Z');
  });

  it('en ny planversion ændrer eventene uden dubletter', async () => {
    const ics1 = await feed();
    const v1 = parse(ics1);
    const { plan } = await getActivePlan(db);
    // Version 2: Styrke A i uge 6 rykkes til tirsdag, og RDL får 4 sæt i uge 6–7.
    const plan2 = structuredClone(plan);
    plan2.weeks.find((w) => w.weekNo === 6)!.sessions.find((s) => s.sessionId === 'styrke-a')!.day = 2;
    const styrkeA = plan2.sessions.find((s) => s.id === 'styrke-a');
    if (styrkeA?.kind !== 'styrke') throw new Error('styrke-a er ikke styrke');
    const rdl = styrkeA.slots[0].variants.find((v) => v.weeks.some((r) => r.from <= 6 && r.to >= 6))!.exercises[0];
    expect(rdl.exerciseId).toBe('rdl');
    rdl.dose.sets = 4;
    await db
      .prepare(`INSERT INTO plan_versions (version, created_at, source, note, plan_json, is_active, based_on_version) VALUES (2, ?, 'manual', 'test', ?, 0, 1)`)
      .bind(T('10-14T08:00:00'), JSON.stringify(plan2))
      .run();
    await activatePlanVersion(db, 2, T('10-14T09:00:00'));

    const ics2 = await feed();
    const v2 = parse(ics2);
    expect(v2.map((e) => e.uid).sort()).toEqual(v1.map((e) => e.uid).sort());
    expect(new Set(v2.map((e) => e.uid)).size).toBe(v2.length);
    const a6 = byUid(v2, 'styrke-a-uge6@traeningsnav');
    expect(a6.startDate.toString()).toBe('2026-11-03');
    expect(a6.description).toMatch(/\nRumænsk dødløft \(RDL\) — 4 × /);
    for (const e of v2) expect(e.sequence).toBeGreaterThan(byUid(v1, e.uid).sequence);
    expect(ics2).toContain('planversion 2');

    // Tilbagerulning til version 1 tæller også som en ændring.
    await activatePlanVersion(db, 1, T('10-14T09:30:00'));
    const v3 = parse(await feed());
    expect(byUid(v3, 'styrke-a-uge6@traeningsnav').startDate.toString()).toBe('2026-11-02');
    for (const e of v3) expect(e.sequence).toBeGreaterThan(byUid(v2, e.uid).sequence);
  });

  it('viser planens øvrige mål som heldagsevents', async () => {
    const { plan } = await getActivePlan(db);
    const events = buildEvents({
      plan: { ...plan, goals: [{ date: '2026-11-21', title: '5 km test under 20:30', note: 'Kalibrerer farterne' }] },
      planVersion: 1,
      planChangedAt: T('09-27T12:00:00'),
      workouts: [],
      sets: [],
      groinChecks: [],
      overrides: [],
      settings: [],
      origin: ORIGIN,
      now: NOW.getTime(),
    });
    expect(events.find((e) => e.uid === 'maal-2026-11-21-5-km-test-under-20-30@traeningsnav')).toMatchObject({
      summary: 'Mål: 5 km test under 20:30',
      date: '2026-11-21',
      startTime: null,
    });
  });
});

// ─── Endpoint og indstillinger ──────────────────────────────────────────────

describe('GET /cal/:token.ics', () => {
  beforeEach(async () => {
    db = await createSeededD1();
  });

  const env = (extra: Record<string, unknown> = {}) => ({ DB: db, ASSETS: { fetch: async () => new Response('app') } as unknown as Fetcher, ...extra });
  const ctx = {} as ExecutionContext;
  const get = (path: string, e = env({ CAL_TOKEN: 'kal-token' })) => worker.fetch(new Request(`${ORIGIN}${path}`), e, ctx);

  it('serverer feedet med korrekt token', async () => {
    const res = await get('/cal/kal-token.ics');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('max-age=900');
    const body = await res.text();
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body.replace(/\r\n /g, '')).toContain(`URL;VALUE=URI:${ORIGIN}/session/rehab-a?uge=1`);
  });

  it('giver 404 (ikke 401) ved forkert eller manglende token', async () => {
    expect((await get('/cal/forkert.ics')).status).toBe(404);
    expect((await get('/cal/kal-token')).status).toBe(404);
    expect((await get('/cal/kal-token.ics', env())).status).toBe(404);
    // API-tokenet virker ikke som kalendertoken.
    expect((await get('/cal/api-token.ics', env({ API_TOKEN: 'api-token' }))).status).toBe(404);
  });

  it('API: viser abonnements-URL og gemmer indstillinger', async () => {
    const e = env({ API_TOKEN: 'api', CAL_TOKEN: 'kal-token' });
    const call = (path: string, init: RequestInit = {}) =>
      app.request(path, { ...init, headers: { Authorization: 'Bearer api', 'Content-Type': 'application/json' } }, e);

    const info = (await (await call(`${ORIGIN}/api/calendar`)).json()) as { feedUrl: string; settings: { session_type: string; all_day: boolean }[] };
    expect(info.feedUrl).toBe(`${ORIGIN}/cal/kal-token.ics`);
    expect(info.settings.map((s) => [s.session_type, s.all_day])).toEqual([
      ['styrke', true],
      ['løb', true],
      ['cardio', true],
    ]);

    const put = (type: string, body: unknown) => call(`${ORIGIN}/api/calendar/settings/${encodeURIComponent(type)}`, { method: 'PUT', body: JSON.stringify(body) });
    expect((await put('styrke', { all_day: false, start_time: '17:30', duration_min: 75 })).status).toBe(200);
    expect((await put('styrke', { all_day: false })).status).toBe(400);
    expect((await put('styrke', { all_day: false, start_time: '25:00', duration_min: 60 })).status).toBe(400);
    expect((await put('padel', { all_day: true })).status).toBe(400);

    const events = parse(await buildCalendarFeed(db, { origin: ORIGIN, now: NOW }));
    const a = byUid(events, 'rehab-a-uge3@traeningsnav');
    expect(a.startDate.toString()).toBe('2026-10-12T17:30:00');
    expect(a.duration.toString()).toBe('PT75M');
    expect((await app.request(`${ORIGIN}/api/calendar`, {}, e)).status).toBe(401);
  });
});
