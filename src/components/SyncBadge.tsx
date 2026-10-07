import { useSyncState } from '../data/sync';

/** Diskret sync-status: synket / venter / offline. */
export function SyncBadge() {
  const { phase, pending, error, lastSyncAt } = useSyncState();
  // Før første gennemførte sync vides intet om serveren endnu.
  const first = (!lastSyncAt || pending === undefined) && phase !== 'offline' && phase !== 'error';
  const synced = pending === 0 && !first && phase !== 'error';
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
    <span role="status" title={error} className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden="true" className={`size-2 rounded-full ${synced ? 'bg-mob' : phase === 'error' ? 'bg-a' : 'bg-run'}`} />
      <span className="num">{text}</span>
    </span>
  );
}
