import { Sparkle } from '@phosphor-icons/react';
import type { Plan } from '../../shared/plan.schema';
import type { CoachNote } from '../../shared/records.schema';
import { getSession } from '../../shared/resolve';
import { dismissNote } from '../data/notes';
import { formatShort } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { TextButton } from '../ui/Button';

/** Noter fra Claude med "Luk". Sessionsnoter viser hvilken session de hører til. */
export function CoachNotes({ notes, plan, showSession = true }: { notes: CoachNote[]; plan: Plan; showSession?: boolean }) {
  if (!notes.length) return null;
  return (
    <section aria-label="Noter fra Claude" className="mb-8 flex flex-col gap-2">
      {notes.map((n) => {
        const session = n.session_id ? getSession(plan, n.session_id) : undefined;
        return (
          <article key={n.uuid} className="flex items-start gap-3 rounded-card bg-surface p-4">
            <Sparkle size={20} weight="fill" className="mt-0.5 shrink-0 text-cat-arms" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-footnote text-ink-2">
                Fra Claude · {formatShort(n.created_at.slice(0, 10))}
                {showSession && session && ` · ${sessionTitle(session)}`}
                {showSession && !session && n.week_no && ` · uge ${n.week_no}`}
              </p>
              <p className="whitespace-pre-line text-body">{n.text}</p>
            </div>
            <TextButton onClick={() => void dismissNote(n.uuid)} aria-label="Luk noten" className="-mt-2 -mr-2">
              Luk
            </TextButton>
          </article>
        );
      })}
    </section>
  );
}
