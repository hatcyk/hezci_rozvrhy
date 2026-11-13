# Lepší Rozvrh – technická dokumentace

*Verze 2.0.0 (4. 11. 2026). Popisuje stav kódu v tomto repozitáři; rychlý
přehled je v [README.md](README.md), nasazení v [DEPLOYMENT.md](DEPLOYMENT.md).*

## 1. Účel

Bakaláři zobrazují rozvrhy SPŠD Motol jako webové stránky, které se na mobilu
špatně čtou a o změnách (suplování, zrušené hodiny, změny učeben) nikoho
neupozorní. Lepší Rozvrh tyto stránky pravidelně stahuje, ukládá je jako
strukturovaná data do Firestore a nad nimi nabízí responzivní PWA s pohledy na
změny, volné učebny a společné volno, push upozornění a export do kalendáře.
Bakaláři nemají veřejné strojové rozhraní pro rozvrhy, proto se čte HTML
veřejných stránek rozvrhu (`/Timetable/Public/…`) po přihlášení školním účtem.

## 2. Technologie

| Část | Technologie |
|---|---|
| Běhové prostředí | Node.js 22 (`engines: 22.x`), CommonJS |
| Server | Express 5, `cors`, `dotenv` |
| Stahování a parsování | `axios`, `cheerio` |
| Čas | `date-fns`, `date-fns-tz` (pásmo Europe/Prague včetně letního času) |
| Data a upozornění | Firebase: Firestore, Authentication (custom token), Cloud Messaging; server `firebase-admin`, prohlížeč Firebase JS SDK 9.22 (compat) z gstatic.com |
| Frontend | vanilla JavaScript (ES moduly) a CSS bez frameworku; `esbuild` je skládá do `public/js/app.js` a `public/css/app.css` |
| Hosting | Vercel (statické soubory z CDN + Express jako serverless funkce); alternativně vlastní server (Docker / systemd, viz DEPLOYMENT.md) |
| Plánování | GitHub Actions (`.github/workflows/`), cron-job.org, případně systémový cron |
| Testy | `node:test` (jednotkové a integrační), Playwright + axe-core (e2e) |

## 3. Architektura

```
Bakaláři ──(prefetch: HTML)──► Firestore ◄──(čtení, Firebase JS SDK)── prohlížeč (PWA)
                                   ▲  │                                  │
              Express API (Vercel) │  └─ changes → process-notifications ─┼─► FCM ─► zařízení
              /api/auth, fcm, favorites, status, ical, admin, cron  ◄────┘
```

### 3.1 Sběr dat (prefetch)

`backend/prefetch.js`, `prefetchAllData()`; spouští `scripts/run-prefetch.js`
(GitHub Actions `prefetch.yml`, systémový cron) nebo `GET /api/cron/prefetch`.

1. **Přihlášení** do `https://mot-spsd.bakalari.cz/login`
   (`BAKALARI_USERNAME`/`PASSWORD`). `assessLoginResponse` pozná neúspěch
   (přesměrování zpět na `/login`, znovu vrácený formulář, chybějící cookie).
   Špatné údaje se neopakují, síťové chyby až 3× s narůstající prodlevou.
2. **Definice** tříd, vyučujících a učeben + skupiny tříd →
   `definitions/current`.
3. **Rozvrhy** všech tříd, vyučujících a učeben pro `Actual`, `Next` a
   `Permanent` (`/Timetable/Public/{Actual|Next|Permanent}/{Class|Teacher|Room}/{id}`).
   Souběžně nejvýš `PREFETCH_CONCURRENCY` požadavků (výchozí 3), opakování jen
   při síťové chybě, 429 nebo 5xx, s ohledem na `Retry-After`. User-Agent jde
   změnit proměnnou `BAKALARI_USER_AGENT`.
4. **Parser** (`backend/bakalari-parser.js`, `parseTimetablePage`) vrací
   `{ lessons, weekStart, allDaysOff, daysOff, hours, format }`. Hodina má pole
   `day, dayName, date ('YYYY-MM-DD'|null), hour, subject, teacher, room, group,
   theme, type, changed, changeInfo`; `type` je typ z Bakalářů (např. `atom`,
   `removed` = odpadlá, `absent` = akce/absence; výchozí `normal`).
   Rok data („7.9.“) se odvozuje z data stažení (nejbližší z Y−1, Y, Y+1).
   Dny volna (`daysOff: [{day, date, name}]`) se nevyplňují „odpadlými“ hodinami
   ze stálého rozvrhu.
