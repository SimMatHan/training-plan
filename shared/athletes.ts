// Brugere, atleter og overvågning, som API'et sender dem til appen. Uden zod, så frontenden kan importere typerne.

/** ejer: alt. traener: læse og (via Claude) foreslå, men ikke logge eller godkende. */
export type Role = 'ejer' | 'traener';

export const ROLE_RANK: Record<Role, number> = { traener: 1, ejer: 2 };

export interface AthleteRef {
  slug: string;
  name: string;
  role: Role;
}

export interface Me {
  user: { id: number; name: string; isAdmin: boolean; onboarded: boolean };
  /** Atleter brugeren har adgang til; egen atlet (ejer) først. */
  athletes: AthleteRef[];
}

export interface Monitor {
  id: number;
  label: string;
  active: boolean;
  sort: number;
}

export interface MobilityTest {
  id: number;
  name: string;
  unit: string;
  per_side: boolean;
  active: boolean;
  instructions: string | null;
}

export interface Profile {
  athlete: { slug: string; name: string; thresholdHr: number | null };
  role: Role;
  monitors: Monitor[];
  mobilityTests: MobilityTest[];
}

export interface AccessEntry {
  userId: number;
  name: string;
  role: Role;
  grantedAt: string;
}

export interface Sharing {
  access: AccessEntry[];
  /** Brugere der kan få trænerrollen (fx den der inviterede dig). */
  candidates: { userId: number; name: string }[];
}

export interface PasskeyInfo {
  id: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UserInfo {
  id: number;
  name: string;
  isAdmin: boolean;
  athletes: { slug: string; role: Role }[];
  passkeys: number;
}

export interface InviteInfo {
  name: string;
  /** Gendannelse: passkey'en føjes til en eksisterende bruger. */
  existingUser: boolean;
}
