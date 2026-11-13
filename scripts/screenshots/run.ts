// Screenshots af alle skærme i 390 × 844, lys og mørk, til screenshots/.
//
//   npm run screenshots              # alle
//   npm run screenshots -- logning   # kun dem hvis navn indeholder "logning"
//
// Starter Vite i dev-tilstand og svarer selv på /api med data fra fixtures.ts (Simon, mandag i uge 6),
// så der hverken skal bruges Worker, D1 eller passkey. Uret står fast på fixtures.NOW.
// På Linux findes SF Pro ikke; Inter bruges som stedfortræder, hvis den er installeret. Bundens safe-area
// efterlignes (34 px). Toppen er 0: appen starter under iOS' faste statuslinje (status-bar-style default).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import { createServer } from 'vite';
import * as f from './fixtures';

const OUT = path.resolve(import.meta.dirname, '../../screenshots');
const filter = process.argv.slice(2);

type Scenario = {
  name: string;
  full?: boolean;
  loggedOut?: boolean;
  /** Planen med en yogarutine mandag i uge 6. */
  yoga?: boolean;
  viewport?: { width: number; height: number };
  run: (page: Page) => Promise<void>;
};

/** Starter yogarutinen og spoler `sec` sekunder frem (uret står ellers stille). */
async function playYoga(page: Page, sec: number, pause = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start yoga' }).click();
  await page.getByRole('button', { name: 'Start rutinen' }).click();
  await page.clock.setFixedTime(new Date(Date.parse(f.NOW) + sec * 1000));
  if (pause) await page.getByRole('button', { name: 'Pause' }).first().click();
  await page.waitForTimeout(400);
}

/** Åbner dagens mobilitetssession fra I dag. */
async function openMobility(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start mobilitet' }).click();
  await page.getByRole('group', { name: 'Vis mobilitetsblokken som' }).waitFor();
}

