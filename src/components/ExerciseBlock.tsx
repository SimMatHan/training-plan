import { ArrowUp, Minus, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Exercise, Plan } from '../../shared/plan.schema';
import { findPlannedDose, readyForMoreWeight } from '../../shared/progression';
import type { ExerciseNote, SetLog } from '../../shared/records.schema';
import { formatDose, formatIntensity, formatRange, getExercise, setRows, type ResolvedExercise } from '../../shared/resolve';
import { useExerciseHistory } from '../data/history';
import { startTimer } from '../data/timer';
import { deleteRecord } from '../data/records';
import { upsertExerciseNote, upsertSet, useLastTime } from '../data/workouts';
import { extraSetRows, nextSetNo, sidesOf } from '../logic/extras';
import { formatShort } from '../lib/dates';
import { ghostFor, previousSet, summarizeSets } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { restAfter } from '../logic/rest';
import { bestScore, setScore, weightStep } from '../logic/wheel';
import { SecondaryButton, SmallButton, TextButton } from '../ui/Button';
import { GradientPill, HeroNumber } from '../ui/HeroNumber';
import { InsetList } from '../ui/InsetList';
import { NoteField } from './NoteField';
import { ExerciseIllustration } from './ExerciseIllustration';
import { RpePicker } from './RpePicker';
import { usePerSidePref } from '../data/sidePrefs';
import { roundTarget, sidesDiffer, toRounds, type Round } from '../logic/rounds';
import { Switch } from '../ui/Field';
import { SetRow } from './SetRow';

type Values = Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>;

/** Heltetallet for et sæt: vægt, ellers reps, ellers sekunder. */
function heroOf(sets: Values[], kind: Exercise['kind']): { value: string; unit: string } | undefined {
  if (!sets.length) return undefined;
  if (kind === 'time') return { value: String(Math.max(...sets.map((s) => s.seconds ?? 0))), unit: 'sek' };
  const weights = sets.map((s) => s.weight_kg).filter((w): w is number => w != null);
  if (kind === 'weight_reps' && weights.length) return { value: formatDecimal(Math.max(...weights)), unit: 'kg' };
  return { value: String(Math.max(...sets.map((s) => s.reps ?? 0))), unit: 'reps' };
}

/**
 * Én øvelse i logningen: sidste gangs tal som heltetal og alle sættene fra sidst som tekst (så man
 * kan se hvad man skal øge), sættene med talhjul, "Samme som sidst" og RPE/note. Slår et sæt rekorden (vægt × reps), ruller heltetallet til det nye tal.
 */
