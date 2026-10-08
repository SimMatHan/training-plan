import type { ReactNode } from 'react';

/**
 * Skærmens vigtigste tal: label i --ink-2, tallet stort i gradient og enheden ved siden af i
 * --brand-red, grundlinjejusteret. Når `value` skifter, ruller det nye tal ind (200 ms).
 */
export function HeroNumber({
  label,
  value,
  unit,
  badge,
  size = 'lg',
  className = '',
}: {
  label?: ReactNode;
  value: string;
  unit?: string;
  /** Fx "Ny rekord"-pillen. */
  badge?: ReactNode;
  size?: 'lg' | 'md';
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <p className="text-secondary text-ink-2">{label}</p>}
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span key={value} className={`num animate-roll text-gradient ${size === 'lg' ? 'text-hero' : 'text-[44px] leading-none font-bold tracking-[-0.03em]'}`}>
          {value}
        </span>
        {unit && <span className="text-unit text-brand-red">{unit}</span>}
        {badge && <span className="ml-1 self-center">{badge}</span>}
      </p>
    </div>
  );
}

/** Lille pille i gradient, fx "Ny rekord". Appens ene orkestrerede øjeblik. */
export function GradientPill({ children }: { children: ReactNode }) {
  return <span className="animate-pop inline-flex h-7 items-center rounded-full bg-brand px-3 text-footnote font-semibold text-on-brand">{children}</span>;
}
