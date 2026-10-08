// Passkeys i browseren (Face ID / Touch ID via iCloud-nøgleringen).
import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { InviteInfo, Me, PasskeyInfo } from '../../shared/athletes';
import { api, ApiError, OfflineError } from './api';

/** Et kort navn til passkey'en ud fra enheden. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'Passkey';
}

/** En fejl som en kort dansk tekst til skærmen. */
export function passkeyError(e: unknown): string {
  if (e instanceof OfflineError) return 'Ingen forbindelse. Login kræver net.';
  if (e instanceof ApiError) return e.message;
  if (e instanceof WebAuthnError && e.code === 'ERROR_CEREMONY_ABORTED') return 'Afbrudt.';
  if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return 'Afbrudt eller ikke tilladt.';
  return `Det lykkedes ikke: ${(e as Error).message}`;
}

export async function loginWithPasskey(): Promise<Me> {
  const { challengeId, options } = await api<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/auth/login/options', {
    method: 'POST',
    anonymous: true,
  });
  const response = await startAuthentication({ optionsJSON: options });
  return api<Me>('/auth/login/verify', { method: 'POST', json: { challengeId, response }, anonymous: true });
}

export const fetchInvite = (token: string) => api<InviteInfo>(`/auth/invite/${encodeURIComponent(token)}`, { anonymous: true });

export async function registerWithInvite(token: string): Promise<Me> {
  const path = `/auth/invite/${encodeURIComponent(token)}`;
  const { challengeId, options } = await api<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(`${path}/options`, {
    method: 'POST',
    anonymous: true,
  });
  const response = await startRegistration({ optionsJSON: options });
  return api<Me>(`${path}/verify`, { method: 'POST', json: { challengeId, response, label: deviceLabel() }, anonymous: true });
}

/** Endnu en passkey til den indloggede bruger (fx på en Mac). */
export async function addPasskey(): Promise<PasskeyInfo[]> {
  const { challengeId, options } = await api<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/me/passkeys/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON: options });
  return api<PasskeyInfo[]>('/me/passkeys/verify', { method: 'POST', json: { challengeId, response, label: deviceLabel() } });
}
