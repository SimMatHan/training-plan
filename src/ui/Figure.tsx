import { useEffect, useMemo, useState } from 'react';
import { blend, pingPong, solve, type Joint, type Point, type Skeleton } from '../logic/figure';
import type { Illustration, Prop } from '../logic/illustrations';

const NEAR = 'var(--ink)';
const FAR = 'var(--ink-3)';
const GEAR = 'var(--ink-2)';
const LINE = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

function Segment({ a, b, color, width }: { a: Point; b: Point; color: string; width: number }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={width} {...LINE} />;
}

function Limb({ s, joints, color, width = 6 }: { s: Skeleton; joints: Joint[]; color: string; width?: number }) {
  return <polyline points={joints.map((j) => s[j].join(',')).join(' ')} stroke={color} strokeWidth={width} {...LINE} />;
}

/** Selve figuren. `tone` "ghost" tegner hele kroppen svagt (startstillingen bag slutstillingen). */
function Body({ s, ghost = false }: { s: Skeleton; ghost?: boolean }) {
  const near = ghost ? FAR : NEAR;
  const far = FAR;
  return (
    <g opacity={ghost ? 0.35 : 1}>
      <Limb s={s} joints={['hip', 'kneeF', 'ankleF', 'toeF']} color={far} />
      <Limb s={s} joints={['shoulder', 'elbowF', 'wristF']} color={far} />
      <Segment a={s.hip} b={s.neck} color={near} width={8} />
      <circle cx={s.head[0]} cy={s.head[1]} r={8} fill={near} />
      <Limb s={s} joints={['hip', 'kneeN', 'ankleN', 'toeN']} color={near} />
      <Limb s={s} joints={['shoulder', 'elbowN', 'wristN']} color={near} />
    </g>
  );
}

const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Udstyr bag figuren (faste ting) eller foran (ting i hænderne). */
function Gear({ props, s, layer }: { props: Prop[]; s: Skeleton; layer: 'back' | 'front' }) {
  return (
    <>
      {props.map((p, i) => {
        if (layer === 'back') {
          if (p.kind === 'bench') return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={3} fill="var(--fill)" stroke={FAR} strokeWidth={1.5} />;
          if (p.kind === 'incline') return <Segment key={i} a={p.from} b={p.to} color={FAR} width={9} />;
          if (p.kind === 'wall') return <line key={i} x1={p.x} y1={20} x2={p.x} y2={150} stroke={FAR} strokeWidth={4} strokeLinecap="round" />;
          if (p.kind === 'bar') return <line key={i} x1={p.at[0] - 30} y1={p.at[1]} x2={p.at[0] + 30} y2={p.at[1]} stroke={GEAR} strokeWidth={4} strokeLinecap="round" />;
          if (p.kind === 'cable')
            return (
              <g key={i}>
                <line x1={p.from[0]} y1={p.from[1]} x2={s[p.to][0]} y2={s[p.to][1]} stroke={FAR} strokeWidth={1.5} />
                <circle cx={p.from[0]} cy={p.from[1]} r={3.5} fill={FAR} />
              </g>
            );
          if (p.kind === 'ball' && !p.front) return <circle key={i} cx={s[p.at][0] + (p.dx ?? 0)} cy={s[p.at][1] + (p.dy ?? 0)} r={p.r} fill={FAR} />;
          return null;
        }
        if (p.kind === 'ball' && p.front) return <circle key={i} cx={s[p.at][0] + (p.dx ?? 0)} cy={s[p.at][1] + (p.dy ?? 0)} r={p.r} fill={GEAR} />;
        if (p.kind === 'barbell') {
          const [x, y] = p.at ? s[p.at] : mid(s.wristN, s.wristF);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={13} fill="var(--surface)" stroke={GEAR} strokeWidth={3.5} />
              <circle cx={x} cy={y} r={2.5} fill={GEAR} />
            </g>
          );
        }
        if (p.kind === 'plate') return <circle key={i} cx={s[p.at][0]} cy={s[p.at][1] - 2} r={10} fill="var(--surface)" stroke={GEAR} strokeWidth={3} />;
        if (p.kind === 'dumbbell')
          return (p.hands === 'naer' ? (['wristN'] as const) : (['wristF', 'wristN'] as const)).map((w) => (
            <rect key={`${i}${w}`} x={s[w][0] - 8} y={s[w][1] - 3.5} width={16} height={7} rx={2.5} fill={w === 'wristF' ? FAR : GEAR} />
          ));
        if (p.kind === 'band') return <Segment key={i} a={s[p.a]} b={s[p.b]} color={GEAR} width={2} />;
        if (p.kind === 'pad') return <rect key={i} x={s[p.at][0] - 7} y={s[p.at][1] - 3} width={14} height={7} rx={3} fill={GEAR} />;
        return null;
      })}
    </>
  );
}

