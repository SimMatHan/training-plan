# Træningsnav

Personlig træningsapp (PWA) til styrke, løb og lyske/ankel-rehab. Ét Cloudflare Worker-projekt
serverer både appen (static assets) og API'et (`/api`, Hono). Cloudflare D1 er eneste sandhed;
telefonen har en lokal kopi i IndexedDB, så logning virker uden net.

```
iPhone (PWA) ──► Cloudflare Worker ──► D1
                 ├ static assets (dist/)
                 └ /api (Hono, bearer-token)
```

## Indhold

1. [Deploy første gang](#deploy-første-gang)
2. [Daglig drift: push til main](#daglig-drift-push-til-main)
3. [Migrationer](#migrationer)
4. [Seed](#seed)
5. [Ny planversion](#ny-planversion)
6. [Lokal udvikling](#lokal-udvikling)
7. [Accepttest på iPhone](#accepttest-på-iphone)
8. [Fejlfinding](#fejlfinding)
9. [Sådan virker det](#sådan-virker-det)

## Deploy første gang

Kræver Node 22+, en Cloudflare-konto og adgang til GitHub-repoet. Kommandoerne køres fra en
lokal klon af repoet.

### 1. Hent koden og log ind hos Cloudflare

```sh
git clone https://github.com/SimMatHan/training-plan.git
cd training-plan
npm install
npx wrangler login            # åbner browseren; godkend adgangen
```

### 2. Opret D1-databasen

```sh
npx wrangler d1 create traeningsnav
```

Kommandoen skriver et `database_id` (en uuid). Indsæt det i `wrangler.jsonc` i stedet for
`00000000-0000-0000-0000-000000000000`, og commit:

```sh
git add wrangler.jsonc
git commit -m "Sæt D1 database_id"
git push
```

`database_id` er ikke en hemmelighed. Den skal stå i repoet, så Workers Builds kan finde databasen.

### 3. Opret tabellerne og indlæs planen

```sh
npm run db:migrate:remote     # = wrangler d1 migrations apply traeningsnav --remote
npm run db:seed:remote        # = wrangler d1 execute traeningsnav --remote --file plan/seed.sql
```

Seed indsætter planversion 1 som aktiv og baseline-målingen fra 27/9 (højre 5 cm, venstre 7 cm).
Den gør intet, hvis databasen allerede har en planversion, så den kan køres igen uden skade.

Tjek:

```sh
npx wrangler d1 execute traeningsnav --remote --command "SELECT version, source, is_active FROM plan_versions"
```

### 4. Forbind GitHub med Workers Builds

I Cloudflare-dashboardet:

1. **Workers & Pages → Create → Import a repository**. Forbind GitHub, hvis det ikke er gjort, og vælg
   `SimMatHan/training-plan`.
2. **Project name:** `traeningsnav`. Det skal matche `name` i `wrangler.jsonc`.
3. **Build command:** `npm run build`
4. **Deploy command:** `npm run deploy:ci`
   (= `wrangler d1 migrations apply traeningsnav --remote && wrangler deploy`, så nye migrationer
   køres automatisk før hver deploy).
5. **Production branch:** `main`. Lad **Root directory** være tom.
6. **API token:** vælg *Create new token*. Det automatisk oprettede token har **ikke** adgang til D1.
   Tilføj den bagefter:
   **My Profile → API Tokens → (tokenet der hedder "… Workers Builds …") → Edit → Add more →
   Account · D1 · Edit → Continue to summary → Update token.**
7. **Save and Deploy.** Fejler første build på migrationstrinnet, så er D1-rettigheden ikke på
   tokenet endnu. Ret det og tryk **Retry build**.

Node-versionen styres af `.node-version` (22).

Når buildet er grønt, står appens adresse under **Workers & Pages → traeningsnav**, fx
`https://traeningsnav.<dit-subdomæne>.workers.dev`.

### 5. Sæt API-tokenet (secret)

Lav et langt tilfældigt token og gem det i din password-manager:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Sæt det som secret på Worker'en. Kommandoen beder dig indsætte værdien:

```sh
npx wrangler secret put API_TOKEN
```

Secrets overlever alle fremtidige deploys. Uden `API_TOKEN` afviser API'et alle kald.

Tjek at API'et svarer, og at tokenet virker:

```sh
curl https://traeningsnav.<dit-subdomæne>.workers.dev/api/health
curl -H "Authorization: Bearer <token>" https://traeningsnav.<dit-subdomæne>.workers.dev/api/plan/versions
```

### 6. Installér på iPhone

1. Åbn adressen i **Safari** (ikke Chrome).
2. Indsæt API-tokenet, når appen beder om det. Det gemmes på telefonen.
3. **Del → Føj til hjemmeskærm → Tilføj.**
4. Åbn appen fra hjemmeskærmen. Første gang henter den planen og alle data. Statussen øverst skal
   vise **Synket**.

## Daglig drift: push til main

Hver push til `main` bygger og deployer automatisk og kører eventuelle nye migrationer først.
Andre branches bygges som preview-versioner uden migrationer.

Appen opdaterer sig selv: service workeren henter den nye version i baggrunden, og den bruges
næste gang appen åbnes.

## Migrationer

Migrationer ligger i `migrations/` og køres i rækkefølge efter filnavn.

```sh
npx wrangler d1 migrations create traeningsnav <navn>   # ny fil: migrations/000N_<navn>.sql
npm run db:migrate:local                                # afprøv lokalt
npm test                                                # tests kører alle migrationer mod SQLite
git push                                                # Workers Builds kører den på produktion
```

Regler, så fase 2–4 kun tilføjer og aldrig omskriver:

- Tilføj tabeller og kolonner. Omdøb eller slet aldrig noget, appen eller gamle eksporter bruger.
- Nye kolonner skal være `NULL`-bare eller have en `DEFAULT`.
- En migration der allerede er kørt i produktion, må aldrig ændres. Lav en ny.

Køre en migration manuelt (fx hvis buildets token mangler D1-adgang): `npm run db:migrate:remote`.

## Seed

`plan/seed.sql` genereres fra Excel-arket og må ikke rettes i hånden:

```sh
npm run plan:build          # læser plan/traeningsplan.xlsx
                            # → plan/plan.v1.json, plan/seed.sql, plan/plan.v1.oversigt.md
```

Fortolkningen af arket (stabile `exerciseId`'er, sæt- og RPE-regler) står i `plan/seed-config.ts`
og er godkendt i `plan/AFKLARING.md`. Seed bruges kun til en tom database; senere ændringer af
planen er nye planversioner.

## Ny planversion

Planen gemmes i versioner (`plan_versions`), og kun én er aktiv. Loghistorikken hænger på
`exerciseId`, ikke på versionen, så den følger med. Et id må aldrig skifte betydning.

1. **Ret planen.** Enten i et nyt Excel-ark med samme opbygning (hvis nye øvelsesnavne dukker op,
   får de et id i `plan/seed-config.ts`), eller direkte i en kopi af `plan/plan.v1.json`.
2. **Lav SQL'en:**
   ```sh
   npm run plan:version -- plan/min-plan.xlsx --note "Uge 4 gentages; uge 5–14 rykket"
   # eller:   npm run plan:version -- plan/min-plan.json --note "…"
   # tilføj --activate for at gøre den aktiv med det samme
   ```
   Planen valideres mod `shared/plan.schema.ts`, og der advares, hvis et `exerciseId` fra version 1
   er forsvundet. Resultatet er `plan/ny-version.sql` (gitignored), som indsætter versionen med
   næste nummer, `source = 'manual'` og `based_on_version` = den aktive version.
3. **Indsæt:**
   ```sh
   npx wrangler d1 execute traeningsnav --local --file plan/ny-version.sql    # afprøv lokalt først
   npx wrangler d1 execute traeningsnav --remote --file plan/ny-version.sql
   ```
4. **Aktivér** (hvis du ikke brugte `--activate`): i appen under **Indstillinger → Plan → Brug denne**.

**Rul tilbage:** under **Indstillinger → Plan** trykker du **Brug denne** ud for den tidligere version.
Intet slettes, og loghistorikken bevares.

Fase 3 tilføjer `plan_proposals`, hvor Claudes forslag godkendes i appen og bliver nye versioner
med `source = 'claude'`.

## Lokal udvikling

```sh
npm install
cp .dev.vars.example .dev.vars        # lokalt API-token: lokal-udviklings-token
npm run db:migrate:local
npm run db:seed:local
npm run dev                           # Vite på :5173, Worker på :8787 (/api proxies)
```

| Kommando | Hvad |
|---|---|
| `npm test` | Tests af plan, resolver, services, sync og API (D1 simuleret med node:sqlite) |
| `npm run typecheck` | TypeScript for app, worker og scripts |
| `npm run build` | Bygger PWA'en til `dist/` |
| `npm run preview` | Bygger og kører alt via `wrangler dev` på :8787, som i produktion |
| `npm run plan:build` | Genererer plan og seed fra Excel |
| `npm run plan:version` | SQL til en ny planversion (se ovenfor) |
| `npm run deploy` | Manuel deploy fra din maskine: build, migrationer og deploy |
| `npm run icons` | Genererer PWA-ikoner fra `public/icon.svg` |

Lokal D1 ligger i `.wrangler/` og kan nulstilles med `rm -rf .wrangler`.

## Accepttest på iPhone

Definition of done for fase 1. Kør dem efter første deploy:

- [ ] Appen er installeret fra Safari på hjemmeskærmen og åbner uden browserbjælke.
- [ ] **Flytilstand:** slå den til, log en hel Styrke A-session (eller Rehab A), og luk appen.
      Statussen viser "Offline · N venter". Slå nettet til, åbn appen, og vent på "Synket".
- [ ] Næste gang samme øvelse dukker op, står sidste gangs tal dæmpet i felterne.
- [ ] Luk appen midt i en pause og åbn den igen: intet er tabt, og timeren står rigtigt.
- [ ] Slet appen fra hjemmeskærmen, installér igen og indsæt tokenet: alle data er der stadig.
- [ ] Service-funktionerne i `worker/services/` kan kaldes uden HTTP-laget (`npm test`).

## Fejlfinding

| Symptom | Årsag og løsning |
|---|---|
| Build fejler på `d1 migrations apply` med authentication/permission-fejl | Build-tokenet mangler **Account · D1 · Edit** (trin 4.6). |
| Build fejler med "Couldn't find a D1 DB" | `database_id` i `wrangler.jsonc` er ikke sat eller pushet (trin 2). |
| Appen siger "Tokenet blev afvist" | `API_TOKEN` er ikke sat, eller tokenet er skrevet forkert (trin 5). |
| "Ingen aktiv planversion — kør seed" | Seed er ikke kørt på produktion (trin 3). |
| Status "Sync-fejl" | Tryk på statussen for fejlbeskeden. Data ligger sikkert lokalt og sendes ved næste sync. |
| Appen viser gammel version | Luk den helt og åbn den igen. Service workeren skifter ved næste start. |

Logs: **Workers & Pages → traeningsnav → Logs** (observability er slået til), eller `npx wrangler tail`.

## Sådan virker det

### Logning og sync

- Alt gemmes først i IndexedDB (Dexie) og lægges i en udbakke. Der er ingen gem-knap, og intet tabes,
  hvis appen lukkes.
- Sync kører efter hver ændring, når nettet kommer tilbage, når appen får fokus og hvert minut:
  `POST /api/sync/push` sender hele poster med last-write-wins på `updated_at`.
  `GET /api/sync/pull?since=<cursor>` henter alt ændret siden, inklusive sletninger som tombstones.
- Sæt, øvelsesnoter og mobilitetstjek har deterministiske uuid'er (træning + øvelse + side + sæt),
  så hurtige ændringer aldrig giver dubletter.
- En ny installation henter alt fra D1 ved første sync.
- Pausetimeren gemmer kun sluttidspunktet, så den er korrekt efter slukket skærm og genstart.

### Progression

"Klar til mere vægt" vises på en øvelse, når alle planlagte sæt sidste gang ramte toppen af
rep-intervallet, og øvelsens RPE var logget og ≤ planens mål (`shared/progression.ts`).
Tallene ændres aldrig automatisk.

### Lyske-trafiklys

Reglerne ligger i `shared/groin.ts` og bruges både af appen og af services:

- **Grøn:** højst 3/10 under træning og 0/10 næste morgen.
- **Gul:** over 3/10 under træning, eller ikke væk næste morgen.
- **Rød:** gul to sessioner i træk.
- **Afventer:** morgenscoren mangler endnu. Den spørges dagen efter, første gang appen åbnes.

### API

Alle kald undtagen `/api/health` kræver `Authorization: Bearer <API_TOKEN>`.

| Metode | Sti | Hvad |
|---|---|---|
| GET | `/api/plan/active` | Aktiv planversion |
| GET | `/api/plan/versions` | Alle planversioner |
| POST | `/api/plan/versions/:version/activate` | Skift eller rul tilbage til en version |
| GET | `/api/plan/weeks/:weekNo` | Ugens sessioner med konkret dosering |
| POST | `/api/sync/push` | Gem poster fra klienten |
| GET | `/api/sync/pull?since=` | Hent poster ændret siden cursor |
| GET | `/api/trends/groin?from=YYYY-MM-DD` | Lyske-trafiklys pr. træning |
| GET | `/api/trends/mobility` | Knæ-til-væg-målinger med forskel mellem siderne |
| GET | `/api/history/exercises/:exerciseId?limit=` | Alle gange en øvelse er logget, nyeste først |
| GET | `/api/history/weeks/:weekNo` | Ugens sessioner, volumen pr. øvelse, løbe-km og trafiklys |
| GET | `/api/export` | Alle data som én JSON-fil (planversioner og alle logtabeller) |

Auth er et udskifteligt Hono-middleware (`worker/auth.ts`): `requireAuth(bearerToken())`.
Fase 3 tilføjer en OAuth-strategi til MCP-connectoren ved siden af tokenet.

### Service-funktioner (til MCP i fase 3)

Forretningslogikken ligger i `worker/services/` og tager `db: D1Database` som første parameter, uden HTTP:

| Funktion | Fil |
|---|---|
| `getActivePlan(db)`, `getWeek(db, weekNo)`, `listPlanVersions(db)`, `activatePlanVersion(db, version)` | `plan.ts` |
| `getExerciseHistory(db, exerciseId, limit)`, `getWeeklySummary(db, weekNo)`, `exportAll(db)` | `history.ts` |
| `getGroinTrend(db, fromDate)`, `getMobilityTrend(db)` | `trends.ts` |
| `pushChanges(db, changes)`, `pullChanges(db, since)` | `sync.ts` |

### Struktur

```
src/        frontend (React, Tailwind, Dexie)
worker/     Hono-API; forretningslogik i worker/services/
shared/     zod-skemaer, plan-resolver og ren logik (historik, trafiklys, progression), brugt begge steder
migrations/ D1-migrationer
plan/       traeningsplan.xlsx, seed- og versionsscripts, genereret plan
test/       vitest; test/d1.ts er en D1-adapter over node:sqlite
```
