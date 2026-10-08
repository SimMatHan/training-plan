import { CaretRight } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'wouter';

/**
 * iOS "inset grouped": hvid flade, radius 16, ingen skygge. Separatorerne starter ved
 * `inset` px (efter ikonflisen, når rækkerne har en).
 */
export function InsetList({ children, inset = 16, className = '', label }: { children: ReactNode; inset?: number; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={`inset-list overflow-hidden rounded-card bg-surface ${className}`} style={{ '--sep-inset': `${inset}px` } as CSSProperties}>
      {children}
    </ul>
  );
}

const rowBase = 'flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left';
const pressable = 'transition-colors duration-150 active:bg-surface-2';

/** Én række. Med `href` bliver hele rækken et link; med `onClick` en knap. */
export function InsetRow({
  href,
  onClick,
  children,
  className = '',
  chevron = !!href || !!onClick,
  ariaLabel,
  current,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  chevron?: boolean;
  ariaLabel?: string;
  current?: boolean;
}) {
  const content = (
    <>
      {children}
      {chevron && <CaretRight size={16} weight="bold" className="shrink-0 text-ink-3" aria-hidden="true" />}
    </>
  );
  return (
    <li aria-current={current ? 'date' : undefined}>
      {href ? (
        <Link href={href} aria-label={ariaLabel} className={`${rowBase} ${pressable} ${className}`}>
          {content}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} aria-label={ariaLabel} className={`${rowBase} ${pressable} ${className}`}>
          {content}
        </button>
      ) : (
        <div className={`${rowBase} ${className}`}>{content}</div>
      )}
    </li>
  );
}

/** Tekstdelen af en række: titel 17/500 og evt. undertekst i --ink-2. */
export function RowText({ title, detail, muted = false }: { title: ReactNode; detail?: ReactNode; muted?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block text-row ${muted ? 'text-ink-2' : ''}`}>{title}</span>
      {detail && <span className="num block text-secondary text-ink-2">{detail}</span>}
    </span>
  );
}

/** Højrestillet værdi i to linjer ("16 kg" / "8 reps"). */
export function RowValue({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="num shrink-0 text-right">
      <span className="block text-row">{primary}</span>
      {secondary && <span className="block text-secondary text-ink-2">{secondary}</span>}
    </span>
  );
}

/** Flad hvid flade til indhold der ikke er en liste. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card bg-surface p-4 ${className}`}>{children}</div>;
}

/** En sektion med overskrift (titel 22/700) og valgfri fodnote under. */
export function Group({ title, footer, children, className = '', action }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`mb-8 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          {title && <h2 className="text-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
      {footer && <p className="mt-2 px-4 text-footnote text-ink-2">{footer}</p>}
    </section>
  );
}
