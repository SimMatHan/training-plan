import { useEffect, useState } from 'react';
import type { YogaRoutine } from '../../shared/plan.schema';
import { catalogPose, poseCue, poseName, SIDE_LABEL, type YogaPosition, type YogaStep } from '../../shared/yoga';
import { illustrationFor } from '../logic/illustrations';
import { Figure } from '../ui/Figure';
import { Ring } from '../ui/Ring';

/** "1:05" eller "45". */
export const secondsText = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
};

/** "12:40". */
export const clockText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const KIND_LABEL: Record<YogaStep['kind'], string> = { klar: 'Gør dig klar', overgang: 'Næste stilling', skift: 'Skift side', stilling: 'Hold' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Liggende skærm (TV, eller telefonen vendt ved skærmspejling). */
export function useLandscape() {
  const query = '(orientation: landscape) and (min-width: 560px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Hvad der vises under rutinen: stillingens navn, side, figur, nedtælling og hvad der kommer bagefter.
 * `wide`: to kolonner med store bogstaver til TV (eller telefonen på langs); ellers lodret til telefonen.
 */
export function YogaStage({ routine, steps, pos, wide, paused }: { routine: YogaRoutine; steps: YogaStep[]; pos: YogaPosition; wide: boolean; paused: boolean }) {
  const step = pos.step;
  if (!step) return null;
  const pose = routine.poses[step.poseIndex];
  const name = poseName(pose);
  const alias = catalogPose(pose.poseId)?.alias;
  const ill = illustrationFor(pose.poseId, name);
  const holding = step.kind === 'stilling';
  const progress = 1 - pos.remainingMs / (step.seconds * 1000);
  // Det der kommer efter dette hold (næste stilling eller anden side).
  const after = holding ? steps.slice(pos.index + 1).find((s) => s.kind === 'stilling') : undefined;
  const afterText = after && (after.poseIndex === step.poseIndex ? `Anden side: ${SIDE_LABEL[after.side!]}` : `Derefter: ${poseName(routine.poses[after.poseIndex])}`);
  const kicker = holding ? (step.side ? cap(SIDE_LABEL[step.side]) : KIND_LABEL.stilling) : step.kind === 'skift' ? `Skift til ${SIDE_LABEL[step.side!]}` : KIND_LABEL[step.kind];
  const sideNote = !holding && step.kind !== 'skift' && step.side ? ` · start med ${SIDE_LABEL[step.side]}` : '';
  const poseNo = `Stilling ${step.poseIndex + 1} af ${routine.poses.length}`;
  const cue = poseCue(pose);

  const accent = holding ? 'text-brand-red' : 'text-ink-2';

  const figure = ill ? (
    <Figure illustration={ill} animate={!paused} label={name} className={`w-full ${holding ? '' : 'opacity-60'} ${wide ? 'h-[52vh]' : 'max-h-[24vh]'}`} />
  ) : (
    <div className={`grid w-full place-items-center rounded-card bg-fill ${wide ? 'h-[52vh]' : 'h-[24vh]'}`} aria-hidden="true" />
  );

  if (wide)
    return (
      <div className="grid h-full grid-cols-[1.1fr_1fr] items-center gap-[4vw] px-[4vw]">
        <div className="flex flex-col items-center">{figure}</div>
        <div className="flex min-w-0 flex-col gap-[2.2vh]">
          <p className={`font-semibold tracking-wide uppercase ${accent}`} style={{ fontSize: '3.4vh' }}>
            {kicker}
            {sideNote && <span className="text-ink-2 normal-case">{sideNote}</span>}
          </p>
          <h2 className="leading-[1.05] font-bold" style={{ fontSize: 'min(9vh, 6.5vw)' }}>
            {name}
          </h2>
          {alias && (
            <p className="text-ink-2" style={{ fontSize: '3vh' }}>
              {alias}
            </p>
          )}
          <div className="flex items-center gap-[3vw]">
            <Ring progress={progress} size={Math.round(Math.min(innerHeight * 0.3, innerWidth * 0.26))} stroke={Math.round(innerHeight * 0.022)}>
              <span className={`num font-bold ${paused ? 'text-ink-2' : ''}`} style={{ fontSize: 'min(11vh, 8vw)' }}>
                {secondsText(pos.remainingMs)}
              </span>
            </Ring>
            <div className="min-w-0">
              {cue && (
                <p className="text-ink" style={{ fontSize: '3vh', lineHeight: 1.3 }}>
                  {cue}
                </p>
              )}
            </div>
          </div>
          <p className="text-ink-2" style={{ fontSize: '2.8vh' }}>
            {afterText ?? poseNo} · {clockText(pos.totalMs - pos.elapsedMs)} tilbage
          </p>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {figure}
      <p className={`text-footnote font-semibold tracking-wide uppercase ${accent}`}>
        {kicker}
        {sideNote && <span className="text-ink-2 normal-case">{sideNote}</span>}
      </p>
      <h2 className="text-[28px] leading-[32px] font-bold">{name}</h2>
      {alias && <p className="-mt-1.5 text-secondary text-ink-2">{alias}</p>}
      <Ring progress={progress} size={144} stroke={11} label={`${secondsText(pos.remainingMs)} sekunder tilbage`}>
        <span className={`num text-[46px] leading-none font-bold ${paused ? 'text-ink-2' : ''}`}>{secondsText(pos.remainingMs)}</span>
      </Ring>
      {cue && <p className="max-w-md text-secondary text-ink">{cue}</p>}
      <p className="text-secondary text-ink-2">{afterText ?? poseNo}</p>
    </div>
  );
}

/** Tynd fremdriftsbjælke for hele rutinen. */
export function RoutineBar({ pos }: { pos: YogaPosition }) {
  const p = pos.totalMs ? pos.elapsedMs / pos.totalMs : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${p * 100}%` }} />
    </div>
  );
}
