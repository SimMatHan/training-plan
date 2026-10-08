import { CaretLeft, ListBullets } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import type { Plan, Session } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { formatRange, getSession, resolveStrengthSession } from '../../shared/resolve';
import { CoachNotes } from '../components/CoachNotes';
import { ExerciseBlock } from '../components/ExerciseBlock';
import { MobilityChecklist } from '../components/MobilityChecklist';
import { NoteField } from '../components/NoteField';
import { RestTimer } from '../components/RestTimer';
import { RpePicker } from '../components/RpePicker';
import { RunLog } from '../components/RunLog';
import { ScoreScale } from '../components/ScoreScale';
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
import { exerciseCategory } from '../logic/category';
import { isComplete, mobilityProgress, nextIncomplete, slotProgress, type Progress } from '../logic/progress';
import { PrimaryButton, SecondaryButton, TextButton } from '../ui/Button';
import { HeroNumber } from '../ui/HeroNumber';
import { IconTile } from '../ui/IconTile';
import { InsetList, InsetRow, RowText } from '../ui/InsetList';
import { Muted } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { TILE_INSET } from '../ui/ExerciseRow';

const MOBILITY = 'mobilitet';
const FINISH = 'afslut';

/**
 * Logning, én øvelse ad gangen: mobilitet (hvis planen siger før), hver plads i sessionen og
 * til sidst afslutning med smerte, RPE og note. Løb og aktiviteter er ét trin.
 */
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
  const [step, setStep] = useState<string>();
  const [overview, setOverview] = useState(false);
  const [timerCompact, setTimerCompact] = useState(false);
  useWakeLock(true);

  const plan = active?.plan;
  const session = plan && workout?.planned_session_id ? getSession(plan, workout.planned_session_id) : undefined;
  const strength = plan && session?.kind === 'styrke' && workout?.week_no ? resolveStrengthSession(plan, session.id, workout.week_no) : undefined;
  const showMobility = !!plan?.mobility && (session?.kind === 'mobilitet' || (session?.kind === 'styrke' && session.mobility === 'before'));
  const stepped = !!strength || session?.kind === 'mobilitet';

  // Trinene i rækkefølge: mobilitet først, så pladserne, til sidst afslutning.
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
  const steps = [...order, FINISH];

  // Start på det første ufærdige trin, når data er indlæst.
  useEffect(() => {
    if (step !== undefined || !logs || !plan || !workout) return;
    setStep(workout.finished_at ? steps[0] : (nextIncomplete(order, progress) ?? FINISH));
  }, [logs, plan, workout, step]);

  if (workout === undefined || logs === undefined || !active || !plan) return <main className="pt-safe p-4 text-ink-2">Henter …</main>;
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
  const current = stepped ? (step ?? steps[0]) : FINISH;
  const index = steps.indexOf(current);
  const slots = strength?.slots ?? [];
  const slotIndex = slots.findIndex((s) => s.slotId === current);
  const slot = slots[slotIndex];
  const title = !stepped
    ? session
      ? sessionTitle(session)
      : (workout.activity ?? 'Træning')
    : current === MOBILITY
      ? plan.mobility!.name
      : current === FINISH
        ? 'Afslut'
        : slot.exercises.map((e) => e.label).join(' + ');

  const go = (id: string) => {
    setStep(id);
    setOverview(false);
    window.scrollTo({ top: 0 });
  };
  const next = steps[index + 1];
  const nextLabel = current === MOBILITY ? (slots.length ? 'Til øvelserne' : 'Til afslutning') : next === FINISH ? 'Til afslutning' : 'Næste øvelse';

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

  const counter = slotIndex >= 0 ? `${slotIndex + 1}/${slots.length}` : undefined;

  return (
    <main className={`mx-auto max-w-xl px-4 ${timerFor ? (timerCompact ? 'pb-36' : 'pb-[24rem]') : 'pb-12'}`}>
      <header className="pt-safe blur-chrome sticky top-0 z-20 -mx-4 border-b-[0.5px] border-separator px-2">
        <div className="grid h-11 grid-cols-[minmax(5.5rem,auto)_1fr_minmax(5.5rem,auto)] items-center gap-1">
          <Link href="/" className="inline-flex min-h-11 items-center gap-0.5 pr-2 text-body text-ink">
            <CaretLeft size={22} weight="bold" className="text-brand-red" aria-hidden="true" />I dag
          </Link>
          <h1 className="truncate text-center text-headline">{title}</h1>
          <div className="flex justify-end">
            {stepped ? (
              <button type="button" onClick={() => setOverview(true)} aria-label={`Oversigt${counter ? `, øvelse ${counter}` : ''}`} className="num inline-flex min-h-11 items-center gap-1.5 px-2 text-body text-ink-2">
                {counter ?? <ListBullets size={22} aria-hidden="true" />}
              </button>
            ) : (
              <span className="px-2">
                <SyncBadge quiet />
              </span>
            )}
          </div>
        </div>
      </header>

      <p className="mt-3 mb-4 px-1 text-footnote text-ink-2">
        {session ? sessionTitle(session) : (workout.activity ?? 'Træning')}
        {workout.week_no && ` · uge ${workout.week_no}`} · {formatLong(workout.date)}
        {!session && workout.activity && ' · uden for planen'}
        {workout.finished_at && ' · afsluttet'}
      </p>

      {index <= 0 && <CoachNotes notes={weekNotes.filter((n) => n.session_id === workout.planned_session_id && n.session_id)} plan={plan} showSession={false} />}

      {current === MOBILITY && (
        <>
          <HeroNumber className="mb-5 px-1" label="Mobilitet før styrke" value={`${progress[MOBILITY].done}/${progress[MOBILITY].total}`} unit="lavet" />
          <MobilityChecklist plan={plan} workoutUuid={workout.uuid} checks={logs.mobility} />
        </>
      )}

      {slot &&
        slot.exercises.map((ex, i) => (
          <ExerciseBlock
            key={`${slot.slotId}-${ex.exercise.id}`}
            plan={plan}
            workoutUuid={workout.uuid}
            resolved={ex}
            sets={logs.sets}
            notes={logs.notes}
            supersetFirst={slot.superset && i === 0}
            showTitle={slot.superset}
          />
        ))}
      {slot?.superset && <Muted className="-mt-4 mb-6 px-1">Tag dem lige efter hinanden; pause efter anden øvelse.</Muted>}

      {!stepped && session && (session.kind === 'løb' || session.kind === 'cardio') && <RunHeader workout={workout} plan={plan} session={session} />}
      {!stepped && (session?.kind === 'løb' || session?.kind === 'cardio') && (
        <RunLog workout={workout} session={session} scheduled={plan.weeks.find((w) => w.weekNo === workout.week_no)?.sessions.find((s) => s.sessionId === session.id)} />
      )}
      {!stepped && !session && workout.activity && <RunLog workout={workout} />}

      {current === FINISH && (
        <FinishSection
          workout={workout}
          monitors={monitors}
          painScores={painScores}
          missingPain={missingPain}
          setMissingPain={setMissingPain}
          onDone={() => {
            if (timerFor) skipTimer();
            navigate('/');
          }}
          onDelete={() => void remove('slet')}
        />
      )}

      {current !== FINISH && next && (
        <PrimaryButton onClick={() => go(next)} className="mt-2">
          {nextLabel}
        </PrimaryButton>
      )}

      {stepped && (
        <Sheet open={overview} onClose={() => setOverview(false)} title={session ? sessionTitle(session) : 'Session'}>
          <InsetList inset={TILE_INSET} className="mb-4">
            {steps.map((id) => {
              const s = slots.find((x) => x.slotId === id);
              const p = progress[id];
              return (
                <InsetRow key={id} onClick={() => go(id)} current={id === current}>
                  <IconTile category={id === MOBILITY ? 'mobility' : s ? exerciseCategory(plan, s.exercises[0].exercise.id) : 'legs'} />
                  <RowText
                    title={id === MOBILITY ? plan.mobility!.name : id === FINISH ? 'Afslut' : s!.exercises.map((e) => e.label).join(' + ')}
                    detail={p && (isComplete(p) ? `Færdig · ${p.done}/${p.total}` : `${p.done}/${p.total} sæt`)}
                  />
                </InsetRow>
              );
            })}
          </InsetList>
          <div className="flex items-center justify-between">
            <SyncBadge />
            {!workout.finished_at && (
              <TextButton danger onClick={() => void remove('annuller')}>
                Annuller session
              </TextButton>
            )}
          </div>
        </Sheet>
      )}

      {timerFor && <RestTimer compact={timerCompact} onToggle={() => setTimerCompact((c) => !c)} />}
    </main>
  );
}

