// Eksport af alle data som JSON. Hentes fra D1 (eneste sandhed); uden net
// bruges den lokale kopi i IndexedDB, tydeligt markeret.
import type { SyncTable } from '../../shared/records.schema';
import { SYNC_TABLES } from '../../shared/tables';
import { db, kvGet, recordTable } from '../data/db';
import { athleteApi, OfflineError } from './api';
import { todayIso } from './dates';

const TABLES: readonly SyncTable[] = SYNC_TABLES;

async function localExport(slug: string) {
  const out: Record<string, unknown> = {
    format: 'traeningsnav-eksport',
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    source: 'lokal kopi (offline) — kan mangle ændringer fra andre enheder',
    athlete: slug,
    activePlan: await kvGet('activePlan'),
    profile: await kvGet('profile'),
    pendingSync: await db.outbox.count(),
  };
  for (const t of TABLES) out[t] = await recordTable(t).toArray();
  return out;
}

/** Henter eksporten og giver den til brugeren: delingsark på telefon, download på desktop. */
export async function exportData(slug: string): Promise<'server' | 'lokal'> {
  let data: unknown;
  let source: 'server' | 'lokal' = 'server';
  try {
    data = await athleteApi(slug, '/export');
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    data = await localExport(slug);
    source = 'lokal';
  }

  const name = `traeningsnav-${slug}-${todayIso()}${source === 'lokal' ? '-lokal' : ''}.json`;
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
