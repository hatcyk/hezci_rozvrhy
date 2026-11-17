# Nasazení

Produkce běží na **Vercelu** (statické soubory z CDN + Express API jako
serverless funkce), sběr dat na **GitHub Actions** a data ve **Firebase**
(projekt `barat-bakalari`). Kapitola 1 popisuje přechod na verzi 2.0.0:
sekce 1.1–1.7 jednotlivé části, **postup vydání krok za krokem je v 1.8**,
návrat v 1.9. Kapitola 2 popisuje provoz na vlastním serveru.

## 1. Nasazení verze 2.0.0 (Vercel)

### 1.1 Proměnné prostředí

Vercel → Project → Settings → Environment Variables (Production). Lokálně
tytéž hodnoty patří do `.env` (vzor s komentáři je `.env.example`).

| Proměnná | Kde | Povinná | Význam |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Vercel, GitHub secret | ano | celý servisní účet jako JSON na jednom řádku (lokálně místo něj `FIREBASE_SERVICE_ACCOUNT_PATH`) |
| `CRON_SECRET` | Vercel, GitHub secret | ano | `Authorization: Bearer …` pro `/api/cron/*`; bez něj v produkci 503 |
| `BAKALARI_USERNAME`, `BAKALARI_PASSWORD` | GitHub secret | ano | účet pro stahování rozvrhů (prefetch) |
| **`ADMIN_SECRET`** | Vercel | pro `/admin` | heslo administrace (`openssl rand -base64 32`, v produkci min. 16 znaků); bez něj `/api/admin/*` vrací 503 |
| **`GITHUB_DISPATCH_TOKEN`** | Vercel | pro „Spustit sběr“ | fine-grained PAT jen pro tento repozitář, oprávnění **Actions: Read and write** |
| **`GITHUB_REPO`** | Vercel | pro „Spustit sběr“ | `hatcyk/hezci_rozvrhy` |
| `GITHUB_DISPATCH_REF`, `GITHUB_DISPATCH_WORKFLOW` | Vercel | ne | větev a workflow pro ruční sběr (výchozí `main`, `prefetch.yml`) |
| **`CORS_ORIGINS`** | Vercel | ne | povolené původy oddělené čárkou, bez lomítka na konci; výchozí `https://spsd-rozvrhy.vercel.app,http://localhost:3000,http://127.0.0.1:3000`. Při vlastní doméně ji sem přidej. |
| **`ICAL_ENABLED`** | Vercel | ne | `false` vypne `/api/ical/*` (404). Výchozí zapnuto – rozhodnutí o zveřejnění strojově čitelného rozvrhu patří škole. |
| **`SEMESTER_END`** | Vercel | ne | poslední den pololetí pro stálý rozvrh v iCal (`2027-01-31`); výchozí 31. 1. nebo 30. 6. podle data |
| **`PREFETCH_CONCURRENCY`** | `prefetch.yml` | ne | souběžné požadavky na Bakaláře; výchozí i nastavená hodnota **3** (víc jen zatěžuje školní server) |
| **`BAKALARI_USER_AGENT`** | `prefetch.yml` | ne | identifikace robota vůči Bakalářům, např. `LepsiRozvrh/2.0 (+https://spsd-rozvrhy.vercel.app; kontakt)`. Výchozí je prohlížečový řetězec. `prefetch.yml` ji dnes nepředává: doplň do kroku *Run prefetch script* `BAKALARI_USER_AGENT: ${{ vars.BAKALARI_USER_AGENT }}` a nejdřív ověř ručním během, že ji server nefiltruje. |
| `LESSON_REMINDER_*`, `REMINDER_HTTP_BUDGET_MS` | Vercel | ne | upomínky (vypnutí `LESSON_REMINDER_ENABLED=false`, okno, souběžnost, 25s rozpočet odpovědi) |
| `DEBUG` | jen lokálně | ne | na Vercelu nenastavuj (Production ani Preview). `/api/debug/*` odpovídá jen při `DEBUG=true`, mimo Vercel a z 127.0.0.1, jinak 404 |
| `NEW_USERS_PER_IP_LIMIT` | Vercel | ne | kolik nových uživatelů (dokumentů `users`) smí jedna IP (IPv6 po prefixu /64) založit za 10 minut prvním zápisem (upozornění, jejich nastavení, oblíbené), pak 429 s `Retry-After`; výchozí **60** (celá škola je za jednou veřejnou IP). `/api/auth` dál vydá identitu každému, takže čtení rozvrhů limit nikdy nezastaví; zápisy existujících uživatelů se nepočítají. Limit drží každá serverless instance zvlášť. Na vlastním serveru za proxy jen s `TRUST_PROXY=1`, jinak se všichni počítají jako adresa proxy. |
| `TRUST_PROXY`, `RUN_TRIGGER` | jen vlastní server | ne | viz kapitola 2 |

