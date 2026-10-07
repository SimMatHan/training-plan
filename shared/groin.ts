// Lyske-trafiklys (venstre lyske). Ren logik, brugt af appen og af services
// (getGroinTrend nu, MCP i fase 3).
//
// Regler (fra planen og Simons beskrivelse):
//   grøn     højst 3/10 under træning OG 0/10 ("væk") næste morgen
//   gul      over 3/10 under træning, eller ikke væk næste morgen
//   rød      gul to sessioner i træk ("snurren to sessioner i træk")
//   afventer under-scoren er ≤ 3, men morgenscoren mangler endnu
//   ukendt   morgenscoren blev aldrig givet
import type { GroinCheck, Workout } from './records.schema';

export type GroinLight = 'grøn' | 'gul' | 'rød' | 'afventer' | 'ukendt';

export interface GroinAssessment {
  workoutUuid: string;
  date: string;
  weekNo: number | null;
  plannedSessionId: string | null;
  during: number;
  morning: number | null;
  light: GroinLight;
}

export const GREEN_MAX_DURING = 3;

export function nextDay(date: string): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
}

/** Træninger hvor lysken vurderes: styrke, løb og cardio med en under-score. */
export const isAssessable = (w: Workout) => !w.deleted_at && w.type !== 'mobilitet' && w.groin_during != null;

/** Vurderer alle træninger i kronologisk rækkefølge. `today` afgør om en manglende morgenscore stadig kan komme. */
export function assessGroin(workouts: Workout[], checks: GroinCheck[], today: string): GroinAssessment[] {
  const live = checks.filter((c) => !c.deleted_at);
  const sorted = workouts
    .filter(isAssessable)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.started_at ?? '').localeCompare(b.started_at ?? ''));

  const out: GroinAssessment[] = [];
  for (const w of sorted) {
    const morningDate = nextDay(w.date);
    const check = live.find((c) => c.workout_uuid === w.uuid) ?? live.find((c) => c.date === morningDate && !c.workout_uuid);
    const during = w.groin_during!;
    const morning = check?.morning_score ?? null;

    let light: GroinLight;
    if (during > GREEN_MAX_DURING || (morning !== null && morning > 0)) light = 'gul';
    else if (morning === 0) light = 'grøn';
    else light = today <= morningDate ? 'afventer' : 'ukendt';

    const prev = out.at(-1);
    if (light === 'gul' && prev && (prev.light === 'gul' || prev.light === 'rød')) light = 'rød';

    out.push({ workoutUuid: w.uuid, date: w.date, weekNo: w.week_no, plannedSessionId: w.planned_session_id, during, morning, light });
  }
  return out;
}

/** Træningen som morgenspørgsmålet i dag handler om: gårsdagens seneste vurderbare træning uden morgenscore. */
export function pendingMorningCheck(workouts: Workout[], checks: GroinCheck[], today: string): Workout | undefined {
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const live = checks.filter((c) => !c.deleted_at);
  if (live.some((c) => c.date === today)) return undefined;
  return workouts
    .filter((w) => isAssessable(w) && w.date === yesterday)
    .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
}

/** Porten efter rehab: "Port til uge 5: grønt i uge 3 og 4." → { toWeek: 5, weeks: [3, 4] }. */
export function parseGate(gate: string | undefined): { toWeek: number; weeks: number[] } | undefined {
  const m = gate?.match(/Port til uge (\d+)/);
  if (!m) return undefined;
  const toWeek = Number(m[1]);
  const weeks = gate!.match(/grønt i uge (\d+) og (\d+)/)?.slice(1).map(Number) ?? [toWeek - 2, toWeek - 1];
  return { toWeek, weeks };
}
