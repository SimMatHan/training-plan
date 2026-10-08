import { useSyncState } from '../data/sync';

/** Diskret sync-status: synket / venter / offline. `quiet` skjuler den, når alt er synket. */
export function SyncBadge({ quiet = false }: { quiet?: boolean }) {
  const { phase, pending, error, lastSyncAt } = useSyncState();
  // Før første gennemførte sync vides intet om serveren endnu.
  const first = (!lastSyncAt || pending === undefined) && phase !== 'offline' && phase !== 'error';
  const synced = pending === 0 && !first && phase !== 'error';
  if (quiet && (synced || first)) return null;
  const text =
    phase === 'error'
      ? 'Sync-fejl'
      : first
        ? 'Synker …'
        : synced
          ? 'Synket'
          : phase === 'offline'
            ? `Offline · ${pending ?? 0} venter`
            : `${pending ?? 0} venter`;
  return (
    <span role="status" title={error} className="inline-flex items-center gap-1.5 text-footnote text-ink-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${synced ? 'bg-status-green' : phase === 'error' ? 'bg-status-red' : 'bg-status-yellow'}`} />
      <span className="num">{text}</span>
    </span>
  );
}
