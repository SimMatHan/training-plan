import { ArrowUp, ChartLineUp, Copy, DotsThreeVertical, Minus, NotePencil, Plus, Swap, Timer, Trash } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { Exercise, Plan } from '../../shared/plan.schema';
import { findPlannedDose, readyForMoreWeight } from '../../shared/progression';
import type { ExerciseNote, SetLog } from '../../shared/records.schema';
import { formatDose, formatIntensity, formatRange, getExercise, setRows, type ResolvedExercise } from '../../shared/resolve';
import { useExerciseHistory } from '../data/history';
import { startTimer } from '../data/timer';
import { deleteRecord } from '../data/records';
import { upsertExerciseNote, upsertSet, useLastTime } from '../data/workouts';
import { extraSetRows, firstSkipped, keptRows, nextSetNo, sidesOf } from '../logic/extras';
import { ghostFor, previousSet } from '../logic/lastTime';
import { formatDecimal } from '../logic/numbers';
import { restAfter } from '../logic/rest';
import { bestScore, setScore } from '../logic/wheel';
import { GradientPill } from '../ui/HeroNumber';
import { NoteField } from './NoteField';
import { ExerciseIllustration } from './ExerciseIllustration';
import { RpePicker } from './RpePicker';
import { usePerSidePref } from '../data/sidePrefs';
import { sidesDiffer, toRounds, type Round } from '../logic/rounds';
import { Switch } from '../ui/Field';
import { InsetList, InsetRow } from '../ui/InsetList';
import { Sheet } from '../ui/Sheet';
import { fieldsOf, gridOf, SetRow } from './SetRow';

