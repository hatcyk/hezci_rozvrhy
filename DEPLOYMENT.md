# Nasazení

Produkce běží na **Vercelu** (statické soubory z CDN + Express API jako
serverless funkce), sběr dat na **GitHub Actions** a data ve **Firebase**
(projekt `barat-bakalari`). Kapitola 1 popisuje přechod na verzi 2.0.0,
kapitola 2 provoz na vlastním serveru.

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
| `DEBUG` | Vercel | ne | nech `false` (ladicí endpointy nejsou chráněné) |
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

1. Všechny změny slouč **jedním merge** – nic z backendu ani frontendu
   nenasazuj zvlášť ani cherry-pickem.
2. Slouč je **do `main` i do `dev` zároveň**. Vercel nasazuje produkci z
   produkční větve (standardně `main`, ověř v Settings → Git), ale `prefetch.yml` (spouštěný z `main`) checkoutuje kód sběru z
   větve `dev` (`ref: dev`). Nový prefetch zapisuje `weekStart`, `date`, `daysOff`
   a agregáty, které nový frontend čte.
3. Bundle frontendu je commitnutý; před merge ověř `npm run build` (nesmí
   vzniknout rozdíl), `npm test` a `npm run test:e2e`.
4. Otevřené karty se starou verzí po nasazení hlásí 401 u oblíbených a
   notifikací, dokud se neobnoví; service worker načítá stránku stylem
   „network-first“, takže stačí nové otevření aplikace.

Návrat: Vercel → Deployments → předchozí nasazení → *Instant Rollback*.
Data ve Firestore zůstanou kompatibilní (nová pole starý kód ignoruje).

### 1.3 Migrace uživatelů

Nic se nespouští ručně. Při prvním otevření nové verze klient pošle uložené
`localStorage.userId`:

- starý formát `anonymous-<ms>` → server v jedné transakci zkopíruje
  `users/{starý}` do `users/anon-<uuid>` (s `migratedFrom`, `migratedAt`), starý
  smaže a vrátí nové ID, které si klient uloží;
- bez ID nebo s neplatným ID vznikne nové `anon-<uuid>`.

Uživatelé, kteří aplikaci neotevřou, zůstávají pod starým ID a upozornění
dostávají dál (odesílání tokeny nemění). Index sledovaných rozvrhů
(`watchedKeys`, `watchedTypes`) doplní starým dokumentům jednorázová migrace
`watchIndexV2` při prvním běhu notifikací.

Kontrola: Firestore → `users`, filtr `migratedFrom` existuje; v `/admin`
statistiky uživatelů. Zvaž po několika měsících migraci starých ID ukončit
(starý formát je odhadnutelný).

### 1.4 Pravidla a indexy Firestore

Repozitář obsahuje `firestore.rules` (prohlížeč jen čte veřejná data a vlastní
`users/{uid}`, zápis jen server) a `firestore.indexes.json` (index
`runs: job ↑, startedAt ↓` pro administraci).

1. **Až po nasazení nového klienta** (přihlašuje se před prvním čtením;
   starý klient by dostal `permission-denied`).
2. Ulož si stávající pravidla: konzole Firebase → Firestore → Rules → zkopírovat.
3. Volitelně otestuj v emulátoru (Java 11+):
   `npm i -D @firebase/rules-unit-testing@6 firebase@13`, pak
   `npx firebase-tools emulators:exec --only firestore --project demo-lepsi-rozvrh "node --test test/rules/firestore-rules.emulator.test.mjs"`
   (projekt `demo-*` se nikdy nedotkne produkce; test není součástí `npm test`).
