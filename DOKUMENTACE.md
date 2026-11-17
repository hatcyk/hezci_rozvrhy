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
| Vzhled | návrh G „Obloha“: CSS vrstvy (`@layer`), `light-dark()`, `backdrop-filter`, systémové písmo bez webových fontů, ikony Lucide (`lucide-static`, jen při buildu) ve spritu `public/icons.svg` |
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
(GitHub Actions `prefetch.yml`, systémový cron). `GET /api/cron/prefetch` je jen
pro trvale běžící server (Docker, vlastní hostitel): běh trvá minuty a na
Vercelu by ho po odeslání odpovědi platforma zmrazila, proto tam bez
`waitUntil` (`@vercel/functions`) odpoví 501. Během rozpracovaného běhu vrací 409.

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
   Stálé rozvrhy se v září stahují v každém běhu, jinak jednou denně (první
   běh pražského dne, `system/permanentRefresh`; nepovedené se zkouší v dalších
   bězích) a zpracují se před `Actual`/`Next`, aby aktuální týden počítal
   s čerstvým stálým rozvrhem. Stránka, která je místo rozvrhu přihlašovacím
   formulářem (vypršelá relace), je chyba: běh se jednou znovu přihlásí.
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
   slotu se párují podle stavu, předmětu a vyučujícího. Typy změn:
   `substitution`, `room_change`, `subject_change` (jiný předmět, stejný
   vyučující), `lesson_replaced` (jiný předmět i vyučující, tedy suplování
   jiným předmětem), `type_change` (hodina odpadla / absence),
   `lesson_restored` (zrušení odvoláno), `lesson_added`, `lesson_removed`.
   Nalezené změny → dokument `changes/{docKey}_{hash}` se `sent: false`,
   zapsaný jednou dávkou spolu se snímkem. ID je hash verze výchozího snímku
   a obsahu změn a zapisuje se přes `create()`, takže dva překryté běhy
   neuloží (a nepošlou) tutéž změnu dvakrát.
8. **Agregáty** (`backend/aggregates.js`) ze snímků v paměti:
   `aggregates/changes_{Actual|Next}` (změny všech tříd po dnech) a
   `aggregates/freeRooms_{Actual|Next}` (volné učebny pro každý den a hodinu).
   Zapisují se jen při změně obsahu.
9. **Výsledek** `{ success, status, …počítadla }`, kde `status` je `ok`,
   `partial`, `login_failed`, `network`, `guard_no_definitions`,
   `guard_no_lessons` nebo `error`. `partial` = neobnovilo se víc než 10 %
   rozvrhů (chyby stažení + prázdné stránky, u kterých zůstal starý snímek);
   `success` je pak `false`. Funkce nevyhazuje výjimky.

### 3.2 Upozornění

- **Na změny** (`backend/fcm.js`, `processPendingChanges`; `scripts/process-notifications.js`
  nebo `GET /api/cron/process-notifications`): neodeslané `changes` → uživatelé,
  kteří daný rozvrh sledují (index `watchedKeys`) → filtr podle typu změny a
  skupin → **jen datová** zpráva FCM (`fitFcmDataPayload` ji udrží pod limitem
  4 KB). Neplatné tokeny se odstraní; `messaging/invalid-argument` token nemaže.
  Přepínače: `type_change` a `lesson_restored` patří pod „Odpadlé hodiny“;
  `lesson_replaced` projde, je-li zapnuté „Suplování“, „Odpadlé hodiny“ nebo
  „Změna předmětu“. Dokument se před odesláním zabere v transakci
  (`sent: false → true`), po odeslání dostane `sentToUsers`/`sentToDevices`
  (0, když rozvrh nikdo nesleduje). Zprávy mají `Urgency: high` a TTL 3 dny.
