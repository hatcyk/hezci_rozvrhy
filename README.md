# Lepší Rozvrh

Alternativní webové rozhraní pro školní rozvrhy SPŠD Motol ze systému
Bakaláři. Rozvrhy tříd, vyučujících a učeben (stálý, aktuální a příští týden)
včetně změn, s upozorněním na suplování a jako instalovatelná PWA.

Produkce: <https://spsd-rozvrhy.vercel.app> · maturitní práce 2026/27 ·
verze 2.0.0 ([changelog](changelog.md))

## Funkce

- **Rozvrh** třídy, vyučujícího nebo učebny pro stálý, aktuální a příští týden.
  Změny (suplování, změna učebny, zrušená hodina, akce/absence) jsou odlišené
  barvou, ikonou i textem. Detail hodiny ukazuje „Proti stálému rozvrhu:
  původně → nyní“.
- **Rozvržení:** na desktopu celý týden nebo den, na mobilu agenda (výchozí),
  seznam, karty a den. Volba se ukládá v prohlížeči.
- **Pohledy:** *Změny* (tabule změn celé školy na dnešek, zítřek i oba týdny, filtr
  třídy a vyučujícího), *Volné učebny* (teď, další hodina, libovolný den a hodina),
  *Společné volno* (společné volné hodiny 2–6 vyučujících nebo tříd).
- **Kiosk** `/?kiosk=changes` pro televizi ve vestibulu: živá tabule změn,
  automatické posouvání s pauzou, Wake Lock, noční obnovení.
- **Upozornění (FCM):** na změny ve sledovaných rozvrzích (s filtrem skupin)
  a upomínka pár minut před hodinou.
- **Další:** oblíbené rozvrhy, „Jen změny“, sdílení odkazu, tisk týdne na A4,
  „Do kalendáře“ (iCal/webcal), světlý a tmavý motiv, widget „Teď / Další“,
  automatické přepnutí na příští týden v pátek od 14:00 a o víkendu.
- **PWA a offline:** instalace na plochu, při výpadku sítě poslední uložená data
  s informací o jejich stáří; banner, když se data z Bakalářů nedaří aktualizovat.
- **Administrace** `/admin` (chráněná `ADMIN_SECRET`): stáří dat, běhy úloh
  a jejich rozestupy, změny a doručení, souhrnné statistiky, ruční spuštění
  sběru, auditní záznam.
- **Přístupnost:** cíl WCAG 2.2 AA – ovládání klávesnicí, modální dialogy
  s návratem fokusu, kontrast; automatický audit axe-core v e2e testech.

## Architektura v kostce

```
Bakaláři (mot-spsd.bakalari.cz, HTML stránky rozvrhů)
   │  prefetch: přihlášení, stažení ~220–310 stránek, parser, detektor změn
   │  (GitHub Actions; spouští cron-job.org přes workflow_dispatch, záložně cron)
   ▼
Firestore ── definitions/current, timetables/{Typ}_{id}_{Actual|Next|Permanent},
   │         aggregates/{changes,freeRooms}_{Actual|Next}, changes, users,
   │         runs, system/health, audit
   │  čtení přes Firebase JS SDK (po přihlášení custom tokenem)
   ▼
Prohlížeč (PWA) ◄──► Express API na Vercelu (/api/*)
                      auth, fcm, favorites, status, ical, admin, cron
                          │
                          ▼
                Firebase Cloud Messaging → upozornění na telefon
```

- **Backend** (Node.js 22, CommonJS, Express 5): `backend/` logika (parser,
  prefetch, detektor změn, agregáty, FCM, upomínky, iCal, admin, bezpečnostní
  hlavičky), `routes/` HTTP API, `scripts/` samostatné úlohy pro GitHub Actions
  a cron.
- **Frontend** (vanilla ES moduly bez frameworku): zdroje v `public/js` a
  `public/css`, esbuild z nich skládá `public/js/app.js` a `public/css/app.css`
  (commitnuté, nasazení nic nebuilduje). Service worker
  `public/firebase-messaging-sw.js`, administrace `public/admin.html` +
  `public/admin/`.
- **Identita:** server přiděluje anonymní `anon-<uuid>` a custom token
  (`POST /api/auth`); volání s uživatelem nesou Firebase ID token.
- Podrobně: [DOKUMENTACE.md](DOKUMENTACE.md).

## Rychlý start lokálně

Potřebuješ Node.js 22 a servisní účet Firebase (bez něj nefunguje přihlášení
`/api/auth`, a tedy ani čtení rozvrhů).

```bash
git clone https://github.com/hatcyk/hezci_rozvrhy
cd hezci_rozvrhy
npm ci
cp .env.example .env        # vyplň FIREBASE_SERVICE_ACCOUNT_PATH (a CRON_SECRET)
npm start                   # http://localhost:3000, administrace /admin
```

Po úpravě souborů v `public/js` nebo `public/css` spusť `npm run build`
(sestaví bundle, otiskne `?v=` do `index.html` a service workeru a přepočítá
CSP hashe ve `vercel.json`) a výsledek commitni.

> **Pozor:** projekt má jediný Firebase projekt. `npm run prefetch`,
> `process-notifications`, `lesson-reminders` a `cleanup` pracují s produkčními
> daty (a posílají skutečná upozornění). Lokálně je spouštěj jen vědomě.

## Testy

| Příkaz | Co dělá |
|---|---|
| `npm test` | jednotkové a integrační testy (`node:test`, `test/**/*.test.js`): parser, prefetch, detektor změn, agregáty, API, admin, iCal, klientské moduly. Firebase, Bakaláře a FCM nahrazují atrapy v `test/helpers/`. |
| `npm run test:coverage` | totéž s pokrytím `backend/**` a `routes/**` |
| `npm run test:e2e` | end-to-end testy v Chromiu (Playwright + axe-core), mobil 390×844 a desktop 1440×900, nad `public/` se syntetickými daty, síť a Firebase nahrazené atrapou (`test/e2e/`). Prohlížeč poprvé: `npx playwright install chromium`. Report: `npx playwright show-report`. |

CI: `.github/workflows/test.yml` (Node 22/24 × UTC/Europe/Prague, pokrytí),
`.github/workflows/e2e.yml` (pull request a ruční spuštění, report jako artefakt).

## Odkazy

- [DOKUMENTACE.md](DOKUMENTACE.md) – technická dokumentace (architektura, data, API, testy)
- [DEPLOYMENT.md](DEPLOYMENT.md) – nasazení na Vercel i na vlastní server, proměnné prostředí, kontrolní seznam
- [changelog.md](changelog.md) – historie verzí
- [.env.example](.env.example) – všechny proměnné prostředí s komentáři
- [firestore.rules](firestore.rules), [firestore.indexes.json](firestore.indexes.json) – pravidla a indexy Firestore
- [docs/plans/](docs/plans/) – návrhy funkcí

Autor: Štefan Barát, SPŠD Motol.
