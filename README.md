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

## Struktur

```
src/        frontend (React, Tailwind, Dexie)
worker/     Hono-API; forretningslogik i worker/services/ (kaldes også af MCP i fase 3)
shared/     zod-skemaer og plan-resolver, brugt begge steder
migrations/ D1-migrationer
plan/       traeningsplan.xlsx, seed-script og genereret plan
```