4. Nasazení pravidel i indexů:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore --project barat-bakalari
   ```

   Index se staví několik minut; do té doby `/admin` ukazuje varování a čte
   náhradní cestou.
5. Ověř v aplikaci, že se rozvrh načte a v konzoli prohlížeče není
   `permission-denied`.

### 1.5 Plánování: cron-job.org → `workflow_dispatch`

Plánovač GitHubu běhy zpožďuje nebo vynechává, proto sběr spouští
cron-job.org přes REST API GitHubu; `schedule` v `prefetch.yml` zůstává jako
záloha a souběh řeší `concurrency`.

1. Token: GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Resource owner `hatcyk`, *Only select repositories*
   → `hezci_rozvrhy`, Repository permissions → **Actions: Read and write**,
   expirace (např. 30. 6. 2027). Může to být jiný token než
   `GITHUB_DISPATCH_TOKEN`, aby šly zrušit zvlášť.
2. cron-job.org, úloha **Prefetch**:
   - `POST https://api.github.com/repos/hatcyk/hezci_rozvrhy/actions/workflows/prefetch.yml/dispatches`
   - hlavičky `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2026-03-10`, `User-Agent: lepsi-rozvrh-cron`,
     `Content-Type: application/json`
   - tělo `{"ref":"main"}`; úspěch = HTTP 200 (`workflow_run_id`, `html_url`)
   - plán každých 15 min, Po–Pá 6–18 h, **časové pásmo Europe/Prague**
     (nastavuje se u úlohy, výchozí je UTC); druhá úloha 1× za hodinu mimo tuto dobu.
3. Úloha **Notifikace**: `GET https://spsd-rozvrhy.vercel.app/api/cron/process-notifications`,
   hlavička `Authorization: Bearer <CRON_SECRET>`, každých 5 min.
4. Úloha **Upomínky**: `GET …/api/cron/lesson-reminders`, stejná hlavička,
   každou minutu, Po–Pá 7–17 h, Europe/Prague. cron-job.org čeká nejvýš 30 s,
   endpoint proto odpoví do 25 s (200, nebo 202 a běh pokračuje). Aby Vercel
   práci po odpovědi 202 nezmrazil, lze doinstalovat `@vercel/functions`
   (kód použije `waitUntil` sám).
5. Kontrola: v `runs` mají běhy prefetche `trigger: 'dispatch'`; `/admin` →
   rozestupy běhů za 7 dní.

### 1.6 CSP: z Report-Only na vynucenou

Aplikace posílá `Content-Security-Policy-Report-Only` a hlášení zapisuje do
logu (Vercel → Logs, řádky `🛡️ CSP report`). Administrace má CSP vynucenou už
teď. E2E test `test/e2e/csp.spec.js` politiku v prohlížeči vynucuje a hlídá,
že aplikace nic neporuší (ověřuje hashe inline skriptů a zdroje načítané při
startu; skutečné spojení Firebase SDK v testu není).

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
curl -s -o /dev/null -w '%{http_code}\n' $URL/api/admin/health                # 401 (503 = chybí ADMIN_SECRET); počítá se jako 1 chybný pokus
```

- [ ] Proměnné z 1.1 nastavené na Vercelu i v GitHubu, Node.js 22.x.
- [ ] Merge do `main` i `dev` najednou (1.2); Vercel nasadil `main`.
- [ ] Ruční běh `prefetch.yml` (Actions → Run workflow nebo `/admin` → Spustit
      sběr): v logu „✅ Login successful“, `runs` má záznam `status: ok`.
      **První běh nic nehlásí** („not compared: previous_without_week“) a
      jednorázově přepíše všechny snímky (nově s `date` a `weekStart`).
- [ ] `aggregates/changes_*` a `aggregates/freeRooms_*` existují; pohledy Změny a
      Volné učebny ukazují data.
- [ ] Aplikace v prohlížeči: rozvrh se načte, oblíbené se uloží, v konzoli
      nejsou chyby ani 401.
- [ ] Notifikace na testovacím telefonu (Android i iPhone s aplikací na ploše):
      zapnout, sledovat třídu, ověřit doručení při změně a upomínku.
- [ ] `/admin`: přihlášení `ADMIN_SECRET`, semafor stáří dat, běhy, statistiky.
- [ ] Pravidla a indexy Firestore nasazené (1.4), aplikace bez `permission-denied`.
- [ ] cron-job.org: historie úloh hlásí 200/202, `check-status.yml` je zelený.
- [ ] `/api/ical/Class/<id>.ics` vrací kalendář (nebo 404 při `ICAL_ENABLED=false`).
- [ ] Vercel → Logs: hlášení CSP (1.6).

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