export function ExerciseBlock({
  plan,
  workoutUuid,
  resolved,
  sets,
  notes,
  supersetFirst,
  showTitle = false,
  onRemove,
}: {
  plan: Plan;
  workoutUuid: string;
  resolved: ResolvedExercise;
  sets: SetLog[];
  notes: ExerciseNote[];
  supersetFirst: boolean;
  /** Vis navnet (superset: to øvelser på samme trin). */
  showTitle?: boolean;
  /** En øvelse ud over planen: fjerner den fra træningen. */
  onRemove?: () => void;
}) {
  const alt = resolved.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  const [useAlt, setUseAlt] = useState(() => !!alt && sets.some((s) => s.exercise_id === alt.exerciseId));
  const [picked, setPicked] = useState<number | null>(null);

  const exercise = useAlt && altExercise ? altExercise : resolved.exercise;
  const dose = useAlt && alt ? alt.dose : resolved.planned.dose;
  const label = useAlt && alt ? (alt.label ?? altExercise!.name) : resolved.label;
  const plannedRows = useAlt ? setRows(exercise, dose) : resolved.rows;
  const mine = sets.filter((s) => s.exercise_id === exercise.id);
  // Planens sæt og de sæt, der er tilføjet ud over planen i denne træning.
  const extraRows = extraSetRows(plannedRows, mine, exercise, dose);
  const rows = [...plannedRows, ...extraRows];
  const note = notes.find((n) => n.exercise_id === exercise.id);
  const last = useLastTime(exercise.id, workoutUuid);
  const history = useExerciseHistory(exercise.id);

  const logFor = (side: string | null, setNo: number) => mine.find((s) => s.side === side && s.set_no === setNo);
  const key = (side: SetLog['side'], setNo: number) => ({ workoutUuid, exerciseId: exercise.id, side, setNo });

  // Ensidige øvelser logges som runder (begge sider på én gang), medmindre kontakten er slået til,
  // eller dagens log allerede har forskellige tal på siderne.
  const [perSidePref, setPerSidePref] = usePerSidePref(exercise.id);
  const differs = exercise.perSide && sidesDiffer(mine);
  const perSide = exercise.perSide && (perSidePref || differs);
  const rounds = perSide ? rows.map((row) => ({ setNo: row.setNo, rows: [row], optional: row.optional })) : toRounds(rows);
  /** En runde er færdig, når alle dens sider er. Tallene vises fra første side. */
  const roundLog = (round: Round): SetLog | undefined => {
    const logs = round.rows.map((r) => logFor(r.side, r.setNo));
    const first = logs.find(Boolean);
    return first && { ...first, done: logs.every((l) => l?.done) };
  };
  const firstOpen = rounds.findIndex((r) => !roundLog(r)?.done);
  const active = picked ?? firstOpen;

  // "Klar til mere vægt": sidste gang ramte alle sæt toppen af intervallet ved RPE ≤ planens mål.
  const lastPlan = last && findPlannedDose(plan, last.workout.planned_session_id, last.workout.week_no, exercise.id);
  const ready = !!last && !!lastPlan && readyForMoreWeight(lastPlan.exercise, lastPlan.dose, last.sets, last.rpe);

  // Ny rekord: et færdigt sæt i dag slår alle tidligere sæt (vægt × reps, ellers reps/sekunder).
  const doneToday = mine.filter((s) => s.done);
  const before = bestScore((history ?? []).filter((e) => e.workoutUuid !== workoutUuid).flatMap((e) => e.sets), exercise.kind);
  const todayBest = doneToday.length ? doneToday.reduce((a, b) => (setScore(b, exercise.kind) > setScore(a, exercise.kind) ? b : a)) : undefined;
  const record = before != null && before > 0 && !!todayBest && setScore(todayBest, exercise.kind) > before;
  const hero = record ? heroOf([todayBest!], exercise.kind) : last ? heroOf(last.sets, exercise.kind) : undefined;

  const target = exercise.kind === 'time' ? formatRange(dose.seconds) : formatRange(dose.reps);
  const meta = [formatDose(exercise, dose), formatIntensity(dose), `pause ${dose.restSec} s`].filter(Boolean).join(' · ');
  const intensity = dose.intensity?.kind === 'rpe' ? formatRange(dose.intensity) : undefined;
  const canCopy = !!last && plannedRows.some((r) => !logFor(r.side, r.setNo)?.done && ghostFor(last, r.side, r.setNo));

  /** Et sæt mere ud over planen: tomt, med sidste gangs tal på hjulene. */
  async function addSet() {
    const setNo = nextSetNo(plannedRows, mine, exercise.id);
    await Promise.all(sidesOf(exercise, dose).map((side) => upsertSet(key(side, setNo), { done: false, weight_kg: null, reps: null, seconds: null })));
    setPicked(perSide ? rows.length : rounds.length);
  }

  /** Fjerner det sidste ekstra sæt. */
  async function removeSet() {
    const setNo = extraRows.at(-1)?.setNo;
    if (setNo == null) return;
    const logs = mine.filter((s) => s.set_no === setNo);
    if (logs.some((s) => s.done) && !confirm(`Fjerne sæt ${setNo}? Det er logget.`)) return;
    await Promise.all(logs.map((s) => deleteRecord('set_logs', s.uuid)));
    setPicked(null);
  }

  /** Alle ufærdige sæt som sidst, markeret færdige. */
  function sameAsLast() {
    for (const r of plannedRows) {
      const g = ghostFor(last, r.side, r.setNo);
      if (!g || logFor(r.side, r.setNo)?.done || r.optional) continue;
      void upsertSet(key(r.side, r.setNo), { weight_kg: g.weight_kg, reps: g.reps, seconds: g.seconds, done: true });
    }
    setPicked(null);
  }

  return (
    <article className="mb-10">
      {showTitle && <h2 className="mb-2 text-title">{label}</h2>}
      <div className="mb-4 px-1">
        <div className="flex items-start justify-between gap-3">
          <HeroNumber
            className="min-w-0"
            size={showTitle ? 'md' : 'lg'}
            label={record ? 'I dag' : last ? `Sidst ${formatShort(last.workout.date)}` : 'Første gang · mål'}
            value={hero?.value ?? (target || '–')}
            unit={hero?.unit ?? (exercise.kind === 'time' ? 'sek' : 'reps')}
            badge={record && <GradientPill>Ny rekord</GradientPill>}
          />
          <ExerciseIllustration
            id={exercise.id}
            name={label}
            size={showTitle ? 'sm' : 'md'}
            details={
              <div className="flex flex-col gap-1 px-1">
                <p className="num text-body">{meta}</p>
                {(dose.tempo || dose.note) && <p className="text-secondary">{[dose.tempo, dose.note].filter(Boolean).join(' · ')}</p>}
                {resolved.planned.cue && !useAlt && <p className="text-secondary text-ink-2">{resolved.planned.cue}</p>}
              </div>
            }
          />
        </div>
        {last && (
          <p className="num mt-2 text-secondary">
            <span className="font-semibold">Sidst{record ? ` ${formatShort(last.workout.date)}` : ''}:</span>{' '}
            {[summarizeSets(last.sets, exercise.kind), last.rpe != null && `RPE ${formatDecimal(last.rpe)}`].filter(Boolean).join(' · ')}
          </p>
        )}
        <p className={`num ${last ? 'mt-0.5' : 'mt-2'} text-secondary text-ink-2`}>{meta}</p>
        {(dose.tempo || dose.note) && <p className="mt-0.5 text-secondary">{[dose.tempo, dose.note].filter(Boolean).join(' · ')}</p>}
        {!useAlt && resolved.planned.cue && <p className="mt-0.5 text-secondary text-ink-2">{resolved.planned.cue}</p>}
        {last?.note && <p className="mt-0.5 text-secondary text-ink-2">Sidst: “{last.note}”</p>}
        {ready && (
          <p className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-footnote font-semibold">
            <ArrowUp size={14} weight="bold" className="text-status-green" aria-hidden="true" /> Klar til mere vægt
          </p>
        )}
        {alt && (
          <SmallButton onClick={() => setUseAlt((u) => !u)} aria-pressed={useAlt} className="mt-3 h-auto py-2 text-left">
            {useAlt ? `Tilbage til ${resolved.label}` : `Alternativ: ${alt.label ?? altExercise?.name} — ${alt.condition.toLowerCase()}`}
          </SmallButton>
        )}
      </div>

      {exercise.perSide && (
        <div className="mb-2 px-1">
          <Switch
            label="Forskellig vægt eller reps pr. side"
            checked={perSide}
            onChange={(on) => {
              setPerSidePref(on);
              setPicked(null);
            }}
          />
        </div>
      )}

      <InsetList label={`Sæt, ${label}`}>
        {rounds.map((round, i) => {
          const row = round.rows.length > 1 ? { ...round.rows[0], side: null } : round.rows[0];
          const write = (patch: Parameters<typeof upsertSet>[1]) => {
            for (const r of round.rows) void upsertSet(key(r.side, r.setNo), patch);
          };
          return (
            <SetRow
              key={`${exercise.id}-${perSide ? 'side' : 'runde'}-${row.side}-${row.setNo}`}
              row={{ ...row, optional: round.optional }}
              kind={exercise.kind}
              step={weightStep(exercise)}
              log={roundLog(round)}
              ghost={ghostFor(last, round.rows[0].side, round.setNo)}
              active={i === active}
              targetText={round.rows.length > 1 ? roundTarget(round, exercise.kind) : undefined}
              previous={previousSet(last, round.rows.map((r) => r.side), round.setNo, exercise.kind)}
              onActivate={() => setPicked(i)}
              onPatch={write}
              onDone={(done, values) => {
                write({ ...values, done });
                if (picked === i) setPicked(null);
                if (!done) return;
                // Pr. side: ingen pause mellem siderne i samme sæt. Runder: pause efter hver runde.
                const rest = perSide || !exercise.perSide ? restAfter(rows, rows.indexOf(round.rows[0]), dose, { supersetFirst }) : supersetFirst ? 0 : dose.restSec;
                if (rest > 0) startTimer(rest, label, workoutUuid);
              }}
            />
          );
        })}
      </InsetList>

      <div className="mt-2 flex items-center gap-1 px-1">
        <TextButton onClick={() => void addSet()} className="gap-1 text-ink">
          <Plus size={16} weight="bold" aria-hidden="true" /> Tilføj sæt
        </TextButton>
        {extraRows.length > 0 && (
          <TextButton onClick={() => void removeSet()} className="gap-1">
            <Minus size={16} weight="bold" aria-hidden="true" /> Fjern ekstra sæt
          </TextButton>
        )}
      </div>

      <SecondaryButton onClick={sameAsLast} disabled={!canCopy} className="mt-2">
        Samme som sidst
      </SecondaryButton>

      <div className="mt-6 flex flex-col gap-4 px-1">
        <RpePicker label="RPE for øvelsen" target={intensity} value={note?.rpe ?? null} onChange={(rpe) => void upsertExerciseNote(workoutUuid, exercise.id, { rpe })} />
        <NoteField label="Note til øvelsen" value={note?.note ?? null} onSave={(v) => void upsertExerciseNote(workoutUuid, exercise.id, { note: v })} />
        {onRemove && (
          <TextButton danger onClick={onRemove} className="self-start">
            Fjern øvelsen fra træningen
          </TextButton>
        )}
      </div>
    </article>
  );
}
