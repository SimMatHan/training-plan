import { useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { getSession, resolveStrengthSession } from '../../shared/resolve';
import { ExerciseBlock } from '../components/ExerciseBlock';
import { MobilityChecklist } from '../components/MobilityChecklist';
import { NoteField } from '../components/NoteField';
import { RestTimerBar } from '../components/RestTimerBar';
import { RpePicker } from '../components/RpePicker';
import { RunLog } from '../components/RunLog';
import { ScoreScale } from '../components/ScoreScale';
import { SessionMark } from '../components/SessionMark';
import { SyncBadge } from '../components/SyncBadge';
import { usePlan } from '../data/plan';
import { deleteRecord } from '../data/records';
import { skipTimer, useTimer } from '../data/timer';
import { finishWorkout, patchWorkout, useWorkout, useWorkoutLogs } from '../data/workouts';
import { formatLong } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { useWakeLock } from '../lib/wakeLock';

export function SessionPage() {
  const [, params] = useRoute('/session/:uuid');
  const uuid = params?.uuid;
  const [, navigate] = useLocation();
  const { active } = usePlan();
  const workout = useWorkout(uuid);
  const logs = useWorkoutLogs(uuid);
  const timer = useTimer();
  const [missingGroin, setMissingGroin] = useState(false);
  useWakeLock(true);

  if (workout === undefined || logs === undefined || !active) return <main className="p-4 text-muted">Henter …</main>;
  if (workout === null || workout.deleted_at)
    return (
      <main className="pt-safe p-4">
        <p className="mb-4">Træningen findes ikke.</p>
        <Link href="/" className="underline">
          Til I dag
        </Link>
      </main>
    );

  const { plan } = active;
  const session = workout.planned_session_id ? getSession(plan, workout.planned_session_id) : undefined;
  const strength = session?.kind === 'styrke' && workout.week_no ? resolveStrengthSession(plan, session.id, workout.week_no) : undefined;
  const showMobility = session?.kind === 'mobilitet' || (session?.kind === 'styrke' && session.mobility === 'before');
  const timerFor = timer.state?.workoutUuid === workout.uuid;
  const isRun = session?.kind === 'løb' || session?.kind === 'cardio';
  const scheduled = plan.weeks.find((w) => w.weekNo === workout.week_no)?.sessions.find((s) => s.sessionId === session?.id);
  // Lysken vurderes efter alle styrke-, løbe- og cardiosessioner.
  const asksGroin = workout.type !== 'mobilitet';

  async function finish() {
    if (asksGroin && workout!.groin_during == null) {
      setMissingGroin(true);
      document.getElementById('groin')?.scrollIntoView({ block: 'center' });
      return;
    }
    await finishWorkout(workout!.uuid);
    if (timerFor) skipTimer();
    navigate('/');
  }

  async function remove() {
    if (!confirm('Slette denne træning? Alt logget i den forsvinder fra historikken.')) return;
    await deleteRecord('workouts', workout!.uuid);
    if (timerFor) skipTimer();
    navigate('/');
  }

  return (
    <main className={`pt-safe mx-auto max-w-xl px-4 ${timerFor ? 'pb-36' : 'pb-12'}`}>
      <header className="pt-2 pb-3">
        <div className="mb-2 flex items-center justify-between">
          <Link href="/" className="-ml-2 inline-flex min-h-12 items-center px-2 text-base">
            ← I dag
          </Link>
          <SyncBadge />
        </div>
        <div className="flex gap-3">
          {session && <SessionMark colorKey={session.colorKey} />}
          <div>
            <h1 className="text-3xl">{session ? sessionTitle(session) : 'Træning'}</h1>
            <p className="text-sm text-muted">
              {workout.week_no && `Uge ${workout.week_no} · `}
              {formatLong(workout.date)}
              {workout.finished_at && ' · afsluttet'}
            </p>
          </div>
        </div>
      </header>

      <div className="divide-y divide-line">
        {showMobility && <MobilityChecklist plan={plan} workoutUuid={workout.uuid} checks={logs.mobility} />}

        {strength?.slots.map((slot) =>
          slot.superset ? (
            <section key={slot.slotId} aria-label="Superset" className="py-1">
              <p className="pt-4 text-sm font-semibold text-muted">Superset — tag dem lige efter hinanden, pause efter anden øvelse</p>
              <div className="ml-1 divide-y divide-line border-l-2 border-line pl-3">
                {slot.exercises.map((ex, i) => (
                  <ExerciseBlock key={ex.exercise.id} plan={plan} workoutUuid={workout.uuid} resolved={ex} sets={logs.sets} notes={logs.notes} supersetFirst={i === 0} />
                ))}
              </div>
            </section>
          ) : (
            <ExerciseBlock
              key={slot.slotId}
              plan={plan}
              workoutUuid={workout.uuid}
              resolved={slot.exercises[0]}
              sets={logs.sets}
              notes={logs.notes}
              supersetFirst={false}
            />
          ),
        )}

        {isRun && session && (session.kind === 'løb' || session.kind === 'cardio') && <RunLog workout={workout} session={session} scheduled={scheduled} />}

        <section className="flex flex-col gap-4 py-6">
          <h2 className="text-2xl">Sessionen</h2>
          {asksGroin && (
            <div id="groin" className={missingGroin && workout.groin_during == null ? 'rounded-lg outline-3 outline-offset-4 outline-a' : ''}>
              <ScoreScale
                label="Venstre lyske under træningen"
                hint="Højst 3 er grønt, hvis lysken også er væk i morgen tidlig."
                value={workout.groin_during}
                onChange={(v) => void patchWorkout(workout.uuid, { groin_during: v })}
              />
              {missingGroin && workout.groin_during == null && (
                <p role="alert" className="mt-2 text-sm text-a-ink">
                  Angiv lysken før du afslutter.
                </p>
              )}
            </div>
          )}
          <RpePicker label="RPE for hele sessionen" value={workout.rpe} onChange={(rpe) => void patchWorkout(workout.uuid, { rpe })} />
          <NoteField label="Note til sessionen" value={workout.note} onSave={(note) => void patchWorkout(workout.uuid, { note })} />
          {!workout.finished_at ? (
            <button type="button" onClick={() => void finish()} className="min-h-14 rounded-lg bg-fg text-lg font-semibold text-bg">
              Afslut session
            </button>
          ) : (
            <button type="button" onClick={() => void patchWorkout(workout.uuid, { finished_at: null })} className="min-h-12 rounded-lg border border-line font-medium">
              Genåbn session
            </button>
          )}
          <button type="button" onClick={() => void remove()} className="min-h-12 self-start px-1 text-sm text-a-ink underline">
            Slet træningen
          </button>
        </section>
      </div>

      {timerFor && <RestTimerBar />}
    </main>
  );
}
