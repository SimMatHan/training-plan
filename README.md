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

## Struktur

```
src/        frontend (React, Tailwind, Dexie)
worker/     Hono-API; forretningslogik i worker/services/ (kaldes også af MCP i fase 3)
shared/     zod-skemaer og plan-resolver, brugt begge steder
migrations/ D1-migrationer
plan/       traeningsplan.xlsx, seed-script og genereret plan
```
