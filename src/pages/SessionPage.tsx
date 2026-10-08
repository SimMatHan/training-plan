import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { formatDose, formatIntensity, getSession, resolveStrengthSession } from '../../shared/resolve';
import { CoachNotes } from '../components/CoachNotes';
import { Collapsible } from '../components/Collapsible';
import { ExerciseBlock } from '../components/ExerciseBlock';
import { MobilityChecklist } from '../components/MobilityChecklist';
import { NoteField } from '../components/NoteField';
import { RestTimerBar } from '../components/RestTimerBar';
import { RpePicker } from '../components/RpePicker';
import { RunLog } from '../components/RunLog';
import { ScoreScale } from '../components/ScoreScale';
import { SessionMark } from '../components/SessionMark';
import { SyncBadge } from '../components/SyncBadge';
import { saveDuringScore, useDuringScores } from '../data/health';
import { useCoachNotes } from '../data/notes';
import { useMonitors, usePlan } from '../data/plan';
import { deleteRecord } from '../data/records';
import { skipTimer, useTimer } from '../data/timer';
import { finishWorkout, patchWorkout, useWorkout, useWorkoutLogs } from '../data/workouts';
import { formatLong } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { useWakeLock } from '../lib/wakeLock';
import { isComplete, mobilityProgress, nextIncomplete, slotProgress, type Progress } from '../logic/progress';

const MOBILITY = 'mobilitet';

const scrollToSection = (id: string) =>
  requestAnimationFrame(() =>
    document.getElementById(`sektion-${id}`)?.scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    }),
  );

