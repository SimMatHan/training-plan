// Falske API-svar til screenshots: Simon med planversion 1 og fem ugers historik, set fra
// mandag i uge 6. Ingen server, ingen passkey: Playwright svarer på /api i stedet.
import planJson from '../../plan/plan.v1.json' with { type: 'json' };
import type { Me, Profile, Sharing, PasskeyInfo } from '../../shared/athletes';
import type { CalendarInfo } from '../../shared/calendar';
import { PlanSchema, type Exercise } from '../../shared/plan.schema';
import type { McpAuditEntry } from '../../shared/proposals';
import type { ExerciseNote, MobilityMeasurement, PainScore, PlanVersionMeta, SetLog, Workout } from '../../shared/records.schema';
import { dateOfDay, resolveStrengthSession } from '../../shared/resolve';
import { weightStep } from '../../src/logic/wheel';

export const NOW = '2026-11-02T08:30:00+01:00';
export const plan = PlanSchema.parse(planJson);

const ts = (date: string, hour = 17) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const nextDay = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);

export const me: Me = { user: { id: 1, name: 'Simon', isAdmin: true, onboarded: true }, athletes: [{ slug: 'simon', name: 'Simon', role: 'ejer' }] };

export const meta: PlanVersionMeta = { id: 1, version: 1, created_at: '2026-10-07T12:00:00.000Z', source: 'seed', note: null, based_on_version: null, is_active: true };

export const profile: Profile = {
  athlete: { slug: 'simon', name: 'Simon', thresholdHr: 172 },
  role: 'ejer',
  monitors: [{ id: 1, label: 'Venstre lyske', active: true, sort: 1 }],
  mobilityTests: [{ id: 1, name: 'Knee-to-wall', unit: 'cm', per_side: true, active: true, instructions: 'Stå med tæerne mod væggen og før knæet frem.' }],
};

// Startvægte pr. øvelse; ellers efter vægttrin. Stigning pr. uge.
const START: Record<string, [number, number]> = {
  rdl: [40, 2.5],
  'enbens-rdl': [13, 1],
  'bulgarian-split-squat': [8, 1],
  'hip-thrust': [50, 5],
  'lat-pulldown': [35, 2.5],
  'siddende-tahaev': [20, 2.5],
  'enbens-tahaev': [10, 1],
  'pallof-press': [10, 0],
};

function weight(ex: Exercise, week: number) {
  const [start, inc] = START[ex.id] ?? (weightStep(ex) === 2.5 ? [25, 2.5] : [8, 0.5]);
  return start + (week - 1) * inc;
}

export const workouts: Workout[] = [];
export const sets: SetLog[] = [];
export const notes: ExerciseNote[] = [];
export const pain: PainScore[] = [];

const workout = (w: Partial<Workout> & Pick<Workout, 'date' | 'type'>): Workout => ({
  uuid: uuid(),
  updated_at: ts(w.date, 18),
  deleted_at: null,
  planned_session_id: null,
  plan_version: 1,
  week_no: null,
  started_at: ts(w.date, 16),
  finished_at: ts(w.date, 17),
  rpe: 7,
  note: null,
  source: 'app',
  external_id: null,
  distance_km: null,
  duration_sec: null,
  avg_hr: null,
  activity: null,
  skipped_at: null,
  skip_reason: null,
  ...w,
});

