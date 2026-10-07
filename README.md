# Træningsnav

Personlig træningsapp (PWA) til styrke, løb og lyske/ankel-rehab. Ét Cloudflare Worker-projekt
serverer appen (static assets) og API'et (`/api`, Hono). Data ligger i Cloudflare D1.

Fuld deploy-guide følger i milepæl 6.

## Udvikling

```sh
npm install
cp .dev.vars.example .dev.vars        # lokalt API-token
npm run db:migrate:local              # D1-skema lokalt
npm run db:seed:local                 # planversion 1 + baseline-måling
npm run dev                           # Vite (5173) + Worker (8787); /api proxies til Worker
```

| Kommando | Hvad |
|---|---|
| `npm run plan:build` | Læser `plan/traeningsplan.xlsx` → `plan.v1.json`, `seed.sql`, `plan.v1.oversigt.md` |
| `npm test` | Tests af plan, resolver, services og API (D1 simuleret med node:sqlite) |
| `npm run typecheck` | TypeScript for app, worker og scripts |
| `npm run build` | Bygger PWA'en til `dist/` |
| `npm run preview` | Bygger og kører alt via `wrangler dev` på port 8787, som i produktion |
| `npm run icons` | Genererer PWA-ikoner fra `public/icon.svg` |

## Sådan virker logning og sync

- Alt gemmes først i IndexedDB (Dexie) og lægges i en udbakke. Intet gem-knap; intet tabes hvis appen lukkes.
- Sync kører efter hver ændring, når nettet kommer tilbage, når appen får fokus og hvert minut:
  `POST /api/sync/push` (hele poster, last-write-wins på `updated_at`) og
  `GET /api/sync/pull?since=<cursor>` (alt ændret siden, inkl. sletninger som tombstones).
- Sæt, øvelsesnoter og mobilitetstjek har deterministiske uuid'er (træning + øvelse + side + sæt),
  så hurtige ændringer aldrig giver dubletter.
- En ny installation henter alt fra D1 ved første sync.
- Pausetimeren gemmer kun sluttidspunktet, så den er korrekt efter slukket skærm og genstart.

## API

Alle kald undtagen `/api/health` kræver `Authorization: Bearer <API_TOKEN>`.

| Metode | Sti | Hvad |
|---|---|---|
| GET | `/api/plan/active` | Aktiv planversion |
| GET | `/api/plan/versions` | Alle planversioner |
| POST | `/api/plan/versions/:version/activate` | Skift/rul tilbage til en version |
| GET | `/api/plan/weeks/:weekNo` | Ugens sessioner med konkret dosering |
| POST | `/api/sync/push` | Gem poster fra klienten |
| GET | `/api/sync/pull?since=` | Hent poster ændret siden cursor |
| GET | `/api/trends/groin?from=YYYY-MM-DD` | Lyske-trafiklys pr. træning |
| GET | `/api/trends/mobility` | Knæ-til-væg-målinger med forskel mellem siderne |
| GET | `/api/history/exercises/:exerciseId?limit=` | Alle gange en øvelse er logget, nyeste først |
| GET | `/api/history/weeks/:weekNo` | Ugens sessioner, volumen pr. øvelse, løbe-km og trafiklys |
| GET | `/api/export` | Alle data som én JSON-fil (planversioner og alle logtabeller) |

## Service-funktioner (til MCP i fase 3)

Forretningslogikken ligger i `worker/services/` og tager `db: D1Database` som første parameter, uden HTTP:

| Funktion | Fil |
|---|---|
| `getActivePlan(db)`, `getWeek(db, weekNo)`, `listPlanVersions(db)`, `activatePlanVersion(db, version)` | `plan.ts` |
| `getExerciseHistory(db, exerciseId, limit)`, `getWeeklySummary(db, weekNo)`, `exportAll(db)` | `history.ts` |
| `getGroinTrend(db, fromDate)`, `getMobilityTrend(db)` | `trends.ts` |
| `pushChanges(db, changes)`, `pullChanges(db, since)` | `sync.ts` |

## Progression

"Klar til mere vægt" vises på en øvelse, når alle planlagte sæt sidste gang ramte toppen af
rep-intervallet, og øvelsens RPE var logget og ≤ planens mål (`shared/progression.ts`).
Tallene ændres aldrig automatisk.

## Lyske-trafiklys

Reglerne ligger i `shared/groin.ts` og bruges både af appen og af services:

- **Grøn:** højst 3/10 under træning og 0/10 næste morgen.
- **Gul:** over 3/10 under træning, eller ikke væk næste morgen.
- **Rød:** gul to sessioner i træk.
- **Afventer:** morgenscoren mangler endnu (spørges dagen efter, første gang appen åbnes).

## Struktur

```
src/        frontend (React, Tailwind, Dexie)
worker/     Hono-API; forretningslogik i worker/services/ (kaldes også af MCP i fase 3)
shared/     zod-skemaer og plan-resolver, brugt begge steder
migrations/ D1-migrationer
plan/       traeningsplan.xlsx, seed-script og genereret plan
```