/** Løb: målet som heltetal. */
function RunHeader({ workout, plan, session }: { workout: Workout; plan: Plan; session: Session }) {
  const scheduled = plan.weeks.find((w) => w.weekNo === workout.week_no)?.sessions.find((s) => s.sessionId === session.id);
  const km = scheduled?.targetKm;
  const min = scheduled?.targetMin;
  if (!km && !min) return null;
  return <HeroNumber className="mb-4 px-1" label="Mål" value={km ? formatRange(km) : formatRange(min)} unit={km ? 'km' : 'min'} />;
}

function FinishSection({
  workout,
  monitors,
  painScores,
  missingPain,
  setMissingPain,
  onDone,
  onDelete,
}: {
  workout: Workout;
  monitors: ReturnType<typeof useMonitors>;
  painScores: ReturnType<typeof useDuringScores>;
  missingPain: boolean;
  setMissingPain: (v: boolean) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  // Smerten vurderes pr. monitor efter alle styrke-, løbe- og cardiosessioner.
  const asksPain = workout.type !== 'mobilitet' && monitors.length > 0;
  const scoreOf = (monitorId: number) => painScores.find((p) => p.monitor_id === monitorId)?.score ?? null;
  const missing = asksPain ? monitors.filter((m) => scoreOf(m.id) == null) : [];

  async function finish() {
    if (missing.length) {
      setMissingPain(true);
      document.getElementById(`smerte-${missing[0].id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    await finishWorkout(workout.uuid);
    onDone();
  }

  return (
    <section className="flex flex-col gap-6 px-1 pt-2">
      {asksPain &&
        monitors.map((m) => {
          const value = scoreOf(m.id);
          return (
            <div key={m.id} id={`smerte-${m.id}`} className={missingPain && value == null ? 'rounded-card outline-2 outline-offset-4 outline-danger' : ''}>
              <ScoreScale
                label={`${m.label} under træningen`}
                hint="Højst 3 er grønt, hvis det også er væk i morgen tidlig."
                value={value}
                onChange={(v) => void saveDuringScore(workout, m.id, v)}
              />
              {missingPain && value == null && (
                <p role="alert" className="mt-2 text-secondary text-danger">
                  Angiv {m.label.charAt(0).toLowerCase() + m.label.slice(1)} før du afslutter.
                </p>
              )}
            </div>
          );
        })}
      <RpePicker label="RPE for hele sessionen" value={workout.rpe} onChange={(rpe) => void patchWorkout(workout.uuid, { rpe })} />
      <NoteField label="Note til sessionen" value={workout.note} onSave={(note) => void patchWorkout(workout.uuid, { note })} />
      {!workout.finished_at ? (
        <PrimaryButton onClick={() => void finish()}>Afslut session</PrimaryButton>
      ) : (
        <>
          <SecondaryButton onClick={() => void patchWorkout(workout.uuid, { finished_at: null })}>Genåbn session</SecondaryButton>
          <TextButton danger onClick={onDelete} className="self-start">
            Slet træningen
          </TextButton>
        </>
      )}
    </section>
  );
}