async function startSession(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.waitForURL(/\/session\//);
}

async function toFirstExercise(page: Page) {
  await startSession(page);
  await page.getByRole('heading', { name: /Rumænsk dødløft/ }).waitFor();
  // Sidste gangs tal er forslagene, ✓ gemmer: vent til de er indlæst.
  await page.getByText('50 kg × 8').first().waitFor();
}

/** En øvelse på logningssiden (kortet), scrollet op under topbjælken. */
async function toExercise(page: Page, name: RegExp) {
  await toFirstExercise(page);
  const card = page.getByRole('article', { name });
  await card.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.evaluate('window.scrollBy(0, -96)');
  return card;
}

const scenarios: Scenario[] = [
  { name: 'dev-ui', full: true, run: (p) => p.goto('/dev/ui').then(() => undefined) },
  {
    name: 'dev-figurer-udvalgt',
    full: true,
    run: (p) =>
      p.goto(`/dev/figurer?vis=${process.env.FIGURER ?? 'copenhagen-plank,sideplanke,glideskinne-leg-curl,step-down,pull-up-elastik,psoas-release'}`).then(() => p.getByText('Figurer').waitFor()),
  },
  { name: 'dev-figurer', full: true, run: (p) => p.goto('/dev/figurer').then(() => p.getByText('Figurer').waitFor()) },
  { name: '1-logning-mobilitet', run: startSession },
  { name: '2-logning', run: toFirstExercise },
  {
    name: '3-logning-pause',
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('button', { name: /Sæt 1.*færdigt/ }).first().click();
      await p.getByRole('timer').waitFor();
    },
  },
  {
    name: '4-logning-rekord',
    run: async (p) => {
      const card = await toExercise(p, /Rumænsk dødløft/);
      await card.getByRole('textbox', { name: 'Sæt 1, kg' }).fill('55');
      await card.getByRole('button', { name: /Sæt 1.*færdigt/ }).click();
      await p.getByText('Ny rekord').waitFor();
      await p.getByRole('button', { name: 'Spring over' }).click();
      await card.evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await p.evaluate('window.scrollBy(0, -96)');
    },
  },
  {
    name: '4b-logning-runder',
    run: async (p) => {
      await toExercise(p, /Bulgarian split squat/);
    },
  },
  {
    name: '4c-logning-pr-side',
    run: async (p) => {
      const card = await toExercise(p, /Bulgarian split squat/);
      await card.getByRole('button', { name: /^Mere for/ }).click();
      await p.getByRole('switch', { name: /Forskellig vægt eller reps pr. side/ }).click();
      await p.getByRole('dialog').getByRole('button', { name: 'Luk' }).click();
      await card.getByRole('button', { name: /Sæt 1 venstre/ }).first().waitFor();
    },
  },
  {
    // En runde skal logge begge sider: en runde tæller først som lavet, når begge sider er det.
    name: '4d-runde-logger-begge-sider',
    run: async (p) => {
      const card = await toExercise(p, /Bulgarian split squat/);
      await card.getByRole('button', { name: /^Sæt 1 færdigt/ }).click();
      await p.getByRole('button', { name: 'Spring over' }).click();
      await p.getByText('1/17', { exact: true }).waitFor();
      console.log('  runde logget på begge sider (1/17 sæt)');
    },
  },
  {
    name: '4e-illustration',
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('button', { name: /Se hvordan Rumænsk .* udføres/ }).click();
      await p.getByRole('dialog').waitFor();
    },
  },
  {
    name: '4f-hele-traeningen-logning',
    full: true,
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('button', { name: /^Sæt 1 færdigt/ }).first().click();
      await p.getByRole('button', { name: 'Spring over' }).click();
    },
  },
  {
    name: '4g-ekstra-saet',
    run: async (p) => {
      const card = await toExercise(p, /Rumænsk dødløft/);
      await card.getByRole('button', { name: 'Tilføj sæt' }).click();
      await card.getByText('ekstra').waitFor();
    },
  },
  {
    name: '4j-fjern-saet',
    run: async (p) => {
      const card = await toExercise(p, /Rumænsk dødløft/);
      const rows = card.getByRole('list', { name: /^Sæt,/ }).getByRole('listitem');
      const before = await rows.count();
      await card.getByRole('button', { name: /^Fjern sæt/ }).click();
      await card.getByRole('listitem').nth(before - 1).waitFor({ state: 'detached' });
    },
  },
  {
    name: '4k-flyt-oevelse',
    run: async (p) => {
      const card = await toExercise(p, /Rumænsk dødløft/);
      await card.getByRole('button', { name: /^Mere for/ }).click();
      await p.getByRole('dialog').getByText('Flyt ned', { exact: true }).click();
      await p.waitForTimeout(800);
    },
  },
  {
    name: '4i-saetur',
    run: async (p) => {
      const card = await toExercise(p, /Copenhagen plank/);
      await card.getByRole('button', { name: /Start uret, sæt 1/ }).first().click();
      await card.getByRole('timer').first().waitFor();
    },
  },
  {
    name: '4h-ekstra-oevelse',
    run: async (p) => {
      await toFirstExercise(p);
      await p.getByRole('button', { name: 'Tilføj øvelse' }).click();
      await p.getByRole('searchbox', { name: 'Søg i øvelser' }).fill('face');
      await p.getByRole('button', { name: /Face pull/ }).click();
      await p.getByRole('heading', { name: 'Face pull' }).waitFor();
      await p.waitForTimeout(600);
    },
  },
  {
    name: '6b-hele-traeningen-i-dag',
    run: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Se hele træningen' }).click();
      await p.getByRole('dialog').getByText('Rumænsk dødløft (RDL)').waitFor();
    },
  },
  { name: '5-logning-afslut', run: async (p) => {
      await startSession(p);
      await p.getByRole('button', { name: 'Afslut', exact: true }).click();
      await p.getByRole('heading', { name: 'Afslut' }).waitFor();
    } },
  {
    // Definition of done: en hel Styrke A logget med ✓ alene (sidste gangs tal), uden at tastaturet åbnes.
    name: '13-hel-styrke-a',
    run: async (p) => {
      await startSession(p);
      await p.evaluate(`window.__keyboard = 0; addEventListener('focusin', (e) => { if (e.target.matches('input, textarea')) window.__keyboard++; });`);
      for (const box of await p.getByRole('checkbox').all()) await box.check({ force: true });
      const skip = p.getByRole('button', { name: 'Spring over' });
      for (;;) {
        const open = p.locator('button[aria-label$="færdigt"][aria-pressed="false"]');
        if ((await open.count()) === 0) break;
        await open.first().click();
        if (await skip.isVisible()) await skip.click();
      }
      await p.getByRole('button', { name: 'Afslut', exact: true }).click();
      await p.getByRole('group', { name: /Venstre lyske under/ }).getByRole('button', { name: '1', exact: true }).click();
      await p.getByRole('button', { name: 'Afslut session' }).click();
      await p.waitForURL((u) => u.pathname === '/');
      await p.getByRole('button', { name: 'Vis session' }).waitFor();
      const keyboard = await p.evaluate('window.__keyboard');
      if (keyboard !== 0) throw new Error(`tastaturet blev åbnet ${keyboard} gange`);
      console.log('  hel Styrke A logget uden tastatur');
    },
  },
  { name: '14-ret-session', full: true, run: (p) => p.goto('/plan/styrke-a?uge=6').then(() => p.getByRole('heading', { name: 'Ret Styrke A' }).waitFor()) },
  {
    name: '14b-ret-oevelse',
    run: async (p) => {
      await p.goto('/plan/styrke-a?uge=6');
      await p.getByRole('button', { name: /Rumænsk dødløft/ }).click();
      await p.getByRole('button', { name: 'Sæt: flere', exact: true }).click();
      await p.getByRole('dialog').getByText('Pause').waitFor();
    },
  },
  {
    name: '14c-ret-aendringer',
    run: async (p) => {
      await p.goto('/plan/styrke-a?uge=6');
      await p.getByRole('button', { name: /Rumænsk dødløft/ }).click();
      await p.getByRole('button', { name: 'Sæt: flere', exact: true }).click();
      await p.getByRole('dialog').getByRole('button', { name: 'Luk' }).click();
      await p.getByRole('button', { name: 'Flyt 6 op' }).click();
      await p.getByText('Ændringer', { exact: true }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    },
  },
  {
    name: '14d-tilfoej-oevelse',
    run: async (p) => {
      await p.goto('/plan/styrke-a?uge=6');
      await p.getByRole('button', { name: 'Tilføj øvelse' }).click();
      await p.getByRole('dialog').getByText('Ny øvelse').waitFor();
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
  {
    name: '15-yoga-i-dag',
    yoga: true,
    run: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Start yoga' }).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    },
  },
  {
    name: '15b-yoga-oversigt',
    yoga: true,
    full: true,
    run: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Start yoga' }).click();
      await p.getByRole('button', { name: 'Start rutinen' }).waitFor();
    },
  },
  { name: '15c-yoga-afspiller', yoga: true, run: (p) => playYoga(p, 95) },
  { name: '15c2-yoga-naeste-oevelse', yoga: true, run: (p) => playYoga(p, 119) },
  { name: '15d-yoga-skift-side', yoga: true, run: (p) => playYoga(p, 192) },
  {
    name: '15e-yoga-cast',
    yoga: true,
    run: async (p) => {
      await playYoga(p, 95);
      await p.getByRole('button', { name: 'Vis på TV' }).click();
      await p.getByRole('button', { name: 'Start TV-visning' }).click();
      await p.getByText('TV’et er forbundet').waitFor();
    },
  },
  { name: '15f-yoga-lyd', yoga: true, run: async (p) => {
      await playYoga(p, 95);
      await p.getByRole('button', { name: 'Lyd' }).click();
      await p.getByRole('dialog').getByText('Lyde ved skift').waitFor();
    } },
  { name: '15g-yoga-liggende', yoga: true, viewport: { width: 844, height: 390 }, run: (p) => playYoga(p, 95) },
  { name: '15h-yoga-tv', yoga: true, viewport: { width: 1280, height: 720 }, run: (p) => p.goto(`/tv/${f.castToken}`).then(() => p.getByText('Tryk OK for lyd').waitFor()) },
  { name: '15i-yoga-tv-kode', viewport: { width: 1280, height: 720 }, run: (p) => p.goto('/tv').then(() => p.getByRole('textbox', { name: 'Kode fra telefonen' }).waitFor()) },
  { name: '15j-yoga-faerdig', yoga: true, run: (p) => playYoga(p, 1300) },
  // Mobilitetsblokken (planens tjekliste) i en mobilitetssession: vælg tjekliste eller afspiller.
  { name: '16-mobilitet-tjekliste', run: openMobility },
  {
    name: '16b-mobilitet-afspiller-oversigt',
    full: true,
    run: async (p) => {
      await openMobility(p);
      await p.getByRole('button', { name: 'Afspiller' }).click();
      await p.getByRole('button', { name: 'Start rutinen' }).waitFor();
    },
  },
  {
    name: '16c-mobilitet-afspiller',
    run: async (p) => {
      await openMobility(p);
      await p.getByRole('button', { name: 'Afspiller' }).click();
      await p.getByRole('button', { name: 'Start rutinen' }).click();
      await p.clock.setFixedTime(new Date(Date.parse(f.NOW) + 20_000));
      await p.waitForTimeout(400);
    },
  },
  { name: '12-login', loggedOut: true, run: (p) => p.goto('/').then(() => p.getByRole('button', { name: /Face ID/ }).waitFor()) },
];

let pulled = false;
async function api(route: Route, loggedOut: boolean, yoga: boolean) {
  const url = new URL(route.request().url());
  const p = url.pathname.replace(/^\/api/, '').replace(/^\/a\/simon/, '');
  const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // Cast til TV (yoga): opret, opdatér, TV'ets visning og kodeopslag.
  const now = Date.parse(f.NOW);
  if (p === '/cast' && route.request().method() === 'POST') return json({ token: f.castToken, code: '482913', expiresAt: f.NOW, serverNow: now });
  if (p.startsWith('/cast/kode/')) return json({ token: f.castToken });
  if (p.startsWith('/cast/') && route.request().method() === 'PUT') return json({ serverNow: now, tvSeenAt: now });
  if (p === `/cast/${f.castToken}`)
    return json({ title: 'Yoga · hofter og ankler', routine: f.yogaRoutine, state: { playing: true, elapsedMs: 95_000, tvSound: true }, stateAt: now, serverNow: now, tvSeenAt: now, ended: false });
  if (loggedOut) return json({ error: 'Ikke logget ind' }, 401);
  if (p === '/me') return json(f.me);
  if (p === '/plan/active') return json({ meta: f.meta, plan: yoga ? f.planWithYoga : f.plan });
  if (p === '/plan/versions' && route.request().method() === 'POST') return json({ meta: { ...f.meta, version: 2 }, plan: f.plan, diff: [] });
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
// PW_CHROMIUM: en anden Chromium end Playwrights egen (fx en forudinstalleret).
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
mkdirSync(OUT, { recursive: true });

try {
  for (const s of scenarios.filter((s) => !filter.length || filter.some((x) => s.name.includes(x)))) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        baseURL: 'http://localhost:5199',
        viewport: s.viewport ?? { width: 390, height: 844 },
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
      await context.route('**/api/**', (r) => api(r, !!s.loggedOut, !!s.yoga));
      // SF Pro findes ikke på Linux: Inter er den nærmeste stedfortræder.
      await context.addInitScript({
        content: `addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = ':root { --font-sans: Inter, sans-serif !important; } * { caret-color: transparent; } .pb-safe { padding-bottom: 34px !important; } .pb-tabbar { padding-bottom: calc(34px + 6rem) !important; }';
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
