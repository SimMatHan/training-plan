// Login med passkeys (WebAuthn), invitationslinks, egen konto og admin.
//   /api/auth/*   uden session, rate limit pr. IP
//   /api/me/*     egen bruger (kræver session)
//   /api/admin/*  brugere og invitationer (kræver admin)
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { z } from 'zod';
import type { InviteInfo, Me } from '../../shared/athletes';
import { appOrigin, clearSessionCookie, clientIp, requireAdmin, requireSession, rpId, SESSION_COOKIE, sessionCookie } from '../auth';
import type { AppEnv } from '../env';
import { assertPositiveId, createAthleteForUser, getSharing, grantCoach, listAthletesForUser, ownAthlete, updateAthlete } from '../services/athletes';
import { authAttemptStatus, recordAuthAttempt } from '../services/audit';
import { ConflictError, NotFoundError, ValidationError } from '../services/errors';
import {
  addPasskey,
  createInvite,
  createSession,
  deletePasskey,
  deleteSession,
  findInvite,
  findPasskey,
  getUser,
  listOpenInvites,
  listPasskeys,
  listUsers,
  markOnboarded,
  markPasskeyUsed,
  redeemInvite,
  renamePasskey,
  storeChallenge,
  takeChallenge,
  userCredentialIds,
  type SessionUser,
} from '../services/users';

const RP_NAME = 'Træningsnav';

const VerifyBody = z.object({
  challengeId: z.string().min(1).max(64),
  response: z.looseObject({ id: z.string().min(1).max(1024) }),
  label: z.string().trim().max(60).optional(),
});

/** Et kort navn til en ny passkey ud fra enheden, fx "iPhone" eller "Mac". */
function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}

const transportsOf = (t: string[] | undefined) => t as AuthenticatorTransportFuture[] | undefined;

/** Rate limit: højst 10 forsøg pr. IP pr. 15 minutter på login og invitationer. */
async function limited(c: Context<AppEnv>): Promise<Response | null> {
  const status = await authAttemptStatus(c.env.DB, clientIp(c));
  if (status.allowed) return null;
  const seconds = Math.max(1, Math.ceil((Date.parse(status.retryAt!) - Date.now()) / 1000));
  return c.json({ error: 'For mange forsøg. Prøv igen om lidt.', retryAt: status.retryAt }, 429, { 'Retry-After': String(seconds) });
}

const attempt = (c: Context<AppEnv>, kind: string, ok: boolean) => recordAuthAttempt(c.env.DB, clientIp(c), kind, ok);

async function startSession(c: Context<AppEnv>, user: SessionUser) {
  const id = await createSession(c.env.DB, user.id, c.req.header('User-Agent') ?? null);
  c.header('Set-Cookie', sessionCookie(id));
}

async function registrationOptions(c: Context<AppEnv>, opts: { userHandle: string; userName: string; exclude: { id: string; transports?: string[] }[] }) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(c.env, c.req.url),
    userName: opts.userName,
    userDisplayName: opts.userName,
    userID: new Uint8Array(new TextEncoder().encode(opts.userHandle)),
    attestationType: 'none',
    excludeCredentials: opts.exclude.map((e) => ({ id: e.id, transports: transportsOf(e.transports) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
}

async function verifyRegistration(c: Context<AppEnv>, challenge: string, response: unknown) {
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: appOrigin(c.env, c.req.url),
      expectedRPID: rpId(c.env, c.req.url),
      requireUserVerification: false,
    });
  } catch (e) {
    throw new ValidationError(`Passkey kunne ikke registreres: ${(e as Error).message}`);
  }
  if (!verified.verified || !verified.registrationInfo) throw new ValidationError('Passkey kunne ikke registreres');
  const { credential } = verified.registrationInfo;
  return { credentialId: credential.id, publicKey: isoBase64URL.fromBuffer(credential.publicKey), counter: credential.counter, transports: credential.transports };
}

export async function getMe(db: D1Database, user: SessionUser): Promise<Me> {
  return { user, athletes: await listAthletesForUser(db, user.id) };
}

// ─── /api/auth ──────────────────────────────────────────────────────────────