GitHub → Settings → Secrets and variables → Actions potřebuje secrets
`BAKALARI_USERNAME`, `BAKALARI_PASSWORD`, `FIREBASE_SERVICE_ACCOUNT`,
`CRON_SECRET` a `VERCEL_URL` (např. `https://spsd-rozvrhy.vercel.app`).

Vercel → Settings → General → Node.js Version: **22.x** (`engines` ji vynucuje).

### 1.2 Backend a frontend najednou

Uživatelská API (`/api/fcm/*`, `/api/favorites/*`) nově vyžadují
`Authorization: Bearer <Firebase ID token>` a `/api/auth` vydává token jen pro
nový formát ID. Starý klient s novým API dostane 401, nový klient se starým
API nefunguje správně. Proto:

1. Všechny změny slouč **jedním merge commitem**. Nic z backendu ani frontendu
   nenasazuj zvlášť ani cherry-pickem a **nikdy nepoužívej squash**: `main` a
   `dev` by se rozešly a příští společné vydání by nešlo.
2. Ten commit pošli **do `main` i do `dev` jedním příkazem**
   `git push --atomic` (1.8, krok 1.3). Vercel nasazuje produkci z produkční
   větve (standardně `main`, ověř v Settings → Git), ale `prefetch.yml`
   (spouštěný z `main`) checkoutuje kód sběru z větve `dev` (`ref: dev`).
   Nový sběr zapisuje `weekStart`, `date`, `daysOff` a agregáty, které nový
   frontend čte. **Nový sběr nesmí běžet dřív než nový web:** starý odesílač
   na Vercelu nezná nové typy změn (`lesson_replaced`, `lesson_restored`) a
   poslal by upozornění s prázdným textem. Opačně (nový web, starý sběr) je
   to v pořádku. Proto se sběr na dobu pushe pozastaví (1.8, krok 1.3). Co
   způsobí, když se povede jen jedna větev, je v 1.9.
3. Bundle frontendu je commitnutý; před sloučením ověř `npm run build` (nesmí
   vzniknout rozdíl), `npm test` a `npm run test:e2e`. E2E v CI běží jen na
   pull requestu (`e2e.yml`), při přímém pushi ne. Proto nejdřív otevři PR a
   nech doběhnout všechny kontroly.
4. Otevřené karty se starou verzí po nasazení hlásí 401 u oblíbených a
   notifikací, dokud se neobnoví; service worker načítá stránku stylem
   „network-first“, takže stačí nové otevření aplikace.

Návrat je v 1.9. Samotný Instant Rollback na Vercelu nestačí, protože nevrací
sběr ve větvi `dev`.

### 1.3 Migrace uživatelů

Nic se nespouští ručně. Při prvním otevření nové verze klient pošle uložené
`localStorage.userId`:

- starý formát `anonymous-<ms>` + ID token relace, kterou k němu založila verze
  1.x (stejné SDK 9.22.0, relace v prohlížeči zůstává) → server v jedné
  transakci zkopíruje nastavení z `users/{starý}` do `users/anon-<uuid>`
  (s `migratedFrom`, `migratedAt`), starý dokument smaže a zapíše
  `userMigrations/{starý}`. **Tokeny zařízení se nepřenáší**: prohlížeč s
  povolenými upozorněními si token po převodu zaregistruje znovu sám. Kdo
  token nikdy nezaregistruje (upozornění zakázaná), nepřijde o nic jiného;
- opakovaný pokus z téže relace Firebase dostane totéž nové ID (záznam v
  `userMigrations`), jiná relace dostane nové prázdné ID;
- bez ID, s neplatným ID nebo s ID, ke kterému volající nemá relaci, vznikne
  nové prázdné `anon-<uuid>`. Kdo starý identifikátor jen zná nebo uhodne,
  nezíská nic.

Prohlížeč, který přišel o přihlášení Firebase, ale ne o `userId`, dostane nové
prázdné ID a starý dokument zůstane. Jakmile na tomto zařízení znovu zapne
upozornění, server token ze starých dokumentů `anonymous-*` odebere, takže
upozornění nechodí dvakrát ani z dokumentu, který už uživatel nevidí. Dokumentů
`anon-*` jiných uživatelů se to nikdy nedotkne.

Migrace starý dokument maže. **Bez zálohy `users` (1.8, krok 0.5) je
nevratná.** Spravovaný export Firestore vyžaduje zapnuté placení, proto je v
repozitáři `scripts/backup-users.js` (export do JSON a obnova chybějících
dokumentů).

Uživatelé, kteří aplikaci neotevřou, zůstávají pod starým ID a upozornění
dostávají dál (odesílání tokeny nemění). Index sledovaných rozvrhů
(`watchedKeys`, `watchedTypes`) doplní starým dokumentům jednorázová migrace
`watchIndexV2` při prvním běhu notifikací.

