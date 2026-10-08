import { ArrowUp } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Exercise, Plan } from '../../shared/plan.schema';
import { findPlannedDose, readyForMoreWeight } from '../../shared/progression';
import type { ExerciseNote, SetLog } from '../../shared/records.schema';
import { formatDose, formatIntensity, formatRange, getExercise, setRows, type ResolvedExercise } from '../../shared/resolve';
import { useExerciseHistory } from '../data/history';
import { startTimer } from '../data/timer';
import { upsertExerciseNote, upsertSet, useLastTime } from '../data/workouts';
import { formatShort } from '../lib/dates';
import { ghostFor } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { restAfter } from '../logic/rest';
import { bestScore, setScore, weightStep } from '../logic/wheel';
import { SecondaryButton, SmallButton } from '../ui/Button';
import { GradientPill, HeroNumber } from '../ui/HeroNumber';
import { InsetList } from '../ui/InsetList';
import { NoteField } from './NoteField';
import { RpePicker } from './RpePicker';
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
 * Én øvelse i logningen: sidste gangs tal som heltetal, sættene med talhjul, "Samme som sidst"
 * og RPE/note. Slår et sæt rekorden (vægt × reps), ruller heltetallet til det nye tal.
 */
export function ExerciseBlock({
  plan,
  workoutUuid,
  resolved,
  sets,
  notes,
  supersetFirst,
  showTitle = false,
}: {
  plan: Plan;
  workoutUuid: string;
  resolved: ResolvedExercise;
  sets: SetLog[];
  notes: ExerciseNote[];
  supersetFirst: boolean;
  /** Vis navnet (superset: to øvelser på samme trin). */
  showTitle?: boolean;
}) {
  const alt = resolved.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  const [useAlt, setUseAlt] = useState(() => !!alt && sets.some((s) => s.exercise_id === alt.exerciseId));
  const [picked, setPicked] = useState<number | null>(null);

  const exercise = useAlt && altExercise ? altExercise : resolved.exercise;
  const dose = useAlt && alt ? alt.dose : resolved.planned.dose;
  const label = useAlt && alt ? (alt.label ?? altExercise!.name) : resolved.label;
  const rows = useAlt ? setRows(exercise, dose) : resolved.rows;
  const mine = sets.filter((s) => s.exercise_id === exercise.id);
  const note = notes.find((n) => n.exercise_id === exercise.id);
  const last = useLastTime(exercise.id, workoutUuid);
  const history = useExerciseHistory(exercise.id);

  const logFor = (side: string | null, setNo: number) => mine.find((s) => s.side === side && s.set_no === setNo);
  const key = (side: SetLog['side'], setNo: number) => ({ workoutUuid, exerciseId: exercise.id, side, setNo });
  const firstOpen = rows.findIndex((r) => !logFor(r.side, r.setNo)?.done);
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
  const canCopy = !!last && rows.some((r) => !logFor(r.side, r.setNo)?.done && ghostFor(last, r.side, r.setNo));

  /** Alle ufærdige sæt som sidst, markeret færdige. */
  function sameAsLast() {
    for (const r of rows) {
      const g = ghostFor(last, r.side, r.setNo);
      if (!g || logFor(r.side, r.setNo)?.done || r.optional) continue;
      void upsertSet(key(r.side, r.setNo), { weight_kg: g.weight_kg, reps: g.reps, seconds: g.seconds, done: true });
    }
    setPicked(null);
  }

  return (
    <article className="mb-8">
      {showTitle && <h2 className="mb-2 text-title">{label}</h2>}
      <div className="mb-4 px-1">
        <HeroNumber
          size={showTitle ? 'md' : 'lg'}
          label={record ? 'I dag' : last ? `Sidst ${formatShort(last.workout.date)}` : 'Første gang · mål'}
          value={hero?.value ?? (target || '–')}
          unit={hero?.unit ?? (exercise.kind === 'time' ? 'sek' : 'reps')}
          badge={record && <GradientPill>Ny rekord</GradientPill>}
        />
        <p className="num mt-2 text-secondary text-ink-2">{meta}</p>
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

      <InsetList label={`Sæt, ${label}`}>
        {rows.map((row, i) => (
          <SetRow
            key={`${exercise.id}-${row.side}-${row.setNo}`}
            row={row}
            kind={exercise.kind}
            step={weightStep(exercise)}
            log={logFor(row.side, row.setNo)}
            ghost={ghostFor(last, row.side, row.setNo)}
            active={i === active}
            onActivate={() => setPicked(i)}
            onPatch={(p) => void upsertSet(key(row.side, row.setNo), p)}
            onDone={(done, values) => {
              void upsertSet(key(row.side, row.setNo), { ...values, done });
              if (picked === i) setPicked(null);
              if (!done) return;
              const rest = restAfter(rows, i, dose, { supersetFirst });
              if (rest > 0) startTimer(rest, label, workoutUuid);
            }}
          />
        ))}
      </InsetList>

      <SecondaryButton onClick={sameAsLast} disabled={!canCopy} className="mt-3">
        Samme som sidst
      </SecondaryButton>

      <div className="mt-6 flex flex-col gap-4 px-1">
        <RpePicker label="RPE for øvelsen" target={intensity} value={note?.rpe ?? null} onChange={(rpe) => void upsertExerciseNote(workoutUuid, exercise.id, { rpe })} />
        <NoteField label="Note til øvelsen" value={note?.note ?? null} onSave={(v) => void upsertExerciseNote(workoutUuid, exercise.id, { note: v })} />
      </div>
    </article>
  );
}
