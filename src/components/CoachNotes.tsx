import type { Plan } from '../../shared/plan.schema';
import type { CoachNote } from '../../shared/records.schema';
import { getSession } from '../../shared/resolve';
import { dismissNote } from '../data/notes';
import { formatShort } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';

/** Noter fra Claude med "Luk". Sessionsnoter viser hvilken session de hører til. */
export function CoachNotes({ notes, plan, showSession = true }: { notes: CoachNote[]; plan: Plan; showSession?: boolean }) {
  if (!notes.length) return null;
  return (
    <section aria-label="Noter fra Claude" className="mb-7 flex flex-col gap-2">
      {notes.map((n) => {
        const session = n.session_id ? getSession(plan, n.session_id) : undefined;
        return (
          <article key={n.uuid} className="flex items-start gap-3 rounded-lg bg-surface p-4">
            <span aria-hidden="true" className="mt-1 inline-block h-8 w-1.5 shrink-0 rounded-full bg-b" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">
                Fra Claude · {formatShort(n.created_at.slice(0, 10))}
                {showSession && session && ` · ${sessionTitle(session)}`}
                {showSession && !session && n.week_no && ` · uge ${n.week_no}`}
              </p>
              <p className="whitespace-pre-line">{n.text}</p>
            </div>
            <button type="button" onClick={() => void dismissNote(n.uuid)} aria-label="Luk noten" className="-mt-2 -mr-2 min-h-12 rounded-lg px-3 text-sm font-medium text-muted">
              Luk
            </button>
          </article>
        );
      })}
    </section>
  );
}