- **Upomínky před hodinou** (`backend/lesson-reminder.js`; `scripts/send-lesson-reminders.js`
  nebo `GET /api/cron/lesson-reminders`): okno 6–1 min před začátkem hodiny
  (`LESSON_REMINDER_*`). Hodina musí mít dnešní `date` a den nesmí být volný.
  Každá upomínka se nejdřív „zabere“ (`create()` v `lesson_notifications_sent`),
  takže souběžné běhy ji nepošlou dvakrát. Berou se jen sledované rozvrhy se
  zapnutou připomínkou, třída má přednost. TTL zprávy končí dvě minuty po
  začátku hodiny. HTTP varianta odpoví nejpozději po
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
  `lastSuccessAt` se posune jen při `status === 'ok'` (ne při `partial`).
- `GET /api/status` vrací `isHealthy`, `lastSuccessAt`, `dataAgeMin`,
  `maxAgeMin` a další. Data jsou zdravá, když jsou mladší než 120 min (Po–Pá
  6–18 h pražského času), jinak 12 h. S `?strict=1` vrací při nezdravém stavu 503.
  Odpověď smí CDN držet 30 s (`public, max-age=0, s-maxage=30`), prohlížeč se
  ptá vždy znovu; chyba čtení Firestore má `no-store`.
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
(`deploy/crontab.example`), sběr a odesílání změn pod zámkem `flock -n`, aby se
běhy nepřekryly.

## 4. Data ve Firestore

| Kolekce / dokument | Obsah | Zapisuje | Prohlížeč (pravidla) |
|---|---|---|---|
| `definitions/current` | třídy, vyučující, učebny, `classGroups` | prefetch | čte jednotlivé dokumenty (`get`, přihlášený) |
| `timetables/{Typ}_{id}_{Actual\|Next\|Permanent}` | snímek rozvrhu (3.1, bod 6) | prefetch | čte |
| `aggregates/changes_*`, `aggregates/freeRooms_*` | souhrny pro pohledy Změny a Volné učebny | prefetch | čte |
| `metadata/lastPrefetch` | souhrn posledního běhu (záloha pro banner) | prefetch | čte |
| `users/{uid}` | tokeny FCM, sledované rozvrhy a filtry, oblíbené, index `watchedKeys`/`watchedTypes` | API | ne (nastavení vrací API bez tokenů) |
| `changes/*` | zjištěné změny k odeslání | prefetch, notifikace | ne |
| `lesson_notifications_sent/*` | zábory upomínek | upomínky | ne |
| `runs/*`, `system/*` | běhy úloh, stav, migrace, slot ručního spuštění, `system/permanentRefresh` (denní obnova stálých rozvrhů) | úlohy, admin | ne |
| `userMigrations/{anonymous-<ms>}` | na které nové ID se staré převedlo (`migratedTo`, `authTime`) | `/api/auth` | ne |
| `audit/*` | přístupy do administrace (`ipHash` = HMAC) | admin API | ne |

Pravidla jsou v `firestore.rules` (prohlížeč smí jen `get` jednotlivých
dokumentů čtyř veřejných kolekcí, žádný výpis ani dotaz; zápis z prohlížeče
nikde, server zapisuje přes Admin SDK), složený index `runs (job ↑, startedAt ↓)` v
`firestore.indexes.json`.

## 5. HTTP API (`routes/`)

