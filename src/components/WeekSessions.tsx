import { useState } from 'react';
import { Link } from 'wouter';
import type { Plan, Session, Week } from '../../shared/plan.schema';
import { dateOfDay, getSession } from '../../shared/resolve';
import { effectiveSessions, type EffectiveSession } from '../../shared/schedule';
import { useGroinAssessments } from '../data/health';
import { useWeekOverrides } from '../data/schedule';
import { statusOf, useWeekWorkouts } from '../data/workouts';
import { formatShort, todayIso, weekday, WEEKDAYS_SHORT } from '../lib/dates';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { formatDuration } from '../logic/pace';
import { dayState } from '../logic/progress';
import { MoveSheet } from './MoveSheet';
import { SessionAction } from './SessionAction';
import { SessionMark } from './SessionMark';
import { TrafficLight } from './TrafficLight';

/**
 * Ugens sessioner med status, på deres faktiske dag (efter evt. flytning).
 * I dag markeres; en passeret dag uden træning vises dæmpet som "misset".
 * Aktiviteter uden for planen (padel o.l.) står nederst.
 */
export function WeekSessions({ plan, week, today = todayIso() }: { plan: Plan; week: Week; today?: string }) {
  const workouts = useWeekWorkouts(week.weekNo);
  const overrides = useWeekOverrides(week.weekNo);
  const groin = useGroinAssessments();
  const [moving, setMoving] = useState<{ scheduled: EffectiveSession; session: Session } | null>(null);
  const sessions = effectiveSessions(week, overrides ?? []);
  const extras = (workouts ?? []).filter((w) => !w.planned_session_id).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <ul className="divide-y divide-line border-y border-line">
        {sessions.map((s) => {
          const session = getSession(plan, s.sessionId)!;
          const date = dateOfDay(week, s.day);
          const state = dayState(date, today);
          const status = workouts ? statusOf(workouts, s.sessionId, today).status : undefined;
          const missed = state === 'past' && !s.optional && status === 'ikke-lavet';
          const detail = sessionDetail(s, session);
          return (
            <li
              key={s.sessionId}
              aria-current={state === 'today' ? 'date' : undefined}
              className={`flex min-h-16 items-center gap-2.5 py-2.5 ${state === 'today' ? '-mx-3 rounded-lg bg-surface px-3' : ''}`}
            >
              <SessionMark colorKey={session.colorKey} muted={missed} className="self-stretch" />
              <div className="w-11 shrink-0">
                <div className={`text-sm ${state === 'today' ? 'font-semibold' : 'text-muted'}`}>{state === 'today' ? 'I dag' : WEEKDAYS_SHORT[s.day]}</div>
                <div className="num text-xs text-muted">{formatShort(date)}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className={`font-medium ${missed ? 'text-muted' : ''}`}>{sessionTitle(session)}</div>
                <div className="text-sm text-muted">
                  {missed && (
                    <span className="mr-1.5 inline-flex items-center gap-1">
                      <span aria-hidden="true" className="inline-block size-2 rounded-full border border-dashed border-muted" />
                      Misset
                    </span>
                  )}
                  {s.moved && <span className="mr-1.5">Flyttet fra {WEEKDAYS_SHORT[s.plannedDay]}</span>}
                  {(missed || s.moved) && detail && <span aria-hidden="true">· </span>}
                  {detail}
                </div>
              </div>
              {status === 'ikke-lavet' && (
                <button
                  type="button"
                  onClick={() => setMoving({ scheduled: s, session })}
                  aria-label={`Flyt ${sessionTitle(session)}`}
                  className="flex min-h-12 min-w-11 items-center justify-center rounded-lg text-muted"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3.5" y="5" width="17" height="15" rx="2" />
                    <path d="M3.5 10h17M8 3v4M16 3v4M10 15h5m-2-2 2 2-2 2" />
                  </svg>
                </button>
              )}
              <SessionAction session={session} week={week} workouts={workouts} groin={groin} primary={state === 'today'} />
            </li>
          );
        })}
      </ul>

      {extras.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-sm font-semibold text-muted">Andre aktiviteter</h3>
          <ul className="divide-y divide-line border-y border-line">
            {extras.map((w) => {
              const light = groin.get(w.uuid)?.light;
              return (
                <li key={w.uuid}>
                  <Link href={`/session/${w.uuid}`} className="flex min-h-14 items-center gap-2.5 py-2">
                    <span aria-hidden="true" className="inline-block w-1.5 self-stretch rounded-full border border-line" />
                    <span className="w-11 shrink-0">
                      <span className="block text-sm text-muted">{WEEKDAYS_SHORT[weekday(w.date)]}</span>
                      <span className="num block text-xs text-muted">{formatShort(w.date)}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{w.activity ?? 'Anden aktivitet'}</span>
                      <span className="num block text-sm text-muted">
                        {w.duration_sec ? formatDuration(w.duration_sec) : w.finished_at ? 'Lavet' : 'I gang'}
                      </span>
                    </span>
                    {light && <TrafficLight light={light} />}
                    <span aria-hidden="true" className="text-xl text-muted">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {moving && <MoveSheet open onClose={() => setMoving(null)} week={week} scheduled={moving.scheduled} session={moving.session} />}
    </>
  );
}
