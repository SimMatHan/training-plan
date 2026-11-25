// Kalenderen i appen: hvad der står på hver dag. Samme regler som kalenderfeedet
// (worker/calendar/feed.ts):
//
//   planlagt, ikke lavet    planens (evt. flyttede) dag i ugen; "misset", når dagen er gået
//   lavet / i gang          den faktiske dato for træningen
//   sprunget over           datoen for træningen, der markerer det
//   andre aktiviteter       deres dato (padel o.l., mobilitet fra afspilleren, en tidligere plans træninger)
//
// Ren logik, så den kan testes uden IndexedDB.
import type { Plan, Session } from '../../shared/plan.schema';
import type { MobilityRoundCheck, ScheduleOverride, Workout } from '../../shared/records.schema';
import { dateOfDay, getSession } from '../../shared/resolve';
import { assignToOccurrences, effectiveSessions, inPlanWeek, occurrenceKey } from '../../shared/schedule';
import { sessionTitle } from '../lib/sessions';
import { sessionCategory, type Category } from './category';

export type DayState = 'planlagt' | 'lavet' | 'i-gang' | 'sprunget-over' | 'misset';

export interface DayEntry {
  /** Unik pr. dag: forekomsten eller træningens uuid. */
  key: string;
  date: string;
  title: string;
  category: Category;
  state: DayState;
  /** Planens session; null for en aktivitet uden for planen. */
  session: Session | null;
  workout?: Workout;
  /** Planens uge og dag for en planlagt forekomst (til Start/Fortsæt). */
  weekNo?: number;
  plannedDay?: number;
  /** Planens dag, hvis sessionen er flyttet til en anden dag. */
  movedFrom?: number;
  /** Dagen sessionen stod på (efter flytning). Kan afvige fra `date`, når den er lavet en anden dag. */
  plannedDate?: string;
  optional?: boolean;
}

const alive = <T extends { deleted_at: string | null }>(r: T) => !r.deleted_at;

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

const TYPE_TITLE: Record<Workout['type'], string> = { styrke: 'Styrke', løb: 'Løb', cardio: 'Cardio', mobilitet: 'Mobilitet' };
const TYPE_CATEGORY: Record<Workout['type'], Category> = { styrke: 'legs', løb: 'cardio', cardio: 'cardio', mobilitet: 'mobility' };

const stateOf = (w: Workout): DayState => (w.skipped_at ? 'sprunget-over' : w.finished_at ? 'lavet' : 'i-gang');

/**
 * Dagene fra `from` til `to` (begge med) og hvad der står på dem. `overrides` er planens flytninger
 * (allerede uden en tidligere plans). Dage uden noget er ikke med i resultatet.
 */
export function dayEntries(plan: Plan | undefined, workouts: Workout[], overrides: ScheduleOverride[], from: string, to: string, today: string): Map<string, DayEntry[]> {
  const out = new Map<string, DayEntry[]>();
  const add = (e: DayEntry) => {
    if (e.date < from || e.date > to) return;
    out.set(e.date, [...(out.get(e.date) ?? []), e]);
  };
  const live = workouts.filter(alive);
  const attached = new Set<string>();

  // Planens forekomster. En træning kan ligge efter sin uge (søndagens på mandag), så alle ugerne gennemgås.
  for (const week of plan?.weeks ?? []) {
    const weekEnd = dateOfDay(week, 7);
    if (weekEnd < addDays(from, -7) || week.startDate > addDays(to, 7)) continue;
    const inWeek = live.filter((w) => inPlanWeek(w, week));
    const byOccurrence = assignToOccurrences(
      week,
      inWeek.filter((w) => w.planned_session_id !== 'mobilitet'),
      (w) => w.planned_session_id,
      (w) => w.planned_day ?? null,
    );
    for (const s of effectiveSessions(week, overrides)) {
      const session = getSession(plan!, s.sessionId);
      if (!session) continue;
      const date = dateOfDay(week, s.day);
      // Mobilitetsblokken tages pr. dato, ikke pr. forekomst.
      const w =
        s.sessionId === 'mobilitet'
          ? inWeek.find((x) => x.planned_session_id === 'mobilitet' && x.date === date)
          : byOccurrence.get(occurrenceKey(s.sessionId, s.plannedDay))?.[0];
      if (w) attached.add(w.uuid);
      add({
        key: `${s.sessionId}|${week.weekNo}|${s.plannedDay}`,
        date: w ? w.date : date,
        title: sessionTitle(session),
        category: sessionCategory(session),
        state: w ? stateOf(w) : date < today && !s.optional ? 'misset' : 'planlagt',
        session,
        workout: w,
        weekNo: week.weekNo,
        plannedDay: s.plannedDay,
        plannedDate: date,
        ...(s.moved && { movedFrom: s.plannedDay }),
        ...(s.optional && { optional: true }),
      });
    }
  }

  // Alt andet logget: aktiviteter uden for planen, mobilitet fra afspilleren og en tidligere plans træninger.
  for (const w of live) {
    if (attached.has(w.uuid)) continue;
    const session = plan && w.planned_session_id ? (getSession(plan, w.planned_session_id) ?? null) : null;
    add({
      key: w.uuid,
      date: w.date,
      title: w.activity ?? (session ? sessionTitle(session) : TYPE_TITLE[w.type]),
      category: session ? sessionCategory(session) : TYPE_CATEGORY[w.type],
      state: stateOf(w),
      session,
      workout: w,
    });
  }

  const rank: Record<DayState, number> = { lavet: 0, 'i-gang': 1, planlagt: 2, misset: 3, 'sprunget-over': 4 };
  for (const list of out.values()) list.sort((a, b) => rank[a.state] - rank[b.state] || (a.workout?.started_at ?? '').localeCompare(b.workout?.started_at ?? ''));
  return out;
}

/** Afkrydsede punkter i mobilitetsrunderne pr. dato (kun planens punkter). */
export function roundsByDate(plan: Plan | undefined, checks: MobilityRoundCheck[]): Map<string, { round: MobilityRoundCheck['round']; done: number; total: number }[]> {
  const items = new Set(plan?.mobility?.items.map((i) => i.id) ?? []);
  const done = new Map<string, Set<string>>();
  for (const c of checks) {
    if (!alive(c) || !c.done || !items.has(c.item_id)) continue;
    const key = `${c.date}|${c.round}`;
    done.set(key, (done.get(key) ?? new Set()).add(c.item_id));
  }
  const out = new Map<string, { round: MobilityRoundCheck['round']; done: number; total: number }[]>();
  for (const [key, set] of [...done].sort(([a], [b]) => a.localeCompare(b))) {
    const [date, round] = key.split('|') as [string, MobilityRoundCheck['round']];
    out.set(date, [...(out.get(date) ?? []), { round, done: set.size, total: items.size }].sort((a, b) => (a.round === b.round ? 0 : a.round === 'morgen' ? -1 : 1)));
  }
  return out;
}

/** Mandag i ugen for en dato. */
export function mondayOf(iso: string): string {
  const day = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return addDays(iso, -day);
}

/** Månedens dage i hele uger (mandag–søndag), med dage fra måneden før og efter. `month` er 'YYYY-MM'. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const weeks: string[][] = [];
  for (let d = mondayOf(first); d <= last; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

/** 'YYYY-MM' n måneder fra `month`. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export { addDays };