Kontrola: Firestore → `users`, filtr `migratedFrom` existuje; v `/admin`
statistiky uživatelů. Dokumenty `users/anonymous-*`, které se ani po několika
měsících nepřevedly, můžeš smazat (jejich uživatelé aplikaci neotevírají).

### 1.4 Pravidla a indexy Firestore

Repozitář obsahuje `firestore.rules` a `firestore.indexes.json` (index
`runs: job ↑, startedAt ↓` pro administraci). Prohlížeč smí jen **číst po
jednom dokumentu** (`get`) čtyři veřejné kolekce `definitions`, `timetables`,
`metadata` a `aggregates`, a to jen přihlášený. Dotaz na celou kolekci
(`list`) je zakázaný, aby jeden návštěvník nevyčerpal denní limit čtení.
`users` a všechny serverové kolekce (`userMigrations`, `changes`,
`lesson_notifications_sent`, `runs`, `system`, `audit`) jsou pro prohlížeč
zavřené. Zapisuje jen server přes Admin SDK, na které se pravidla nevztahují.

Pravidla patří **do téhož sezení jako vydání**, hned po ověření nového
klienta (1.8, krok 1.6), ne „někdy potom“. Klient 1.x se přihlašuje a čte jen
jednotlivé dokumenty, takže mu nová pravidla vyhoví. Dokud pravidla
nasazená nejsou, platí to, co je v konzoli, a to nikdo neověřil.

1. Ulož si stávající pravidla a seznam indexů: konzole Firebase → Firestore →
   Rules (zkopírovat do souboru) a Indexes.
2. Test pravidel v emulátoru musí být **zelený před nasazením**:
   GitHub → Actions → *Firestore rules* → Run workflow (spouští se i samo na
   PR, který mění pravidla). Lokálně to jde jen s Javou 21:

   ```bash
   npm i --no-save --no-package-lock @firebase/rules-unit-testing@6.0.0 firebase@13.1.0 firebase-tools@15.34.2
   npm run test:rules
   ```

   Projekt `demo-lepsi-rozvrh` se nikdy nedotkne produkce. Test není součástí
   `npm test`; `npm test` jen hlídá, že pravidla vyjmenovávají všechny
   kolekce, které kód používá.
3. Nasazení pravidel i indexů:

   ```bash
   npx firebase-tools@15.34.2 login
   npx firebase-tools@15.34.2 deploy --only firestore --project barat-bakalari
   ```

   **Nepoužívej `--force`**: smazal by indexy, které nejsou v souboru. Index se
   staví několik minut; do té doby `/admin` ukazuje varování a čte náhradní
   cestou.
4. Ověř v aplikaci, že se načte rozvrh, Změny, Volné učebny a kiosk (živý
   odběr) a že v konzoli prohlížeče není `permission-denied`.
5. Návrat: vložit pravidla uložená v kroku 1. Při návratu webu na 1.x to
   potřeba není, klient 1.x s novými pravidly funguje.

### 1.5 Plánování: cron-job.org → `workflow_dispatch`

Plánovač GitHubu běhy zpožďuje nebo vynechává (medián rozestupu kolem 5 h).
Nová verze přitom ve školní den 6–18 h hlásí data starší než 120 minut jako
zastaralá a `check-status.yml` pak padá každých 10 minut. Úloha **Prefetch**
proto musí běžet **ještě před vydáním** (1.8, krok 0.6). Funguje už s 1.x,
protože stará `prefetch.yml` v `main` `workflow_dispatch` přijímá.
`schedule` v `prefetch.yml` zůstává jako záloha a souběh řeší `concurrency`.

1. Token: GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Resource owner `hatcyk`, *Only select repositories*
   → `hezci_rozvrhy`, Repository permissions → **Actions: Read and write**,
   expirace (např. 30. 6. 2027). Může to být jiný token než
   `GITHUB_DISPATCH_TOKEN`, aby šly zrušit zvlášť.
2. cron-job.org, úloha **Prefetch** (před vydáním):
   - `POST https://api.github.com/repos/hatcyk/hezci_rozvrhy/actions/workflows/prefetch.yml/dispatches`
   - hlavičky `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2026-03-10`, `User-Agent: lepsi-rozvrh-cron`,
     `Content-Type: application/json`
   - tělo `{"ref":"main"}`; úspěch = HTTP 200 (`workflow_run_id`, `html_url`)
   - plán každých 15 min, Po–Pá 6–18 h, **časové pásmo Europe/Prague**
     (nastavuje se u úlohy, výchozí je UTC); druhá úloha 1× za hodinu mimo tuto dobu.
3. Úloha **Notifikace** (po vydání): `GET https://spsd-rozvrhy.vercel.app/api/cron/process-notifications`,
   hlavička `Authorization: Bearer <CRON_SECRET>`, každých 5 min.