/**
 * Udsnittet der viser figuren og udstyret i hele bevægelsen, med lidt luft og altid 5 : 4, så
 * små miniaturer fylder rammen. Kabler tæller ikke med (deres ophæng kan ligge langt væk).
 */
export function viewBoxFor(ill: Illustration): string {
  const xs: number[] = [];
  const ys: number[] = [150];
  for (const t of [0, 0.5, 1]) {
    for (const [x, y] of Object.values(solve(blend(ill.from, ill.to, t)))) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const p of ill.props ?? []) {
    if (p.kind === 'bench') xs.push(p.x, p.x + p.w), ys.push(p.y);
    if (p.kind === 'incline') xs.push(p.from[0], p.to[0]), ys.push(p.from[1], p.to[1]);
    if (p.kind === 'wall') xs.push(p.x);
    if (p.kind === 'bar') xs.push(p.at[0] - 30, p.at[0] + 30), ys.push(p.at[1]);
  }
  const pad = 14;
  let x0 = Math.min(...xs) - pad;
  let x1 = Math.max(...xs) + pad;
  let y0 = Math.min(...ys) - pad;
  let y1 = Math.max(...ys) + 6;
  // Udvid den korte led til 5 : 4.
  const w = x1 - x0;
  const h = y1 - y0;
  if (w / h < 1.25) {
    const extra = h * 1.25 - w;
    x0 -= extra / 2;
    x1 += extra / 2;
  } else {
    y0 -= w / 1.25 - h;
  }
  return `${x0.toFixed(1)} ${y0.toFixed(1)} ${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * En øvelse som tændstiksmand. `animate`: bevæger sig roligt mellem start og slut (ikke ved
 * reduceret bevægelse). Stillestående vises slutstillingen med startstillingen svagt bagved.
 */
export function Figure({
  illustration,
  animate = false,
  frame,
  label,
  className = '',
}: {
  illustration: Illustration;
  animate?: boolean;
  /** Fast stilling 0–1 (0 = start, 1 = slut) uden skygge; bruges af /dev/figurer. */
  frame?: number;
  label: string;
  className?: string;
}) {
  const moving = animate && !reducedMotion();
  const [t, setT] = useState(1);

  useEffect(() => {
    if (!moving) return setT(1);
    let frame = 0;
    const start = performance.now();
    const period = (illustration.seconds ?? 3) * 1000;
    const tick = (now: number) => {
      setT(pingPong((now - start) / period));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, illustration]);

  const props = illustration.props ?? [];
  const viewBox = useMemo(() => viewBoxFor(illustration), [illustration]);
  const s = solve(blend(illustration.from, illustration.to, frame ?? t));
  const start = moving || frame !== undefined ? undefined : solve(illustration.from);

  return (
    <svg viewBox={viewBox} role="img" aria-label={label} className={className}>
      <line x1={-200} y1={150.5} x2={400} y2={150.5} stroke="var(--separator)" strokeWidth={2} />
      <Gear props={props} s={s} layer="back" />
      {start && <Body s={start} ghost />}
      <Body s={s} />
      <Gear props={props} s={s} layer="front" />
    </svg>
  );
}
