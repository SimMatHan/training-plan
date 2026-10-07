// Tid og tempo for løb og cardio. Bruges af appen og kalenderfeedet.

/** 1300 → "21:40", 6248 → "1:44:08". */
export function formatDuration(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Tempo i min/km, fx "4:18". Undefined hvis distance eller tid mangler. */
export function formatPace(durationSec: number | null | undefined, distanceKm: number | null | undefined): string | undefined {
  if (!durationSec || !distanceKm) return undefined;
  const perKm = Math.round(durationSec / distanceKm);
  return `${Math.floor(perKm / 60)}:${String(perKm % 60).padStart(2, '0')}`;
}
