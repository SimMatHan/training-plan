import type { ReactNode } from 'react';
import type { Category } from '../logic/category';
import { IconTile } from './IconTile';
import { InsetRow, RowText, RowValue } from './InsetList';

/** Ikonflise · navn (+ dosering under) · sidste resultat i to linjer · chevron. Brug i en InsetList med inset 64. */
export function ExerciseRow({
  category,
  name,
  detail,
  value,
  sub,
  href,
}: {
  category: Category;
  name: ReactNode;
  detail?: ReactNode;
  /** Fx "16 kg". */
  value?: ReactNode;
  /** Fx "8 reps". */
  sub?: ReactNode;
  href?: string;
}) {
  return (
    <InsetRow href={href} chevron={!!href}>
      <IconTile category={category} />
      <RowText title={name} detail={detail} />
      {value != null && <RowValue primary={value} secondary={sub} />}
    </InsetRow>
  );
}

/** Separatorens start i en liste med ikonfliser: 16 + 36 + 12. */
export const TILE_INSET = 64;