5. **Pojistky:** prázdný nový snímek nepřepíše neprázdný předchozí (pokud není
   celý týden volno); 0 definic nebo 0 hodin ukončí běh se stavem
   `guard_no_definitions` / `guard_no_lessons`.
6. **Zápis** `timetables/{Typ}_{id}_{Actual|Next|Permanent}` =
   `{ type, id, name, scheduleType, weekStart, daysOff, data, lessonCount, lastUpdate }`,
   jen když se obsah změnil.
7. **Detekce změn** (`backend/change-detector.js`): porovnávají se jen snímky
   téhož týdne (`selectComparisonBaseline`: stejný `weekStart`, nebo nový
   `Actual` proti loňskému `Next` téhož týdne). Jinak se nic nehlásí. Hodiny ve
   slotu se párují podle stavu, předmětu a vyučujícího. Nalezené změny →
   dokument `changes/{docKey}_{čas}` se `sent: false`.
8. **Agregáty** (`backend/aggregates.js`) ze snímků v paměti:
   `aggregates/changes_{Actual|Next}` (změny všech tříd po dnech) a
   `aggregates/freeRooms_{Actual|Next}` (volné učebny pro každý den a hodinu).
   Zapisují se jen při změně obsahu.
9. **Výsledek** `{ success, status, …počítadla }`, kde `status` je `ok`,
   `login_failed`, `network`, `guard_no_definitions`, `guard_no_lessons` nebo
   `error`. Funkce nevyhazuje výjimky.

### 3.2 Upozornění

- **Na změny** (`backend/fcm.js`, `processPendingChanges`; `scripts/process-notifications.js`
  nebo `GET /api/cron/process-notifications`): neodeslané `changes` → uživatelé,
  kteří daný rozvrh sledují (index `watchedKeys`) → filtr podle typu změny a
  skupin → **jen datová** zpráva FCM (`fitFcmDataPayload` ji udrží pod limitem
  4 KB). Neplatné tokeny se odstraní; `messaging/invalid-argument` token nemaže.
- **Upomínky před hodinou** (`backend/lesson-reminder.js`; `scripts/send-lesson-reminders.js`
  nebo `GET /api/cron/lesson-reminders`): okno 6–1 min před začátkem hodiny
  (`LESSON_REMINDER_*`). Hodina musí mít dnešní `date` a den nesmí být volný.
  Každá upomínka se nejdřív „zabere“ (`create()` v `lesson_notifications_sent`),
  takže souběžné běhy ji nepošlou dvakrát. HTTP varianta odpoví nejpozději po
  `REMINDER_HTTP_BUDGET_MS` (25 s): 200 s výsledkem, jinak 202.
- **Service worker** (`public/firebase-messaging-sw.js`) zobrazí notifikaci se
  značkou `change_<typ>_<id>_<týden>`; na Apple (Web Push přes `*.push.apple.com`)
  zobrazí každý push sám, jinak by WebKit odběr zrušil.

### 3.3 Provozní záznamy a stav

- Každý běh úlohy (`backend/cron.js`, `runJob`) zapíše `runs/{auto}` =
  `{ job, trigger, startedAt, finishedAt, durationMs, status, counts, error }`;
  `trigger` se bere z `GITHUB_EVENT_NAME`, `RUN_TRIGGER` nebo podle terminálu.
- Prefetch navíc aktualizuje `system/health`
  (`lastRunAt, lastSuccessAt, lastStatus, consecutiveFailures, lastError, updatedAt`);
  `lastSuccessAt` se posune jen při `status === 'ok'`.
- `GET /api/status` vrací `isHealthy`, `lastSuccessAt`, `dataAgeMin`,
  `maxAgeMin` a další. Data jsou zdravá, když jsou mladší než 120 min (Po–Pá
  6–18 h pražského času), jinak 12 h. S `?strict=1` vrací při nezdravém stavu 503.
- **Úklid** (`scripts/cleanup.js`, `GET /api/cron/cleanup`): záznamy odeslaných
  upomínek starší 7 dní, zpracované `changes` starší 2 dnů, `runs` starší 30 dní,
  `audit` starší 90 dní.

