import { DotsThree } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Plan, Session, Week } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { dateOfDay, getSession } from '../../shared/resolve';
import { effectiveSessions, type EffectiveSession } from '../../shared/schedule';
import { useWorstLights } from '../data/health';
import { useWeekOverrides } from '../data/schedule';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { formatShort, todayIso, weekday, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { sessionCategory } from '../logic/category';
import { formatDuration } from '../logic/pace';
import { dayState } from '../logic/progress';
import { IconTile } from '../ui/IconTile';
import { InsetList, InsetRow, RowText } from '../ui/InsetList';
import { StatusLight } from '../ui/StatusLight';
import { SessionAction } from './SessionAction';
import { SessionOptionsSheet } from './SessionOptionsSheet';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Day({ date, today }: { date: string; today: boolean }) {
  return (
    <span className="w-12 shrink-0 whitespace-nowrap">
      <span className={`block text-secondary ${today ? 'font-semibold text-ink' : 'text-ink-2'}`}>{today ? 'I dag' : cap(WEEKDAYS_SHORT[weekday(date)])}</span>
      <span className="num block text-footnote text-ink-2">{formatShort(date)}</span>
    </span>
  );
}

/**
 * Ugens sessioner med status, på deres faktiske dag (efter evt. flytning). Trafiklyset pr.
 * session står som prik + tekst. Aktiviteter uden for planen (padel o.l.) står nederst.
 */
export function WeekSessions({ plan, week, today = todayIso() }: { plan: Plan; week: Week; today?: string }) {
  const workouts = useWeekWorkouts(week.weekNo);
  const overrides = useWeekOverrides(week.weekNo);
  const groin = useWorstLights();
  const [options, setOptions] = useState<{ scheduled: EffectiveSession; session: Session; skipped?: Workout } | null>(null);
  const sessions = effectiveSessions(week, overrides ?? []);
  const extras = (workouts ?? []).filter((w) => !w.planned_session_id).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <InsetList label="Ugens sessioner">
        {sessions.map((s) => {
          const session = getSession(plan, s.sessionId)!;
          const date = dateOfDay(week, s.day);
          const state = dayState(date, today);
          const { status, workout } = workouts ? statusOf(workouts, s.sessionId, today) : { status: undefined, workout: undefined };
          const missed = state === 'past' && !s.optional && status === 'ikke-lavet';
          const skipped = status === 'sprunget-over';
          const light = workout && groin.get(workout.uuid)?.light;
          const notes = [
            skipped && `Sprunget over${workout?.skip_reason ? ` · ${workout.skip_reason}` : ''}`,
            missed && 'Misset',
            s.moved && `Flyttet fra ${WEEKDAYS_SHORT[s.plannedDay]}`,
            status === 'i-gang' && 'I gang',
            !skipped && sessionDetail(s, session),
          ].filter(Boolean);
          return (
            <InsetRow key={s.sessionId} current={state === 'today'} chevron={false} className="gap-2.5">
              <Day date={date} today={state === 'today'} />
              <RowText
                muted={missed || skipped}
                title={sessionTitle(session)}
                detail={
                  <>
                    {notes.join(' · ')}
                    {light && (
                      <span className="mt-0.5 block">
                        <StatusLight light={light} label="Lysken" />
                      </span>
                    )}
                  </>
                }
              />
              {(status === 'ikke-lavet' || skipped) && (
                <button
                  type="button"
                  onClick={() => setOptions({ scheduled: s, session, skipped: skipped ? workout : undefined })}
                  aria-label={`Muligheder for ${sessionTitle(session)}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2"
                >
                  <DotsThree size={24} weight="bold" aria-hidden="true" />
                </button>
              )}
              <SessionAction session={session} week={week} workouts={workouts} />
            </InsetRow>
          );
        })}
      </InsetList>

      {extras.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 px-1 text-headline">Andre aktiviteter</h3>
          <InsetList>
            {extras.map((w) => {
              const light = groin.get(w.uuid)?.light;
              return (
                <InsetRow key={w.uuid} href={`/session/${w.uuid}`} className="gap-2.5">
                  <Day date={w.date} today={w.date === today} />
                  <IconTile category={sessionCategory({ kind: 'cardio', colorKey: 'run' })} />
                  <RowText title={w.activity ?? 'Anden aktivitet'} detail={w.duration_sec ? formatDuration(w.duration_sec) : w.finished_at ? 'Lavet' : 'I gang'} />
                  {light && <StatusLight light={light} />}
                </InsetRow>
              );
            })}
          </InsetList>
        </>
      )}

      {options && (
        <SessionOptionsSheet open onClose={() => setOptions(null)} week={week} scheduled={options.scheduled} session={options.session} skipped={options.skipped} />
      )}
    </>
  );
}
