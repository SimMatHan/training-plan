# Træningsnav

Personlig træningsapp (PWA) til styrke, løb og lyske/ankel-rehab. Ét Cloudflare Worker-projekt
serverer appen (static assets), API'et (`/api`, Hono) og en MCP-server til Claude (`/mcp`). Cloudflare D1 er eneste sandhed;
telefonen har en lokal kopi i IndexedDB, så logning virker uden net.

```
iPhone (PWA) ──► Cloudflare Worker ──► D1
                 ├ static assets (dist/)
                 ├ /api (Hono, bearer-token)
Kalender-app ──► ├ /cal/<CAL_TOKEN>.ics (kalenderfeed)
claude.ai ─────► └ /mcp (MCP, OAuth) ──► KV (OAuth-tokens)
```

## Indhold

1. [Deploy første gang](#deploy-første-gang)
2. [Daglig drift: push til main](#daglig-drift-push-til-main)
3. [Migrationer](#migrationer)
4. [Seed](#seed)
5. [Ny planversion](#ny-planversion)
6. [Lokal udvikling](#lokal-udvikling)
7. [Kalenderfeed](#kalenderfeed)
8. [Claude-connector (MCP)](#claude-connector-mcp)
9. [Accepttest på iPhone](#accepttest-på-iphone)
10. [Fejlfinding](#fejlfinding)
11. [Sådan virker det](#sådan-virker-det)

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

Sæt også kalendertokenet (se [Kalenderfeed](#kalenderfeed)). Det er en anden secret end
`API_TOKEN`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put CAL_TOKEN
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

### Opdatering af appen på telefonen

Appen skifter **ikke** version af sig selv, så den aldrig genindlæser midt i en træning. Service workeren
henter den nye version i baggrunden (når appen åbnes eller får fokus, og hver 30. minut), og så:

- vises bjælken **Ny version klar** over bundmenuen. Tryk **Opdater**. Bjælken vises ikke under en session,
  og **Senere** skjuler den, til appen åbnes igen.
- eller tryk **Indstillinger → App → Søg efter opdatering → Opdater til ny version**.

Versionen under **Indstillinger → App** er commit-id'et fra Workers Builds, så du kan se, om telefonen kører
det seneste deploy.

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

Claudes forslag (`plan_proposals`) godkendes i appen og bliver nye versioner med `source = 'claude'`
(se [Claude-connector](#claude-connector-mcp)).

## Lokal udvikling

```sh
npm install
cp .dev.vars.example .dev.vars        # API-token: lokal-udviklings-token, kodeord: lokalt-kodeord
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

## Kalenderfeed

Kalenderen abonnerer på `GET /cal/<CAL_TOKEN>.ics`. Feedet genereres ved hvert kald ud fra den aktive
planversion og logs (intet caches i D1), og kalenderappen henter det igen hver 6. time
(`REFRESH-INTERVAL`); svaret må caches i 15 minutter.

### Sæt det op

1. Sæt `CAL_TOKEN` (deploy trin 5). Tokenet står i URL'en og kan lække via kalenderapps, derfor er det
   ikke `API_TOKEN`. Forkert eller manglende token giver 404.
2. I appen: **Indstillinger → Kalender** viser abonnements-URL'en med en kopiknap.
3. På iPhone: **Indstillinger → Kalender → Konti → Tilføj konto → Andet → Tilføj kalender-abonnement**,
   indsæt URL'en, **Næste → Gem**. (Knappen **Abonnér** i appen åbner samme dialog via `webcal://`.)
4. Vælg under **Indstillinger → Kalender** i appen, om styrke, løb og crosstrainer skal stå som heldag
   (standard) eller med starttidspunkt og varighed. Det gemmes i `calendar_settings`.

### Rotér tokenet

Der er ingen knap i appen. Lav et nyt token og sæt det:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put CAL_TOKEN
```

Den gamle URL giver straks 404. Slet abonnementet i kalenderen og tilføj det igen med den nye URL fra
**Indstillinger → Kalender**. Lokalt står tokenet i `.dev.vars` (`CAL_TOKEN=lokal-kalender-token`).

### Hvad står der

| Kilde | Event |
|---|---|
| Planlagt session, ikke lavet | Planens (evt. flyttede) dag i ugen |
| Session lavet | Den faktiske dato, `✓ ` foran titlen. I gang = faktisk dato uden mærke |
| Sprunget over (markeret i appen, eller ugen er passeret uden træning) | Bliver stående med `– ` foran titlen |
| Løbet på `raceDate` og `goals` i planen | Heldagsevent, `Mål: …` |

Titlen er kort: `Styrke A`, `Løb — 3×10 min tærskel`, `Crosstrainer — 45 min`. Beskrivelsen har uge og fase,
øvelserne med ugens dosering (`Enbens RDL — 3 × 8/side, RPE 6, 75 s`), et resultat for lavede sessioner
(topvægt pr. øvelse, løbetal, RPE og lyske) og et link til `/session/<sessionId>?uge=<n>` i appen. Linket
åbner ugens træning, hvis den er startet, ellers ugen.

**Opdatering uden dubletter:** `UID` er `<sessionId>-uge<n>@traeningsnav` og ændrer sig aldrig for en
session i en uge. `LAST-MODIFIED`, `DTSTAMP` og `SEQUENCE` afledes af det seneste tidsstempel blandt alt,
der påvirker eventet: planskiftet (`plan_versions.activated_at`), træninger, sæt, lyske, flytninger og
kalenderindstillingen (tombstones tæller med), plus midnat efter ugen, når en session bliver misset.
`SEQUENCE` er sekunder fra 1/1 2026 til det tidspunkt, så den stiger ved hver ændring uden at noget gemmes.

Koden: `worker/calendar/ical.ts` (serializer: CRLF, foldning ved 75 oktetter, escaping, `VTIMEZONE` for
Europe/Copenhagen), `worker/calendar/feed.ts` (plan + logs → events) og `worker/services/calendar.ts` (D1).
`test/__snapshots__/kalender.ics` er et snapshot af feedet for en kendt plan og et par logs. Ændrer du
feedet med vilje, opdateres det med `npx vitest run -u`.

## Claude-connector (MCP)

Claude (træneren i claude.ai-projektet "Træning") forbinder sig til `https://<domæne>/mcp` som en custom connector.
Claude kan læse planen og alle logs, **foreslå** planændringer, logge løb og skrive noter. Claude kan ikke slette noget,
ændre logs eller aktivere en planversion; det gør du selv i appen.

```
claude.ai ──OAuth (DCR + PKCE)──► /oauth/register, /authorize (kodeord), /oauth/token
          ──Bearer <OAuth-token>─► /mcp  ──► worker/mcp/tools.ts ──► worker/services/ ──► D1
```

### Sæt det op

Kræver at fase 1 er deployet. Kommandoerne køres fra din lokale klon.

**1. Kodeord, KV-namespace og migration**

Lav et langt kodeord og gem det i din password-manager. Det er det, du skriver, når Claude forbinder sig:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
npx wrangler secret put OWNER_PASSWORD
```

OAuth-tokens ligger i et KV-namespace med bindingen `OAUTH_KV`. `wrangler.jsonc` har bindingen uden id, så
`wrangler deploy` opretter namespacet selv ved første deploy. Vil du styre det selv (anbefalet):

```sh
npx wrangler kv namespace list                  # står der allerede et "traeningsnav-oauth-kv" o.l., så brug dets id
npx wrangler kv namespace create OAUTH_KV       # ellers: opret det
```

Indsæt id'et under `kv_namespaces` i `wrangler.jsonc` (`{ "binding": "OAUTH_KV", "id": "<id>" }`) og commit.
Fejler buildet på KV, så mangler build-tokenet **Account · Workers KV Storage · Edit** (tilføjes som D1 i deploy trin 4.6).

Migrationen `0005_claude.sql` (forslag, noter, revisionslog, `workouts.source = 'claude'`) køres automatisk af
Workers Builds ved næste push til `main`. Manuelt: `npm run db:migrate:remote`.

Tjek at alt svarer (efter deploy):

```sh
curl https://<domæne>/.well-known/oauth-authorization-server    # JSON med authorization_endpoint m.m.
curl -i -X POST https://<domæne>/mcp                            # 401 med WWW-Authenticate (ikke 503)
```

503 "MCP-connectoren er ikke sat op" betyder, at `OWNER_PASSWORD` eller `OAUTH_KV` mangler.

**2. Tilføj connectoren i claude.ai (i en browser)**

Det kan ikke gøres fra mobilappen, men connectoren virker der bagefter.

1. Åbn **claude.ai** i en browser på computeren. **Indstillinger → Connectors → Tilføj brugerdefineret connector**
   (Add custom connector).
2. **Navn:** `Træningsnav`. **URL:** `https://<domæne>/mcp` (står også i appen under **Indstillinger → Claude**).
   Lad OAuth Client ID/Secret være tomme; Claude registrerer sig selv.
3. **Tilføj → Forbind.** Et vindue viser "Giv Claude adgang til Træningsnav?". Skriv `OWNER_PASSWORD` og tryk
   **Giv adgang**. Vinduet lukker, og connectoren står som forbundet.

**3. Slå connectoren til i projektet "Træning"**

Åbn projektet **Træning** i claude.ai, start en samtale, tryk på værktøjsknappen (skyderne ved inputfeltet) og slå
**Træningsnav** til. Spørg fx "Hvad løftede jeg i enbens RDL de sidste to gange?". Claude bruger `hent_status`,
`list_ovelser` og `hent_ovelseshistorik` og svarer ud fra dine data. På mobilen er connectoren nu også tilgængelig.

### Værktøjer

| Værktøj | Hvad |
|---|---|
| `hent_status` | Dato, uge X af 14, fase, dagens og ugens sessioner med status, trafiklys de sidste 7 dage, dage siden knee-to-wall, ventende forslag |
| `hent_plan` | Aktiv (eller angivet) planversion kompakt, med JSON Pointer-stier. `sti` giver rå JSON til patches |
| `hent_uge` | Planlagt vs. lavet, volumen pr. øvelse, løbe-km, trafiklys, noter |
| `hent_ovelseshistorik` | Hver gang en øvelse er logget: sæt, RPE, note, "Klar til mere vægt" |
| `list_ovelser` | Alle `exerciseId` med navn |
| `hent_lysketrend` | Score under og morgenen efter pr. træning med trafiklys |
| `hent_mobilitet` | Knee-to-wall-målinger og forskel venstre − højre |
| `hent_lob` | Løb med distance, tid, tempo, puls, RPE, note |
| `foreslaa_planaendring` | JSON Patch mod aktiv version → gemmes som `afventer`. Aktiverer aldrig noget |
| `log_lob` | Opretter et løb med `source = 'claude'` (kun når du beder om det) |
| `skriv_note` | Note til en uge, en session i en uge, eller generel |

Værktøjerne er tynde lag over `worker/services/` (ingen SQL i `worker/mcp/`). Svar er kompakt JSON med datoer som
`YYYY-MM-DD` (dansk tid).

### Forslag til planen

- Et forslag er en JSON Patch (RFC 6902) mod den aktive planversion. Det valideres ved oprettelse og igen ved
  godkendelse: patchen skal kunne anvendes, være højst 50 KB / 200 operationer, og resultatet skal bestå plan-skemaet.
- Et `exerciseId` må aldrig ændres, fjernes eller genbruges (navn, type og sidevis skal være uændrede). Nye øvelser får
  nye id'er, der aldrig har stået i en planversion eller i loggen.
- På **I dag** står "Claude foreslår en ændring til planen". Forslaget viser summary, begrundelse og en læsbar diff
  (fx `Styrke A · Enbens RDL, uge 9–10: 3 × 8/side, RPE 7–8, pause 90 s → 3 × 10/side, …`).
- **Godkend** laver en ny planversion (`source = 'claude'`, forslagets summary som note), som er aktiv med det samme.
  Kalenderfeedet følger med. Rul tilbage under **Indstillinger → Plan**.
- Godkendes ét forslag, bliver de andre ventende `forældet`. Aktiveres en anden version (også en tilbagerulning),
  bliver forslag mod en anden base `forældet`.
- Godkend og afvis findes kun i appen (`/api`, appens token), aldrig som MCP-værktøj.

### Noter fra Claude

Noter (`coach_notes`) synkes til telefonen som de andre data. De står på **I dag** (generelle og ugens), på **Uge** og
på sessionen de hører til, til du trykker **Luk**.

### Sikkerhed

- `/mcp` kræver et OAuth-token udstedt af Worker'en. Tokens gælder kun `/mcp`; `/api` tager stadig kun `API_TOKEN`.
- Kun `https://claude.ai/api/mcp/auth_callback` og `https://claude.com/api/mcp/auth_callback` accepteres som
  `redirect_uri`, både ved registrering og på `/authorize`.
- Højst 5 forkerte kodeord pr. 15 minutter, samlet for alle afsendere (`auth_attempts`). Bagefter siger siden, hvornår
  der kan prøves igen.
- Alt input valideres med zod med størrelsesgrænser. Hvert kald logges i `mcp_audit` (værktøj, tidspunkt, ok/fejl,
  aldrig input). De seneste 20 står under **Indstillinger → Claude**.
- Access-tokens lever 1 time og fornyes med refresh-tokens; en forbindelse der ikke bruges i 30 dage udløber.

**Fjern Claudes adgang:** afbryd connectoren i claude.ai. Vil du også gøre alle udstedte tokens ugyldige på serveren:

```sh
npx wrangler kv key list --binding OAUTH_KV --remote --prefix "token:" > tokens.json
npx wrangler kv key list --binding OAUTH_KV --remote --prefix "grant:" > grants.json
npx wrangler kv bulk delete --binding OAUTH_KV --remote tokens.json
npx wrangler kv bulk delete --binding OAUTH_KV --remote grants.json
```

Har kodeordet været lækket, så sæt også et nyt med `npx wrangler secret put OWNER_PASSWORD`.

### Lokal test med MCP Inspector

`.dev.vars` (fra `.dev.vars.example`) sætter `OWNER_PASSWORD=lokalt-kodeord` og `OAUTH_ALLOW_LOCALHOST=true`, så
Inspectorens `http://localhost`-callback er tilladt. **Sæt aldrig `OAUTH_ALLOW_LOCALHOST` i produktion.**

```sh
npm run db:migrate:local && npm run db:seed:local
npm run preview                                   # bygger og kører wrangler dev på :8787
npx @modelcontextprotocol/inspector               # i en anden terminal; åbner http://localhost:6274
```

I Inspector: tilføj (eller ret) en server med transport **Streamable HTTP** og URL `http://localhost:8787/mcp`, og
slå den til. Browseren sendes til `/authorize`; skriv `lokalt-kodeord` og tryk **Giv adgang**. Under **Tools** kan alle
værktøjer kaldes. Til hurtige kald uden browser findes Inspectorens CLI-tilstand med et token i headeren:
`npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --method tools/list --header "Authorization: Bearer <token>"`.

## Accepttest på iPhone

Definition of done for fase 1. Kør dem efter første deploy:

- [ ] Appen er installeret fra Safari på hjemmeskærmen og åbner uden browserbjælke.
- [ ] **Flytilstand:** slå den til, log en hel Styrke A-session (eller Rehab A), og luk appen.
      Statussen viser "Offline · N venter". Slå nettet til, åbn appen, og vent på "Synket".
- [ ] Næste gang samme øvelse dukker op, står sidste gangs tal dæmpet i felterne.
- [ ] Luk appen midt i en pause og åbn den igen: intet er tabt, og timeren står rigtigt.
- [ ] Slet appen fra hjemmeskærmen, installér igen og indsæt tokenet: alle data er der stadig.
- [ ] Service-funktionerne i `worker/services/` kan kaldes uden HTTP-laget (`npm test`).

Fase 2 (kalenderfeed):

- [ ] Abonnér fra iPhone (se [Kalenderfeed](#kalenderfeed)). Alle 14 ugers sessioner og løbet 31/12 står i
      kalenderen "Træningsplan".
- [ ] Log torsdagens session om fredagen. Efter næste opdatering står den fredag med ✓, og torsdag er tom.
      (Opdatér med det samme: træk ned i Kalender-appens kalenderliste.)
- [ ] Skift planversion under **Indstillinger → Plan**. Eventene ændres uden dubletter.

Fase 3 (Claude-connector):

- [ ] Connectoren er tilføjet i claude.ai, og Claude svarer på "hvad løftede jeg i enbens RDL de sidste to gange?" ud fra
      rigtige data.
- [ ] Bed Claude foreslå en ændring. Banneret står på **I dag**; godkend, og ændringen er aktiv (version fra Claude under
      **Indstillinger → Plan**) og står i kalenderen efter næste opdatering.
- [ ] Forkert kodeord på `/authorize` afvises, og efter 5 forsøg siger siden, hvornår der kan prøves igen.
- [ ] Bed Claude logge et løb og skrive en note: løbet står i ugen med ✓, og noten kan lukkes.

## Fejlfinding

| Symptom | Årsag og løsning |
|---|---|
| Build fejler på `d1 migrations apply` med authentication/permission-fejl | Build-tokenet mangler **Account · D1 · Edit** (trin 4.6). |
| Build fejler med "Couldn't find a D1 DB" | `database_id` i `wrangler.jsonc` er ikke sat eller pushet (trin 2). |
| Appen siger "Tokenet blev afvist" | `API_TOKEN` er ikke sat, eller tokenet er skrevet forkert (trin 5). |
| "Ingen aktiv planversion — kør seed" | Seed er ikke kørt på produktion (trin 3). |
| Kalenderen siger, at abonnementet ikke kan hentes (404) | `CAL_TOKEN` er ikke sat, eller URL'en er fra før tokenet blev roteret. |
| "Kalenderfeedet er ikke slået til" under Indstillinger | `CAL_TOKEN` mangler på Worker'en (trin 5). |
| `/mcp` giver 503 "MCP-connectoren er ikke sat op" | `OWNER_PASSWORD` eller `OAUTH_KV` mangler ([Claude-connector](#sæt-det-op-1) trin 1). |
| claude.ai siger, at connectoren ikke kan forbindes | Tjek URL'en (`https://<domæne>/mcp`) og at `/.well-known/oauth-authorization-server` svarer. Er siden "Kun Claude kan forbindes" vist, er klienten ikke claude.ai. |
| "For mange forkerte forsøg" på `/authorize` | Vent til det tidspunkt siden nævner (15 min efter de forkerte forsøg). |
| Claudes forslag står som "Forældet" | Planen er skiftet siden forslaget. Bed Claude om et nyt mod den aktive version. |
| Status "Sync-fejl" | Tryk på statussen for fejlbeskeden. Data ligger sikkert lokalt og sendes ved næste sync. |
| Appen viser gammel version | Tryk **Opdater** i bjælken eller under **Indstillinger → App**. Kommer der ingen knap (en installation fra før knappen fandtes), så luk appen helt i app-skifteren og åbn den igen. Hjælper det ikke: tjek at statussen siger **Synket**, slet appen fra hjemmeskærmen og tilføj den igen fra Safari. |

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

### Flytning og andre aktiviteter

- **Flyt en session:** ⋯ ud for en session, der ikke er lavet, flytter den til en anden dag i
  samme uge. Flytningen gemmes i `schedule_overrides`, og planen ændres ikke.
  `shared/schedule.ts` lægger flytningerne ovenpå planen for appen, `getWeek` og ugeopsummeringen
  (og kalenderfeedet i fase 2).
- **Spring over:** samme ark (⋯ ud for en session) kan markere en session som sprunget over med en årsag
  (fx "Lyske/smerte") og en note. Den gemmes som en træning med `skipped_at` og `skip_reason` og vises i
  ugen og historikken i stedet for "Misset". Den kan fortrydes.
- **Anden aktivitet** (padel, fodbold …): en træning uden for planen med `type = 'cardio'` og sportens
  navn i `workouts.activity`. Du logger tid, puls, evt. distance, RPE, note og lysken. Den tæller med i
  trafiklyset men ikke som en planlagt session.

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

Alle kald undtagen `/api/health` kræver `Authorization: Bearer <API_TOKEN>`. Kalenderfeedet ligger uden for
`/api` og bruger sit eget token i URL'en.

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
| GET | `/api/calendar` | Abonnements-URL'en og kalenderindstillinger pr. sessionstype |
| PUT | `/api/calendar/settings/:type` | `{ all_day, start_time: "HH:MM", duration_min }` for `styrke`, `løb` eller `cardio` |
| GET | `/api/proposals?status=afventer` | Claudes forslag med læsbar diff, nyeste først |
| GET | `/api/proposals/:id` | Ét forslag |
| POST | `/api/proposals/:id/approve` | Godkend: ny aktiv planversion fra Claude. 409 hvis forslaget er afgjort eller forældet |
| POST | `/api/proposals/:id/reject` | Afvis |
| GET | `/api/mcp/audit` | De seneste 20 MCP-kald (værktøj, tidspunkt, ok/fejl) |
| GET | `/cal/<CAL_TOKEN>.ics` | Kalenderfeedet (`text/calendar`). Forkert token giver 404 |
| POST | `/mcp` | MCP (Streamable HTTP). Kræver et OAuth-token, ikke `API_TOKEN` |

Auth er et udskifteligt Hono-middleware (`worker/auth.ts`): `requireAuth(bearerToken())`. MCP-connectorens OAuth
(`@cloudflare/workers-oauth-provider`, `worker/oauth/`) ligger ved siden af og beskytter kun `/mcp`.

### Service-funktioner (bruges af API'et og MCP)

Forretningslogikken ligger i `worker/services/` og tager `db: D1Database` som første parameter, uden HTTP:

| Funktion | Fil |
|---|---|
| `getActivePlan(db)`, `getWeek(db, weekNo)`, `listPlanVersions(db)`, `activatePlanVersion(db, version)` | `plan.ts` |
| `getExerciseHistory(db, exerciseId, limit)`, `getWeeklySummary(db, weekNo)`, `exportAll(db)` | `history.ts` |
| `getGroinTrend(db, fromDate)`, `getMobilityTrend(db)` | `trends.ts` |
| `pushChanges(db, changes)`, `pullChanges(db, since)` | `sync.ts` |
| `buildCalendarFeed(db, { origin })`, `getCalendarSettings(db)`, `setCalendarSetting(db, type, setting)` | `calendar.ts` |
| `createProposal(db, input)`, `listProposals(db)`, `approveProposal(db, id)`, `rejectProposal(db, id)`, `validatePatch(db, base, patch)` | `proposals.ts` |
| `createCoachNote(db, input)`, `listCoachNotes(db)` | `notes.ts` |
| `listWorkouts(db, filter)`, `logRun(db, input)` | `workouts.ts` |
| `recordMcpCall(db, entry)`, `listMcpAudit(db)`, `authAttemptStatus(db)`, `recordAuthAttempt(db, ok)` | `audit.ts` |

### Struktur

```
src/        frontend (React, Tailwind, Dexie)
worker/     Hono-API; forretningslogik i worker/services/; MCP-værktøjer i worker/mcp/, OAuth i worker/oauth/
shared/     zod-skemaer, plan-resolver og ren logik (historik, trafiklys, progression), brugt begge steder
migrations/ D1-migrationer
plan/       traeningsplan.xlsx, seed- og versionsscripts, genereret plan
test/       vitest; test/d1.ts er en D1-adapter over node:sqlite
```
