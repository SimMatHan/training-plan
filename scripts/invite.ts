// Invitationslink fra kommandolinjen — også nødvejen, hvis alle passkeys er mistet.
//
//   npm run invite -- --name Simon --admin --url https://traening.example.dk
//   npm run invite -- --name Karo --url https://traening.example.dk
//   npm run invite -- --name Simon --local          # lokal D1 (wrangler dev)
//
// Findes der allerede en bruger med navnet, bliver det en gendannelse: passkey'en føjes til den
// bruger (al historik bevares). Ellers oprettes en ny bruger med sin egen atlet.
// Linket gælder i 7 dage og kan bruges én gang. Kun tokenets SHA-256 gemmes i D1.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('name')?.trim();
if (!name) {
  console.error('Brug: npm run invite -- --name <navn> [--admin] [--url https://<domæne>] [--local]');
  process.exit(1);
}
const admin = process.argv.includes('--admin');
const local = process.argv.includes('--local');
const url = (arg('url') ?? process.env.APP_ORIGIN ?? '').replace(/\/$/, '');

const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const hash = createHash('sha256').update(token).digest('hex');
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const sql =
  `INSERT INTO invites (token_hash, name, is_admin, user_id, created_by, created_at, expires_at) ` +
  `VALUES (${q(hash)}, ${q(name)}, ${admin ? 1 : 0}, (SELECT id FROM users WHERE name = ${q(name)} ORDER BY id LIMIT 1), NULL, ` +
  `${q(iso(now))}, ${q(iso(now + 7 * 86_400_000))});`;

execFileSync('npx', ['wrangler', 'd1', 'execute', 'traeningsnav', local ? '--local' : '--remote', '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] });

const link = `${url}/invite/${token}`;
console.log(`\nInvitation til ${name}${admin ? ' (admin)' : ''}, gyldig i 7 dage og kun én gang:\n\n  ${link}\n`);
if (!url) console.log('Sæt appens adresse foran stien (eller brug --url https://<domæne>).\n');
console.log('Åbn linket på telefonen i den installerede app (eller Safari) og opret en passkey.');