4. Úloha **Upomínky** (po vydání): `GET …/api/cron/lesson-reminders`, stejná
   hlavička, každou minutu, Po–Pá 7–17 h, Europe/Prague. cron-job.org čeká
   nejvýš 30 s, endpoint proto odpoví do 25 s (200, nebo 202 a běh pokračuje).
   Aby Vercel práci po odpovědi 202 nezmrazil, lze doinstalovat
   `@vercel/functions` (kód použije `waitUntil` sám).
5. Kontrola: v `runs` mají běhy prefetche `trigger: 'dispatch'`; `/admin` →
   rozestupy běhů za 7 dní.

Po sběru volá `prefetch.yml` zpracování notifikací. Když se `CRON_SECRET` na
Vercelu a v GitHubu liší, krok *Process notifications after prefetch* teď
viditelně selže (401/503) místo toho, aby chybu spolkl. Červený krok znamená
zkontrolovat tajemství.

### 1.6 CSP a skripty třetích stran

Aplikace posílá `Content-Security-Policy-Report-Only` a hlášení zapisuje do
logu (Vercel → Logs, řádky `🛡️ CSP report`). Administrace má CSP vynucenou už
teď. E2E test `test/e2e/csp.spec.js` politiku v prohlížeči vynucuje a hlídá,
že aplikace nic neporuší (ověřuje hashe inline skriptů a zdroje načítané při
startu; skutečné spojení Firebase SDK v testu není).

Skripty z cizích serverů:

- **Firebase SDK** se načítá z `https://www.gstatic.com/firebasejs/9.22.0/`
  s otiskem `integrity` (SRI) a `crossorigin="anonymous"`. Prohlížeč soubor s
  jiným obsahem nespustí, ani když přijde z mezipaměti service workeru (ten
  SDK ukládá a podává v režimu `cors`). CSP povoluje gstatic jen pod cestou
  této verze. Přechod na jinou verzi SDK:
  1. Změnit verzi všude: `public/index.html` (4× `src`),
     `public/firebase-messaging-sw.js` (2× `importScripts` a
     `CROSS_ORIGIN_PRECACHE`), `backend/security-headers.js`
     (`FIREBASE_SDK_BASE`). Shodu hlídá `test/client-sdk-integrity.test.js`.
  2. Spočítat otisky a zapsat je do `integrity="sha384-…"` v `index.html`:

     ```bash
     for f in app auth firestore messaging; do curl -s https://www.gstatic.com/firebasejs/X.Y.Z/firebase-$f-compat.js | openssl dgst -sha384 -binary | openssl base64 -A; echo; done
     ```

     Soubory musí mít hlavičku `Access-Control-Allow-Origin: *`
     (`curl -sI …`), jinak je prohlížeč s `crossorigin` zablokuje.
  3. `npm run build` (CSP do `vercel.json`), `npm test`, `npm run test:e2e`.
  4. Po nasazení zkontrolovat konzoli prohlížeče. Špatný otisk nebo chybějící
     CORS znamená, že prohlížeč SDK zablokuje a aplikace běží jen z uložených
     dat („Nepodařilo se připojit k databázi rozvrhů…“).
- **Vercel Web Analytics a Speed Insights** se načítají z vlastní domény
  (`/_vercel/insights/script.js`, `/_vercel/speed-insights/script.js`) až po
  načtení stránky, ne z jsDelivr. Ty cesty existují, jen když jsou obě služby
  zapnuté v projektu (Vercel → Project → Analytics → Web Analytics, Speed
  Insights) a projekt je potom znovu nasazený. Bez toho, a mimo Vercel, vrací
  404: aplikace běží dál, jen se nic neměří. Balíčky z npm/jsDelivr ani
  `va.vercel-scripts.com` do stránky ani do CSP nevracej.

Přechod z Report-Only na vynucenou CSP:

1. Nech Report-Only běžet aspoň 2–3 týdny a sleduj hlášení. Hlášení z
   rozšíření prohlížeče (`chrome-extension://…`) ignoruj.
2. V `backend/security-headers.js` ve funkci `baseHeaders()` přejmenuj klíč
   `Content-Security-Policy-Report-Only` na `Content-Security-Policy`.
3. `node tools/csp-hashes.js --write` – přepíše hlavičky ve `vercel.json`.
4. V `test/security-headers.test.js` uprav test „Express: hlavičky …“
   (čte `content-security-policy-report-only` a očekává, že vynucená chybí).
5. `npm test`, `npm run test:e2e`, nasadit a znovu sledovat logy.

Po každé změně inline skriptu v `public/index.html` spusť `npm run build`
(přepočítá hashe ve `vercel.json`), jinak `npm test` selže.

### 1.7 Kontrolní seznam po nasazení

