// Noter fra Claude. Synkes som de andre tabeller; "Luk" sætter dismissed_at.
import { useLiveQuery } from 'dexie-react-hooks';
import type { CoachNote } from '../../shared/records.schema';
import { sincePlanStart } from '../../shared/schedule';
import { db } from './db';
import { usePlan } from './plan';
import { patchRecord } from './records';

const open = (n: CoachNote) => !n.deleted_at && !n.dismissed_at;
const byCreated = (a: CoachNote, b: CoachNote) => a.created_at.localeCompare(b.created_at);

/**
 * Åbne noter til ugen (uge- og sessionsnoter), og med `general` også noter uden uge. En note til samme
 * ugenummer i en tidligere plan (skrevet før planen begyndte) er ikke med.
 */
export function useCoachNotes(weekNo: number | undefined, opts: { general?: boolean } = {}): CoachNote[] {
  const startedAt = usePlan().active?.startedAt;
  return useLiveQuery(
    async () => {
      const all = await db.coach_notes.toArray();
      return all
        .filter((n) => open(n) && ((weekNo !== undefined && n.week_no === weekNo && sincePlanStart(n.created_at, startedAt)) || (opts.general && n.week_no === null)))
        .sort(byCreated);
    },
    [weekNo, opts.general, startedAt],
    [],
  );
}

export const dismissNote = (uuid: string) => patchRecord('coach_notes', uuid, { dismissed_at: new Date().toISOString() });