// Uge 1–5: alt lavet, undtagen den valgfri løbetur i uge 5 og sidste session i uge 2. Lysken er grøn, én gul.
for (const week of plan.weeks.filter((w) => w.weekNo <= 5)) {
  for (const s of week.sessions) {
    if (week.weekNo === 5 && s.optional) continue;
    const session = plan.sessions.find((x) => x.id === s.sessionId)!;
    const date = dateOfDay(week, s.day);
    const kind = session.kind;
    // Uge 2: sidste session sprunget over (som i virkeligheden), så ugekortet viser det.
    if (week.weekNo === 2 && s === week.sessions.at(-1)) {
      workouts.push(workout({ date, type: kind, planned_session_id: session.id, week_no: 2, started_at: null, finished_at: null, rpe: null, skipped_at: ts(date, 7), skip_reason: 'Kalender/tid' }));
      continue;
    }
    const w = workout({
      date,
      type: kind,
      planned_session_id: session.id,
      week_no: week.weekNo,
      ...(kind !== 'styrke' && kind !== 'mobilitet' && { distance_km: s.targetKm?.max ?? 6, duration_sec: Math.round((s.targetKm?.max ?? 6) * 330), avg_hr: 148 }),
    });
    workouts.push(w);
    if (kind === 'styrke') {
      for (const slot of resolveStrengthSession(plan, session.id, week.weekNo).slots)
        for (const ex of slot.exercises) {
          for (const row of ex.rows.filter((r) => !r.optional))
            sets.push({
              uuid: uuid(),
              updated_at: w.updated_at,
              deleted_at: null,
              workout_uuid: w.uuid,
              exercise_id: ex.exercise.id,
              set_no: row.setNo,
              side: row.side,
              weight_kg: ex.exercise.kind === 'weight_reps' ? weight(ex.exercise, week.weekNo) : null,
              reps: ex.exercise.kind === 'time' ? null : (row.reps?.max ?? 8),
              seconds: ex.exercise.kind === 'time' ? (row.seconds?.max ?? 30) : null,
              rpe: null,
              done: true,
            });
          notes.push({ uuid: uuid(), updated_at: w.updated_at, deleted_at: null, workout_uuid: w.uuid, exercise_id: ex.exercise.id, note: null, rpe: 7 });
        }
    }
    if (kind !== 'mobilitet') {
      const yellow = week.weekNo === 3 && s.day === 4;
      pain.push({ uuid: uuid(), updated_at: w.updated_at, deleted_at: null, monitor_id: 1, workout_uuid: w.uuid, date, kind: 'under', score: yellow ? 4 : 2 });
      pain.push({ uuid: uuid(), updated_at: w.updated_at, deleted_at: null, monitor_id: 1, workout_uuid: w.uuid, date: nextDay(date), kind: 'morgen', score: yellow ? 1 : 0 });
    }
  }
}

export const measurements: MobilityMeasurement[] = [
  ['2026-09-27', 5, 7],
  ['2026-10-11', 5.5, 7],
  ['2026-10-25', 6, 6.5],
].map(([date, r, l]) => ({ uuid: uuid(), updated_at: ts(String(date)), deleted_at: null, test_id: 1, date: String(date), value_right: Number(r), value_left: Number(l), value: null, note: null }));

export const sharing: Sharing = { access: [{ userId: 1, name: 'Simon', role: 'ejer', grantedAt: '2026-10-07T12:00:00.000Z' }, { userId: 2, name: 'Karo', role: 'traener', grantedAt: '2026-10-08T12:00:00.000Z' }], candidates: [] };
export const passkeys: PasskeyInfo[] = [{ id: 1, label: 'iPhone', createdAt: '2026-10-07T12:00:00.000Z', lastUsedAt: '2026-11-01T07:00:00.000Z' }];
export const calendar: CalendarInfo = {
  hasFeed: true,
  settings: (['styrke', 'løb', 'cardio'] as const).map((t) => ({ session_type: t, all_day: t !== 'styrke', start_time: t === 'styrke' ? '07:00' : null, duration_min: t === 'styrke' ? 60 : null, updated_at: null })),
};
export const audit: McpAuditEntry[] = [
  { at: '2026-11-01T19:02:00.000Z', tool: 'get_week', ok: true, error: null, durationMs: 40 },
  { at: '2026-11-01T19:03:00.000Z', tool: 'add_note', ok: true, error: null, durationMs: 51 },
];