| Endpoint | Ochrana | Účel |
|---|---|---|
| `POST /api/auth` `{ userId? }` | ID token jen k prokázání ID | přidělí nové prázdné `anon-<uuid>` a custom token. Uložené `anon-<uuid>` znovu vydá a starý `anonymous-<ms>` jednorázově převede (`migratedFrom`), **jen když požadavek nese ID token téže identity**: samotné ID není heslo. Převádí se nastavení, ne tokeny zařízení (prohlížeč si token při startu zaregistruje znovu). Opakovaný požadavek téže relace Firebase (ztracená odpověď) dostane totéž nové ID. Nových identit nejvýš `AUTH_NEW_ID_LIMIT` (výchozí 60) z jedné IP, u IPv6 z prefixu /64, za 10 min, pak 429 s `Retry-After`. |
| `GET /api/status[?strict=1]` | – | stáří dat (3.3) |
| `GET /api/groups/:classId` | – | skupiny třídy |
| `GET\|POST /api/favorites/:userId` | ID token, vlastní `userId` | oblíbené rozvrhy (max. 50) |
| `POST /api/fcm/subscribe`, `unsubscribe`, `update-preferences`, `update-global-preferences`, `GET /api/fcm/preferences/:userId` | ID token, vlastní `userId` | odběr upozornění a nastavení (max. 200 sledovaných rozvrhů). Zápisy nejvýš 60 za 10 min na uživatele, pak 429 s `Retry-After`. `subscribe` ověří token u FCM nanečisto (`send(…, dryRun)`): token, který FCM odmítne, je 400; při výpadku FCM se token přijme a zaloguje. Týž token v jedné dávce s vlastním zápisem odebere ze starých dokumentů 1.x (`anonymous-…`, osiřelé po nepovedeném převodu); dokumenty jiných `anon-…` nemění nikdy (stačila by k tomu znalost cizího tokenu). Zařízení pod dvěma ID proto řeší odesílání: stejnou zprávu (u změny dokument změn a text, u upomínky rozvrh, hodina a text) dostane jeden token nejvýš jednou; různé zprávy odejdou všechny, takže na pořadí dokumentů nezáleží. |
| `POST /api/fcm/process-changes`, `GET /api/cron/{prefetch,process-notifications,lesson-reminders,cleanup}` | `Authorization: Bearer <CRON_SECRET>` | plánované úlohy; bez tajemství v produkci 503 |
| `GET /api/ical/:type/:id.ics?schedule=…&group=…` | – (vypínač `ICAL_ENABLED`) | kalendář iCalendar (RFC 5545), ETag/304 |
| `GET /api/admin/{health,runs,runs/intervals,changes,stats,audit}`, `POST /api/admin/prefetch/dispatch` | `Authorization: Bearer <ADMIN_SECRET>` | administrace (kap. 7) |
| `POST /api/csp-report` | limit 60/min | hlášení porušení CSP do logu |
| `GET /api/debug/*` (`status`, `users`, `simulate-change`, …) | jen `DEBUG=true` mimo produkci (nikdy na Vercelu ani s `NODE_ENV=production`) a z `127.0.0.1`; jinak obyčejná 404 | ladění |

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
- **Rám** (`shell.js`): na mobilu (šířka ≤ 1079 px) obrazovky Přehled a Den,
  plovoucí spodní lišta s pohledy a počtem změn, kulaté tlačítko hledání a
  nabídka „⋯“; na počítači postranní panel (hledání, pohledy, oblíbené, karta
  „teď“) a lišta pohledu (Den / Týden, Stálý / Aktuální / Příští, Dnes, ‹ ›,
  „Jen změny“). Den na mobilu je záznam v historii, systémové Zpět vrátí
  na Přehled.
- **Přehled** (`overview.js`): vždy o „teď“ (aktuální týden, o víkendu příští):
  probíhající nebo další hodina s učebnou, věta o změnách dne, pás hodin,
  řádky týdne, dlaždice Změny a Volné učebny.
- **Hledání** místo rozbalovacího seznamu: skupiny Třídy / Vyučující / Učebny,
  bez ohledu na diakritiku, ovládání klávesnicí a zkratka „/“, nedávné volby,
  hvězdička oblíbených jako samostatné tlačítko.
- **Rozvržení** (`layout-registry.js`, `layout-manager.js`, `layout-renderers.js`,
  `timetable.js`, čisté funkce v `rozvrh-core.js`): `day` (časová osa ve
  skutečném měřítku s čárou „teď“, mobil i počítač), `week-view` (jen počítač,
  výchozí), `compact-list` a `card-view` (jen mobil). Uložené `agenda` a
  `single-day` převede `migrateLayoutId()` na `day`. Stav hodiny je vždy ikona
  a slovo (suplování, jiná učebna, odpadá, akce, přidaná hodina), ne jen barva.
  Detail hodiny je na mobilu spodní panel, na počítači bublina u bloku.
- **Pohledy** (`view-router.js`, skutečné odkazy, History API, fokus na nadpis):
  Změny (`changes-*.js`), Volné učebny (`rooms-*.js`), Společné volno
  (`common-*.js`), kiosk (`kiosk*.js`, `/?kiosk=changes`, `onSnapshot`, Wake Lock).
