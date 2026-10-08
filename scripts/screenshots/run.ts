// Screenshots af alle skærme i 390 × 844, lys og mørk, til screenshots/.
//
//   npm run screenshots              # alle
//   npm run screenshots -- logning   # kun dem hvis navn indeholder "logning"
//
// Starter Vite i dev-tilstand og svarer selv på /api med data fra fixtures.ts (Simon, mandag i uge 6),
// så der hverken skal bruges Worker, D1 eller passkey. Uret står fast på fixtures.NOW.
// På Linux findes SF Pro ikke; Inter bruges som stedfortræder, hvis den er installeret. Safe-area efterlignes
// som på en iPhone i 390 × 844 (47 px top, 34 px bund), så luften over titlerne ligner telefonen.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import { createServer } from 'vite';
import * as f from './fixtures';

const OUT = path.resolve(import.meta.dirname, '../../screenshots');
const filter = process.argv.slice(2);

type Scenario = { name: string; full?: boolean; loggedOut?: boolean; run: (page: Page) => Promise<void> };

async function startSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.waitForURL(/\/session\//);
}

async function toFirstExercise(page: Page) {
  await startSession(page);
  await page.getByRole('button', { name: /Til øvelserne|Næste øvelse/ }).click();
  await page.getByRole('heading', { name: /Rumænsk dødløft/ }).waitFor();
}

const scenarios: Scenario[] = [
  { name: 'dev-ui', full: true, run: (p) => p.goto('/dev/ui').then(() => undefined) },
  { name: '1-logning-mobilitet', run: startSession },
  { name: '2-logning', run: toFirstExercise },
  {
    name: '3-logning-pause',
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('button', { name: /Sæt 1.*færdigt/ }).click();
      await p.getByRole('timer').waitFor();
    },
  },
  {
    name: '4-logning-rekord',
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('spinbutton', { name: /Sæt 1, kg/ }).focus();
      await p.keyboard.press('ArrowUp');
      await p.keyboard.press('ArrowUp');
      await p.getByRole('button', { name: /Sæt 1.*færdigt/ }).click();
      await p.getByText('Ny rekord').waitFor();
      await p.getByRole('button', { name: 'Spring over' }).click();
      await p.evaluate('window.scrollTo(0, 0)');
    },
  },
  { name: '5-logning-afslut', run: async (p) => {
      await startSession(p);
      for (let i = 0; i < 7; i++) await p.getByRole('button', { name: /Til øvelserne|Næste øvelse|Til afslutning/ }).click();
      await p.getByRole('heading', { name: 'Afslut' }).waitFor();
    } },
  {
    // Definition of done: en hel Styrke A logget med talhjul og ✓, uden at tastaturet åbnes.
    name: '13-hel-styrke-a',
    run: async (p) => {
      await startSession(p);
      await p.evaluate(`window.__keyboard = 0; addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) window.__keyboard++; });`);
      for (const box of await p.getByRole('checkbox').all()) await box.check({ force: true });
      await p.getByRole('button', { name: 'Til øvelserne' }).click();
      for (let step = 0; step < 6; step++) {
        const skip = p.getByRole('button', { name: 'Spring over' });
        for (;;) {
          const open = p.locator('button[aria-label$="færdigt"][aria-pressed="false"]');
          if ((await open.count()) === 0) break;
          await open.first().click();
          if (await skip.isVisible()) await skip.click();
        }
        await p.getByRole('button', { name: /Næste øvelse|Til afslutning/ }).click();
      }
      await p.getByRole('group', { name: /Venstre lyske under/ }).getByRole('button', { name: '1', exact: true }).click();
      await p.getByRole('button', { name: 'Afslut session' }).click();
      await p.waitForURL((u) => u.pathname === '/');
      await p.getByRole('button', { name: 'Vis session' }).waitFor();
      const keyboard = await p.evaluate('window.__keyboard');
      if (keyboard !== 0) throw new Error(`tastaturet blev åbnet ${keyboard} gange`);
      console.log('  hel Styrke A logget uden tastatur');
    },
  },
  { name: '6-i-dag', run: (p) => p.goto('/').then(() => p.getByRole('button', { name: /Start session/ }).waitFor()) },
  { name: '6-i-dag-hele', full: true, run: (p) => p.goto('/').then(() => p.getByRole('button', { name: /Start session/ }).waitFor()) },
  { name: '7-historik', run: (p) => p.goto('/historik').then(() => p.getByText('Rumænsk dødløft (RDL)').first().waitFor()) },
  {
    name: '7-historik-uger',
    run: async (p) => {
      await p.goto('/historik');
      await p.getByRole('button', { name: 'Uger' }).click();
      await p.getByRole('button', { name: /^Uge 2/ }).click();
      await p.getByText(/Sprunget over · Kalender\/tid/).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    },
  },
  { name: '8-historik-oevelse', run: (p) => p.goto('/historik/oevelse/enbens-rdl').then(() => p.getByText('Bedste resultat').waitFor()) },
  { name: '8-historik-oevelse-hele', full: true, run: (p) => p.goto('/historik/oevelse/enbens-rdl').then(() => p.getByText('Bedste resultat').waitFor()) },
  { name: '9-uge', run: (p) => p.goto('/uge').then(() => p.getByText('Styrke A').first().waitFor()) },
  { name: '9-uge-hele', full: true, run: (p) => p.goto('/uge').then(() => p.getByText('Styrke A').first().waitFor()) },
  { name: '9-uge-forrige', run: (p) => p.goto('/uge?uge=5').then(() => p.getByText('Styrke A').first().waitFor()) },
  { name: '10-indstillinger', full: true, run: (p) => p.goto('/indstillinger').then(() => p.getByText('Version 1').first().waitFor()) },
  { name: '11-mobilitet', run: (p) => p.goto('/mobilitet').then(() => p.getByText('Knee-to-wall').first().waitFor()) },
  { name: '12-login', loggedOut: true, run: (p) => p.goto('/').then(() => p.getByRole('button', { name: /Face ID/ }).waitFor()) },
];

