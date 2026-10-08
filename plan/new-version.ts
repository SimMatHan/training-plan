// Laver SQL til en ny planversion ud fra et rettet Excel-ark eller en plan-JSON.
//
//   npm run plan:version -- <fil.xlsx|fil.json> --note "Hvad er ændret" [--activate] [--athlete simon]
//
// Skriver plan/ny-version.sql for atleten (standard simon). Versionsnummeret bliver atletens højeste + 1,
// source = 'manual', based_on_version = den aktive version. Uden --activate
// indsættes versionen inaktiv og aktiveres under Indstillinger i appen.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanSchema, type Plan } from '../shared/plan.schema';
import { assertStatementSize, build, sql } from './seed';

const here = path.dirname(fileURLToPath(import.meta.url));

function args() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  const noteIndex = argv.indexOf('--note');
  const note = noteIndex >= 0 ? argv[noteIndex + 1] : undefined;
  if (!file || !note) {
    console.error('Brug: npm run plan:version -- <fil.xlsx|fil.json> --note "Hvad er ændret" [--activate]');
    process.exit(1);
  }
  const athleteIndex = argv.indexOf('--athlete');
  const athlete = athleteIndex >= 0 ? argv[athleteIndex + 1] : 'simon';
  if (!/^[a-z][a-z0-9-]*$/.test(athlete)) {
    console.error(`Ugyldig atlet: ${athlete}`);
    process.exit(1);
  }
  return { file, note, activate: argv.includes('--activate'), athlete };
}

async function loadPlan(file: string): Promise<Plan> {
  if (file.endsWith('.xlsx')) return (await build(file)).plan;
  return PlanSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

const { file, note, activate, athlete } = args();
const plan = await loadPlan(file);

// Loghistorik hænger på exerciseId. Advar hvis et id fra version 1 er forsvundet.
const v1 = PlanSchema.parse(JSON.parse(readFileSync(path.join(here, 'plan.v1.json'), 'utf8')));
const ids = new Set(plan.exercises.map((e) => e.id));
const missing = v1.exercises.filter((e) => !ids.has(e.id)).map((e) => e.id);
if (missing.length)
  console.warn(`Advarsel: disse exerciseId'er findes ikke længere: ${missing.join(', ')}. Deres historik bevares, men vises ikke under planens øvelser.`);

const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const athleteId = `(SELECT id FROM athletes WHERE slug = ${sql(athlete)})`;
const insert =
  `INSERT INTO plan_versions (athlete_id, version, created_at, source, note, plan_json, is_active, based_on_version)\n` +
  `SELECT ${athleteId}, COALESCE(MAX(version), 0) + 1, ${now}, 'manual', ${sql(note)}, ${sql(JSON.stringify(plan))}, 0,\n` +
  `  (SELECT version FROM plan_versions WHERE athlete_id = ${athleteId} AND is_active = 1) FROM plan_versions WHERE athlete_id = ${athleteId};`;
assertStatementSize(insert);

const lines = [`-- Genereret af plan/new-version.ts fra ${path.basename(file)}.`, insert];
if (activate)
  lines.push(
    `UPDATE plan_versions SET is_active = 0 WHERE athlete_id = ${athleteId} AND is_active = 1;`,
    `UPDATE plan_versions SET is_active = 1, activated_at = ${now} WHERE athlete_id = ${athleteId} AND version = (SELECT MAX(version) FROM plan_versions WHERE athlete_id = ${athleteId});`,
  );
const out = path.join(here, 'ny-version.sql');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Skrev ${path.relative(process.cwd(), out)} for ${athlete} (${plan.weeks.length} uger, ${plan.exercises.length} øvelser${activate ? ', aktiveres' : ', indsættes inaktiv'}).`);