- **Nástroje rozvrhu** (`timetable-tools.js`, `share.js`, `print.js`,
  `calendar-sheet.js`): „Jen změny“, sdílení (Web Share API, jinak schránka),
  tisk A4 na šířku, odkaz `webcal://…/api/ical/…`.
- **Panely** jsou nativní `<dialog>` + `showModal()` (`bottom-sheet.js`):
  stránka za nimi je inertní, Esc zavře, fokus se vrátí.
- **Vzhled** (`public/css/g/`, pořadí v `tools/build.js`): `tokens.css` deklaruje
  vrstvy `reset, tokens, base, materials, components, shell, views, motion, print`
  a barvy obou režimů přes `light-dark()`. Tři materiály: sklo
  (`backdrop-filter`) jen na navigaci, závoj na obsahu a plná plocha; bez
  podpory `backdrop-filter`, při `prefers-reduced-transparency` nebo s volbou
  „Omezit průhlednost“ (`data-transparency="reduced"`, Safari systémové
  nastavení nepozná) je všude plná plocha. Obloha je pevná vrstva
  `body::before`. Ikony jsou `<svg><use href="icons.svg#…">`; sprite skládá
  `tools/icons.js` z balíčku `lucide-static`. Kiosk má vždy noční oblohu bez
  skla a písmo podle výšky obrazovky, tisk bílý papír a stav ikonou a slovem.
  Vzorník `design.html` ukazuje tokeny, materiály, stavy a živý kontrast.
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
  volání s uživatelem. Nových identit nejvýš 60 z jedné adresy (IPv6 po /64)
  za 10 min (`AUTH_NEW_ID_LIMIT`), aby jeden skript nenadělal stovky uživatelů
  s upomínkami; obnova vlastní relace a převod starého ID se nepočítají.
