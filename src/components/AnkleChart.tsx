import { useState } from 'react';
import type { MobilityPoint } from '../../shared/mobility';
import { formatShort } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

const W = 340;
const H = 150;
const PAD = { top: 16, right: 44, bottom: 22, left: 30 };

/**
 * Forskel mellem siderne over tid (venstre − højre, cm). Målet er 0.
 * Én serie, så ingen legend; tryk på et punkt for værdierne.
 */
export function AnkleChart({ points }: { points: MobilityPoint[] }) {
  // null = seneste punkt (også når nye målinger kommer til).
  const [picked, setPicked] = useState<number | null>(null);
  if (points.length === 0) return null;
  const selected = picked != null && picked < points.length ? picked : points.length - 1;
  const setSelected = setPicked;

  const t = points.map((p) => Date.parse(p.date));
  const tMin = Math.min(...t);
  const tMax = Math.max(...t, tMin + 86_400_000 * 14);
  const yMax = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.diff))));
  const yMin = Math.min(0, Math.floor(Math.min(...points.map((p) => p.diff))));
  const x = (ms: number) => PAD.left + ((ms - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i).filter((v, _, a) => a.length <= 6 || v % 2 === 0);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(p.diff).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  const sel = points[selected];

  return (
    <figure className="mb-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Forskel mellem siderne, seneste ${formatDecimal(last.diff)} cm. Målet er 0.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} strokeDasharray={v === 0 ? '4 4' : undefined} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {v}
            </text>
          </g>
        ))}
        <text x={W - PAD.right + 4} y={y(0)} dy="0.32em" className="fill-muted text-[11px]">
          mål 0
        </text>
        <text x={PAD.left} y={H - 4} className="num fill-muted text-[11px]">
          {formatShort(points[0].date)}
        </text>
        {points.length > 1 && (
          <text x={x(t.at(-1)!)} y={H - 4} textAnchor="end" className="num fill-muted text-[11px]">
            {formatShort(last.date)}
          </text>
        )}
        {points.length > 1 && <path d={path} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <g key={p.uuid}>
            <circle cx={x(t[i])} cy={y(p.diff)} r={i === selected ? 5.5 : 4} fill="var(--chart-line)" stroke="var(--bg)" strokeWidth={2} />
            <circle
              cx={x(t[i])}
              cy={y(p.diff)}
              r={18}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label={`${formatShort(p.date)}: forskel ${formatDecimal(p.diff)} cm`}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(i)}
            />
          </g>
        ))}
        <text x={x(t.at(-1)!) + 9} y={y(last.diff)} dy="0.32em" className="num fill-fg text-[12px] font-semibold">
          {formatDecimal(last.diff)} cm
        </text>
      </svg>
      <figcaption className="num text-sm" aria-live="polite">
        <span className="text-muted">{formatShort(sel.date)}:</span> højre {formatDecimal(sel.right)} cm · venstre {formatDecimal(sel.left)} cm ·{' '}
        <span className="font-semibold">forskel {formatDecimal(sel.diff)} cm</span>
      </figcaption>
    </figure>
  );
}
