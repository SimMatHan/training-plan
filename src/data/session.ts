// Login og log ud på enheden: åbner brugerens lokale database og starter sync — eller sletter
// det hele igen.
import type { Me } from '../../shared/athletes';
import { forgetMe, setMe } from '../lib/auth';
import { deleteUserDb, openUserDb, removeLegacyDb } from './db';
import { logout, startSync } from './sync';

/** Efter login (eller ved start med en kendt bruger): brugerens database og baggrundssync. */
export function startUserSession(me: Me) {
  openUserDb(me.user.id);
  void removeLegacyDb();
  try {
    // API-tokenet fra før fase 5 bruges ikke længere.
    localStorage.removeItem('traeningsnav.token');
  } catch {
    // Ikke kritisk.
  }
  startSync();
}

/** Ny bruger fra serveren (login, invitation). Sender straks det der venter i udbakken. */
export function signedIn(me: Me) {
  openUserDb(me.user.id);
  setMe(me);
  startSync();
}

/** Log ud: slet sessionen på serveren, den lokale database og brugeren på enheden. */
export async function signOut() {
  await logout();
  await deleteUserDb();
  try {
    localStorage.removeItem('traeningsnav.timer');
    localStorage.removeItem('traeningsnav.viewAthlete');
  } catch {
    // Ikke kritisk.
  }
  forgetMe();
}