```bash
URL=https://spsd-rozvrhy.vercel.app
curl -s $URL/api/status                       # po prvním sběru isHealthy: true, čerstvé lastSuccessAt
curl -sI $URL/ | grep -iE 'content-security-policy|x-frame-options|nosniff'
curl -s -X POST -H 'Content-Type: application/json' -d '{}' $URL/api/auth   # userId: anon-…
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/favorites/anon-00000000-0000-4000-8000-000000000000   # 401
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/cron/cleanup                # 401
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/debug/status                # 404 (ladicí API na Vercelu nikdy neběží)
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/admin/health                # 401 (503 = chybí ADMIN_SECRET); počítá se jako 1 chybný pokus
curl -fsS -H "Authorization: Bearer $CRON_SECRET" $URL/api/cron/process-notifications   # 200: tajemství na Vercelu sedí
curl -s -o /dev/null -w '%{http_code}\n' $URL/_vercel/insights/script.js       # 200 (404 = Web Analytics nejsou zapnuté, 1.6)
```

- [ ] Proměnné z 1.1 nastavené na Vercelu i v GitHubu, Node.js 22.x, `DEBUG`
      nenastavená v Production ani v Preview.
- [ ] `main` i `dev` ukazují na stejný merge commit (`git ls-remote origin main dev`);
      Vercel nasadil `main`.
- [ ] Ruční běh `prefetch.yml` (Actions → Run workflow nebo `/admin` → Spustit
      sběr): v logu „✅ Login successful“, `runs` má záznam `status: ok`.
      **První běh nic nehlásí** („not compared: previous_without_week“) a
      jednorázově přepíše všechny snímky (nově s `date` a `weekStart`).
- [ ] `aggregates/changes_*` a `aggregates/freeRooms_*` existují; pohledy Změny a
      Volné učebny ukazují data.
- [ ] `system/migrations` má `watchIndexV2: true` (po prvním běhu notifikací).
- [ ] Aplikace v prohlížeči: rozvrh se načte, oblíbené se uloží, v konzoli
      nejsou chyby ani 401.
- [ ] Notifikace na testovacím telefonu (Android i iPhone s aplikací na ploše):
      zapnout, sledovat třídu, ověřit doručení při změně a upomínku.
- [ ] Zařízení, kde byla 1.x se zapnutými upozorněními: po otevření má
      `localStorage.userId` tvar `anon-…`, ve Firestore má `users/anon-…`
      `migratedFrom` a znovu zaregistrovaný token, sledované rozvrhy i
      oblíbené sedí.
- [ ] Kiosk na chodbě po nasazení ukazuje dnešní změny (po jednom
      automatickém obnovení); jinak ho obnov ručně.
- [ ] Konzole prohlížeče bez „Failed to find a valid digest“ (otisky SDK, 1.6).
- [ ] `/admin`: přihlášení `ADMIN_SECRET`, semafor stáří dat, běhy, statistiky.
- [ ] Pravidla a indexy Firestore nasazené (1.4), aplikace bez `permission-denied`.
- [ ] cron-job.org: historie úloh hlásí 200/202, `check-status.yml` je zelený.
- [ ] `/api/ical/Class/<id>.ics` vrací kalendář (nebo 404 při `ICAL_ENABLED=false`).
- [ ] Vercel → Logs: hlášení CSP (1.6).

### 1.8 Postup vydání krok za krokem

**Pracuj v čerstvém klonu** (`git clone https://github.com/hatcyk/hezci_rozvrhy`).
Starší lokální checkout může mít historii z doby před jejím přepsáním
(13. 11. 2026). Push z něj by ji vrátil do `main`.

Čas vydání: **mimo výuku** (pátek večer nebo sobota), ne v noci na pondělí.
První běh nového sběru nic neporovnává, takže změny zveřejněné mezi posledním
starým a prvním novým během se nikdy neohlásí.

**Fáze 0: příprava (produkci nemění)**

