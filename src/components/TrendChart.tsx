import { useState } from 'react';
import { formatShort } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

export interface TrendPoint {
  key: string;
  date: string;
  value: number;
  /** Tekst når punktet er valgt, fx "højre 6 cm · venstre 7 cm". */
  detail?: string;
}

const W = 340;
const H = 150;
const PAD = { top: 16, right: 52, bottom: 22, left: 34 };

/**
 * Én serie over tid (ingen legend; titlen navngiver den). Tynd linje, punkter
 * med ring, direkte etiket på seneste værdi, valgfri mållinje. Tryk på et
 * punkt for detaljer — figurteksten fungerer som tooltip på touch.
 */
export function TrendChart({ points, unit, goal, label }: { points: TrendPoint[]; unit: string; goal?: number; label: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (points.length === 0) return null;
  const selected = picked != null && picked < points.length ? picked : points.length - 1;

  const t = points.map((p) => Date.parse(p.date));
  const tMin = Math.min(...t);
  const tMax = Math.max(...t, tMin + 86_400_000 * 14);
  const values = points.map((p) => p.value);
  const rawMax = Math.max(...values, goal ?? -Infinity);
  const rawMin = Math.min(...values, goal ?? Infinity);
  const step = niceStep((rawMax - rawMin) / 4 || Math.abs(rawMax) / 4 || 1);
  const yMax = Math.ceil(rawMax / step) * step + (rawMax === rawMin ? step : 0);
  const yMin = goal === undefined && rawMin > 0 ? Math.max(0, Math.floor(rawMin / step) * step - step) : Math.floor(rawMin / step) * step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  const x = (ms: number) => PAD.left + ((ms - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points.at(-1)!;
  const sel = points[selected];

  return (
    <figure className="mb-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}, seneste ${formatDecimal(last.value)} ${unit}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} strokeDasharray={v === goal ? '4 4' : undefined} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="num fill-muted text-[11px]">
              {formatDecimal(v)}
            </text>
          </g>
        ))}
        {goal !== undefined && (
          <text x={W - PAD.right + 4} y={y(goal)} dy="0.32em" className="fill-muted text-[11px]">
            mål {formatDecimal(goal)}
          </text>
        )}
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
          <g key={p.key}>
            <circle cx={x(t[i])} cy={y(p.value)} r={i === selected ? 5.5 : 4} fill="var(--chart-line)" stroke="var(--bg)" strokeWidth={2} />
            <circle
              cx={x(t[i])}
              cy={y(p.value)}
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
        <text x={x(t.at(-1)!) + 9} y={y(last.value)} dy="0.32em" className="num fill-fg text-[12px] font-semibold">
          {formatDecimal(last.value)} {unit}
        </text>
      </svg>
      <figcaption className="num text-sm" aria-live="polite">
        <span className="text-muted">{formatShort(sel.date)}:</span> {sel.detail ?? `${formatDecimal(sel.value)} ${unit}`}
      </figcaption>
    </figure>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