let pulled = false;
async function api(route: Route, loggedOut: boolean) {
  const url = new URL(route.request().url());
  const p = url.pathname.replace(/^\/api/, '').replace(/^\/a\/simon/, '');
  const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (loggedOut) return json({ error: 'Ikke logget ind' }, 401);
  if (p === '/me') return json(f.me);
  if (p === '/plan/active') return json({ meta: f.meta, plan: f.plan });
  if (p === '/plan/versions') return json([f.meta]);
  if (p === '/profile') return json(f.profile);
  if (p === '/sync/push') return json({});
  if (p === '/sync/pull') {
    if (url.searchParams.has('since') || pulled) return json({ changes: {}, cursor: null });
    pulled = true;
    return json({
      changes: { workouts: f.workouts, set_logs: f.sets, exercise_notes: f.notes, pain_scores: f.pain, mobility_measurements: f.measurements },
      cursor: '2026-11-02T07:00:00.000Z',
    });
  }
  if (p.startsWith('/proposals')) return json([]);
  if (p === '/sharing') return json(f.sharing);
  if (p === '/calendar') return json(f.calendar);
  if (p === '/mcp/audit') return json(f.audit);
  if (p === '/me/passkeys') return json(f.passkeys);
  if (p === '/admin/users') return json({ users: [{ id: 1, name: 'Simon', isAdmin: true, athletes: [{ slug: 'simon', role: 'ejer' }], passkeys: 1 }], invites: [] });
  return json({ error: `ikke mocket: ${p}` }, 404);
}

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

try {
  for (const s of scenarios.filter((s) => !filter.length || filter.some((x) => s.name.includes(x)))) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5199',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme,
        locale: 'da-DK',
        timezoneId: 'Europe/Copenhagen',
        serviceWorkers: 'block',
      });
      await context.clock.setFixedTime(new Date(f.NOW));
      pulled = false;
      await context.route('**/api/**', (r) => api(r, !!s.loggedOut));
      // SF Pro findes ikke på Linux: Inter er den nærmeste stedfortræder.
      await context.addInitScript({
        content: `addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = ':root { --font-sans: Inter, sans-serif !important; } * { caret-color: transparent; } .pt-safe { padding-top: 47px !important; } .pb-safe { padding-bottom: 34px !important; } .pb-tabbar { padding-bottom: calc(34px + 6rem) !important; }';
          document.head.append(style);
        });`,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', (e) => console.error(`  [${s.name}/${colorScheme}] ${e.message}`));
      try {
        await s.run(page);
        await page.waitForTimeout(500);
        const file = path.join(OUT, `${s.name}-${colorScheme === 'light' ? 'lys' : 'moerk'}.png`);
        await page.screenshot({ path: file, fullPage: !!s.full });
        console.log(`✓ ${path.relative(process.cwd(), file)}`);
      } catch (e) {
        console.error(`✗ ${s.name}/${colorScheme}: ${(e as Error).message.split('\n')[0]}`);
        await page.screenshot({ path: path.join(OUT, `fejl-${s.name}-${colorScheme}.png`) }).catch(() => undefined);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