| # | Co udělat | Jak ověřit | Návrat |
|---|---|---|---|
| 0.1 | `git fetch origin`; `git merge-base --is-ancestor origin/dev origin/main` a `git merge-base --is-ancestor origin/2.0 origin/design-g`; sloučení nanečisto `git merge-tree --write-tree origin/main origin/design-g` | oba příkazy skončí 0, merge-tree bez konfliktu | — |
| 0.2 | Vercel: Production Branch = `main`, Node 22.x, proměnné z 1.1 (nově `ADMIN_SECRET`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`); `DEBUG` v Production ani Preview nenastavená; zjistit, zda Preview má produkční servisní účet a zda je zapnutá Deployment Protection | výpis proměnných; proměnné platí až pro další nasazení | smazat proměnné |
| 0.3 | Rozhodnout `ICAL_ENABLED` | zapsáno | — |
| 0.4 | Lokálně `npm ci && npm run build && git diff --exit-code && npm test && npm run test:e2e`; otevřít PR `design-g → main` (zatím neslučovat) | `test.yml`, `e2e.yml` a `rules.yml` zelené na PR | zavřít PR |
| 0.5 | Záloha `users` mimo repozitář: `node scripts/backup-users.js export ~/zalohy/users-$(date +%F).json` (s produkčním servisním účtem; obsahuje tokeny zařízení); uložit pravidla a indexy (1.4, krok 1); `git tag v1-last origin/main && git push origin v1-last`; poznamenat ID současného produkčního nasazení na Vercelu | skript vypíše počet dokumentů; `restore` bez `--yes` nad týmž souborem hlásí „0 chybí“; tag na GitHubu | — |
| 0.6 | cron-job.org: PAT a úloha Prefetch (1.5, kroky 1–2) | v Actions běhy `workflow_dispatch` po 15 min, sběr zelený | vypnout úlohu |

**Fáze 1: přepnutí, v jednom sezení (asi 30–45 min)**

| # | Co udělat | Jak ověřit | Návrat |
|---|---|---|---|
| 1.1 | Ručně pustit starý sběr (Actions → Prefetch → Run workflow) a nechat doběhnout upozornění | běh zelený; ve `changes` nic se `sent == false` | — |
| 1.2 | `git checkout -B release origin/main && git merge --no-ff origin/design-g`, pak `npm ci && npm test` | testy zelené, `git diff origin/design-g` prázdný | `git branch -D release` |
| 1.3 | Pozastavit sběr: cron-job.org → úloha Prefetch vypnout, GitHub → Actions → *Prefetch Timetable Data* → *Disable workflow*. Pak `git push --atomic origin release:main release:dev`, počkat na nasazení na Vercelu a teprve potom workflow znovu povolit (*Enable workflow*) | `git ls-remote origin main dev` = stejné SHA; Vercel: nasazení toho SHA „Ready“ na produkční doméně; `test.yml` zelené | 1.9 |
| 1.4 | Kontroly `curl` z 1.7 včetně kladné zkoušky cronu | `/api/auth` → `anon-…`; oblíbené 401; ladění 404; cron s tajemstvím 200; v logu „Watch index backfilled“ | — |
| 1.5 | Ruční nový sběr č. 1, po něm č. 2 | č. 1: „Login successful“, „not compared: previous_without_week“, `runs` `status: ok`, `system/health.lastSuccessAt` čerstvé, existují `aggregates/changes_*` a `freeRooms_*`. Č. 2: porovnává, nových dokumentů `changes` je málo. Pak znovu zapnout úlohu Prefetch na cron-job.org | — |
| 1.6 | Zařízení s 1.x a zapnutými upozorněními: otevřít aplikaci (bod z 1.7); v DevTools nový service worker a jediná mezipaměť `bakalari-shell-…` | `users/anon-…` s `migratedFrom` a tokenem; Změny a Volné učebny mají data; konzole bez chyb a 401 | — |
| 1.7 | Pravidla a indexy (1.4, kroky 3–4) | aplikace bez `permission-denied`; v simulátoru pravidel přihlášený nečte `users/…` ani `list` na `timetables` | vložit uložená pravidla zpět |
| 1.8 | cron-job.org: úlohy Notifikace a Upomínky (1.5, kroky 3–4); `/admin` přihlášení | historie úloh 200/202; semafor stáří dat zelený | vypnout úlohy |

Co se v okamžiku 1.3 stane uživatelům 1.x:

- *Otevřená karta 1.x* čte rozvrh dál přímo z Firestore; ukládání oblíbených a
  nastavení upozornění vrací 401, dokud stránku neobnoví. Nic se neztrácí.
- *Další otevření aplikace:* starý service worker pustí navigaci na síť → nové
  `index.html` a bundle; nový service worker se nainstaluje, převezme stránky a
  smaže starou mezipaměť. Starý worker ale stránce ještě podá SDK Firebase
  bez CORS, které kontrola otisku (1.6) odmítne. Jakmile stránku převezme
  nový worker, aplikace se proto **jednou sama obnoví**, a to do 10 s od
  startu, pokud uživatel ještě nic neudělal. Jinak ukáže lištu „Je k
  dispozici nová verze. Obnovit“. Kiosk (`?kiosk=changes`) se obnoví sám
  kdykoli, jen jednou za relaci karty.
- *Nastavení v prohlížeči* (motiv, vybraný rozvrh, rozvržení) zůstane, stará
  rozvržení se převedou na Den.
- *Nastavení na serveru* se při prvním otevření přesune pod nové ID (1.3).
- *Upozornění:* odběr push i token se nemění; kdo aplikaci neotevře, dostává
  upozornění dál pod starým ID.

### 1.9 Návrat

Pořadí je podstatné:

1. Pozastavit úlohy Notifikace a Prefetch na cron-job.org a v GitHub Actions
   vypnout workflow *Prefetch Timetable Data* a `process-notifications`.
   Starý web s novým sběrem by posílal upozornění s prázdným textem.
2. Vercel → Deployments → nasazení poznamenané v kroku 0.5 → *Instant
   Rollback*. Pozor: Instant Rollback pozastaví automatické přiřazení
   produkční domény a další push do `main` se sám neprojeví, dokud návrat v
   Vercelu nezrušíš.
3. `git revert -m 1 <merge>` a `git push --atomic origin HEAD:main HEAD:dev`
   (ne force-push).
4. Pustit jednou starý sběr. Starý sběr porovnává snímky zapsané novým (jiné
   složení) a může vyrobit falešné změny: dokumenty `changes` se `sent == false`,
   které z něj vzniknou, před obnovením upozornění zkontroluj a případně smaž.
5. Pravidla lze nechat (klient 1.x se přihlašuje). Zůstane-li web na 2.0 a
   vrací se jen sběr (`dev`), smaž `system/health`, jinak aplikace natrvalo
   hlásí zastaralá data, přestože jsou čerstvá.
6. Obnovit úlohy z kroku 1.

Uživatelé převedení na `anon-<uuid>` zůstanou funkční i v 1.x (staré
`/api/auth` podepíše jakékoli ID). Dokumenty smazané migrací vrátí jen záloha
z kroku 0.5: `node scripts/backup-users.js restore <soubor>` vypíše, kolik jich
chybí, a s `--yes` je založí znovu. Existující dokumenty nepřepisuje.

Částečné vydání:

| Stav | Důsledek |
|---|---|
| Sloučen jen `main` | Změny a Volné učebny trvale prázdné (sběr 1.x agregáty nepíše) |
| Sloučeno, cron-job.org nenastaven | pruh „zastaralá data“ většinu dne, e-mail z `check-status` každých 10 min |
| Sloučeno, pravidla nenasazena | platí neověřená pravidla z konzole |
| Vrácen jen sběr (`dev`) | trvalý falešný stav „zastaralá data“ (krok 5) |
| Instant Rollback a pak nový push | nová verze se sama nenasadí (krok 2) |
| Vyměněn klíč servisního účtu před koncem okna pro návrat | Instant Rollback míří na nasazení, které se k Firebase nepřihlásí (1.10) |
| Sloučení přes squash | `main` a `dev` se rozejdou |

### 1.10 Po vydání

Prvních 24–48 h sleduj `check-status`, logy Vercelu (401, 429, hlášení CSP,
řádky „Legacy user“) a přírůstek `users` s `migratedFrom`.

Po uzavření okna pro návrat (např. za týden):

1. **Vyměnit klíč servisního účtu.** Každé starší nasazení na Vercelu (i
   náhledy větví) má vlastní trvalou adresu a proměnné z doby sestavení, tedy
   i produkční servisní účet. Jeho staré `/api/auth` dál podepíše token pro
   libovolné ID, a to i po vydání. Postup: konzole Firebase → Project settings
   → Service accounts → *Generate new private key* → nový JSON vlož do
   `FIREBASE_SERVICE_ACCOUNT` na Vercelu a v GitHub secrets → znovu nasadit →
   ověřit 1.7 → Google Cloud → IAM → Service accounts → Keys → **smazat starý
   klíč**. Stažený soubor nenechávej v repozitáři (`.gitignore` zachytí
   výchozí název `*firebase-adminsdk*.json`, i tak ho po vložení smaž).
2. Smazat stará nasazení na Vercelu, nebo zapnout Deployment Protection
   (Vercel Authentication) pro vše mimo produkční doménu.
3. Odebrat adresy náhledů z omezení webového klíče Firebase (Google Cloud →
   Credentials → API key → Website restrictions).
4. Zavřít PR #51, otagovat `v2.0.0`.
5. Ochrana větví `main` a `dev` na GitHubu (žádný force-push, PR s kontrolami).
   S produkčními tajemstvími se spouští kód z `dev`.

Další zpevnění, které repozitář samo neudělá:

- **Pravidlo rate limitu ve Vercel Firewall** pro `/api/auth` a `/api/fcm/*`.
  Limit nových uživatelů (`NEW_USERS_PER_IP_LIMIT`) a zápisů upozornění drží každá
  serverless instance ve vlastní paměti, takže je jen hrubý.
- **Firebase App Check** s vynucením pro Firestore (vyžaduje klíč reCAPTCHA a
  úpravu klienta).
- Rozpočtové upozornění v Google Cloud.
- PR od Dependabotu (akce, měsíčně) slučovat do `main` i `dev`: naplánované
  běhy berou workflow z `main`. Sběr instaluje závislosti s
  `--ignore-scripts`; kdyby nová závislost instalační skript potřebovala,
  sběr selže už při načtení modulu.
- Vynucení CSP (1.6) a smazání nepřevedených `users/anonymous-*` (1.3).

## 2. Vlastní server (Docker nebo systemd)

Aplikace nic na Vercelu nevyžaduje. Firebase (Firestore + notifikace) zůstává,
přesouvá se jen webová část a plánované úlohy.

### 2.1 Co server potřebuje

| Požadavek | Proč |
|---|---|
| Node.js 22 (nebo Docker, obraz `node:22-alpine`) | běh aplikace |
| Odchozí přístup na `mot-spsd.bakalari.cz` | stahování rozvrhů |
| Odchozí přístup na `*.googleapis.com` | Firestore a odesílání notifikací |
| **HTTPS s platným certifikátem** | bez něj nefungují notifikace ani instalace PWA |
| Pásmo serveru `Europe/Prague` (`timedatectl`) | cron čte plán v systémovém pásmu |
| ~300 MB RAM, ~500 MB disku | Node proces a závislosti |

Service worker, push i instalace fungují jen v zabezpečeném kontextu
(`https://` nebo `http://localhost`). Certifikát může být z Let's Encryptu nebo
školní CA, kterou mají žáci v zařízeních.

### 2.2 Konfigurace

`cp .env.example .env` a vyplň proměnné z 1.1 (místo `FIREBASE_SERVICE_ACCOUNT`
lze `FIREBASE_SERVICE_ACCOUNT_PATH`). Navíc:

| Proměnná | Význam |
|---|---|
| `PORT` | port aplikace (výchozí 3000) |
| `HOST` | adresa, na které server poslouchá: výchozí `127.0.0.1` (jen tento počítač), `0.0.0.0` = celá síť. Obraz Dockeru a `deploy/lepsi-rozvrh.service` nastavují `0.0.0.0` samy |
| `CORS_ORIGINS` | doména serveru, např. `https://rozvrh.skola.cz` |
| `TRUST_PROXY=1` | jen za vlastní reverzní proxy: IP z `X-Forwarded-For` pro limit pokusů a audit administrace |
| `RUN_TRIGGER=cron` | označení běhů v `runs` (nastavuje ho `deploy/crontab.example`) |

`.env` ani servisní účet nikdy necommituj (jsou v `.gitignore`).

### 2.3 Varianta A: Docker (doporučeno)

```bash
git clone https://github.com/hatcyk/hezci_rozvrhy /srv/lepsi-rozvrh
cd /srv/lepsi-rozvrh
cp .env.example .env && $EDITOR .env
docker compose up -d --build
```

Kontejner poslouchá na `127.0.0.1:3000`, před něj patří reverzní proxy s TLS
(vzor `deploy/nginx.conf.example`). Obraz má healthcheck na `/api/status`.
Při použití souboru se servisním účtem nech v `docker-compose.yml`
odkomentovaný volume, jinak ho smaž a vyplň `FIREBASE_SERVICE_ACCOUNT`.

### 2.4 Varianta B: Node přímo + systemd

```bash
sudo useradd --system --home /srv/lepsi-rozvrh rozvrh
git clone https://github.com/hatcyk/hezci_rozvrhy /srv/lepsi-rozvrh
cd /srv/lepsi-rozvrh
npm ci --omit=dev
cp .env.example .env && $EDITOR .env
sudo chown -R rozvrh:rozvrh /srv/lepsi-rozvrh
sudo cp deploy/lepsi-rozvrh.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lepsi-rozvrh
```

### 2.5 Plánované úlohy

Server ve školní síti z internetu většinou dostupný není, úlohy proto běží
lokálně přes cron (vzor `deploy/crontab.example`, `CRON_SECRET` pak není třeba):

| Úloha | Interval | Příkaz |
|---|---|---|
| Stažení rozvrhů a detekce změn | 15 min | `node scripts/run-prefetch.js` (`npm run prefetch`) |
| Odeslání notifikací o změnách | 5 min | `node scripts/process-notifications.js` |
| Upomínky před hodinou | 1 min, Po–Pá 7–17 h | `node scripts/send-lesson-reminders.js` |
| Úklid starých záznamů | denně | `node scripts/cleanup.js` |

V Dockeru předřaď `docker compose exec -T app`.

**Pozor:** když zároveň poběží GitHub Actions / cron-job.org proti Vercelu,
obě instance zapisují do stejného Firestore a notifikace mohou přijít dvakrát.
Po přechodu workflow i úlohy na cron-job.org vypni.

### 2.6 Aktualizace

```bash
cd /srv/lepsi-rozvrh && git pull
docker compose up -d --build                              # Docker
npm ci --omit=dev && sudo systemctl restart lepsi-rozvrh  # systemd
```

Frontend je předsestavený a commitnutý (`public/css/app.css`,
`public/js/app.js`), na serveru se nic nebuilduje.

### 2.7 Ověření

```bash
curl -s https://rozvrh.skola.cz/api/status          # isHealthy: true
npm run prefetch                                    # ruční sběr (produkční data!)
```

V prohlížeči zkontroluj, že se rozvrh načte, že jdou zapnout notifikace (bez
HTTPS selže) a že v konzoli není chyba service workeru. Dál platí kontrolní
seznam 1.7.
