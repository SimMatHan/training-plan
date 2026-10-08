import { useId, type ReactNode } from 'react';

/** Cirkulær fremdrift med gradient-streg og rund ende. Til pausetimer og ugens fremdrift. */
export function Ring({
  progress,
  size = 120,
  stroke = 10,
  children,
  label,
  className = '',
}: {
  /** 0–1. */
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  // Et id der også virker inde i url(#…).
  const id = `ring${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--brand-pink)' }} />
            <stop offset="1" style={{ stopColor: 'var(--brand-red)' }} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {p > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - p)}
            className="transition-[stroke-dashoffset] duration-[280ms] ease-ios"
          />
        )}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}
