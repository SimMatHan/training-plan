import type { ReactNode } from 'react';
import { SyncBadge } from './SyncBadge';

/** Fælles skærmlayout: titel og sync-status øverst, plads til bundbaren nederst. */
export function Screen({ title, eyebrow, children }: { title: string; eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <main className="pt-safe mx-auto max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
      <header className="mb-5 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted">{eyebrow}</p>
          <SyncBadge />
        </div>
        <h1 className="text-3xl">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-lg">{title}</h2>
      {children}
    </section>
  );
}
