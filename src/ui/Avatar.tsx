import { Link } from 'wouter';

/** Rund forbogstav-avatar. Linker til Indstillinger. */
export function Avatar({ name, href = '/indstillinger' }: { name: string; href?: string }) {
  return (
    <Link href={href} aria-label={`${name}: indstillinger`} className="grid size-11 place-items-center">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-surface-2 text-headline text-ink">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </Link>
  );
}
