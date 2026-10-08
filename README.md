# Træningsnav

Træningsapp (PWA) til styrke, løb og rehab — for flere atleter (Simon og Karo), hver med sin egen plan og sine
egne logs. Ét Cloudflare Worker-projekt serverer appen (static assets), API'et (`/api`, Hono) og én MCP-forbindelse
til Claude pr. atlet (`/mcp/<atlet>`). Cloudflare D1 er eneste sandhed; telefonen har en lokal kopi af brugerens egen
træning i IndexedDB, så logning virker uden net. Login sker med passkeys (Face ID).

```
iPhone (PWA) ──► Cloudflare Worker ──► D1
                 ├ static assets (dist/)
                 ├ /api (Hono, passkey-login, session-cookie) ── /api/a/<atlet>/…
Kalender-app ──► ├ /cal/<atlet>/<token>.ics (kalenderfeed pr. atlet)
claude.ai ─────► └ /mcp/<atlet> (MCP, OAuth pr. atlet) ──► KV (OAuth-tokens)
```

**Begreber.** En *bruger* logger ind (Simon, Karo). En *atlet* er den, en plan og logs tilhører (`simon`, `karo`).
*Adgang* kobler bruger og atlet med rollen `ejer` (alt) eller `traener` (se uge, historik og forslag; via Claude læse og
foreslå). Hver bruger er ejer af sin egen atlet og kan give andre trænerrollen. Kun ejeren kan logge og godkende forslag.

## Indhold

