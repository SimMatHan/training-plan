// Smerte-trafiklys pr. monitor (fx "Venstre lyske"). Ren logik, brugt af appen, services,
// MCP og kalenderfeedet. Fase 5 generaliserer fase 1's lyske-trafiklys.
//
// Regler pr. monitor:
//   grøn     højst 3/10 under træning OG 0/10 ("væk") næste morgen
//   gul      over 3/10 under træning, eller ikke væk næste morgen
//   rød      gul to sessioner i træk
//   afventer under-scoren er ≤ 3, men morgenscoren mangler endnu
//   ukendt   morgenscoren blev aldrig givet
import type { PainScore, Workout } from './records.schema';

export type PainLight = 'grøn' | 'gul' | 'rød' | 'afventer' | 'ukendt';

export interface PainAssessment {
  monitorId: number;
  workoutUuid: string;
  date: string;
  weekNo: number | null;
  plannedSessionId: string | null;
  during: number;
  morning: number | null;
  light: PainLight;
}

export const GREEN_MAX_DURING = 3;

export function nextDay(date: string): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
}

const live = (s: PainScore) => !s.deleted_at;

/** Under-scoren for en træning og monitor. */
export const duringScore = (scores: PainScore[], workoutUuid: string, monitorId: number) =>
  scores.find((s) => live(s) && s.kind === 'under' && s.monitor_id === monitorId && s.workout_uuid === workoutUuid);

/** Morgenscoren efter en træning: knyttet til træningen, ellers morgenens score uden træning. */
export function morningScore(scores: PainScore[], w: Pick<Workout, 'uuid' | 'date'>, monitorId: number): PainScore | undefined {
  const morning = scores.filter((s) => live(s) && s.kind === 'morgen' && s.monitor_id === monitorId);
  return morning.find((s) => s.workout_uuid === w.uuid) ?? morning.find((s) => s.date === nextDay(w.date) && !s.workout_uuid);
}

/** Træninger der vurderes: styrke, løb og cardio. */
export const isAssessableWorkout = (w: Workout) => !w.deleted_at && w.type !== 'mobilitet';

const byTime = (a: Workout, b: Workout) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? '');

/** Vurderer én monitor over alle træninger i kronologisk rækkefølge. `today` afgør om en manglende morgenscore stadig kan komme. */
export function assessPain(workouts: Workout[], scores: PainScore[], monitorId: number, today: string): PainAssessment[] {
  const out: PainAssessment[] = [];
  for (const w of workouts.filter(isAssessableWorkout).sort(byTime)) {
    const during = duringScore(scores, w.uuid, monitorId)?.score;
    if (during == null) continue;
    const morningDate = nextDay(w.date);
    const morning = morningScore(scores, w, monitorId)?.score ?? null;

    let light: PainLight;
    if (during > GREEN_MAX_DURING || (morning !== null && morning > 0)) light = 'gul';
    else if (morning === 0) light = 'grøn';
    else light = today <= morningDate ? 'afventer' : 'ukendt';

    const prev = out.at(-1);
    if (light === 'gul' && prev && (prev.light === 'gul' || prev.light === 'rød')) light = 'rød';

    out.push({ monitorId, workoutUuid: w.uuid, date: w.date, weekNo: w.week_no, plannedSessionId: w.planned_session_id, during, morning, light });
  }
  return out;
}

/** Alle monitors' vurderinger samlet. */
export const assessAllPain = (workouts: Workout[], scores: PainScore[], monitorIds: number[], today: string) =>
  monitorIds.flatMap((id) => assessPain(workouts, scores, id, today));

const SEVERITY: Record<PainLight, number> = { grøn: 0, afventer: 1, ukendt: 2, gul: 3, rød: 4 };

export const worstLight = (lights: PainLight[]): PainLight | undefined =>
  lights.length ? lights.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a)) : undefined;

/** Det værste lys pr. træning på tværs af monitors (til prikker og status). */
export function worstByWorkout(assessments: PainAssessment[]): Map<string, PainAssessment> {
  const out = new Map<string, PainAssessment>();
  for (const a of assessments) {
    const prev = out.get(a.workoutUuid);
    if (!prev || SEVERITY[a.light] > SEVERITY[prev.light]) out.set(a.workoutUuid, a);
  }
  return out;
}

/**
 * Morgenspørgsmålene i dag: for hver monitor gårsdagens seneste vurderbare træning med en
 * under-score, hvis morgenens score for monitoren ikke er givet endnu.
 */
export function pendingMorningChecks(workouts: Workout[], scores: PainScore[], monitorIds: number[], today: string): { monitorId: number; workout: Workout }[] {
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const out: { monitorId: number; workout: Workout }[] = [];
  for (const monitorId of monitorIds) {
    if (scores.some((s) => live(s) && s.kind === 'morgen' && s.monitor_id === monitorId && s.date === today)) continue;
    const workout = workouts
      .filter((w) => isAssessableWorkout(w) && w.date === yesterday && duringScore(scores, w.uuid, monitorId))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
    if (workout) out.push({ monitorId, workout });
  }
  return out;
}

/** Porten efter rehab: "Port til uge 5: grønt i uge 3 og 4." → { toWeek: 5, weeks: [3, 4] }. */
export function parseGate(gate: string | undefined): { toWeek: number; weeks: number[] } | undefined {
  const m = gate?.match(/Port til uge (\d+)/);
  if (!m) return undefined;
  const toWeek = Number(m[1]);
  const weeks = gate!.match(/grønt i uge (\d+) og (\d+)/)?.slice(1).map(Number) ?? [toWeek - 2, toWeek - 1];
  return { toWeek, weeks };
}