### 3.4 Plánování

| Úloha | Kde běží | Spouštěč |
|---|---|---|
| Prefetch | GitHub Actions `prefetch.yml` (`node scripts/run-prefetch.js`) | cron-job.org → `workflow_dispatch`; záložně `schedule` á 15 min; ručně z `/admin` |
| Notifikace o změnách | Vercel `/api/cron/process-notifications` | po každém prefetchi (krok v `prefetch.yml`), `process-notifications.yml` á 5 min, doporučeně i cron-job.org |
| Upomínky | Vercel `/api/cron/lesson-reminders` | cron-job.org každou minutu Po–Pá 7–17 h |
| Úklid | Vercel `/api/cron/cleanup` | `cleanup.yml` denně v 1:00 UTC |
| Kontrola stáří dat | `check-status.yml` → `/api/status?strict=1` | á 10 min |
| Udržení plánovaných workflow | `keepalive.yml` | týdně (GitHub vypíná plánované workflow po 60 dnech bez commitu) |

Spouštěče na cron-job.org odpovídají doporučenému nastavení v DEPLOYMENT.md
(kap. 1.5). Na vlastním serveru se tytéž skripty pouštějí systémovým cronem
(`deploy/crontab.example`).

## 4. Data ve Firestore

| Kolekce / dokument | Obsah | Zapisuje | Prohlížeč (pravidla) |
|---|---|---|---|
| `definitions/current` | třídy, vyučující, učebny, `classGroups` | prefetch | čte (přihlášený) |
| `timetables/{Typ}_{id}_{Actual\|Next\|Permanent}` | snímek rozvrhu (3.1, bod 6) | prefetch | čte |
| `aggregates/changes_*`, `aggregates/freeRooms_*` | souhrny pro pohledy Změny a Volné učebny | prefetch | čte |
| `metadata/lastPrefetch` | souhrn posledního běhu (záloha pro banner) | prefetch | čte |
| `users/{uid}` | tokeny FCM, sledované rozvrhy a filtry, oblíbené, index `watchedKeys`/`watchedTypes` | API | jen `get` vlastního dokumentu |
| `changes/*` | zjištěné změny k odeslání | prefetch, notifikace | ne |
| `lesson_notifications_sent/*` | zábory upomínek | upomínky | ne |
| `runs/*`, `system/*` | běhy úloh, stav, migrace, slot ručního spuštění | úlohy, admin | ne |
| `audit/*` | přístupy do administrace (`ipHash` = HMAC) | admin API | ne |

Pravidla jsou v `firestore.rules` (zápis z prohlížeče nikde, server zapisuje
přes Admin SDK), složený index `runs (job ↑, startedAt ↓)` v
`firestore.indexes.json`.

## 5. HTTP API (`routes/`)

| Endpoint | Ochrana | Účel |
|---|---|---|
| `POST /api/auth` `{ userId? }` | ID token jen k prokázání ID | přidělí nové prázdné `anon-<uuid>` a custom token. Uložené `anon-<uuid>` znovu vydá a starý `anonymous-<ms>` jednorázově převede (`migratedFrom`), **jen když požadavek nese ID token téže identity**: samotné ID není heslo. |
| `GET /api/status[?strict=1]` | – | stáří dat (3.3) |
| `GET /api/groups/:classId` | – | skupiny třídy |
| `GET\|POST /api/favorites/:userId` | ID token, vlastní `userId` | oblíbené rozvrhy (max. 50) |
| `POST /api/fcm/subscribe`, `unsubscribe`, `update-preferences`, `update-global-preferences`, `GET /api/fcm/preferences/:userId` | ID token, vlastní `userId` | odběr upozornění a nastavení (max. 200 sledovaných rozvrhů) |
| `POST /api/fcm/process-changes`, `GET /api/cron/{prefetch,process-notifications,lesson-reminders,cleanup}` | `Authorization: Bearer <CRON_SECRET>` | plánované úlohy; bez tajemství v produkci 503 |
| `GET /api/ical/:type/:id.ics?schedule=…&group=…` | – (vypínač `ICAL_ENABLED`) | kalendář iCalendar (RFC 5545), ETag/304 |
| `GET /api/admin/{health,runs,runs/intervals,changes,stats,audit}`, `POST /api/admin/prefetch/dispatch` | `Authorization: Bearer <ADMIN_SECRET>` | administrace (kap. 7) |
| `POST /api/csp-report` | limit 60/min | hlášení porušení CSP do logu |
| `GET /api/debug/status`; ostatní `/api/debug/*` | ostatní jen s `DEBUG=true` | ladění |

