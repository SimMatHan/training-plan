// Påmindelser som push-beskeder på denne enhed (Web Push). På iPhone kræver det, at appen er føjet
// til hjemmeskærmen (iOS 16.4+); i Safari-fanen findes PushManager ikke.
import { api } from './api';

export type PushSupport = 'ok' | 'hjemmeskaerm' | 'nej';

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  return ios() && !standalone() ? 'hjemmeskaerm' : 'nej';
}

const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.ready;
}

/** Enhedens nuværende abonnement, hvis det også er kendt af serveren. */
export async function currentPush(): Promise<PushSubscription | null> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return null;
  const { subscribed } = await api<{ subscribed: boolean }>('/me/push/status', { method: 'POST', json: { endpoint: sub.endpoint } });
  return subscribed ? sub : null;
}

/** Beder om lov og slår påmindelser til. Kaldes fra et tryk (iOS kræver det for tilladelsen). */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifikationer er ikke tilladt. Slå dem til for appen under Indstillinger → Notifikationer på telefonen.');
  const { publicKey } = await api<{ publicKey: string }>('/me/push/key');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // Et abonnement med en anden nøgle (fx fra før) kan ikke bruges.
  const key = sub?.options.applicationServerKey;
  if (sub && key && new Uint8Array(key).join() !== fromB64url(publicKey).join()) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) });
  await api('/me/push', { method: 'POST', json: { endpoint: sub.endpoint } });
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api('/me/push', { method: 'DELETE', json: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

export async function testPush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) throw new Error('Påmindelser er ikke slået til');
  const { result } = await api<{ result: string }>('/me/push/test', { method: 'POST', json: { endpoint: sub.endpoint } });
  if (result !== 'sendt') throw new Error(result === 'udløbet' ? 'Abonnementet er udløbet. Slå påmindelser fra og til igen.' : 'Push-tjenesten afviste beskeden. Prøv igen senere.');
}