1. [Deploy første gang](#deploy-første-gang)
2. [Fase 5: login og flere atleter (udrulning)](#fase-5-login-og-flere-atleter-udrulning)
3. [Daglig drift: push til main](#daglig-drift-push-til-main)
4. [Migrationer](#migrationer)
5. [Seed](#seed)
6. [Ny planversion](#ny-planversion)
7. [Lokal udvikling](#lokal-udvikling)
8. [Kalenderfeed](#kalenderfeed)
9. [Claude-connector (MCP)](#claude-connector-mcp)
10. [Brugere, login og deling](#brugere-login-og-deling)
11. [Accepttest på iPhone](#accepttest-på-iphone)
12. [Fejlfinding](#fejlfinding)
13. [Sådan virker det](#sådan-virker-det)

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

Migrationerne opretter atleten `simon` og brugeren Simon (admin) med monitoren "Venstre lyske" og testen
Knee-to-wall. Seed indsætter planversion 1 som aktiv for `simon` og baseline-målingen fra 27/9 (højre 5 cm, venstre 7 cm).
Den gør intet, hvis Simon allerede har en planversion, så den kan køres igen uden skade.

Tjek:

```sh
npx wrangler d1 execute traeningsnav --remote --command "SELECT athlete_id, version, source, is_active FROM plan_versions"
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

### 5. Fastlæg domænet

Passkeys er bundet til domænet. Skifter du senere fra `*.workers.dev` til et eget domæne, skal alle registrere en
ny passkey (via et invitationslink). Vælg derfor domænet nu. Bruger du et eget domæne, så tilføj det under
**Workers & Pages → traeningsnav → Settings → Domains & Routes** og sæt det som variabel, så passkeys og
Origin-tjekket altid bruger det, uanset hvilken adresse et kald kommer ind på:

```sh
npx wrangler secret put APP_ORIGIN      # fx https://traening.example.dk (uden / til sidst)
```

Uden `APP_ORIGIN` bruges den adresse, kaldet kom ind på.

### 6. Første login og installér på iPhone

Der er ingen kodeord. Lav et invitationslink til dig selv fra kommandolinjen:

```sh
npm run invite -- --name Simon --admin --url https://<domæne>
```

1. Åbn adressen i **Safari** (ikke Chrome). **Del → Føj til hjemmeskærm → Tilføj.**
2. Åbn linket fra `npm run invite` i Safari, tryk **Opret adgang med Face ID**. Passkey'en gemmes i iCloud-nøgleringen.
3. Åbn appen fra hjemmeskærmen og tryk **Log ind med Face ID**. Første gang henter den planen og alle data. Statussen
   øverst skal vise **Synket**.

`npm run invite` er også nødvejen, hvis alle passkeys er mistet: med et eksisterende navn bliver det en gendannelse
(ny passkey til samme bruger; al historik bevares).

Kalenderen og Claude sættes op bagefter (se [Kalenderfeed](#kalenderfeed) og [Claude-connector](#claude-connector-mcp)).

## Fase 5: login og flere atleter (udrulning)

Fase 5 erstatter `API_TOKEN`, `CAL_TOKEN` og `OWNER_PASSWORD` med passkey-login, gør al data pr. atlet og giver hver atlet
sin egen MCP-forbindelse. Al eksisterende data tilhører atleten `simon` efter migrationen. Gør det i denne rækkefølge:

**0. Før du merger.** Fastlæg domænet ([trin 5](#5-fastlæg-domænet)). Åbn appen på telefonen og tjek at statussen siger
**Synket**: den nye app bruger en ny lokal database pr. bruger, og en gammel udbakke med usendte ændringer sendes ikke
(den gamle database bevares dog urørt, hvis den ikke er tom).

**1. Backup af D1** (køres ikke automatisk):

```sh
npx wrangler d1 export traeningsnav --remote --output backup-før-fase5.sql
```

**Afprøv migrationen på kopien** (lokalt i node:sqlite, uden at røre produktionen). Scriptet tæller rækker og beregner
lyske-trafiklysene med fase 1-reglen, kører `0006_atleter.sql`, læser det hele igen gennem de nye services og fejler
højlydt ved den mindste afvigelse i rækketal, trafiklysfarver, knee-to-wall eller planversioner:

```sh
npm run db:verify-migration -- backup-før-fase5.sql
npm run db:verify-migration -- backup-før-fase5.sql --cleanup   # også oprydningen (trin 7)
```

Vil du se det i appen, så indlæs kopien i den lokale D1 og kør migrationen der:
`rm -rf .wrangler && npx wrangler d1 execute traeningsnav --local --file backup-før-fase5.sql && npm run db:migrate:local`.

**2. Deploy migrationen og den nye kode:** merge til `main`. Workers Builds kører `0006_atleter.sql` før deployet.
Migrationen indeholder selv kontroller (rækketal og at alle rækker har fået en atlet) og afbrydes, hvis en fejler.

**3. Log ind som Simon:**

```sh
npm run invite -- --name Simon --admin --url https://<domæne>
```

Åbn linket på iPhone i Safari (eller den installerede app), registrér passkey'en, åbn appen og log ind. Tjek at al
historik, alle planversioner og lyske-trafiklyset er som før.

**4. Claude for Simon:** i claude.ai fjern den gamle Træningsnav-connector og tilføj
`https://<domæne>/mcp/simon` som **Træningsnav – Simon** (se [Claude-connector](#claude-connector-mcp)). Det gamle `/mcp`
svarer nu 410.

**5. Invitér Karo:** **Indstillinger → Brugere → Opret invitation** (navn Karo). Send linket. Hun installerer PWA'en,
åbner linket, registrerer en passkey og vælger, om du må være træner. Hun ser en tom app, der venter på sin første plan.

**6. Claude for Karo:** tilføj `https://<domæne>/mcp/karo` som **Træningsnav – Karo** i den claude.ai-konto, hvor Karos
projekt skal ligge. Hun (eller du som træner, hvis hun har sagt ja) logger ind med passkey, når claude.ai beder om det.

**7. Oprydning, når alt er bekræftet:** flyt `migrations-pending/0007_oprydning.sql` til `migrations/` og push. Den
fjerner de gamle kolonner (`workouts.groin_during`, `groin_checks`, `mobility_measurements.knee_to_wall_*`), som 0006 har
kopieret. Koden bruger dem ikke længere.

Til sidst kan de gamle secrets slettes: `npx wrangler secret delete API_TOKEN`, `CAL_TOKEN` og `OWNER_PASSWORD`.
Kalenderabonnementet fra før fase 5 holder op med at virke; lav et nyt link under **Indstillinger → Kalender**.

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

### Nyt hjemmeskærmikon

Et nyt appikon (fx vægtløfteren fra det nye design) kommer med næste opdatering i browserfanen og i Safari, men
**iOS viser først det nye ikon på hjemmeskærmen, når appen er fjernet og tilføjet igen**: hold på ikonet → **Fjern
app → Slet fra hjemmeskærm**, åbn adressen i Safari og **Del → Føj til hjemmeskærm**. Log ind med Face ID; sørg
for at statussen sagde **Synket** først, så intet usendt går tabt. Service workerens cache har fået et nyt navn
(`CACHE_VERSION` i `vite.config.ts`), så installerede apps henter alle filer forfra ved opdateringen.

## Migrationer

Migrationer ligger i `migrations/` og køres i rækkefølge efter filnavn.

```sh
npx wrangler d1 migrations create traeningsnav <navn>   # ny fil: migrations/000N_<navn>.sql
npm run db:migrate:local                                # afprøv lokalt
npm test                                                # tests kører alle migrationer mod SQLite
git push                                                # Workers Builds kører den på produktion
```

Regler, så senere faser kun tilføjer og aldrig omskriver:

- Tilføj tabeller og kolonner. Omdøb eller slet aldrig noget, appen eller gamle eksporter bruger.
- Nye kolonner skal være `NULL`-bare eller have en `DEFAULT`.
- En migration der allerede er kørt i produktion, må aldrig ændres. Lav en ny.

Køre en migration manuelt (fx hvis buildets token mangler D1-adgang): `npm run db:migrate:remote`.

Fase 5 (`0006_atleter.sql`) er undtagelsen fra "kun tilføjelser": `plan_versions` og `calendar_settings` bygges om,
fordi deres nøgler skal være pr. atlet. Migrationer der fjerner noget, ligger i `migrations-pending/`, til de er
bekræftet, og flyttes så til `migrations/` (Workers Builds kører alt i `migrations/` automatisk).

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
   # tilføj --activate for at gøre den aktiv med det samme, og --athlete karo for en anden atlet end simon
   ```
   Planen valideres mod `shared/plan.schema.ts`, og der advares, hvis et `exerciseId` fra version 1
   er forsvundet. Resultatet er `plan/ny-version.sql` (gitignored), som indsætter versionen med
   atletens næste nummer, `source = 'manual'` og `based_on_version` = den aktive version.
3. **Indsæt:**
   ```sh
   npx wrangler d1 execute traeningsnav --local --file plan/ny-version.sql    # afprøv lokalt først
   npx wrangler d1 execute traeningsnav --remote --file plan/ny-version.sql
   ```
4. **Aktivér** (hvis du ikke brugte `--activate`): i appen under **Indstillinger → Plan → Brug denne**.

**Rul tilbage:** under **Indstillinger → Plan** trykker du **Brug denne** ud for den tidligere version.
Intet slettes, og loghistorikken bevares.

Claudes forslag (`plan_proposals`) godkendes i appen og bliver nye versioner med `source = 'claude'`
(se [Claude-connector](#claude-connector-mcp)). En atlets første plan kommer altid som et forslag (`foreslaa_ny_plan`).

## Lokal udvikling

```sh
npm install
cp .dev.vars.example .dev.vars        # APP_ORIGIN=http://localhost:5173 (passkeys og Origin-tjek)
npm run db:migrate:local
npm run db:seed:local
npm run invite -- --name Simon --admin --local --url http://localhost:5173
npm run dev                           # Vite på :5173, Worker på :8787 (/api, /mcp … proxies)
```

Åbn invitationslinket i en browser og opret en passkey (Chrome og Safari kan bruge passkeys på `localhost`). Bruger du
`npm run preview` (alt på :8787), så sæt `APP_ORIGIN=http://localhost:8787` og brug `--url http://localhost:8787`.

| Kommando | Hvad |
|---|---|
| `npm test` | Tests af plan, resolver, services, sync, API, adskillelse, migration og passkey-flow (D1 simuleret med node:sqlite) |
| `npm run typecheck` | TypeScript for app, worker og scripts |
| `npm run build` | Bygger PWA'en til `dist/` |
| `npm run preview` | Bygger og kører alt via `wrangler dev` på :8787, som i produktion |
| `npm run plan:build` | Genererer plan og seed fra Excel |
| `npm run plan:version` | SQL til en ny planversion (se ovenfor) |
| `npm run deploy` | Manuel deploy fra din maskine: build, migrationer og deploy |
| `npm run icons` | Genererer favicon, hjemmeskærm- og manifestikoner fra `brand/icon.svg` til `brand/` og `public/` |
| `npm run screenshots [-- <navn>]` | Screenshots af alle skærme i 390 × 844, lys og mørk, til `screenshots/` (se Design) |
| `npm run invite -- --name <navn> [--admin] [--url …] [--local]` | Invitationslink (ny bruger, eller gendannelse ved et eksisterende navn) |
| `npm run db:verify-migration -- <backup.sql> [--cleanup]` | Afprøver fase 5-migrationen mod en kopi af produktionen |

Lokal D1 ligger i `.wrangler/` og kan nulstilles med `rm -rf .wrangler`.

## Kalenderfeed

Hver atlet har sit eget feed: `GET /cal/<atlet>/<token>.ics`. Feedet genereres ved hvert kald ud fra atletens aktive
planversion og logs (intet caches i D1), og kalenderappen henter det igen hver 6. time (`REFRESH-INTERVAL`); svaret må
caches i 15 minutter. En atlet uden plan får et tomt feed.

### Sæt det op

1. I appen: **Indstillinger → Kalender → Lav nyt link**. Tokenet gemmes kun hashet (SHA-256) i D1, så URL'en vises
   kun nu og huskes på denne enhed. Forkert atlet eller token giver 404.
2. På iPhone: **Indstillinger → Kalender → Konti → Tilføj konto → Andet → Tilføj kalender-abonnement**,
   indsæt URL'en, **Næste → Gem**. (Knappen **Abonnér** i appen åbner samme dialog via `webcal://`.)
3. Vælg under **Indstillinger → Kalender** i appen, om styrke, løb og crosstrainer skal stå som heldag
   (standard) eller med starttidspunkt og varighed. Det gemmes i `calendar_settings` pr. atlet.

### Nyt link

**Lav nyt link** under **Indstillinger → Kalender** laver et nyt token; det gamle link giver straks 404. Slet
abonnementet i kalenderen og tilføj det igen med den nye URL.

### Hvad står der

| Kilde | Event |
|---|---|
| Planlagt session, ikke lavet | Planens (evt. flyttede) dag i ugen |
| Session lavet | Den faktiske dato, `✓ ` foran titlen. I gang = faktisk dato uden mærke |
| Sprunget over (markeret i appen, eller ugen er passeret uden træning) | Bliver stående med `– ` foran titlen |
| Løbet på `raceDate` og `goals` i planen | Heldagsevent, `Mål: …` |

Titlen er kort: `Styrke A`, `Løb — 3×10 min tærskel`, `Crosstrainer — 45 min`. Beskrivelsen har uge og fase,
øvelserne med ugens dosering (`Enbens RDL — 3 × 8/side, RPE 6, 75 s`), et resultat for lavede sessioner
(topvægt pr. øvelse, løbetal, RPE og smerte pr. monitor, fx `Venstre lyske: 2/10 under, 0/10 næste morgen`) og et link til `/session/<sessionId>?uge=<n>` i appen. Linket
åbner ugens træning, hvis den er startet, ellers ugen.

**Opdatering uden dubletter:** `UID` er `<sessionId>-uge<n>@traeningsnav` og ændrer sig aldrig for en
session i en uge. `LAST-MODIFIED`, `DTSTAMP` og `SEQUENCE` afledes af det seneste tidsstempel blandt alt,
der påvirker eventet: planskiftet (`plan_versions.activated_at`), træninger, sæt, smertescorer, flytninger og
kalenderindstillingen (tombstones tæller med), plus midnat efter ugen, når en session bliver misset.
`SEQUENCE` er sekunder fra 1/1 2026 til det tidspunkt, så den stiger ved hver ændring uden at noget gemmes.

Koden: `worker/calendar/ical.ts` (serializer: CRLF, foldning ved 75 oktetter, escaping, `VTIMEZONE` for
Europe/Copenhagen), `worker/calendar/feed.ts` (plan + logs → events) og `worker/services/calendar.ts` (D1).
`test/__snapshots__/kalender.ics` er et snapshot af feedet for en kendt plan og et par logs. Ændrer du
feedet med vilje, opdateres det med `npx vitest run -u`.

## Claude-connector (MCP)

Hver atlet har sin egen forbindelse: `https://<domæne>/mcp/simon` og `https://<domæne>/mcp/karo`. De bruges i hver sit
claude.ai-projekt, og et kald via Karos forbindelse kan rent teknisk ikke ramme Simons data: tokenet er bundet til
ressourcen `/mcp/karo` (RFC 8707), og hvert kald tjekker igen, at stiens atlet er tokenets, og slår adgangen op live.
Forbindelsen præsenterer sig som **Træningsnav – Karo** med instruktionen "Denne forbindelse indeholder kun Karos
træningsdata", og hvert værktøjssvar starter med `"atlet": { "slug": "karo", "navn": "Karo" }`.

Claude kan læse planen og alle logs, **foreslå** planændringer, en ny plan eller ændret overvågning, logge løb (kun
atletens egen forbindelse) og skrive noter. Claude kan ikke slette noget, ændre logs, godkende forslag eller aktivere en
planversion; det gør atleten selv i appen. Det gamle fælles `/mcp` svarer 410.

```
claude.ai ──OAuth (DCR + PKCE, resource=/mcp/<atlet>)──► /oauth/register, /authorize (passkey-session), /oauth/token
          ──Bearer <token til /mcp/<atlet>>────────────► /mcp/<atlet> ──► worker/mcp/tools.ts ──► worker/services/ ──► D1
```

### Sæt det op

**1. KV-namespace** (fra fase 3): OAuth-tokens ligger i KV med bindingen `OAUTH_KV` (id i `wrangler.jsonc`). Fejler buildet
på KV, så mangler build-tokenet **Account · Workers KV Storage · Edit** (tilføjes som D1 i deploy trin 4.6).

Tjek at alt svarer (efter deploy):

```sh
curl https://<domæne>/.well-known/oauth-authorization-server                 # JSON med authorization_endpoint m.m.
curl https://<domæne>/.well-known/oauth-protected-resource/mcp/simon         # resource: https://<domæne>/mcp/simon
curl -i -X POST https://<domæne>/mcp/simon                                   # 401 med WWW-Authenticate
```

**2. Tilføj connectoren i claude.ai (i en browser)**

Det kan ikke gøres fra mobilappen, men connectoren virker der bagefter.

1. Åbn **claude.ai** i en browser. **Indstillinger → Connectors → Tilføj brugerdefineret connector** (Add custom connector).
2. **Navn:** `Træningsnav – Simon`. **URL:** `https://<domæne>/mcp/simon` (adresserne står i appen under
   **Indstillinger → Claude**). Lad OAuth Client ID/Secret være tomme; Claude registrerer sig selv.
3. **Tilføj → Forbind.** Er du ikke logget ind i appen i den browser, beder siden om **Log ind med Face ID**. Derefter:
   "Giv Claude adgang til **Simons** træningsdata? Du logger ind som Simon (dig selv)." Tryk **Giv adgang**.

Som træner gør du det samme med `https://<domæne>/mcp/karo` (siden siger "Du logger ind som Simon (træner)"). Det
kræver, at Karo har givet dig trænerrollen under **Indstillinger → Deling**.

**3. Slå connectoren til i projektet**

Åbn projektet i claude.ai, start en samtale, tryk på værktøjsknappen og slå forbindelsen til. Brug kun Simons forbindelse i
Simons projekt og Karos i Karos. Spørg fx "Hvad løftede jeg i enbens RDL de sidste to gange?".

### Værktøjer

| Værktøj | Hvad |
|---|---|
| `hent_status` | Dato, uge X af N, fase, dagens og ugens sessioner med status, trafiklys pr. monitor de sidste 7 dage, dage siden måling pr. mobilitetstest, ventende forslag. Uden plan: en henvisning til `foreslaa_ny_plan` |
| `hent_profil` | Navn, tærskelpuls, monitors og mobilitetstests (med id), aktiv planversion og periode, og hvem der har adgang med hvilken rolle |
| `hent_plan` | Aktiv (eller angivet) planversion kompakt, med JSON Pointer-stier. `sti` giver rå JSON til patches |
| `hent_uge` | Planlagt vs. lavet, volumen pr. øvelse, løbe-km, trafiklys, smerte, noter |
| `hent_ovelseshistorik` | Hver gang en øvelse er logget: sæt, RPE, note, "Klar til mere vægt" |
| `list_ovelser` | Alle `exerciseId` med navn |
| `hent_smertetrend` | Pr. monitor: score under og morgenen efter pr. træning med trafiklys. `hent_lysketrend` er et alias i én version mere |
| `hent_mobilitet` | Målinger pr. mobilitetstest; for tests pr. side også forskel venstre − højre |
| `hent_lob` | Løb med distance, tid, tempo, puls, RPE, smerte, note |
| `foreslaa_planaendring` | JSON Patch mod aktiv version → gemmes som `afventer`. Uden aktiv plan: fejl der henviser til `foreslaa_ny_plan` |
| `foreslaa_ny_plan` | En komplet plan (første plan eller ny blok), valideret mod plan-skemaet → forslag |
| `foreslaa_overvaagning` | Tilføj/deaktivér en monitor eller mobilitetstest → forslag |
| `log_lob` | Opretter et løb med `source = 'claude'` og evt. smerte pr. monitor. Kræver rollen ejer |
| `skriv_note` | Note til en uge, en session i en uge, eller generel |

Værktøjerne er tynde lag over `worker/services/` (ingen SQL i `worker/mcp/`). Svar er kompakt JSON med datoer som
`YYYY-MM-DD` (dansk tid). Fejl er også JSON: `{"atlet": …, "fejl": "…"}`.

### Forslag til planen

- Tre slags forslag: en JSON Patch (RFC 6902) mod den aktive planversion, en komplet ny plan (højst 300 KB), eller
  ændringer af overvågningen. De valideres ved oprettelse og igen ved godkendelse: en patch skal kunne anvendes, være
  højst 50 KB / 200 operationer, og resultatet skal bestå plan-skemaet.
- Et `exerciseId` må aldrig ændres, fjernes eller genbruges (navn, type og sidevis skal være uændrede). Nye øvelser får
  nye id'er, der aldrig har stået i en planversion eller i loggen. En ny plan må droppe gamle øvelser, men et brugt id
  må ikke skifte betydning. Alt gælder pr. atlet.
- På **I dag** står "Claude foreslår en ændring til planen" (også for en ny atlet uden plan). Forslaget viser summary, begrundelse og en læsbar diff
  (fx `Styrke A · Enbens RDL, uge 9–10: 3 × 8/side, RPE 7–8, pause 90 s → 3 × 10/side, …`).
- **Godkend** laver en ny planversion (`source = 'claude'`, forslagets summary som note), som er aktiv med det samme.
  Kalenderfeedet følger med. Rul tilbage under **Indstillinger → Plan**. Et overvågningsforslag tilføjer/deaktiverer
  monitors og tests.
- Godkendes et planforslag, bliver de andre ventende planforslag `forældet`. Aktiveres en anden version (også en
  tilbagerulning), bliver patch-forslag mod en anden base `forældet`.
- Godkend og afvis findes kun i appen og kun for atleten selv (ejer), aldrig som MCP-værktøj. En træner ser forslagene
  skrivebeskyttet.

### Noter fra Claude

Noter (`coach_notes`) synkes til telefonen som de andre data. De står på **I dag** (generelle og ugens), på **Uge** og
på sessionen de hører til, til du trykker **Luk**.

### Sikkerhed

- `/mcp/<atlet>` kræver et OAuth-token udstedt af Worker'en til netop den ressource. Tokens gælder kun MCP; `/api`
  kræver en app-session (passkey). Et token til `/mcp/karo` afvises af `/mcp/simon` (401).
- Samtykket på `/authorize` kræver, at man er logget ind i appen med passkey og har adgang til atleten.
- Grant'en bærer `{ userId, athleteId, athleteSlug }`. Ved hvert kald tjekkes, at stiens atlet er grant'ens, og adgangen
  slås op i `athlete_access`: fjerner Karo Simons trænerrolle, fejler hans næste kald (403).
- Kun `https://claude.ai/api/mcp/auth_callback` og `https://claude.com/api/mcp/auth_callback` accepteres som
  `redirect_uri`, både ved registrering og på `/authorize`.
- Alt input valideres med zod med størrelsesgrænser. Hvert kald logges i `mcp_audit` (værktøj, tidspunkt, ok/fejl,
  bruger og atlet, aldrig input). De seneste 20 på egen træning står under **Indstillinger → Claude**.
- Access-tokens lever 1 time og fornyes med refresh-tokens; en forbindelse der ikke bruges i 30 dage udløber.

**Fjern Claudes adgang:** afbryd connectoren i claude.ai (og fjern evt. trænerrollen under **Indstillinger → Deling**,
hvilket virker med det samme). Vil du også gøre alle udstedte tokens ugyldige på serveren:

```sh
npx wrangler kv key list --binding OAUTH_KV --remote --prefix "token:" > tokens.json
npx wrangler kv key list --binding OAUTH_KV --remote --prefix "grant:" > grants.json
npx wrangler kv bulk delete --binding OAUTH_KV --remote tokens.json
npx wrangler kv bulk delete --binding OAUTH_KV --remote grants.json
```

### Lokal test med MCP Inspector

`.dev.vars` (fra `.dev.vars.example`) sætter `OAUTH_ALLOW_LOCALHOST=true`, så Inspectorens `http://localhost`-callback er
tilladt. **Sæt aldrig `OAUTH_ALLOW_LOCALHOST` i produktion.** Sæt `APP_ORIGIN=http://localhost:8787`.

```sh
npm run db:migrate:local && npm run db:seed:local
npm run invite -- --name Simon --admin --local --url http://localhost:8787   # åbn linket og opret en passkey
npm run preview                                   # bygger og kører wrangler dev på :8787
npx @modelcontextprotocol/inspector               # i en anden terminal; åbner http://localhost:6274
```

I Inspector: tilføj en server med transport **Streamable HTTP** og URL `http://localhost:8787/mcp/simon`. Browseren sendes
til `/authorize`; log ind med passkey og tryk **Giv adgang**. Under **Tools** kan alle værktøjer kaldes.

## Brugere, login og deling

- **Login:** passkey (Face ID, synkes via iCloud-nøgleringen). Ikke logget ind → "Log ind med Face ID". Intet andet.
- **Invitationer:** `/invite/<token>`, gyldige i 7 dage og kun én gang; kun SHA-256 af tokenet gemmes. Admin opretter dem
  under **Indstillinger → Brugere** (ny bruger, eller "gendannelse" = ny passkey til en eksisterende bruger) eller med
  `npm run invite`. En ny bruger får sin egen atlet og en kort onboarding: navn, tærskelpuls (valgfri) og et aktivt valg
  om inviteren må være træner (ikke forudvalgt).
- **Sessioner:** cookien `__Host-tn_session` (HttpOnly, Secure, SameSite=Lax), 32 tilfældige bytes, gemt hashet i D1.
  90 dages udløb, forlænges ved brug (højst én skrivning pr. døgn). Mutationer på `/api` kræver, at `Origin` er appens
  domæne (ellers 403). Højst 10 login- og invitationsforsøg pr. IP pr. 15 minutter (`auth_attempts`, 429).
- **Sikkerhed:** **Indstillinger → Sikkerhed** viser passkeys med navn og sidst brugt, og en kan omdøbes eller slettes
  (ikke den sidste). **Tilføj passkey på denne enhed** til fx en Mac uden samme iCloud-konto.
- **Deling:** **Indstillinger → Deling** viser hvem der har adgang til din træning og har en knap til at fjerne den
  (virker straks, også for Claude). Den der inviterede dig, kan få trænerrollen herfra.
- **Overvågning:** **Indstillinger → Overvågning**: smerte-monitors (fx "Venstre lyske") og mobilitetstests (fx Knee-to-wall,
  cm, pr. side). Claude kan foreslå dem med `foreslaa_overvaagning`.
- **Atletvælger:** har du adgang til flere atleter, står en vælger øverst i **Uge** og **Historik**. Trænervisningen
  hentes fra serveren (kræver net), er skrivebeskyttet og tydeligt markeret med atletens navn. **I dag** viser altid kun
  din egen atlet.
- **Log ud** (**Indstillinger → Konto**) sletter sessionen og den lokale database på enheden. Udløber sessionen blot,
  bliver den lokale database og udbakken liggende og sendes efter næste login.

## Accepttest på iPhone

Definition of done for fase 1. Kør dem efter første deploy:

- [ ] Appen er installeret fra Safari på hjemmeskærmen og åbner uden browserbjælke.
- [ ] **Flytilstand:** slå den til, log en hel Styrke A-session (eller Rehab A), og luk appen.
      Statussen viser "Offline · N venter". Slå nettet til, åbn appen, og vent på "Synket".
- [ ] Næste gang samme øvelse dukker op, står talhjulene på sidste gangs tal, og en hel Styrke A kan logges uden tastatur.
- [ ] Luk appen midt i en pause og åbn den igen: intet er tabt, og timeren står rigtigt.
- [ ] Slet appen fra hjemmeskærmen, installér igen og log ind med passkey: alle data er der stadig, og hjemmeskærmen
      viser vægtløfter-ikonet.
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
- [ ] Bed Claude logge et løb og skrive en note: løbet står i ugen med ✓, og noten kan lukkes.

Fase 5 (login og flere atleter):

- [ ] Log ind med Face ID i den installerede app. Al historik, alle planversioner og lyske-trafiklyset er uændret.
- [ ] Registrering via invitation og login er testet i den installerede PWA på iPhone (ikke kun i Safari).
- [ ] Karo logger ind på sin egen telefon og ser en tom app, der venter på hendes første plan.
- [ ] I Karos claude.ai-projekt laver Claude et program (`foreslaa_ny_plan`); det står som forslag i hendes app, hun
      godkender det og logger sin første session.
- [ ] I Simons projekt svarer Claude kun ud fra Simons data, og omvendt (hvert svar starter med `"atlet"`).
- [ ] Karo fjerner Simons trænerrolle under **Indstillinger → Deling**: Simons næste kald via `/mcp/karo` fejler.
- [ ] `npm test` er grøn, inklusive `test/separation.test.ts`.

## Fejlfinding

| Symptom | Årsag og løsning |
|---|---|
| Build fejler på `d1 migrations apply` med authentication/permission-fejl | Build-tokenet mangler **Account · D1 · Edit** (trin 4.6). |
| Build fejler på `0006_atleter.sql` med "CHECK constraint failed: ok = 1" | En af migrationens kontroller fandt en afvigelse; intet er ændret. Kør `npm run db:verify-migration` på en frisk backup for detaljer. |
| Build fejler med "Couldn't find a D1 DB" | `database_id` i `wrangler.jsonc` er ikke sat eller pushet (trin 2). |
| Passkey-registrering eller login fejler med en origin/rpID-fejl | Appen åbnes på et andet domæne end `APP_ORIGIN`, eller domænet er skiftet. Brug det faste domæne, eller lav en ny invitation (gendannelse). |
| "Passkey kendes ikke" ved login | Passkey'en er slettet eller fra et andet domæne. Lav et invitationslink (`npm run invite -- --name <navn>`). |
| "For mange forsøg" ved login/invitation | Højst 10 forsøg pr. IP pr. 15 minutter. Vent lidt. |
| "Forkert oprindelse" (403) | Kaldet kom ikke fra appens domæne. Tjek `APP_ORIGIN` (lokalt: `.dev.vars`). |
| Karos ny bruger ser ingen plan | Det er forventet: den første plan kommer som forslag fra Claude (`foreslaa_ny_plan`) og godkendes på **I dag**. |
| Kalenderen siger, at abonnementet ikke kan hentes (404) | Linket er fra før fase 5 eller er erstattet af et nyt. Lav et nyt link under **Indstillinger → Kalender**. |
| `/mcp/<atlet>` giver 503 | `OAUTH_KV` mangler ([Claude-connector](#sæt-det-op-1) trin 1). |
| `/mcp` giver 410 | Fase 5 har én forbindelse pr. atlet: brug `/mcp/simon` eller `/mcp/karo`. |
| claude.ai siger, at connectoren ikke kan forbindes | Tjek URL'en (`https://<domæne>/mcp/<atlet>`) og at `/.well-known/oauth-protected-resource/mcp/<atlet>` svarer. Er siden "Kun Claude kan forbindes" vist, er klienten ikke claude.ai. "Ingen adgang": brugeren har ikke adgang til atleten. |
| Claudes forslag står som "Forældet" | Planen er skiftet siden forslaget. Bed Claude om et nyt mod den aktive version. |
| Status "Sync-fejl" | Tryk på statussen for fejlbeskeden. Data ligger sikkert lokalt og sendes ved næste sync. |
| Appen viser gammel version | Tryk **Opdater** i bjælken eller under **Indstillinger → App**. Kommer der ingen knap (en installation fra før knappen fandtes), så luk appen helt i app-skifteren og åbn den igen. Hjælper det ikke: tjek at statussen siger **Synket**, slet appen fra hjemmeskærmen og tilføj den igen fra Safari. |

Logs: **Workers & Pages → traeningsnav → Logs** (observability er slået til), eller `npx wrangler tail`.

## Sådan virker det

### Design

Native iOS-følelse, lyst og luftigt, med én brandfarve: en pink-til-rød gradient. Hver skærm besvarer ét spørgsmål,
og det vigtigste tal (sidste gangs tal) står stort i gradient.

- **Tokens** i `src/styles/tokens.css`: brand, flader og tekst (iOS-systemfarver), kategorifarver og trafiklys, lys og
  mørk. `src/styles.css` eksponerer dem for Tailwind og slår Tailwinds egne farver fra, så komponenter kun kan bruge
  tokens. Gradienten bruges kun til logo, heltetal, primærknap, graf, pausetimer og aktiv fane.
- **Systemfonten** (SF Pro på iPhone), tabulære cifre overalt. Ingen fontfiler.
- **Primitiver** i `src/ui/`: `LargeTitle`, `InsetList`, `ExerciseRow`, `HeroNumber`, knapper, `Segmented`, `Wheel`
  (talhjul), `Ring`, `TabBar`, `Sheet`, `LineChart`, felter og trafiklys. Skærmene bygges kun af dem.
  `/dev/ui` viser dem alle i lys og mørk; siden findes kun i dev-build (`npm run dev`).
- **Ikonfliser:** kategorien kommer fra planens fokusområde (`src/logic/category.ts`). Ikoner er
  [Phosphor](https://phosphoricons.com) (MIT).
- **Logning** tager én øvelse ad gangen. Talhjulene står på sidste gangs vægt og reps, så et sæt magen til sidst er ét
  tryk på ✓; tryk på det valgte tal åbner tastaturet. Vægttrinnet er 2,5 kg for stang, kabel og maskine og 0,5 kg ellers
  (`src/logic/wheel.ts`). Slår et sæt rekorden (vægt × reps), ruller heltetallet til det nye tal med "Ny rekord".
- **Logo** i `brand/` (kilde: `brand/icon.svg`); `npm run icons` laver resten.
- **Screenshots:** `npm run screenshots` starter Vite, svarer selv på `/api` med fem ugers falsk historik
  (`scripts/screenshots/fixtures.ts`) og fotograferer skærmene mandag i uge 6. Kræver Playwrights Chromium
  (`npx playwright install chromium`). Uden SF Pro (Linux) bruges Inter som stedfortræder, hvis den er installeret.

### Logning og sync

- Alt gemmes først i IndexedDB (Dexie, databasen `traeningsnav-<brugerId>`) og lægges i en udbakke, hvor hver post bærer
  atletens slug. Der er ingen gem-knap, og intet tabes, hvis appen lukkes.
- Sync kører efter hver ændring, når nettet kommer tilbage, når appen får fokus og hvert minut:
  `POST /api/a/<atlet>/sync/push` sender hele poster med last-write-wins på `updated_at` (kun ejeren; posterne gemmes på
  rutens atlet, og en post med samme uuid hos en anden atlet overskrives aldrig).
  `GET /api/a/<atlet>/sync/pull?since=<cursor>` henter alt ændret siden, inklusive sletninger som tombstones.
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
  navn i `workouts.activity`. Du logger tid, puls, evt. distance, RPE, note og smerte. Den tæller med i
  trafiklyset men ikke som en planlagt session.

### Progression

"Klar til mere vægt" vises på en øvelse, når alle planlagte sæt sidste gang ramte toppen af
rep-intervallet, og øvelsens RPE var logget og ≤ planens mål (`shared/progression.ts`).
Tallene ændres aldrig automatisk.

### Smerte-trafiklys (pr. monitor)

Fase 1's lyske-trafiklys gælder nu pr. monitor (`monitors`, fx "Venstre lyske"); scorerne ligger i `pain_scores`
(`kind = 'under'` pr. træning, `'morgen'` morgenen efter). Reglerne ligger i `shared/pain.ts` og bruges af appen,
services, MCP og kalenderfeedet:

- **Grøn:** højst 3/10 under træning og 0/10 næste morgen.
- **Gul:** over 3/10 under træning, eller ikke væk næste morgen.
- **Rød:** gul to sessioner i træk.
- **Afventer:** morgenscoren mangler endnu. Den spørges dagen efter, første gang appen åbnes (ét spørgsmål pr. monitor).

En session kan ikke afsluttes uden en score for hver aktiv monitor. Ugeprikker og status viser det værste lys pr. træning.

### Mobilitetstests

Knee-to-wall er en test (`mobility_tests`) med enhed og "pr. side"; målingerne har `test_id` og `value_right`/`value_left`
(eller `value`). For tests pr. side vises forskellen venstre − højre. Påmindelsen kommer efter planens antal dage (14) pr. test.

### API

Alt under `/api` undtagen `/api/health` og `/api/auth/*` kræver en session. Data om en atlet ligger under
`/api/a/<atlet>/…` og går gennem `requireAccess(ctx, slug, minRole)` (`worker/auth.ts`): ingen adgang (eller ukendt
atlet) giver **404**, for lav rolle (træner der vil ændre noget) **403**. Mutationer kræver `Origin` = appens domæne.

| Metode | Sti | Hvad |
|---|---|---|
| POST | `/api/auth/login/options`, `/api/auth/login/verify` | Passkey-login (sætter session-cookien) |
| GET | `/api/auth/invite/:token` | Invitationens navn, og om det er en gendannelse |
| POST | `/api/auth/invite/:token/options`, `…/verify` | Registrér passkey via invitation (ny bruger får sin egen atlet) |
| POST | `/api/auth/logout` | Slet sessionen |
| GET | `/api/me` | Brugeren og atleterne med rolle |
| POST | `/api/me/onboarding` | `{ name, thresholdHr, coach }` |
| GET/PATCH/DELETE | `/api/me/passkeys[/:id]` | Passkeys (den sidste kan ikke slettes) |
| POST | `/api/me/passkeys/options`, `…/verify` | Tilføj passkey |
| GET | `/api/admin/users` | Brugere og åbne invitationer (admin) |
| POST | `/api/admin/invites` | `{ name, isAdmin, userId? }` → invitationslink (admin) |
| GET/PATCH | `/api/a/:slug/profile` | Navn, tærskelpuls, monitors, mobilitetstests, rolle |
| POST/PATCH | `/api/a/:slug/monitors[/:id]`, `/api/a/:slug/mobility-tests[/:id]` | Overvågning (ejer) |
| GET/POST/DELETE | `/api/a/:slug/sharing[/:userId]` | Hvem har adgang; giv/fjern trænerrollen (ejer) |
| GET | `/api/a/:slug/plan/active` | Aktiv planversion, eller `null` uden plan |
| GET | `/api/a/:slug/plan/versions` | Alle planversioner |
| POST | `/api/a/:slug/plan/versions/:version/activate` | Skift eller rul tilbage til en version (ejer) |
| GET | `/api/a/:slug/plan/weeks/:weekNo` | Ugens sessioner med konkret dosering |
| POST | `/api/a/:slug/sync/push` | Gem poster fra klienten (ejer) |
| GET | `/api/a/:slug/sync/pull?since=` | Hent poster ændret siden cursor |
| GET | `/api/a/:slug/trends/pain?from=YYYY-MM-DD` | Trafiklys pr. monitor og træning |
| GET | `/api/a/:slug/trends/mobility` | Målinger pr. mobilitetstest |
| GET | `/api/a/:slug/history/exercises` | Øvelser med historik (trænervisning) |
| GET | `/api/a/:slug/history/exercises/:exerciseId?limit=` | Alle gange en øvelse er logget, nyeste først |
| GET | `/api/a/:slug/history/weeks/:weekNo` | Ugens sessioner, volumen pr. øvelse, løbe-km og trafiklys |
| GET | `/api/a/:slug/export` | Alle atletens data som én JSON-fil (ejer) |
| GET | `/api/a/:slug/calendar` | Om der er et feed, og kalenderindstillinger (ejer) |
| POST | `/api/a/:slug/calendar/token` | Nyt abonnementslink; det gamle holder op med at virke (ejer) |
| PUT | `/api/a/:slug/calendar/settings/:type` | `{ all_day, start_time: "HH:MM", duration_min }` for `styrke`, `løb` eller `cardio` (ejer) |
| GET | `/api/a/:slug/proposals?status=afventer` | Claudes forslag med læsbar diff, nyeste først |
| GET | `/api/a/:slug/proposals/:id` | Ét forslag |
| POST | `/api/a/:slug/proposals/:id/approve` | Godkend (ejer). 409 hvis forslaget er afgjort eller forældet |
| POST | `/api/a/:slug/proposals/:id/reject` | Afvis (ejer) |
| GET | `/api/a/:slug/mcp/audit` | De seneste 20 MCP-kald på atleten (ejer) |
| GET | `/cal/:slug/:token.ics` | Kalenderfeedet (`text/calendar`). Forkert atlet eller token giver 404 |
| POST | `/mcp/:slug` | MCP (Streamable HTTP). Kræver et OAuth-token til netop den atlet |

### Service-funktioner (bruges af API'et og MCP)

Forretningslogikken ligger i `worker/services/` og tager `db: D1Database` og `athleteId` som de første parametre, uden
HTTP. Ingen forespørgsel mod en atlet-tabel er uden `WHERE athlete_id = ?`:

| Funktion | Fil |
|---|---|
| `resolveAccess(db, userId, slug, minRole)`, `getProfile`, `listMonitors`, `listMobilityTests`, `getSharing`, `grantCoach`, `revokeAccess` | `athletes.ts` |
| `getActivePlan(db, athleteId)`, `findActivePlan`, `getWeek`, `listPlanVersions`, `activatePlanVersion` | `plan.ts` |
| `getExerciseHistory`, `getExerciseOverview`, `getWeeklySummary`, `exportAll` | `history.ts` |
| `getPainTrend(db, athleteId, fromDate)`, `getMobilityTrend(db, athleteId)` | `trends.ts` |
| `pushChanges(db, athleteId, changes)`, `pullChanges(db, athleteId, since)` | `sync.ts` |
| `buildCalendarFeed`, `getCalendarSettings`, `setCalendarSetting`, `rotateCalendarToken`, `verifyCalendarToken` | `calendar.ts` |
| `createProposal`, `createNewPlanProposal`, `createMonitoringProposal`, `listProposals`, `approveProposal`, `rejectProposal` | `proposals.ts` |
| `createCoachNote`, `listCoachNotes` | `notes.ts` |
| `listWorkouts`, `logRun` | `workouts.ts` |
| `createSession`, `getSessionUser`, `createInvite`, `redeemInvite`, passkeys | `users.ts` |
| `recordMcpCall`, `listMcpAudit`, `authAttemptStatus`, `recordAuthAttempt` | `audit.ts` |

### Struktur

```
src/        frontend (React, Tailwind, Dexie); src/ui/ designets primitiver, src/styles/tokens.css farverne
worker/     Hono-API; forretningslogik i worker/services/; MCP-værktøjer i worker/mcp/, OAuth i worker/oauth/
shared/     zod-skemaer, plan-resolver og ren logik (historik, trafiklys, progression), brugt begge steder
migrations/ D1-migrationer (køres automatisk); migrations-pending/ venter på bekræftelse
plan/       traeningsplan.xlsx, seed- og versionsscripts, genereret plan
scripts/    invite (invitationslink fra CLI), verify-migration (fase 5 mod en kopi af produktionen), icons og screenshots
brand/      logo og appikoner (kilde: icon.svg)
test/       vitest; test/d1.ts er en D1-adapter over node:sqlite, test/world.ts to atleter med sessioner,
            test/authenticator.ts en passkey i software
```
