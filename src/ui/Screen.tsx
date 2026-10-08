import type { ReactNode } from 'react';
import { LargeTitle, type Back } from './LargeTitle';

/** Fælles skærmlayout: stor titel øverst, plads til fanebjælken nederst. */
export function Screen({
  title,
  subtitle,
  accessory,
  back,
  tabbar = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  accessory?: ReactNode;
  back?: Back;
  /** Fanebjælken vises (plads i bunden). */
  tabbar?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={`pt-safe mx-auto max-w-xl px-4 ${tabbar ? 'pb-tabbar' : 'pb-12'}`}>
      <LargeTitle title={title} subtitle={subtitle} accessory={accessory} back={back} />
      {children}
    </main>
  );
}

/** Rolig infotekst (tom tilstand, "Henter …"). */
export function Muted({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-secondary text-ink-2 ${className}`}>{children}</p>;
}

/** Fejltekst med nok kontrast. */
export function ErrorText({ children, className = '' }: { children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={`text-secondary text-danger ${className}`}>
      {children}
    </p>
  );
}