`requireUser` (`backend/auth-middleware.js`) ověří Firebase ID token
(`verifyIdToken`): bez tokenu 401, cizí `userId` v cestě nebo těle 403.
Těla se validují v `routes/validation.js`.

## 6. Frontend (`public/`)

- **Start** (`js/main.js`): přihlášení (`firebase-client.js`) ještě před prvním
  čtením Firestore. Klient počká, až Firebase obnoví uloženou relaci; patří-li
  k uloženému `userId`, server se vůbec neptá. Jinak `/api/auth` (s ID tokenem
  relace, pokud ji má) → `signInWithCustomToken`; pak současně
  definice, `/api/status` a oblíbené; nakonec pohled z adresy (`/?view=…`),
  deeplink z notifikace (`/?type=&id=&schedule=&day=&hl=change`) nebo uložený
  rozvrh. V pátek od 14:00 a o víkendu se sám přepne na příští týden.
- **Data:** čtení přes Firebase JS SDK (`api.js`), kopie v `localStorage`
  (`cache.js`: definice 7 dní, rozvrhy a agregáty 10 min) a v paměti relace.
  Bez sítě se použije uložená kopie a banner „Režim offline — data aktualizována
  před …“ (`offline.js`); když je server nezdravý, banner říká, z kdy data jsou.
- **Volání API** s uživatelem jdou přes `apiFetch` s `Authorization: Bearer <ID token>`,
  při 401 se jednou přihlásí znovu.
- **Rozvržení** (`layout-registry.js`, `layout-manager.js`, `layout-renderers.js`,
  `timetable.js`): desktop `week-view` (výchozí) a `single-day`; mobil (šířka
  ≤ 1079 px) `agenda` (výchozí), `compact-list`, `card-view`, `single-day`.
- **Pohledy** (`view-router.js`, skutečné odkazy, History API, fokus na nadpis):
  Změny (`changes-*.js`), Volné učebny (`rooms-*.js`), Společné volno
  (`common-*.js`), kiosk (`kiosk*.js`, `/?kiosk=changes`, `onSnapshot`, Wake Lock).
- **Nástroje rozvrhu** (`timetable-tools.js`, `share.js`, `print.js`,
  `calendar-sheet.js`): „Jen změny“, sdílení (Web Share API, jinak schránka),
  tisk A4 na šířku, odkaz `webcal://…/api/ical/…`.
- **Panely** jsou nativní `<dialog>` + `showModal()` (`bottom-sheet.js`):
  stránka za nimi je inertní, Esc zavře, fokus se vrátí.
- **Bezpečné vykreslování:** všechna data z Bakalářů procházejí `esc()`
  (`utils.js`), takže HTML v názvu předmětu se zobrazí jako text.
- **PWA:** `manifest.webmanifest` (maskovatelné ikony, snímky, zkratky na
  pohledy), service worker s precache aplikace (navigace network-first) a
  obsluhou push.
- **Administrace** `admin.html` + `admin/*.js`: samostatné moduly bez bundlu,
  tajemství jen v `sessionStorage`, vynucená CSP bez inline skriptů.
- **Build** (`tools/build.js`): esbuild bundle a minifikace, otisk `?v=` v
  `index.html` a ve service workeru, přepočet CSP hashů inline skriptů ve
  `vercel.json` (`tools/csp-hashes.js`). Výstup je deterministický a commitnutý.

## 7. Bezpečnost

- **Identita (S1):** server vydává token jen pro `anon-<uuid v4>`; dřívější
  endpoint podepsal token pro libovolné uid. ID token se ověřuje na každém
  volání s uživatelem.
