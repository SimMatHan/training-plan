import { useId, useState } from 'react';
import { formatShort } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

export interface ChartPoint {
  key: string;
  date: string;
  value: number;
  /** Tekst når punktet er valgt, fx "højre 6 cm · venstre 7 cm". */
  detail?: string;
}

const W = 358;
const H = 190;
const PAD = { top: 30, right: 14, bottom: 22, left: 30 };

/**
 * Én serie over tid: 2 px streg i brand-gradienten, flade under fra 24 % til 0 %, punkter på
 * 6 px og en afrundet pille med det seneste tal. 3–4 svage vandrette linjer, ingen andre.
 * Tryk på et punkt viser det i figurteksten (tooltip på touch).
 */
export function LineChart({ points, unit, goal, label }: { points: ChartPoint[]; unit: string; goal?: number; label: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (points.length === 0) return null;
  const selected = picked != null && picked < points.length ? picked : points.length - 1;

  const t = points.map((p) => Date.parse(p.date));
  const tMin = Math.min(...t);
  const tMax = Math.max(...t, tMin + 86_400_000 * 14);
  const values = points.map((p) => p.value);
  const rawMax = Math.max(...values, goal ?? -Infinity);
  const rawMin = Math.min(...values, goal ?? Infinity);
  const step = niceStep((rawMax - rawMin) / 3 || Math.abs(rawMax) / 3 || 1);
  const yMax = Math.ceil(rawMax / step) * step + (rawMax === rawMin ? step : 0);
  const yMin = goal === undefined && rawMin > 0 ? Math.max(0, Math.floor(rawMin / step) * step - step) : Math.floor(rawMin / step) * step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  const x = (ms: number) => PAD.left + ((ms - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const xy = points.map((p, i) => [x(t[i]), y(p.value)] as const);
  const line = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const base = y(yMin);
  const area = `${line} L${xy.at(-1)![0].toFixed(1)},${base} L${xy[0][0].toFixed(1)},${base} Z`;
  const last = points.at(-1)!;
  const [lx, ly] = xy.at(-1)!;
  const pillText = `${formatDecimal(last.value)} ${unit}`;
  const pillW = pillText.length * 7 + 18;
  const pillX = Math.min(W - pillW - 2, Math.max(2, lx - pillW / 2));
  const sel = points[selected];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={`${label}, seneste ${pillText}`}>
        <defs>
          <linearGradient id={`${uid}l`} gradientUnits="userSpaceOnUse" x1={PAD.left} y1="0" x2={W - PAD.right} y2="0">
            <stop offset="0" style={{ stopColor: 'var(--brand-pink)' }} />
            <stop offset="1" style={{ stopColor: 'var(--brand-red)' }} />
          </linearGradient>
          <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--brand-pink)', stopOpacity: 0.24 }} />
            <stop offset="1" style={{ stopColor: 'var(--brand-red)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--separator)" strokeWidth={v === goal ? 1.5 : 1} strokeDasharray={v === goal ? '4 4' : undefined} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="num fill-ink-3 text-caption">
              {formatDecimal(v)}
            </text>
          </g>
        ))}
        {goal !== undefined && (
          <text x={W - PAD.right} y={y(goal) - 5} textAnchor="end" className="fill-ink-3 text-caption">
            mål {formatDecimal(goal)}
          </text>
        )}
        <text x={PAD.left} y={H - 4} className="num fill-ink-3 text-caption">
          {formatShort(points[0].date)}
        </text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={H - 4} textAnchor="end" className="num fill-ink-3 text-caption">
            {formatShort(last.date)}
          </text>
        )}
        {points.length > 1 && <path d={area} fill={`url(#${uid}a)`} />}
        {points.length > 1 && <path d={line} fill="none" stroke={`url(#${uid}l)`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={xy[i][0]} cy={xy[i][1]} r={i === selected ? 4.5 : 3} fill={`url(#${uid}l)`} stroke="var(--surface)" strokeWidth={i === selected ? 2 : 0} />
            <circle
              cx={xy[i][0]}
              cy={xy[i][1]}
              r={18}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${formatShort(p.date)}: ${formatDecimal(p.value)} ${unit}`}
              onClick={() => setPicked(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(i)}
            />
          </g>
        ))}
        <g aria-hidden="true">
          <rect x={pillX} y={ly - 32} width={pillW} height={22} rx={11} fill="var(--brand-red)" />
          <text x={pillX + pillW / 2} y={ly - 21} dy="0.35em" textAnchor="middle" className="num fill-on-brand text-[12px] font-semibold">
            {pillText}
          </text>
        </g>
      </svg>
      <figcaption className="num mt-1 text-footnote" aria-live="polite">
        <span className="text-ink-2">{formatShort(sel.date)}:</span> {sel.detail ?? `${formatDecimal(sel.value)} ${unit}`}
      </figcaption>
    </figure>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
