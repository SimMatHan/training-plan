import { Check, PencilSimple } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { Plan, Session } from '../../shared/plan.schema';
import type { MobilityCheck, SetLog } from '../../shared/records.schema';
import { formatDose, formatIntensity, getExercise, resolveStrengthSession, setRows, type ResolvedExercise, type ResolvedSlot } from '../../shared/resolve';
import { useLastEntries } from '../data/history';
import { formatShort } from '../lib/dates';
import { summarizeSets } from '../logic/lastTime';
import { EXTRA_STEP, keptRows } from '../logic/extras';
import { toRounds } from '../logic/rounds';
import { illustrationFor } from '../logic/illustrations';
import { ButtonLink } from '../ui/Button';
import { Figure } from '../ui/Figure';
import { IconTile } from '../ui/IconTile';
import { InsetList, InsetRow } from '../ui/InsetList';
import { Muted } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';

/** Trin-id'er i logningen ud over pladserne. */
export const STEP_MOBILITY = 'mobilitet';
export const STEP_FINISH = 'afslut';

/** "ca. 40 min" fra planens interval (midten, rundet til 5). */
export const aboutMinutes = (d: Session['durationMin']) => (d ? `ca. ${Math.round((d.min + d.max) / 2 / 5) * 5} min` : undefined);

interface Progress {
  done: number;
  total: number;
}

/** Øvelsen der faktisk logges: alternativet, hvis det er brugt i dag. Fjernede sæt er ikke med. */
function inUse(plan: Plan, ex: ResolvedExercise, sets: SetLog[]) {
  const alt = ex.planned.alternative;
  const altExercise = alt && getExercise(plan, alt.exerciseId);
  if (alt && altExercise && sets.some((s) => s.exercise_id === alt.exerciseId)) {
    return { exercise: altExercise, dose: alt.dose, label: alt.label ?? altExercise.name, rows: keptRows(setRows(altExercise, alt.dose), sets, altExercise.id) };
  }
  return { exercise: ex.exercise, dose: ex.planned.dose, label: ex.label, rows: keptRows(ex.rows, sets, ex.exercise.id) };
}

/** Færdige runder (begge sider af et sæt) ud af de planlagte, uden valgfrie. */
function roundProgress(rows: ReturnType<typeof setRows>, exerciseId: string, sets: SetLog[]): Progress {
  const rounds = toRounds(rows).filter((r) => !r.optional);
  const done = rounds.filter((r) => r.rows.every((row) => sets.some((s) => s.exercise_id === exerciseId && s.side === row.side && s.set_no === row.setNo && s.done)));
  return { done: done.length, total: rounds.length };
}

function ProgressMark({ p }: { p: Progress }) {
  if (p.total > 0 && p.done >= p.total)
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-status-green text-on-brand" title="Færdig">
        <Check size={16} weight="bold" aria-hidden="true" />
        <span className="sr-only">Færdig</span>
      </span>
    );
  return (
    <span className="num shrink-0 text-secondary text-ink-2">
      {p.done}/{p.total}
      <span className="sr-only"> sæt</span>
    </span>
  );
}

/**
 * Hele træningen på én skærm: mobilitet og alle øvelser med figur, dosering, sidste gang og
 * hvad der er nået i dag. I logningen springer et tryk på en række til øvelsen.
 */