export const authRoutes = new Hono<AppEnv>()
  .post('/login/options', async (c) => {
    const blocked = await limited(c);
    if (blocked) return blocked;
    const options = await generateAuthenticationOptions({ rpID: rpId(c.env, c.req.url), userVerification: 'preferred', allowCredentials: [] });
    const challengeId = await storeChallenge(c.env.DB, { challenge: options.challenge, kind: 'login' });
    return c.json({ challengeId, options });
  })
  .post('/login/verify', async (c) => {
    const blocked = await limited(c);
    if (blocked) return blocked;
    const body = VerifyBody.parse(await c.req.json());
    const challenge = await takeChallenge(c.env.DB, body.challengeId, 'login');
    const passkey = await findPasskey(c.env.DB, body.response.id);
    if (!challenge || !passkey) {
      await attempt(c, 'login', false);
      return c.json({ error: challenge ? 'Passkey kendes ikke. Brug et invitationslink for at oprette adgang.' : 'Login udløb. Prøv igen.' }, 401);
    }
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: appOrigin(c.env, c.req.url),
        expectedRPID: rpId(c.env, c.req.url),
        credential: {
          id: passkey.credential_id,
          publicKey: isoBase64URL.toBuffer(passkey.public_key),
          counter: passkey.counter,
          transports: transportsOf(passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined),
        },
        requireUserVerification: false,
      });
    } catch {
      result = { verified: false } as const;
    }
    if (!result.verified) {
      await attempt(c, 'login', false);
      return c.json({ error: 'Login mislykkedes' }, 401);
    }
    await attempt(c, 'login', true);
    await markPasskeyUsed(c.env.DB, passkey.id, result.authenticationInfo.newCounter);
    const user = (await getUser(c.env.DB, passkey.user_id))!;
    await startSession(c, user);
    return c.json(await getMe(c.env.DB, user));
  })
  .get('/invite/:token', async (c) => {
    const blocked = await limited(c);
    if (blocked) return blocked;
    const invite = await findInvite(c.env.DB, c.req.param('token'));
    await attempt(c, 'invite', !!invite);
    if (!invite) return c.json({ error: 'Linket er ugyldigt, udløbet eller allerede brugt' }, 404);
    return c.json<InviteInfo>({ name: invite.name, existingUser: invite.userId !== null });
  })
  .post('/invite/:token/options', async (c) => {
    const blocked = await limited(c);
    if (blocked) return blocked;
    const invite = await findInvite(c.env.DB, c.req.param('token'));
    await attempt(c, 'invite', !!invite);
    if (!invite) return c.json({ error: 'Linket er ugyldigt, udløbet eller allerede brugt' }, 404);
    const options = await registrationOptions(c, {
      userHandle: invite.userId ? `tn-${invite.userId}` : `tn-invite-${invite.tokenHash.slice(0, 16)}`,
      userName: invite.name,
      exclude: invite.userId ? await userCredentialIds(c.env.DB, invite.userId) : [],
    });
    const challengeId = await storeChallenge(c.env.DB, { challenge: options.challenge, kind: 'invite', inviteHash: invite.tokenHash });
    return c.json({ challengeId, options });
  })
  .post('/invite/:token/verify', async (c) => {
    const blocked = await limited(c);
    if (blocked) return blocked;
    const body = VerifyBody.parse(await c.req.json());
    const invite = await findInvite(c.env.DB, c.req.param('token'));
    const challenge = await takeChallenge(c.env.DB, body.challengeId, 'invite');
    if (!invite || !challenge || challenge.inviteHash !== invite.tokenHash) {
      await attempt(c, 'invite', false);
      return c.json({ error: 'Linket er ugyldigt, udløbet eller allerede brugt' }, 404);
    }
    const key = await verifyRegistration(c, challenge.challenge, body.response);
    await attempt(c, 'invite', true);
    const user = await redeemInvite(c.env.DB, invite);
    await addPasskey(c.env.DB, { userId: user.id, ...key, label: body.label || deviceLabel(c.req.header('User-Agent')) });
    // En ny bruger får sin egen atlet med det samme; onboarding kan omdøbe den.
    if (!(await ownAthlete(c.env.DB, user.id))) await createAthleteForUser(c.env.DB, user.id, user.name);
    await startSession(c, user);
    return c.json(await getMe(c.env.DB, user));
  })
  .post('/logout', async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) await deleteSession(c.env.DB, id);
    c.header('Set-Cookie', clearSessionCookie());
    return c.json({ ok: true });
  });

