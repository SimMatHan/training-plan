import { CaretLeft } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';

export interface Back {
  href: string;
  label: string;
}

function BackLink({ back }: { back: Back }) {
  return (
    <Link href={back.href} className="-ml-2 inline-flex min-h-11 items-center gap-0.5 pr-2 text-body text-ink">
      {/* Kun pilen i brand-rød: rød tekst har for lav kontrast på hvid. */}
      <CaretLeft size={22} weight="bold" className="text-brand-red" aria-hidden="true" />
      {back.label}
    </Link>
  );
}

/**
 * Stor titel (34/700) med valgfri undertitel. Når titlen er scrollet ud af syne, glider en
 * kompakt, gennemsigtig topbar med blur ind med titlen i 17/600.
 */
export function LargeTitle({ title, subtitle, accessory, back }: { title: string; subtitle?: ReactNode; accessory?: ReactNode; back?: Back }) {
  const sentinel = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div
        aria-hidden={!compact}
        className={`pt-safe blur-chrome fixed inset-x-0 top-0 z-30 border-b-[0.5px] border-separator transition-opacity duration-200 ease-ios ${compact ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="relative mx-auto flex h-11 max-w-xl items-center px-4">
          {back && compact && <BackLink back={back} />}
          <p className="pointer-events-none absolute inset-x-16 truncate text-center text-headline">{title}</p>
        </div>
      </div>
      <header className="pt-3 pb-5">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div>{back && <BackLink back={back} />}</div>
          {accessory && <div className="flex items-center gap-3">{accessory}</div>}
        </div>
        <h1 ref={sentinel} className="text-large-title break-words">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-secondary text-ink-2">{subtitle}</p>}
      </header>
    </>
  );
}