- **CORS** jen pro `CORS_ORIGINS` (výchozí produkční doména a localhost:3000).
- **Hlavičky** (`backend/security-headers.js` pro Express, `vercel.json` pro CDN):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options: DENY`, `Content-Security-Policy-Report-Only` s hashi tří
  inline skriptů a hlášením na `/api/csp-report`. Administrace má CSP vynucenou.
- **Administrace (S5):** `ADMIN_SECRET` porovnávaný v konstantním čase, bez něj
  503, v produkci minimálně 16 znaků; po 5 chybách z jedné IP blokace 15 min;
  ruční spuštění sběru nejvýš 1× za 10 min přes GitHub `workflow_dispatch`
  (`GITHUB_DISPATCH_TOKEN`); statistiky jen agregacemi (`count()`, `sum()`), bez
  čtení dokumentů uživatelů; audit s hashovanou IP.
- **Plánované úlohy:** `CRON_SECRET` v konstantním čase; bez něj v produkci 503.
- **Firestore:** prohlížeč jen čte veřejná data a vlastní `users/{uid}`.
- **Tajemství** (`.env`, servisní účet) jsou v `.gitignore`; vzor proměnných je
  `.env.example`.

## 8. Testování

| Sada | Rozsah | Výsledek (4. 11. 2026) |
|---|---|---|
| `npm test` (`node:test`, `test/*.test.js`, 22 souborů) | parser (vč. přelomu roku), prefetch s atrapou Firestore a Bakalářů, detektor změn a přechod týdne, agregáty, auth/S1, API a validace, stav/S4, upomínky, notifikace a limit FCM, admin API a stránka, iCal s vlastním validátorem, bezpečnostní hlavičky, klientské moduly (auth, XSS, SW, PWA, pohledy, tisk) | 223/223, 0 todo; běží v TZ UTC i Europe/Prague |
| `npm run test:coverage` | pokrytí `backend/**` a `routes/**` | celkem 85,3 % řádků / 84,0 % větví; `backend/` 90,7 % / 85,4 %, `routes/` 66,3 % / 76,7 % (nejméně `debug.js`, `groups.js`, `fcm.js`) |
| `npm run test:e2e` (Playwright 1.64, axe-core 4.14, `test/e2e/*.spec.js`) | 76 scénářů × projekty mobil (390×844) a desktop (1440×900): start a vykreslení, přepínání týdne a druhu, roletka, pohledy a historie, rozvržení, klávesnice na kartách, dialogy (fokus, Esc), Změny, Volné učebny, Společné volno, kiosk, sdílení, offline, přepnutí na příští týden přes `page.clock`, XSS, vynucená CSP, axe WCAG 2.2 AA ve 19 stavech | 134 prošlo, 18 přeskočeno (scénáře jen pro jeden projekt), axe 0 porušení, CSP 0 porušení |

E2E testy běží proti statickému serveru nad `public/`; Firebase SDK nahrazuje
atrapa (`test/e2e/support/fake-firebase.js`), `/api/*` odpovídá atrapa v testu a
každý požadavek mimo lokální server se zablokuje. Data jsou syntetická
(smyšlená jména), agregáty z nich skládá skutečný `backend/aggregates.js`. Čas je
pevně nastavený na středu 4. 11. 2026 8:20 (`page.clock`).

CI: `test.yml` (push a PR; Node 22/24 × TZ UTC/Europe/Prague, práh pokrytí 50 %),
`e2e.yml` (PR a ruční spuštění; kontrola, že commitnutý bundle odpovídá zdrojům,
Chromium headless shell, HTML report jako artefakt).

Testy pravidel Firestore v emulátoru nejsou součástí `npm test` (vyžadují Javu
a `@firebase/rules-unit-testing`); postup je v DEPLOYMENT.md.

## 9. Známá omezení

- Data jsou tak čerstvá, jak často běží prefetch; rozvrh v Bakalářích je
  zdrojem pravdy.
- Parser závisí na struktuře stránek Bakalářů; při změně jejich HTML pojistky
  zastaví přepis dat a `/api/status` ohlásí nezdravý stav.
- Sudé a liché týdny stálého rozvrhu parser nerozlišuje; svátky se do týdenní
  řady v iCal nepromítají.
- Upomínka se doručí nejvýš jednou (zábor `failed` se neopakuje).
- Limit pokusů do administrace je pro každou serverless instanci zvlášť;
  skutečnou ochranou je dlouhé náhodné tajemství.
- Automatický audit přístupnosti nenahrazuje ruční test se čtečkou obrazovky a
  zvětšením 200 %; push na iOS a kiosk na televizi je nutné ověřit na zařízení.

---

*Autor: Štefan Barát – SPŠD Motol, obor IT. Maturitní práce 2026/27.*