export function SessionPage() {
  const [, params] = useRoute('/session/:uuid');
  const uuid = params?.uuid;
  const [, navigate] = useLocation();
  const { active } = usePlan();
  const workout = useWorkout(uuid);
  const logs = useWorkoutLogs(uuid);
  const timer = useTimer();
  const weekNotes = useCoachNotes(workout?.week_no ?? undefined);
  const monitors = useMonitors();
  const painScores = useDuringScores(uuid);
  const [missingPain, setMissingPain] = useState(false);
  // undefined = ikke valgt endnu; null = alt foldet sammen.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const prevComplete = useRef<Record<string, boolean> | null>(null);
  useWakeLock(true);

  const plan = active?.plan;
  const session = plan && workout?.planned_session_id ? getSession(plan, workout.planned_session_id) : undefined;
  const strength = plan && session?.kind === 'styrke' && workout?.week_no ? resolveStrengthSession(plan, session.id, workout.week_no) : undefined;
  const showMobility = !!plan?.mobility && (session?.kind === 'mobilitet' || (session?.kind === 'styrke' && session.mobility === 'before'));

  // Fremskridt pr. sektion, i rækkefølge: mobilitet først, derefter øvelserne.
  const order: string[] = [];
  const progress: Record<string, Progress> = {};
  if (plan && logs) {
    if (showMobility) {
      order.push(MOBILITY);
      progress[MOBILITY] = mobilityProgress(plan, logs.mobility);
    }
    for (const slot of strength?.slots ?? []) {
      order.push(slot.slotId);
      progress[slot.slotId] = slotProgress(plan, slot, logs.sets);
    }
  }
  const completeKey = order.map((id) => (isComplete(progress[id]) ? 1 : 0)).join('');

  // Åbn første ufærdige sektion, når data er indlæst.
  useEffect(() => {
    if (open !== undefined || !logs || !plan) return;
    setOpen(nextIncomplete(order, progress));
    prevComplete.current = Object.fromEntries(order.map((id) => [id, isComplete(progress[id])]));
  }, [logs, plan, open]);

  // Når den åbne sektion bliver færdig, hoppes der videre til den næste.
  useEffect(() => {
    const prev = prevComplete.current;
    if (!prev || open === undefined) return;
    const now = Object.fromEntries(order.map((id) => [id, isComplete(progress[id])]));
    prevComplete.current = now;
    if (open && !prev[open] && now[open]) {
      const next = nextIncomplete(order, progress, open);
      setOpen(next);
      if (next) scrollToSection(next);
    }
  }, [completeKey]);

  if (workout === undefined || logs === undefined || !active || !plan) return <main className="p-4 text-muted">Henter …</main>;
  if (workout === null || workout.deleted_at)
    return (
      <main className="pt-safe p-4">
        <p className="mb-4">Træningen findes ikke.</p>
        <Link href="/" className="underline">
          Til I dag
        </Link>
      </main>
    );

  const timerFor = timer.state?.workoutUuid === workout.uuid;
  const isRun = session?.kind === 'løb' || session?.kind === 'cardio';
  const scheduled = plan.weeks.find((w) => w.weekNo === workout.week_no)?.sessions.find((s) => s.sessionId === session?.id);
  // Smerten vurderes pr. monitor efter alle styrke-, løbe- og cardiosessioner.
  const asksPain = workout.type !== 'mobilitet' && monitors.length > 0;
  const scoreOf = (monitorId: number) => painScores.find((p) => p.monitor_id === monitorId)?.score ?? null;
  const missing = asksPain ? monitors.filter((m) => scoreOf(m.id) == null) : [];

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) scrollToSection(next);
  };

  async function finish() {
    if (missing.length) {
      setMissingPain(true);
      document.getElementById(`smerte-${missing[0].id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    await finishWorkout(workout!.uuid);
    if (timerFor) skipTimer();
    navigate('/');
  }

  /** Annuller (forkert session startet) og slet: begge er en tombstone på træningen. */
  async function remove(kind: 'annuller' | 'slet') {
    const w = workout!;
    const hasData =
      logs!.sets.some((s) => s.done || s.reps != null || s.weight_kg != null || s.seconds != null) ||
      logs!.mobility.some((m) => m.done) ||
      logs!.notes.some((n) => n.note || n.rpe != null) ||
      painScores.length > 0 ||
      [w.distance_km, w.duration_sec, w.avg_hr, w.rpe, w.note].some((v) => v != null && v !== '');
    const question =
      kind === 'annuller' ? 'Annullere sessionen? Det du har logget i den slettes.' : 'Slette denne træning? Alt logget i den forsvinder fra historikken.';
    // En tom session (startet ved en fejl) annulleres uden spørgsmål.
    if ((hasData || kind === 'slet') && !confirm(question)) return;
    await deleteRecord('workouts', w.uuid);
    if (timerFor) skipTimer();
    navigate('/');
  }

  const exerciseSubtitle = (slotIndex: number) => {
    const slot = strength!.slots[slotIndex];
    return slot.exercises
      .map((e) => [formatDose(e.exercise, e.planned.dose), formatIntensity(e.planned.dose)].filter(Boolean).join(' · '))
      .join(' + ');
  };

  return (
    <main className={`pt-safe mx-auto max-w-xl px-4 ${timerFor ? 'pb-36' : 'pb-12'}`}>
      <header className="pt-2 pb-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link href="/" className="-ml-2 inline-flex min-h-12 items-center px-2 text-base">
            ← I dag
          </Link>
          <div className="flex items-center gap-3">
            <SyncBadge />
            {!workout.finished_at && (
              <button type="button" onClick={() => void remove('annuller')} className="min-h-12 rounded-lg border border-line px-3 text-sm font-medium">
                Annuller
              </button>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          {session && <SessionMark colorKey={session.colorKey} />}
          <div>
            <h1 className="text-3xl">{session ? sessionTitle(session) : (workout.activity ?? 'Træning')}</h1>
            <p className="text-sm text-muted">
              {workout.week_no && `Uge ${workout.week_no} · `}
              {formatLong(workout.date)}
              {!session && workout.activity && ' · uden for planen'}
              {workout.finished_at && ' · afsluttet'}
            </p>
          </div>
        </div>
      </header>

      <CoachNotes notes={weekNotes.filter((n) => n.session_id === workout.planned_session_id && n.session_id)} plan={plan} showSession={false} />

      <div className="divide-y divide-line border-t border-line">
        {showMobility && (
          <Collapsible
            id={MOBILITY}
            title={plan.mobility!.name}
            subtitle={plan.mobility!.durationMin ? `${plan.mobility!.durationMin.min}–${plan.mobility!.durationMin.max} min` : undefined}
            progress={progress[MOBILITY]}
            open={open === MOBILITY}
            onToggle={() => toggle(MOBILITY)}
            accent="bg-mob"
          >
            <MobilityChecklist plan={plan} workoutUuid={workout.uuid} checks={logs.mobility} hideHeading />
          </Collapsible>
        )}

        {strength?.slots.map((slot, si) => (
          <Collapsible
            key={slot.slotId}
            id={slot.slotId}
            title={slot.exercises.map((e) => e.label).join(' + ')}
            subtitle={(slot.superset ? 'Superset · ' : '') + exerciseSubtitle(si)}
            progress={progress[slot.slotId]}
            open={open === slot.slotId}
            onToggle={() => toggle(slot.slotId)}
          >
            {slot.superset ? (
              <div className="divide-y divide-line">
                <p className="pb-1 text-sm text-muted">Tag dem lige efter hinanden; pause efter anden øvelse.</p>
                {slot.exercises.map((ex, i) => (
                  <ExerciseBlock key={ex.exercise.id} plan={plan} workoutUuid={workout.uuid} resolved={ex} sets={logs.sets} notes={logs.notes} supersetFirst={i === 0} />
                ))}
              </div>
            ) : (
              <ExerciseBlock plan={plan} workoutUuid={workout.uuid} resolved={slot.exercises[0]} sets={logs.sets} notes={logs.notes} supersetFirst={false} hideTitle />
            )}
          </Collapsible>
        ))}

        {isRun && session && (session.kind === 'løb' || session.kind === 'cardio') && <RunLog workout={workout} session={session} scheduled={scheduled} />}
        {!session && workout.activity && <RunLog workout={workout} />}

        <section className="flex flex-col gap-4 py-6">
          <h2 className="text-2xl">Sessionen</h2>
          {asksPain &&
            monitors.map((m) => {
              const value = scoreOf(m.id);
              return (
                <div key={m.id} id={`smerte-${m.id}`} className={missingPain && value == null ? 'rounded-lg outline-3 outline-offset-4 outline-a' : ''}>
                  <ScoreScale
                    label={`${m.label} under træningen`}
                    hint="Højst 3 er grønt, hvis det også er væk i morgen tidlig."
                    value={value}
                    onChange={(v) => void saveDuringScore(workout, m.id, v)}
                  />
                  {missingPain && value == null && (
                    <p role="alert" className="mt-2 text-sm text-a-ink">
                      Angiv {m.label.charAt(0).toLowerCase() + m.label.slice(1)} før du afslutter.
                    </p>
                  )}
                </div>
              );
            })}
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
          {workout.finished_at && (
            <button type="button" onClick={() => void remove('slet')} className="min-h-12 self-start px-1 text-sm text-a-ink underline">
              Slet træningen
            </button>
          )}
        </section>
      </div>

      {timerFor && <RestTimerBar />}
    </main>
  );
}