/** "1:30", "45 s". */
const restText = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`);

const COLUMN: Record<ReturnType<typeof fieldsOf>[number], string> = { weight_kg: 'kg', reps: 'reps', seconds: 'sek' };

/** Lille pille under øvelsens navn: pause, note, RPE. */
function Chip({ icon, children, onClick, pressed }: { icon: ReactNode; children: ReactNode; onClick?: () => void; pressed?: boolean }) {
  const look = 'inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-secondary font-medium whitespace-nowrap';
  if (!onClick)
    return (
      <span className={`${look} bg-fill text-ink-2`}>
        {icon}
        {children}
      </span>
    );
  return (
    <button type="button" onClick={onClick} aria-expanded={pressed} className={`${look} transition-colors duration-150 ${pressed ? 'bg-ink text-surface' : 'bg-fill text-ink'}`}>
      {icon}
      {children}
    </button>
  );
}

/**
 * Én øvelse i logningen, som hos Hevy: figur og navn, pause/note/RPE som piller, og sættene som
 * en tabel (sæt · sidst · kg · reps · ✓) med "Fjern sæt" og "Tilføj sæt" under. Resten (samme
 * som sidst, alternativ, pr. side, fjern) ligger i ⋯-menuen. Slår et sæt rekorden, vises "Ny rekord".
 */
export function ExerciseBlock({
  plan,
  workoutUuid,
  resolved,
  sets,
  notes,
  supersetFirst,
  onRemove,
}: {
  plan: Plan;
  workoutUuid: string;
  resolved: ResolvedExercise;
  sets: SetLog[];
  notes: ExerciseNote[];
  supersetFirst: boolean;
  /** En øvelse ud over planen: fjerner den fra træningen. */
  onRemove?: () => void;
}) {
  const alt = resolved.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  const [useAlt, setUseAlt] = useState(() => !!alt && sets.some((s) => s.exercise_id === alt.exerciseId));
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<'note' | 'rpe' | null>(null);

  const exercise: Exercise = useAlt && altExercise ? altExercise : resolved.exercise;
  const dose = useAlt && alt ? alt.dose : resolved.planned.dose;
  const label = useAlt && alt ? (alt.label ?? altExercise!.name) : resolved.label;
  const plannedRows = useAlt ? setRows(exercise, dose) : resolved.rows;
  const mine = sets.filter((s) => s.exercise_id === exercise.id);
  // Planens sæt (uden dem, der er fjernet) og de sæt, der er tilføjet ud over planen i denne træning.
  const keptPlanned = keptRows(plannedRows, mine, exercise.id);
  const extraRows = extraSetRows(plannedRows, mine, exercise, dose);
  const rows = [...keptPlanned, ...extraRows];
  const setNos = [...new Set(rows.map((r) => r.setNo))];
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

  // "Klar til mere vægt": sidste gang ramte alle sæt toppen af intervallet ved RPE ≤ planens mål.
  const lastPlan = last && findPlannedDose(plan, last.workout.planned_session_id, last.workout.week_no, exercise.id);
  const ready = !!last && !!lastPlan && readyForMoreWeight(lastPlan.exercise, lastPlan.dose, last.sets, last.rpe);

  // Ny rekord: et færdigt sæt i dag slår alle tidligere sæt (vægt × reps, ellers reps/sekunder).
  const doneToday = mine.filter((s) => s.done);
  const before = bestScore((history ?? []).filter((e) => e.workoutUuid !== workoutUuid).flatMap((e) => e.sets), exercise.kind);
  const record = before != null && before > 0 && doneToday.some((s) => setScore(s, exercise.kind) > before);

  const meta = [formatDose(exercise, dose), formatIntensity(dose)].filter(Boolean).join(' · ');
  const intensity = dose.intensity?.kind === 'rpe' ? formatRange(dose.intensity) : undefined;
  const canCopy = !!last && keptPlanned.some((r) => !logFor(r.side, r.setNo)?.done && ghostFor(last, r.side, r.setNo));
  const fields = fieldsOf(exercise.kind);

  /** Et sæt mere: et fjernet sæt fra planen kommer tilbage, ellers et tomt sæt ud over planen. */
  async function addSet() {
    const skipped = firstSkipped(plannedRows, mine, exercise.id);
    if (skipped != null) {
      const back = plannedRows.filter((r) => r.setNo === skipped);
      await Promise.all(back.map((r) => upsertSet(key(r.side, r.setNo), { skipped: false })));
      return;
    }
    const setNo = nextSetNo(plannedRows, mine, exercise.id);
    await Promise.all(sidesOf(exercise, dose).map((side) => upsertSet(key(side, setNo), { done: false, weight_kg: null, reps: null, seconds: null })));
  }

  /** Fjerner det sidste sæt (begge sider): et ekstra sæt slettes, et af planens markeres som fjernet. Ét sæt bliver altid. */
  async function removeSet() {
    const setNo = setNos.at(-1);
    if (setNo == null || setNos.length < 2) return;
    const logs = mine.filter((s) => s.set_no === setNo && !s.deleted_at);
    if (logs.some((s) => s.done) && !confirm(`Fjerne sæt ${setNo}? Det er logget.`)) return;
    if (extraRows.some((r) => r.setNo === setNo)) {
      await Promise.all(logs.map((s) => deleteRecord('set_logs', s.uuid)));
      return;
    }
    const gone = keptPlanned.filter((r) => r.setNo === setNo);
    await Promise.all(gone.map((r) => upsertSet(key(r.side, r.setNo), { skipped: true, done: false, weight_kg: null, reps: null, seconds: null })));
  }

  /** Alle ufærdige sæt som sidst, markeret færdige. */
  function sameAsLast() {
    for (const r of keptPlanned) {
      const g = ghostFor(last, r.side, r.setNo);
      if (!g || logFor(r.side, r.setNo)?.done || r.optional) continue;
      void upsertSet(key(r.side, r.setNo), { weight_kg: g.weight_kg, reps: g.reps, seconds: g.seconds, done: true });
    }
  }

  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <article aria-label={label} className="overflow-hidden rounded-card bg-surface">
      <div className="px-3 pt-3">
        <div className="flex items-center gap-3">
          <ExerciseIllustration
            id={exercise.id}
            name={label}
            size="sm"
            details={
              <div className="flex flex-col gap-1 px-1">
                <p className="num text-body">{[meta, `pause ${dose.restSec} s`].filter(Boolean).join(' · ')}</p>
                {(dose.tempo || dose.note) && <p className="text-secondary">{[dose.tempo, dose.note].filter(Boolean).join(' · ')}</p>}
                {resolved.planned.cue && !useAlt && <p className="text-secondary text-ink-2">{resolved.planned.cue}</p>}
              </div>
            }
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-headline">
              <Link href={`/historik/oevelse/${encodeURIComponent(exercise.id)}`} className="text-brand-red">
                {label}
              </Link>
            </h2>
            <p className="num text-footnote text-ink-2">{meta}</p>
          </div>
          <button type="button" onClick={() => setMenu(true)} aria-label={`Mere for ${label}`} className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-ink">
            <DotsThreeVertical size={24} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {(record || ready || (resolved.planned.cue && !useAlt) || dose.tempo || dose.note || last?.note) && (
          <div className="mt-2 flex flex-col gap-1">
            {(record || ready) && (
              <p className="flex flex-wrap items-center gap-2">
                {record && <GradientPill>Ny rekord</GradientPill>}
                {ready && (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fill px-3 text-footnote font-semibold">
                    <ArrowUp size={14} weight="bold" className="text-status-green" aria-hidden="true" /> Klar til mere vægt
                  </span>
                )}
              </p>
            )}
            {(dose.tempo || dose.note) && <p className="text-footnote">{[dose.tempo, dose.note].filter(Boolean).join(' · ')}</p>}
            {!useAlt && resolved.planned.cue && <p className="text-footnote text-ink-2">{resolved.planned.cue}</p>}
            {last?.note && <p className="text-footnote text-ink-2">Sidst: “{last.note}”</p>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip icon={<Timer size={18} aria-hidden="true" />}>Pause {restText(dose.restSec)}</Chip>
          <Chip icon={<NotePencil size={18} aria-hidden="true" />} pressed={open === 'note'} onClick={() => setOpen((o) => (o === 'note' ? null : 'note'))}>
            {note?.note ? 'Note ✓' : 'Note'}
          </Chip>
          <Chip pressed={open === 'rpe'} onClick={() => setOpen((o) => (o === 'rpe' ? null : 'rpe'))} icon={null}>
            <span className="num">RPE{note?.rpe != null ? ` ${formatDecimal(note.rpe)}` : intensity ? ` · mål ${intensity}` : ''}</span>
          </Chip>
        </div>
        {open === 'note' && (
          <div className="mt-3">
            <NoteField label="Note til øvelsen" value={note?.note ?? null} onSave={(v) => void upsertExerciseNote(workoutUuid, exercise.id, { note: v })} />
          </div>
        )}
        {open !== 'note' && note?.note && <p className="mt-2 text-footnote text-ink-2">“{note.note}”</p>}
        {open === 'rpe' && (
          <div className="mt-3">
            <RpePicker
              label="RPE for øvelsen"
              target={intensity}
              value={note?.rpe ?? null}
              onChange={(rpe) => {
                void upsertExerciseNote(workoutUuid, exercise.id, { rpe });
                if (rpe != null) setOpen(null);
              }}
            />
          </div>
        )}
      </div>

      <div aria-hidden="true" className={`mt-3 grid ${gridOf(exercise.kind)} gap-x-2 px-3 pb-1 text-caption font-semibold tracking-wide text-ink-2 uppercase`}>
        <span className="text-center">Sæt</span>
        <span>Sidst</span>
        {fields.map((f) => (
          <span key={f} className="text-center">
            {COLUMN[f]}
          </span>
        ))}
        <span className="text-center">✓</span>
      </div>
      <ul aria-label={`Sæt, ${label}`}>
        {rounds.map((round) => {
          const row = round.rows.length > 1 ? { ...round.rows[0], side: null } : round.rows[0];
          const write = (patch: Parameters<typeof upsertSet>[1]) => {
            for (const r of round.rows) void upsertSet(key(r.side, r.setNo), patch);
          };
          return (
            <SetRow
              key={`${exercise.id}-${perSide ? 'side' : 'runde'}-${row.side}-${row.setNo}`}
              row={{ ...row, optional: round.optional }}
              kind={exercise.kind}
              log={roundLog(round)}
              ghost={ghostFor(last, round.rows[0].side, round.setNo)}
              previous={previousSet(last, round.rows.map((r) => r.side), round.setNo, exercise.kind)}
              onPatch={write}
              onDone={(done, values) => {
                write({ ...values, done });
                if (!done) return;
                // Pr. side: ingen pause mellem siderne i samme sæt. Runder: pause efter hver runde.
                const rest = perSide || !exercise.perSide ? restAfter(rows, rows.indexOf(round.rows[0]), dose, { supersetFirst }) : supersetFirst ? 0 : dose.restSec;
                if (rest > 0) startTimer(rest, label, workoutUuid);
              }}
            />
          );
        })}
      </ul>

      <div className="flex gap-2 p-3">
        <button
          type="button"
          onClick={() => void removeSet()}
          disabled={setNos.length < 2}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-fill text-body font-semibold text-ink transition-transform duration-150 ease-ios active:scale-[.98] disabled:opacity-40"
        >
          <Minus size={18} weight="bold" aria-hidden="true" /> Fjern sæt
        </button>
        <button
          type="button"
          onClick={() => void addSet()}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-fill text-body font-semibold text-ink transition-transform duration-150 ease-ios active:scale-[.98]"
        >
          <Plus size={18} weight="bold" aria-hidden="true" /> Tilføj sæt
        </button>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={label}>
        {exercise.perSide && (
          <div className="mb-4 rounded-card bg-bg px-4">
            <Switch label="Forskellig vægt eller reps pr. side" checked={perSide} onChange={(on) => setPerSidePref(on)} />
          </div>
        )}
        <InsetList className="mb-2" inset={52}>
          <InsetRow onClick={canCopy ? act(sameAsLast) : undefined} chevron={false} className={canCopy ? '' : 'opacity-40'}>
            <Copy size={22} className="shrink-0 text-ink-2" aria-hidden="true" />
            <span className="flex-1 text-row">Samme som sidst</span>
          </InsetRow>
          {alt && (
            <InsetRow onClick={act(() => setUseAlt((u) => !u))} chevron={false}>
              <Swap size={22} className="shrink-0 text-ink-2" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-row">{useAlt ? `Tilbage til ${resolved.label}` : `Alternativ: ${alt.label ?? altExercise?.name}`}</span>
                {!useAlt && <span className="block text-secondary text-ink-2">{alt.condition}</span>}
              </span>
            </InsetRow>
          )}
          <InsetRow href={`/historik/oevelse/${encodeURIComponent(exercise.id)}`} chevron={false}>
            <ChartLineUp size={22} className="shrink-0 text-ink-2" aria-hidden="true" />
            <span className="flex-1 text-row">Se historik</span>
          </InsetRow>
          {onRemove && (
            <InsetRow onClick={act(onRemove)} chevron={false}>
              <Trash size={22} className="shrink-0 text-danger" aria-hidden="true" />
              <span className="flex-1 text-row text-danger">Fjern øvelsen fra træningen</span>
            </InsetRow>
          )}
        </InsetList>
      </Sheet>
    </article>
  );
}
