import type { RunSession, ScheduledSession } from '../../shared/plan.schema';
import type { Workout } from '../../shared/records.schema';
import { formatRange } from '../../shared/resolve';
import { patchWorkout } from '../data/workouts';
import { formatPace, joinDuration, splitDuration } from '../logic/pace';
import { NumberField } from './NumberField';

/**
 * Manuel log af løb, cardio og aktiviteter uden for planen (padel o.l.).
 * Fase 4 udfylder de samme felter fra Strava.
 */
export function RunLog({ workout, session, scheduled }: { workout: Workout; session?: RunSession; scheduled?: ScheduledSession }) {
  const { min, sec } = splitDuration(workout.duration_sec);
  const pace = formatPace(workout.duration_sec, workout.distance_km);
  // Distance er kun påkrævet for løb.
  const cardio = workout.type !== 'løb';
  const save = (patch: Partial<Workout>) => void patchWorkout(workout.uuid, patch);

  const plan = (
    session
      ? [
          ['Hovedsæt', session.mainSet],
          ['Pause', session.rest],
          ['Målfart', session.targetPace],
          ['Mål', scheduled?.targetKm ? formatRange(scheduled.targetKm, ' km') : scheduled?.targetMin ? formatRange(scheduled.targetMin, ' min') : undefined],
          ['Opvarmning', session.warmup],
          ['Formål', session.purpose],
        ]
      : []
  ).filter((r): r is [string, string] => !!r[1]);

  return (
    <section className="mb-8">
      {scheduled?.condition && <p className="mb-3 rounded-card bg-surface px-4 py-3 text-headline">{scheduled.condition}</p>}
      {plan.length > 0 && (
        <dl className="mb-6 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 rounded-card bg-surface p-4 text-secondary">
          {plan.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-2">{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1 text-footnote text-ink-2">
          Distance (km){cardio && ' — valgfri'}
          <NumberField decimal label="Distance i km" value={workout.distance_km} placeholder={scheduled?.targetKm ? formatRange(scheduled.targetKm) : ''} onValue={(v) => save({ distance_km: v })} />
        </label>
        <label className="flex flex-col gap-1 text-footnote text-ink-2">
          Tid, min
          <NumberField label="Tid, minutter" value={min} placeholder={scheduled?.targetMin ? formatRange(scheduled.targetMin) : ''} onValue={(v) => save({ duration_sec: joinDuration(v, sec) })} />
        </label>
        <label className="flex flex-col gap-1 text-footnote text-ink-2">
          sek
          <NumberField label="Tid, sekunder" value={sec} onValue={(v) => save({ duration_sec: joinDuration(min, v == null ? null : Math.min(v, 59)) })} />
        </label>
        <label className="flex flex-col gap-1 text-footnote text-ink-2">
          Gns. puls
          <NumberField label="Gennemsnitspuls" value={workout.avg_hr} onValue={(v) => save({ avg_hr: v != null && v >= 30 && v <= 250 ? v : null })} />
        </label>
        <div className="flex flex-col gap-1 text-footnote text-ink-2">
          Tempo
          <output className="num flex h-14 items-center justify-center rounded-[10px] bg-surface text-title text-ink" aria-label="Tempo, minutter pr. km">
            {pace ? `${pace}` : '–'}
            {pace && <span className="ml-1 text-secondary font-normal text-ink-2">/km</span>}
          </output>
        </div>
      </div>
    </section>
  );
}