// ─── /api/me ────────────────────────────────────────────────────────────────

const Onboarding = z.object({
  name: z.string().trim().min(1).max(40),
  thresholdHr: z.int().min(80).max(230).nullable(),
  /** Må den der inviterede (fx Simon) være træner? Skal vælges aktivt. */
  coach: z.boolean(),
});

export const meRoutes = new Hono<AppEnv>()
  .use('*', requireSession)
  .get('/', async (c) => c.json(await getMe(c.env.DB, c.var.user)))
  .post('/onboarding', async (c) => {
    const input = Onboarding.parse(await c.req.json());
    const user = c.var.user;
    const athlete = (await ownAthlete(c.env.DB, user.id)) ?? (await createAthleteForUser(c.env.DB, user.id, input.name));
    await updateAthlete(c.env.DB, athlete.id, { name: input.name, thresholdHr: input.thresholdHr });
    if (input.coach) {
      const { candidates } = await getSharing(c.env.DB, athlete.id, user.id);
      for (const cand of candidates) await grantCoach(c.env.DB, athlete.id, user.id, cand.userId);
    }
    await markOnboarded(c.env.DB, user.id, input.name);
    return c.json(await getMe(c.env.DB, (await getUser(c.env.DB, user.id))!));
  })
  .get('/passkeys', async (c) => c.json(await listPasskeys(c.env.DB, c.var.user.id)))
  .patch('/passkeys/:id', async (c) => {
    const { label } = z.object({ label: z.string() }).parse(await c.req.json());
    await renamePasskey(c.env.DB, c.var.user.id, assertPositiveId(c.req.param('id'), 'passkey-id'), label);
    return c.json(await listPasskeys(c.env.DB, c.var.user.id));
  })
  .delete('/passkeys/:id', async (c) => {
    await deletePasskey(c.env.DB, c.var.user.id, assertPositiveId(c.req.param('id'), 'passkey-id'));
    return c.json(await listPasskeys(c.env.DB, c.var.user.id));
  })
  // Endnu en passkey på denne enhed (fx en Mac uden iCloud-nøglering fra iPhonen).
  .post('/passkeys/options', async (c) => {
    const user = c.var.user;
    const options = await registrationOptions(c, { userHandle: `tn-${user.id}`, userName: user.name, exclude: await userCredentialIds(c.env.DB, user.id) });
    const challengeId = await storeChallenge(c.env.DB, { challenge: options.challenge, kind: 'passkey', userId: user.id });
    return c.json({ challengeId, options });
  })
  .post('/passkeys/verify', async (c) => {
    const body = VerifyBody.parse(await c.req.json());
    const challenge = await takeChallenge(c.env.DB, body.challengeId, 'passkey');
    if (!challenge || challenge.userId !== c.var.user.id) throw new ValidationError('Registreringen udløb. Prøv igen.');
    const key = await verifyRegistration(c, challenge.challenge, body.response);
    if (await findPasskey(c.env.DB, key.credentialId)) throw new ConflictError('Den passkey er allerede tilføjet');
    await addPasskey(c.env.DB, { userId: c.var.user.id, ...key, label: body.label || deviceLabel(c.req.header('User-Agent')) });
    return c.json(await listPasskeys(c.env.DB, c.var.user.id));
  });

// ─── /api/admin ─────────────────────────────────────────────────────────────

const InviteInput = z.object({
  name: z.string().trim().min(1).max(40),
  isAdmin: z.boolean().default(false),
  /** Gendannelse: en ny passkey til en eksisterende bruger. */
  userId: z.int().min(1).nullable().default(null),
});

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireAdmin)
  .get('/users', async (c) => c.json({ users: await listUsers(c.env.DB), invites: await listOpenInvites(c.env.DB) }))
  .post('/invites', async (c) => {
    const input = InviteInput.parse(await c.req.json());
    if (input.userId && !(await getUser(c.env.DB, input.userId))) throw new NotFoundError('Brugeren findes ikke');
    const token = await createInvite(c.env.DB, { ...input, createdBy: c.var.user.id });
    return c.json({ url: `${appOrigin(c.env, c.req.url)}/invite/${token}` });
  });
