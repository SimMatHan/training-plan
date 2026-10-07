import { Link, useLocation } from 'wouter';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const icons = {
  today: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" />
      <circle cx="12" cy="15" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  week: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 18V9M8 18V6M12 18v-8M16 18V5M20 18v-6" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 19h18" />
      <path d="M4 15l5-5 4 3 7-7" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
};

const items = [
  { href: '/', label: 'I dag', icon: icons.today },
  { href: '/uge', label: 'Uge', icon: icons.week },
  { href: '/historik', label: 'Historik', icon: icons.history },
  { href: '/indstillinger', label: 'Indstillinger', icon: icons.settings },
];

export function BottomNav() {
  const [location] = useLocation();
  const isActive = (href: string) => (href === '/' ? location === '/' || location.startsWith('/session') || location.startsWith('/ankel') : location.startsWith(href));

  return (
    <nav aria-label="Hovedmenu" className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg">
      <ul className="mx-auto flex max-w-xl">
        {items.map(({ href, label, icon }) => {
          const active = isActive(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-xs ${
                  active ? 'font-semibold text-fg' : 'text-muted'
                }`}
              >
                <span className="size-6" aria-hidden="true">
                  {icon}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
