import { Check, ListBullets } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ExerciseHistoryEntry } from '../../shared/history';
import type { PainAssessment } from '../../shared/pain';
import type { Plan, Session, Week } from '../../shared/plan.schema';
import type { EffectiveSession } from '../../shared/schedule';
import { warmupRound } from '../../shared/mobility';
import { useRoundChecks, useWorkoutLogs } from '../data/workouts';
import { todayIso } from '../lib/dates';
import type { Workout } from '../../shared/records.schema';
import { formatDose, formatIntensity, formatRange, resolveStrengthSession } from '../../shared/resolve';
import { sessionDetail, sessionTitle } from '../lib/sessions';
import { exerciseCategory } from '../logic/category';
import { formatDecimal } from '../logic/numbers';
import { PrimaryButton, SecondaryButton, smallButton } from '../ui/Button';
import { ExerciseRow, TILE_INSET } from '../ui/ExerciseRow';
import { HeroNumber } from '../ui/HeroNumber';
import { Card, Group, InsetList } from '../ui/InsetList';
import { StatusLight } from '../ui/StatusLight';
import { useSessionOpener } from './SessionAction';
import { aboutMinutes, SessionOverview } from './SessionOverview';

const about = aboutMinutes;

/** Sidste resultat som heltal + enhed og en linje under ("8 reps"). */
export function lastResult(entry: ExerciseHistoryEntry | undefined, kind: string | undefined) {
  if (!entry) return undefined;
  const top = entry.sets.reduce<ExerciseHistoryEntry['sets'][number] | undefined>((a, s) => (!a || (s.weight_kg ?? 0) > (a.weight_kg ?? 0) ? s : a), undefined);
  if (kind === 'time' && entry.maxSeconds != null) return { value: String(entry.maxSeconds), unit: 'sek', sub: `${entry.sets.length} sæt` };
  if (kind === 'weight_reps' && entry.topWeight != null) return { value: formatDecimal(entry.topWeight), unit: 'kg', sub: top?.reps != null ? `${top.reps} reps` : undefined };
  const reps = Math.max(...entry.sets.map((s) => s.reps ?? 0));
  return { value: String(reps), unit: 'reps', sub: `${entry.sets.length} sæt` };
}

/**
 * Dagens session: titel, varighed, heltetallet (sidste gangs tal på første øvelse, eller
 * løbets mål) og én stor knap. For styrke står øvelserne under med sidste resultat.
 */
export function TodayCard({
  plan,
  week,
  scheduled,
  session,
  workouts,
  groin,
  last,
}: {
  plan: Plan;
  week: Week;
  scheduled: EffectiveSession;
  session: Session;
  workouts: Workout[] | undefined;
  groin: Map<string, PainAssessment>;
  /** Seneste gang pr. øvelse. */
  last: Map<string, ExerciseHistoryEntry>;
}) {
  const { status, workout, open, busy } = useSessionOpener(session, week, workouts, scheduled.plannedDay);
  const [overview, setOverview] = useState(false);
  const logs = useWorkoutLogs(workout?.uuid);
  // Med en morgenrunde i planen er sessionens mobilitet dagens morgenrunde.
  const warmup = session.kind === 'styrke' && warmupRound(plan);
  const rounds = useRoundChecks(warmup && workout ? workout.date : warmup ? todayIso() : undefined);
  const strength = session.kind === 'styrke' ? resolveStrengthSession(plan, session.id, week.weekNo) : undefined;
  const exercises = strength?.slots.flatMap((s) => s.exercises) ?? [];
  const light = workout && groin.get(workout.uuid)?.light;

  const detail =
    strength
      ? `${exercises.length} øvelser${session.kind === 'styrke' && session.mobility === 'before' && plan.mobility ? ' + mobilitet' : ''}`
      : sessionDetail(scheduled, session);

  const first = exercises[0];
  const firstLast = first && lastResult(last.get(first.exercise.id), first.exercise.kind);
  const hero = strength
    ? firstLast
      ? { label: `Sidst · ${first.label}`, ...firstLast }
      : first && { label: `Første øvelse · ${first.label}`, value: formatRange(first.planned.dose.reps ?? first.planned.dose.seconds), unit: first.planned.dose.seconds ? 'sek' : 'reps' }
    : scheduled.targetKm
      ? { label: 'Mål', value: formatRange(scheduled.targetKm), unit: 'km' }
      : scheduled.targetMin
        ? { label: 'Mål', value: formatRange(scheduled.targetMin), unit: 'min' }
        : undefined;

  return (
    <>
      <Card className="mb-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-title">{sessionTitle(session)}</h2>
          {about(session.durationMin) && <span className="shrink-0 text-secondary text-ink-2">{about(session.durationMin)}</span>}
        </div>
        {detail && <p className="num text-secondary text-ink-2">{detail}</p>}
        {hero && <HeroNumber className="mt-4" label={hero.label} value={hero.value} unit={hero.unit} />}
        {(session.kind === 'løb' || session.kind === 'cardio') && !scheduled.targetKm && <p className="num mt-3 text-body">{session.mainSet}</p>}
        <div className="mt-5">
          {status === 'sprunget-over' ? (
            <p className="text-secondary text-ink-2">Sprunget over{workout?.skip_reason && ` · ${workout.skip_reason}`}</p>
          ) : status === 'lavet' ? (
            <>
              <p className="mb-3 flex items-center gap-3 text-body">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Check size={18} weight="bold" className="text-status-green" aria-hidden="true" /> Lavet
                </span>
                {light && <StatusLight light={light} label="Lysken" />}
              </p>
              <SecondaryButton onClick={() => void open()} disabled={busy}>
                Vis session
              </SecondaryButton>
            </>
          ) : (
            <PrimaryButton onClick={() => void open()} disabled={busy || !workouts}>
              {status === 'i-gang' ? 'Fortsæt session' : 'Start session'}
            </PrimaryButton>
          )}
        </div>
      </Card>

      {strength && (
        <Group
          title="Øvelser"
          action={
            <button type="button" onClick={() => setOverview(true)} className={smallButton('secondary', 'shrink-0 gap-1.5 px-3')}>
              <ListBullets size={16} weight="bold" aria-hidden="true" />
              Se hele træningen
            </button>
          }
        >
          <InsetList inset={TILE_INSET}>
            {exercises.map((e) => {
              const r = lastResult(last.get(e.exercise.id), e.exercise.kind);
              return (
                <ExerciseRow
                  key={e.exercise.id}
                  category={exerciseCategory(plan, e.exercise.id)}
                  name={e.label}
                  detail={[formatDose(e.exercise, e.planned.dose), formatIntensity(e.planned.dose)].filter(Boolean).join(', ')}
                  value={r ? `${r.value} ${r.unit}` : '–'}
                  sub={r?.sub}
                  href={`/historik/oevelse/${e.exercise.id}`}
                />
              );
            })}
          </InsetList>
        </Group>
      )}

      {strength && (
        <SessionOverview
          open={overview}
          onClose={() => setOverview(false)}
          plan={plan}
          session={session}
          weekNo={week.weekNo}
          workoutUuid={workout && !workout.skipped_at ? workout.uuid : undefined}
          sets={logs?.sets}
          mobilityChecks={warmup ? rounds?.filter((c) => c.round === 'morgen') : logs?.mobility}
        />
      )}
    </>
  );
}