- **CORS** jen pro `CORS_ORIGINS` (výchozí produkční doména a localhost:3000).
- **Hlavičky** (`backend/security-headers.js` pro Express, `vercel.json` pro CDN):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options: DENY`, `Content-Security-Policy-Report-Only` s hashi tří
  inline skriptů a hlášením na `/api/csp-report`. Administrace má CSP vynucenou.
- **Administrace (S5):** `ADMIN_SECRET` porovnávaný v konstantním čase, bez něj
  503, v produkci minimálně 16 znaků; po 5 chybách z jedné IP (IPv6 z jednoho
  prefixu /64) blokace 15 min a jeden záznam v auditu;
  ruční spuštění sběru nejvýš 1× za 10 min přes GitHub `workflow_dispatch`
  (`GITHUB_DISPATCH_TOKEN`); statistiky jen agregacemi (`count()`, `sum()`), bez
  čtení dokumentů uživatelů; audit s hashovanou IP.
- **Plánované úlohy:** `CRON_SECRET` v konstantním čase; bez něj v produkci 503.
- **Ladění** (`/api/debug/*`, bez přihlášení: vypíše tokeny, pošle upozornění
  všem) jen s `DEBUG=true`, mimo produkci a z adresy soketu `127.0.0.1`/`::1`
  (ne z `X-Forwarded-For`); jinak 404 jako neexistující cesta. Server
  poslouchá ve výchozím stavu jen na `127.0.0.1`, do sítě až s `HOST=0.0.0.0`
  (nastavuje ho obraz Dockeru a `deploy/lepsi-rozvrh.service`).
- **Firestore:** prohlížeč jen čte veřejná data a vlastní `users/{uid}`.
- **Tajemství** (`.env`, servisní účet) jsou v `.gitignore`; vzor proměnných je
  `.env.example`.

## 8. Testování

| Sada | Rozsah | Výsledek (15. 11. 2026) |
|---|---|---|
| `npm test` (`node:test`, `test/*.test.js`, 24 souborů) | parser (vč. přelomu roku), prefetch s atrapou Firestore a Bakalářů, detektor změn a přechod týdne, agregáty, auth/S1, API a validace, stav/S4, upomínky, notifikace a limit FCM, admin API a stránka, iCal s vlastním validátorem, bezpečnostní hlavičky, klientské moduly (auth, XSS, SW, PWA, pohledy, tisk, rozvrh návrhu G), kontrast všech dvojic barevných tokenů v obou režimech (`g-contrast.test.js`) | 336/336, 0 todo |
| `npm run test:coverage` | pokrytí `backend/**` a `routes/**` | celkem 85,3 % řádků / 84,1 % větví (15. 11.); po složkách ze 4. 11.: `backend/` 90,7 % / 85,4 %, `routes/` 66,3 % / 76,7 % (nejméně `debug.js`, `groups.js`, `fcm.js`) |
| `npm run test:e2e` (Playwright 1.64, axe-core 4.14, `test/e2e/*.spec.js`) | 93 scénářů × projekty mobil (390×844) a desktop (1440×900): start a vykreslení, Přehled a Den, přepínání týdne a druhu, hledání (diakritika, klávesnice, skupiny), oblíbené, pohledy a historie, rozvržení a převod starých, klávesnice na blocích hodin, dialogy (fokus, Esc), Změny, Volné učebny, Společné volno, kiosk, sdílení, offline, přepnutí na příští týden přes `page.clock`, XSS, vynucená CSP, axe WCAG 2.2 AA ve 27 stavech (13 obrazovek × 2 režimy + kiosk) | 164 prošlo, 22 přeskočeno (scénáře jen pro jeden projekt), axe 0 porušení, CSP 0 porušení |

E2E testy běží proti statickému serveru nad `public/`; Firebase SDK nahrazuje
atrapa (`test/e2e/support/fake-firebase.js`), `/api/*` odpovídá atrapa v testu a
každý požadavek mimo lokální server se zablokuje. Data jsou syntetická
(smyšlená jména), agregáty z nich skládá skutečný `backend/aggregates.js`. Čas je
pevně nastavený na středu 4. 11. 2026 8:20 (`page.clock`).

CI: `test.yml` (push a PR; Node 22/24 × TZ UTC/Europe/Prague, práh pokrytí 50 %),
`e2e.yml` (PR a ruční spuštění; kontrola, že commitnutý bundle odpovídá zdrojům,
Chromium headless shell, HTML report jako artefakt).

Pravidla Firestore: `npm test` hlídá jen jejich text (`test/firestore-rules.test.js`:
veřejné kolekce jen `get`, každá kolekce, kterou server používá, výslovně
zavřená). Vyhodnocení v emulátoru (`test/rules/firestore-rules.emulator.test.mjs`,
`npm run test:rules`) potřebuje Javu 21 a balíčky instalované bez zápisu do
`package.json` (`npm i --no-save --no-package-lock @firebase/rules-unit-testing@6.0.0
firebase@13.1.0 firebase-tools@15.34.2`); v CI ho pouští `rules.yml` (PR a push
do `main`/`dev` se změnou pravidel nebo testu, ručně přes Run workflow).
Akce ve workflows jsou připnuté na SHA, nové verze navrhuje Dependabot
(`.github/dependabot.yml`, měsíčně).

## 9. Známá omezení

- Data jsou tak čerstvá, jak často běží prefetch; rozvrh v Bakalářích je
  zdrojem pravdy.
- Parser závisí na struktuře stránek Bakalářů; při změně jejich HTML pojistky
  zastaví přepis dat a `/api/status` ohlásí nezdravý stav.
- Sudé a liché týdny stálého rozvrhu parser nerozlišuje; svátky se do týdenní
  řady v iCal nepromítají.
- Upomínka se doručí nejvýš jednou (zábor `failed` se neopakuje).
- Limit pokusů do administrace je pro každou serverless instanci zvlášť;
  skutečnou ochranou je dlouhé náhodné tajemství. Stejně tak limity nových
  identit a zápisů upozornění: brzdí jeden skript, ne útok z mnoha adres (na
  to Vercel Firewall nebo Firebase App Check).
- Automatický audit přístupnosti nenahrazuje ruční test se čtečkou obrazovky a
  zvětšením 200 %; push na iOS a kiosk na televizi je nutné ověřit na zařízení.

---

*Autor: Štefan Barát – SPŠD Motol, obor IT. Maturitní práce 2026/27.*
