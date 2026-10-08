import { Barbell, Footprints, HandFist, HandGrabbing, PersonSimpleRun, PersonSimpleTaiChi, Target, type Icon } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { CATEGORY_LABEL, type Category } from '../logic/category';

/** Ét ikon pr. kategori, ikke pr. øvelse. */
const ICON: Record<Category, Icon> = {
  legs: Barbell,
  back: HandGrabbing,
  arms: HandFist,
  core: Target,
  calf: Footprints,
  mobility: PersonSimpleTaiChi,
  cardio: PersonSimpleRun,
};

/** Lille flise (36 × 36, radius 10): ikon i kategoriens farve på samme farve i 14 % opacitet. */
export function IconTile({ category, size = 36 }: { category: Category; size?: number }) {
  const Glyph = ICON[category];
  const color = `var(--cat-${category})`;
  const style = { width: size, height: size, color, background: `color-mix(in srgb, ${color} 14%, transparent)` } satisfies CSSProperties;
  return (
    <span className="grid shrink-0 place-items-center rounded-tile" style={style} title={CATEGORY_LABEL[category]} aria-hidden="true">
      <Glyph size={Math.round(size * 0.56)} weight="fill" />
    </span>
  );
}
