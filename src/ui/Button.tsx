import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'wouter';

type Variant = 'primary' | 'secondary';

const base =
  'inline-flex items-center justify-center gap-2 select-none transition-[transform,opacity] duration-150 ease-ios active:scale-[.98] active:opacity-90 disabled:pointer-events-none disabled:opacity-40';

const look: Record<Variant, string> = {
  // Gradienten er forbeholdt primærknappen (og få andre steder, se tokens.css).
  primary: 'bg-brand text-on-brand',
  secondary: 'bg-surface-2 text-ink',
};

/** Stor knap: fuld bredde, 52 px, radius 14, tekst 17/600. */
export const bigButton = (variant: Variant, className = '') => `${base} ${look[variant]} min-h-[52px] w-full rounded-button px-5 text-headline ${className}`;

/** Lille knap i en række (fx "Start"): min. 44 px høj, pilleformet. */
export const smallButton = (variant: Variant, className = '') => `${base} ${look[variant]} min-h-11 rounded-full px-4 text-secondary font-semibold ${className}`;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

export function PrimaryButton({ className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={bigButton('primary', className)} {...rest} />;
}

export function SecondaryButton({ className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={bigButton('secondary', className)} {...rest} />;
}

export function SmallButton({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps & { variant?: Variant }) {
  return <button type={type} className={smallButton(variant, className)} {...rest} />;
}

/** En knap der er et link (fx "Til I dag"). */
export function ButtonLink({ href, variant = 'secondary', small = false, className, children }: { href: string; variant?: Variant; small?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={small ? smallButton(variant, className) : bigButton(variant, className)}>
      {children}
    </Link>
  );
}

/** Tekstknap uden flade: "Luk", "Omdøb", "Slet". `danger` til destruktive handlinger. */
export function TextButton({ danger = false, className = '', type = 'button', ...rest }: ButtonProps & { danger?: boolean }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-body font-medium whitespace-nowrap disabled:opacity-30 ${danger ? 'text-danger' : 'text-ink-2'} ${className}`}
      {...rest}
    />
  );
}
