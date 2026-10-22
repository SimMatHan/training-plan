import { CaretDown, CaretLeft, PencilSimple, Plus, Timer } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import type { Exercise, Plan, Session } from '../../shared/plan.schema';
import { newExerciseId } from '../../shared/planEdit';
import type { MobilityCheck, SetLog, Workout } from '../../shared/records.schema';
import { formatRange, getExercise, getSession, resolveStrengthSession } from '../../shared/resolve';
import { scheduledOf } from '../../shared/schedule';
import { CoachNotes } from '../components/CoachNotes';
import { ExerciseBlock } from '../components/ExerciseBlock';
import { ExercisePicker } from '../components/ExercisePicker';
import { MobilityChecklist } from '../components/MobilityChecklist';
import { NoteField } from '../components/NoteField';
import { mmss, RestTimer } from '../components/RestTimer';
import { STEP_MOBILITY } from '../components/SessionOverview';
import { RpePicker } from '../components/RpePicker';
import { RunLog } from '../components/RunLog';
import { ScoreScale } from '../components/ScoreScale';
import { SyncBadge } from '../components/SyncBadge';
import { saveDuringScore, useDuringScores } from '../data/health';
import { useCoachNotes } from '../data/notes';
import { db } from '../data/db';
import { savePlanEdit, useMonitors, usePlan } from '../data/plan';
import { deleteRecord } from '../data/records';
import { skipTimer, startTimer, useTimer } from '../data/timer';
import { finishWorkout, patchWorkout, upsertSet, useWorkout, useWorkoutLogs } from '../data/workouts';
import { OfflineError } from '../lib/api';
import { EXTRA_STEP, extraSlots, plannedExerciseIds } from '../logic/extras';
import { formatLong } from '../lib/dates';
import { sessionTitle } from '../lib/sessions';
import { useWakeLock } from '../lib/wakeLock';
import { isComplete, mobilityProgress, nextIncomplete, slotProgress, slotSetProgress, type Progress } from '../logic/progress';
import { ButtonLink, PrimaryButton, SecondaryButton, smallButton, TextButton } from '../ui/Button';
import { HeroNumber } from '../ui/HeroNumber';
import { IconTile } from '../ui/IconTile';
import { Sheet } from '../ui/Sheet';

const MOBILITY = STEP_MOBILITY;
/** Id'et på en plads på siden, så der kan scrolles til den. */
const slotDomId = (slotId: string) => `plads-${slotId}`;

/**
 * Logning som hos Hevy: hele træningen på én side. Øverst varighed, volumen og sæt; så
 * mobiliteten (hvis planen siger før) og alle øvelserne med deres sættabeller. "Afslut" i
 * toppen fører til smerte, RPE og note. Løb og aktiviteter har kun afslutningen.
 */
