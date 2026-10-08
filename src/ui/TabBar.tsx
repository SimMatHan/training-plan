import type { Icon } from '@phosphor-icons/react';
import { Link } from 'wouter';

export interface Tab {
  href: string;
  label: string;
  icon: Icon;
  active: boolean;
}

/** 4 faner, gennemsigtig med blur, hårfin topkant, safe-area i bunden. Aktiv = --brand-red. */
export function TabBar({ tabs }: { tabs: Tab[] }) {
  return (
    <nav aria-label="Hovedmenu" className="pb-safe blur-chrome fixed inset-x-0 bottom-0 z-20 border-t-[0.5px] border-separator">
      <ul className="mx-auto flex max-w-xl">
        {tabs.map(({ href, label, icon: Glyph, active }) => (
          <li key={label} className="flex-1">
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[50px] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-tab ${active ? 'text-brand-red' : 'text-ink-3'}`}
            >
              <Glyph size={26} weight="fill" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
