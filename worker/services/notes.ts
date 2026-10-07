// Noter fra Claude (coach_notes). Synkes til appen som de andre logtabeller.
import { z } from 'zod';
import { Slug } from '../../shared/plan.schema';
import type { CoachNote } from '../../shared/records.schema';
import { ValidationError } from './errors';
import { readTable } from './history';
import { getActivePlan } from './plan';
import { pushChanges } from './sync';

export const NoteInput = z.object({
  text: z.string().trim().min(1).max(2000),
  weekNo: z.int().min(1).nullable().default(null),
  sessionId: Slug.nullable().default(null),
});
export type NoteInput = z.input<typeof NoteInput>;

/** Opretter en note til en uge, en session i en uge, eller (uden begge) en generel note. */
export async function createCoachNote(db: D1Database, raw: NoteInput, now = new Date().toISOString()): Promise<CoachNote> {
  const input = NoteInput.parse(raw);
  if (input.weekNo !== null || input.sessionId !== null) {
    const { plan } = await getActivePlan(db);
    if (input.weekNo === null) throw new ValidationError('En note til en session skal også have en uge');
    const week = plan.weeks.find((w) => w.weekNo === input.weekNo);
    if (!week) throw new ValidationError(`Uge ${input.weekNo} findes ikke i planen`);
    if (input.sessionId && !week.sessions.some((s) => s.sessionId === input.sessionId))
      throw new ValidationError(`Session "${input.sessionId}" står ikke i uge ${input.weekNo}`);
  }
  const note: CoachNote = {
    uuid: crypto.randomUUID(),
    created_at: now,
    week_no: input.weekNo,
    session_id: input.sessionId,
    text: input.text,
    dismissed_at: null,
    updated_at: now,
    deleted_at: null,
  };
  await pushChanges(db, { coach_notes: [note] }, now);
  return note;
}

/** Noter der ikke er slettet, ældste først. Lukkede noter kun med `includeDismissed`. */
export async function listCoachNotes(db: D1Database, opts: { weekNo?: number; includeDismissed?: boolean } = {}): Promise<CoachNote[]> {
  const where = ['deleted_at IS NULL'];
  if (!opts.includeDismissed) where.push('dismissed_at IS NULL');
  if (opts.weekNo !== undefined) where.push('week_no = ?');
  const notes = (await readTable(db, 'coach_notes', `WHERE ${where.join(' AND ')}`, ...(opts.weekNo !== undefined ? [opts.weekNo] : []))) as CoachNote[];
  return notes.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
