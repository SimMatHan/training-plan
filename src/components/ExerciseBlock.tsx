import { useState } from 'react';
import type { Plan } from '../../shared/plan.schema';
import { findPlannedDose, readyForMoreWeight } from '../../shared/progression';
import type { ExerciseNote, SetLog } from '../../shared/records.schema';
import { formatDose, formatIntensity, formatRange, getExercise, setRows, type ResolvedExercise } from '../../shared/resolve';
import { startTimer } from '../data/timer';
import { upsertExerciseNote, upsertSet, useLastTime } from '../data/workouts';
import { formatShort } from '../lib/dates';
import { ghostFor, summarizeSets } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { restAfter } from '../logic/rest';
import { NoteField } from './NoteField';
import { RpePicker } from './RpePicker';
import { setGridCols, SetRowView } from './SetRowView';

export function ExerciseBlock({
  plan,
  workoutUuid,
  resolved,
  sets,
  notes,
  supersetFirst,
  hideTitle = false,
}: {
  plan: Plan;
  workoutUuid: string;
  resolved: ResolvedExercise;
  sets: SetLog[];
  notes: ExerciseNote[];
  supersetFirst: boolean;
  /** Skjul navnet, når sektionens overskrift allerede viser det. */
  hideTitle?: boolean;
}) {
  const alt = resolved.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  const [useAlt, setUseAlt] = useState(() => !!alt && sets.some((s) => s.exercise_id === alt.exerciseId));

  const exercise = useAlt && altExercise ? altExercise : resolved.exercise;
  const dose = useAlt && alt ? alt.dose : resolved.planned.dose;
  const label = useAlt && alt ? (alt.label ?? altExercise!.name) : resolved.label;
  const rows = useAlt ? setRows(exercise, dose) : resolved.rows;
  const mine = sets.filter((s) => s.exercise_id === exercise.id);
  const note = notes.find((n) => n.exercise_id === exercise.id);
  const last = useLastTime(exercise.id, workoutUuid);

  const logFor = (side: string | null, setNo: number) => mine.find((s) => s.side === side && s.set_no === setNo);
  const key = (side: SetLog['side'], setNo: number) => ({ workoutUuid, exerciseId: exercise.id, side, setNo });

  // "Klar til mere vægt": sidste gang ramte alle sæt toppen af intervallet ved RPE ≤ planens mål.
  const lastPlan = last && findPlannedDose(plan, last.workout.planned_session_id, last.workout.week_no, exercise.id);
  const ready = !!last && !!lastPlan && readyForMoreWeight(lastPlan.exercise, lastPlan.dose, last.sets, last.rpe);

  const meta = [formatDose(exercise, dose), formatIntensity(dose), `pause ${dose.restSec} s`].filter(Boolean).join(' · ');
  const intensity = dose.intensity?.kind === 'rpe' ? formatRange(dose.intensity) : undefined;

  return (
    <article className={hideTitle ? 'pb-5' : 'py-5'}>
      <header className="mb-3">
        {(!hideTitle || useAlt) && <h3 className="text-2xl">{label}</h3>}
        <p className="num mt-1 text-base font-medium">{meta}</p>
        {(dose.tempo || dose.note) && <p className="mt-0.5 text-sm">{[dose.tempo, dose.note].filter(Boolean).join(' · ')}</p>}
        {!useAlt && resolved.planned.cue && <p className="mt-1 text-sm text-muted">{resolved.planned.cue}</p>}
        {alt && (
          <button
            type="button"
            onClick={() => setUseAlt((u) => !u)}
            aria-pressed={useAlt}
            className="mt-2 min-h-12 rounded-lg border border-line px-3 text-left text-sm"
          >
            {useAlt ? `Tilbage til ${resolved.label}` : `Alternativ: ${alt.label ?? altExercise?.name} — ${alt.condition.toLowerCase()}`}
          </button>
        )}
      </header>

      {ready && (
        <p className="mb-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border-2 border-mob px-3 text-sm font-semibold text-mob-ink">
          <span aria-hidden="true">↑</span> Klar til mere vægt
        </p>
      )}
      <div className="mb-3 rounded-lg bg-surface px-3 py-2 text-sm">
        {last ? (
          <>
            <p>
              <span className="text-muted">Sidst: {formatShort(last.workout.date)} — </span>
              <span className="num font-medium">
                {summarizeSets(last.sets, exercise.kind)}
                {last.rpe != null && `, RPE ${formatDecimal(last.rpe)}`}
              </span>
            </p>
            {last.note && <p className="mt-0.5 text-muted">“{last.note}”</p>}
          </>
        ) : (
          <p className="text-muted">Første gang med denne øvelse.</p>
        )}
      </div>

      <div className={`mb-1 grid gap-2 px-0.5 text-xs text-muted ${setGridCols(exercise.kind)}`} aria-hidden="true">
        <span className="text-center">Sæt</span>
        {exercise.kind === 'weight_reps' && <span className="text-center">kg</span>}
        <span className="text-center">{exercise.kind === 'time' ? 'sek' : 'reps'}</span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <SetRowView
            key={`${exercise.id}-${row.side}-${row.setNo}`}
            row={row}
            kind={exercise.kind}
            log={logFor(row.side, row.setNo)}
            ghost={ghostFor(last, row.side, row.setNo)}
            onPatch={(p) => void upsertSet(key(row.side, row.setNo), p)}
            onToggleDone={(done) => {
              void upsertSet(key(row.side, row.setNo), { done });
              if (!done) return;
              const rest = restAfter(rows, i, dose, { supersetFirst });
              if (rest > 0) startTimer(rest, label, workoutUuid);
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <RpePicker
          label="RPE for øvelsen"
          target={intensity}
          value={note?.rpe ?? null}
          onChange={(rpe) => void upsertExerciseNote(workoutUuid, exercise.id, { rpe })}
        />
        <NoteField label="Note til øvelsen" value={note?.note ?? null} onSave={(v) => void upsertExerciseNote(workoutUuid, exercise.id, { note: v })} />
      </div>
    </article>
  );
}
