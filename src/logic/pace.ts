export { formatDuration, formatPace } from '../../shared/pace';

/** Deler sekunder i minutter og sekunder til to inputfelter. */
export const splitDuration = (sec: number | null) => (sec == null ? { min: null, sec: null } : { min: Math.floor(sec / 60), sec: sec % 60 });

export function joinDuration(min: number | null, sec: number | null): number | null {
  if (min == null && sec == null) return null;
  return (min ?? 0) * 60 + (sec ?? 0);
}