export function SessionPage() {
  const [, params] = useRoute('/session/:uuid');
  const uuid = params?.uuid;
  const [location, navigate] = useLocation();
  const { active, slug, refresh } = usePlan();
  const workout = useWorkout(uuid);
  const logs = useWorkoutLogs(uuid);
  const timer = useTimer();
  const weekNotes = useCoachNotes(workout?.week_no ?? undefined);
  const monitors = useMonitors();
  const painScores = useDuringScores(uuid);
  const [missingPain, setMissingPain] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [timerCompact, setTimerCompact] = useState(true);
  const [timerPicker, setTimerPicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scrollTo, setScrollTo] = useState<string>();
  const scrolled = useRef(false);
  useWakeLock(true);

  const plan = active?.plan;
  const session = plan && workout?.planned_session_id ? getSession(plan, workout.planned_session_id) : undefined;
  const strength = plan && session?.kind === 'styrke' && workout?.week_no ? resolveStrengthSession(plan, session.id, workout.week_no) : undefined;
  const showMobility = !!plan?.mobility && (session?.kind === 'mobilitet' || (session?.kind === 'styrke' && session.mobility === 'before'));
  const stepped = !!strength || session?.kind === 'mobilitet';
  // Øvelser ud over planen: logget i træningen, men ikke på sessionens pladser i ugen.
  const planned = strength ? plannedExerciseIds(strength.slots) : new Set<string>();
  const extras = plan && strength && logs ? extraSlots(plan, planned, logs.sets) : [];
  const slots = [...(strength?.slots ?? []), ...extras];
  const progress: Record<string, Progress> = {};
  if (plan && logs) for (const slot of slots) progress[slot.slotId] = slotProgress(plan, slot, logs.sets);

  // Er der allerede logget noget, så til den første ufærdige øvelse, når data er indlæst.
  useEffect(() => {
    if (scrolled.current || !logs || !plan || !workout) return;
    scrolled.current = true;
    if (workout.finished_at || !logs.sets.some((s) => s.done)) return;
    const next = nextIncomplete(
      slots.map((s) => s.slotId),
      progress,
    );
    if (next) requestAnimationFrame(() => document.getElementById(slotDomId(next))?.scrollIntoView({ block: 'start' }));
  }, [logs, plan, workout]);

  // En netop tilføjet øvelse: scroll til den, når den er kommet på siden.
  useEffect(() => {
    if (!scrollTo) return;
    const el = document.getElementById(slotDomId(scrollTo));
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setScrollTo(undefined);
  }, [scrollTo, logs]);

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
  const listing = stepped && !finishing;
  const name = session ? sessionTitle(session) : (workout.activity ?? 'Træning');
  // Sæt som i oversigten: højre og venstre i samme sæt er ét.
  const setCount = slots.map((slot) => slotSetProgress(plan, slot, logs.sets)).reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
  const mobility = showMobility ? mobilityProgress(plan, logs.mobility) : undefined;

  const toList = () => {
    setFinishing(false);
    window.scrollTo({ top: 0 });
  };
  const toFinish = () => {
    setFinishing(true);
    window.scrollTo({ top: 0 });
  };

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

  /** Tilføjer en øvelse ud over planen: et tomt første sæt (begge sider), og scroller til den. */
  async function addExtra(exercise: Pick<Exercise, 'id' | 'perSide'>) {
    const sides = exercise.perSide ? (['H', 'V'] as const) : [null];
    await Promise.all(
      sides.map((side) => upsertSet({ workoutUuid: workout!.uuid, exerciseId: exercise.id, side, setNo: 1 }, { done: false, weight_kg: null, reps: null, seconds: null })),
    );
    setScrollTo(`${EXTRA_STEP}${exercise.id}`);
  }

  /** En ny øvelse kommer i planens katalog (ny planversion), før den kan logges. Kræver net. */
  async function createExercise(e: Omit<Exercise, 'id'>) {
    try {
      const logged = (await db.set_logs.orderBy('exercise_id').uniqueKeys()) as string[];
      const exercise = { id: newExerciseId(e.name, [...plan!.exercises.map((x) => x.id), ...logged]), ...e };
      await savePlanEdit(slug, { baseVersion: active!.meta.version, note: `Ny øvelse: ${e.name}`, plan: { ...plan!, exercises: [...plan!.exercises, exercise] } });
      await refresh();
      await addExtra(exercise);
    } catch (err) {
      alert(err instanceof OfflineError ? 'Ingen forbindelse. En ny øvelse kan kun oprettes med net; vælg en fra listen i stedet.' : (err as Error).message);
    }
  }

  /** Fjerner en øvelse ud over planen fra træningen: alle dens sæt og noten. */
  async function removeExtra(exerciseId: string) {
    const own = logs!.sets.filter((s) => s.exercise_id === exerciseId);
    const note = logs!.notes.find((n) => n.exercise_id === exerciseId);
    if ((own.some((s) => s.done || s.reps != null || s.weight_kg != null || s.seconds != null) || note) && !confirm('Fjerne øvelsen fra træningen? Det loggede slettes.')) return;
    await Promise.all([...own.map((s) => deleteRecord('set_logs', s.uuid)), ...(note ? [deleteRecord('exercise_notes', note.uuid)] : [])]);
  }

  const canAdd = !!strength;

  return (
    <main className={`mx-auto max-w-xl px-4 ${timerFor ? (timerCompact ? 'pb-36' : 'pb-[24rem]') : 'pb-12'}`}>
      {/* Fast flade, ikke blur: Safari på iPhone slørede også bjælkens egen tekst. */}
      <header className="pt-safe sticky top-0 z-20 -mx-4 border-b-[0.5px] border-separator bg-bg px-3">
        <div className="flex h-14 items-center gap-2">
          {stepped && finishing ? (
            <button type="button" onClick={toList} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 pr-2 text-body text-ink">
              <CaretLeft size={22} weight="bold" className="text-brand-red" aria-hidden="true" />
              Øvelser
            </button>
          ) : (
            <Link href="/" aria-label="Til I dag" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-pill">
              <CaretDown size={20} weight="bold" aria-hidden="true" />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-headline">{stepped && finishing ? 'Afslut' : name}</h1>
          {listing && (
            <>
              <TimerButton running={timerFor} onClick={() => (timerFor ? setTimerCompact((c) => !c) : setTimerPicker(true))} />
              <button type="button" onClick={toFinish} className={smallButton('primary', 'min-h-10 shrink-0 px-5')}>
                {workout.finished_at ? 'Afsluttet' : 'Afslut'}
              </button>
            </>
          )}
          {!stepped && (
            <span className="px-2">
              <SyncBadge quiet />
            </span>
          )}
        </div>
      </header>

      {stepped ? (
        <WorkoutStats workout={workout} sets={logs.sets} progress={setCount} />
      ) : (
        <div className="h-3" />
      )}
      <p className="mb-4 px-1 text-footnote text-ink-2">
        {name}
        {workout.week_no && ` · uge ${workout.week_no}`} · {formatLong(workout.date)}
        {!session && workout.activity && ' · uden for planen'}
        {workout.finished_at && ' · afsluttet'}
      </p>

      {listing && (
        <>
          <CoachNotes notes={weekNotes.filter((n) => n.session_id === workout.planned_session_id && n.session_id)} plan={plan} showSession={false} />

          <div className="flex flex-col gap-4">
            {mobility && plan.mobility && <MobilitySection plan={plan} workoutUuid={workout.uuid} checks={logs.mobility} progress={mobility} />}

            {slots.map((slot) => (
              <section key={slot.slotId} id={slotDomId(slot.slotId)} aria-label={slot.superset ? 'Superset' : undefined} className="flex scroll-mt-24 flex-col gap-2">
                {slot.superset && (
                  <p className="px-1 text-footnote">
                    <span className="font-semibold text-brand-red">Superset</span>
                    <span className="text-ink-2"> · tag dem lige efter hinanden; pause efter anden øvelse</span>
                  </p>
                )}
                {slot.exercises.map((ex, i) => (
                  <ExerciseBlock
                    key={`${slot.slotId}-${ex.exercise.id}`}
                    plan={plan}
                    workoutUuid={workout.uuid}
                    resolved={ex}
                    sets={logs.sets}
                    notes={logs.notes}
                    supersetFirst={slot.superset && i === 0}
                    onRemove={slot.slotId.startsWith(EXTRA_STEP) ? () => void removeExtra(ex.exercise.id) : undefined}
                  />
                ))}
              </section>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {canAdd && (
              <SecondaryButton onClick={() => setAdding(true)} className="gap-1.5">
                <Plus size={18} weight="bold" aria-hidden="true" /> Tilføj øvelse
              </SecondaryButton>
            )}
            <PrimaryButton onClick={toFinish}>{workout.finished_at ? 'Til afslutningen' : 'Afslut træningen'}</PrimaryButton>
            {strength && session && workout.week_no && (
              <ButtonLink small href={`/plan/${session.id}?uge=${workout.week_no}&tilbage=${encodeURIComponent(location)}`} className="gap-1.5 self-start">
                <PencilSimple size={16} weight="bold" aria-hidden="true" />
                Ret øvelserne i planen
              </ButtonLink>
            )}
            <div className="flex items-center justify-between px-1">
              <SyncBadge />
              {!workout.finished_at && (
                <TextButton danger onClick={() => void remove('annuller')}>
                  Annuller session
                </TextButton>
              )}
            </div>
          </div>
        </>
      )}

      {!stepped && session && (session.kind === 'løb' || session.kind === 'cardio') && <RunHeader workout={workout} plan={plan} session={session} />}
      {!stepped && (session?.kind === 'løb' || session?.kind === 'cardio') && (
        <RunLog workout={workout} session={session} scheduled={scheduledOf(plan.weeks.find((w) => w.weekNo === workout.week_no), session.id, workout.planned_day)} />
      )}
      {!stepped && !session && workout.activity && <RunLog workout={workout} />}

      {!listing && (
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

      {canAdd && (
        <ExercisePicker
          open={adding}
          onClose={() => setAdding(false)}
          title="Tilføj øvelse"
          catalog={plan.exercises}
          exclude={[...planned, ...extras.map((s) => s.exercises[0].exercise.id)]}
          onPick={(id) => {
            const exercise = getExercise(plan, id);
            if (exercise) void addExtra(exercise);
          }}
          onCreate={(e) => void createExercise(e)}
        />
      )}

      <Sheet open={timerPicker} onClose={() => setTimerPicker(false)} title="Pausetimer">
        <div className="grid grid-cols-3 gap-2">
          {[45, 60, 90, 120, 150, 180].map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => {
                startTimer(sec, 'Pause', workout.uuid);
                setTimerCompact(true);
                setTimerPicker(false);
              }}
              className="num min-h-14 rounded-[10px] bg-fill text-headline text-ink"
            >
              {mmss(sec * 1000)}
            </button>
          ))}
        </div>
      </Sheet>

      {timerFor && <RestTimer compact={timerCompact} onToggle={() => setTimerCompact((c) => !c)} />}
    </main>
  );
}

/** Uret i toppen: nedtællingen, mens en pause kører; ellers et ikon der åbner pausetimeren. */
function TimerButton({ running, onClick }: { running: boolean; onClick: () => void }) {
  const { remainingMs, finished } = useTimer();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={running ? `Pause: ${mmss(remainingMs)} tilbage` : 'Start pausetimer'}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-full bg-surface text-ink shadow-pill ${running ? 'px-3' : 'w-10'}`}
    >
      <Timer size={20} weight={running ? 'fill' : 'regular'} className={running ? 'text-brand-red' : ''} aria-hidden="true" />
      {running && <span className="num text-secondary font-semibold">{finished ? '0:00' : mmss(remainingMs)}</span>}
    </button>
  );
}

/** Opdateres hvert sekund, så længe `live` er sand. */
function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return now;
}

const kgFormat = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });

/** "4:05", "1:02:09". */
function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Varighed, volumen (kg × reps i færdige sæt) og færdige sæt ud af de planlagte. */
function WorkoutStats({ workout, sets, progress }: { workout: Workout; sets: SetLog[]; progress: Progress }) {
  const now = useNow(!workout.finished_at);
  const start = workout.started_at ? Date.parse(workout.started_at) : NaN;
  const end = workout.finished_at ? Date.parse(workout.finished_at) : now;
  const elapsed = end - start;
  // En træning logget bagefter (eller over flere dage) har ingen meningsfuld varighed.
  const duration = Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 12 * 3600_000 ? clock(elapsed) : '–';
  const done = sets.filter((s) => s.done);
  const volume = done.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  const stat = (label: string, value: string, accent = false) => (
    <div className="min-w-0">
      <p className="text-footnote text-ink-2">{label}</p>
      <p className={`num truncate text-title ${accent ? 'text-brand-red' : ''}`}>{value}</p>
    </div>
  );
  return (
    <div className="mt-3 mb-1 grid grid-cols-3 gap-3 px-1" aria-label="Træningen indtil nu">
      {stat('Varighed', duration, true)}
      {stat('Volumen', `${kgFormat.format(volume)} kg`)}
      {stat('Sæt', `${progress.done}/${progress.total}`)}
    </div>
  );
}

/** Mobilitetsblokken som et kort, der kan foldes sammen. Åben, indtil den er lavet. */
function MobilitySection({ plan, workoutUuid, checks, progress }: { plan: Plan; workoutUuid: string; checks: MobilityCheck[]; progress: Progress }) {
  const [open, setOpen] = useState(() => !isComplete(progress));
  const block = plan.mobility!;
  return (
    <section id={slotDomId(MOBILITY)} className="scroll-mt-24">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-card bg-surface p-3 text-left">
        <IconTile category="mobility" size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-headline text-brand-red">{block.name}</span>
          <span className="num block text-footnote text-ink-2">
            {block.items.length} øvelser{block.durationMin && ` · ${block.durationMin.min}–${block.durationMin.max} min`}
          </span>
        </span>
        <span className="num text-secondary text-ink-2">
          {progress.done}/{progress.total}
        </span>
        <CaretDown size={18} weight="bold" className={`text-ink-3 transition-transform duration-200 ease-ios ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-2">
          <MobilityChecklist plan={plan} workoutUuid={workoutUuid} checks={checks} />
        </div>
      )}
    </section>
  );
}

/** Løb: målet som heltetal. */
function RunHeader({ workout, plan, session }: { workout: Workout; plan: Plan; session: Session }) {
  const scheduled = scheduledOf(plan.weeks.find((w) => w.weekNo === workout.week_no), session.id, workout.planned_day);
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
