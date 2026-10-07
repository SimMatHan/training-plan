// Eksport af alle data som JSON. Hentes fra D1 (eneste sandhed); uden net
// bruges den lokale kopi i IndexedDB, tydeligt markeret.
import type { SyncTable } from '../../shared/records.schema';
import { db, kvGet, recordTable } from '../data/db';
import { api, OfflineError } from './api';
import { todayIso } from './dates';

const TABLES: SyncTable[] = ['workouts', 'set_logs', 'exercise_notes', 'groin_checks', 'mobility_measurements', 'mobility_checks'];

async function localExport() {
  const out: Record<string, unknown> = {
    format: 'traeningsnav-eksport',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    source: 'lokal kopi (offline) — kan mangle ændringer fra andre enheder',
    activePlan: await kvGet('activePlan'),
    pendingSync: await db.outbox.count(),
  };
  for (const t of TABLES) out[t] = await recordTable(t).toArray();
  return out;
}

/** Henter eksporten og giver den til brugeren: delingsark på telefon, download på desktop. */
export async function exportData(): Promise<'server' | 'lokal'> {
  let data: unknown;
  let source: 'server' | 'lokal' = 'server';
  try {
    data = await api('/export');
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    data = await localExport();
    source = 'lokal';
  }

  const name = `traeningsnav-eksport-${todayIso()}${source === 'lokal' ? '-lokal' : ''}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  // På iPhone (installeret app) er delingsarket vejen til "Arkiver i Filer".
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Træningsnav-eksport' });
      return source;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return source;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return source;
}