export function SessionOverview({
  open,
  onClose,
  plan,
  session,
  weekNo,
  workoutUuid,
  sets = [],
  mobilityChecks = [],
  current,
  onPick,
  footer,
  extraSlots = [],
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  session: Session;
  weekNo: number;
  /** Dagens træning, hvis den er startet: viser fremskridt og udelader den fra "sidst". */
  workoutUuid?: string;
  sets?: SetLog[];
  mobilityChecks?: Pick<MobilityCheck, 'item_id' | 'done'>[];
  /** Det trin, logningen står på. */
  current?: string;
  /** Spring til et trin (kun i logningen). */
  onPick?: (step: string) => void;
  footer?: ReactNode;
  /** Øvelser ud over planen i dagens træning. */
  extraSlots?: ResolvedSlot[];
}) {
  const [location] = useLocation();
  const strength = session.kind === 'styrke' ? resolveStrengthSession(plan, session.id, weekNo) : undefined;
  const slots = [...(strength?.slots ?? []), ...extraSlots];
  const showMobility = !!plan.mobility && (session.kind === 'mobilitet' || (session.kind === 'styrke' && session.mobility === 'before'));
  const exercises = slots.flatMap((s) => s.exercises.map((ex) => inUse(plan, ex, sets)));
  const last = useLastEntries(
    exercises.map((e) => e.exercise.id),
    workoutUuid,
  );

  const slotProgress = slots.map((slot) =>
    slot.exercises
      .map((ex) => inUse(plan, ex, sets))
      .reduce<Progress>(
        (acc, e) => {
          const p = roundProgress(e.rows, e.exercise.id, sets);
          return { done: acc.done + p.done, total: acc.total + p.total };
        },
        { done: 0, total: 0 },
      ),
  );
  const total = slotProgress.reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
  const mobilityDone = new Set(mobilityChecks.filter((c) => c.done).map((c) => c.item_id));
  const mobilityProgress: Progress = { done: plan.mobility?.items.filter((i) => mobilityDone.has(i.id)).length ?? 0, total: plan.mobility?.items.length ?? 0 };
  const pick = (step: string) => (onPick ? () => onPick(step) : undefined);
  const now = (step: string) => current === step && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-footnote font-semibold text-ink">Nu</span>;

  const summary = [
    slots.length ? `${exercises.length} øvelser${showMobility ? ' + mobilitet' : ''}` : showMobility ? 'Mobilitet' : undefined,
    total.total ? `${total.total} sæt` : undefined,
    aboutMinutes(session.durationMin),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet open={open} onClose={onClose} title="Hele træningen">
      <p className="text-headline">{session.name}</p>
      <Muted className="mb-1">
        Uge {weekNo} · {summary}
      </Muted>
      {workoutUuid && total.total > 0 && (
        <p className="num mb-4 text-secondary">
          {total.done} af {total.total} sæt lavet
        </p>
      )}
      {!workoutUuid && <div className="mb-4" />}

      <InsetList inset={84} className="mb-4">
        {showMobility && plan.mobility && (
          <InsetRow onClick={pick(STEP_MOBILITY)} chevron={false} current={current === STEP_MOBILITY}>
            <span className="grid w-14 shrink-0 place-items-center">
              <IconTile category="mobility" size={40} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-row">{plan.mobility.name}</span>
              <span className="num block text-secondary text-ink-2">
                {plan.mobility.items.length} øvelser
                {plan.mobility.durationMin && ` · ${plan.mobility.durationMin.min}–${plan.mobility.durationMin.max} min`}
              </span>
            </span>
            {now(STEP_MOBILITY)}
            {workoutUuid && <ProgressMark p={mobilityProgress} />}
          </InsetRow>
        )}

        {slots.map((slot, si) =>
          slot.exercises.map((ex, ei) => {
            const e = inUse(plan, ex, sets);
            const ill = illustrationFor(e.exercise.id, e.exercise.name);
            const prev = last?.get(e.exercise.id);
            const today = sets.filter((s) => s.exercise_id === e.exercise.id && s.done);
            const meta = [formatDose(e.exercise, e.dose), formatIntensity(e.dose), `pause ${e.dose.restSec} s`].filter(Boolean).join(' · ');
            return (
              <InsetRow key={`${slot.slotId}-${ex.exercise.id}`} onClick={pick(slot.slotId)} chevron={false} current={current === slot.slotId} className="items-start!">
                <span className="w-14 shrink-0 rounded-[10px] bg-bg p-0.5">
                  {ill ? <Figure illustration={ill} label="" className="block h-auto w-full" /> : <span className="block aspect-[5/4]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-row">
                    <span className="num text-ink-2">{si + 1}.</span> {e.label}
                    {slot.superset && <span className="text-secondary text-ink-2"> · superset {ei === 0 ? 'a' : 'b'}</span>}
                    {slot.slotId.startsWith(EXTRA_STEP) && <span className="text-secondary text-ink-2"> · ekstra</span>}
                  </span>
                  <span className="num block text-secondary text-ink-2">{meta}</span>
                  {prev && (
                    <span className="num block text-footnote text-ink-2">
                      Sidst {formatShort(prev.date)}: {summarizeSets(prev.sets, e.exercise.kind)}
                    </span>
                  )}
                  {today.length > 0 && <span className="num block text-footnote text-ink">I dag: {summarizeSets(today, e.exercise.kind)}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                  {ei === 0 && now(slot.slotId)}
                  {workoutUuid && ei === slot.exercises.length - 1 && <ProgressMark p={slotProgress[si]} />}
                </span>
              </InsetRow>
            );
          }),
        )}

        {onPick && (
          <InsetRow onClick={pick(STEP_FINISH)} chevron={false} current={current === STEP_FINISH}>
            <span className="grid w-14 shrink-0 place-items-center">
              <Check size={22} weight="bold" className="text-ink-3" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 text-row">Afslut: smerte, RPE og note</span>
            {now(STEP_FINISH)}
          </InsetRow>
        )}
      </InsetList>
      {strength && (
        <ButtonLink small href={`/plan/${session.id}?uge=${weekNo}&tilbage=${encodeURIComponent(location)}`} className="mb-4 gap-1.5">
          <PencilSimple size={16} weight="bold" aria-hidden="true" />
          Ret øvelserne i planen
        </ButtonLink>
      )}
      {footer}
    </Sheet>
  );
}
