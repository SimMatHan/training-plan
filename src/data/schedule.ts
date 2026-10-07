// Flytning af planlagte sessioner til en anden dag i samme uge.
import { useLiveQuery } from 'dexie-react-hooks';
import type { ScheduleOverride } from '../../shared/records.schema';
import { deterministicUuid } from '../logic/uuid';
import { db } from './db';
import { upsertRecord } from './records';

/** Ugens flytninger (aktive). undefined mens de indlæses. */
export function useWeekOverrides(weekNo: number | undefined): ScheduleOverride[] | undefined {
  return useLiveQuery(
    async () => (weekNo ? (await db.schedule_overrides.where('week_no').equals(weekNo).toArray()).filter((o) => !o.deleted_at) : []),
    [weekNo],
  );
}

/**
 * Flytter en session til `day` (1 = mandag). Flyttes den tilbage til planens dag,
 * bliver flytningen en tombstone. Én post pr. uge + session (deterministisk uuid).
 */
export async function moveSession(weekNo: number, sessionId: string, day: number, plannedDay: number) {
  const uuid = await deterministicUuid('flyt', weekNo, sessionId);
  const back = day === plannedDay;
  await upsertRecord(
    'schedule_overrides',
    uuid,
    { uuid, week_no: weekNo, session_id: sessionId, day },
    { day, deleted_at: back ? new Date().toISOString() : null },
  );
}
