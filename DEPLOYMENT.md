# Nasazení na vlastní server

Aplikace běží na Vercelu, ale nic ji tam nedrží. Tenhle návod popisuje, jak ji
rozjet na školním serveru. Počítá s tím, že Firebase (Firestore + notifikace)
zůstává tam, kde je — přesouvá se jen webová část a plánované úlohy.

## Co server potřebuje

| Požadavek | Proč |
|---|---|
| Node.js 20+ (nebo Docker) | běh aplikace |
| Odchozí přístup na `mot-spsd.bakalari.cz` | stahování rozvrhů |
| Odchozí přístup na `*.googleapis.com` | Firestore a odesílání notifikací |
| **HTTPS s platným certifikátem** | bez něj nefungují notifikace ani „přidat na plochu“ |
| ~300 MB RAM, ~500 MB disku | Node proces a závislosti |

### HTTPS není volitelné

Service worker, push notifikace i PWA instalace fungují jen v zabezpečeném
kontextu. Prohlížeč je povolí na `https://` a na `http://localhost`, nikde
jinde. Na `http://rozvrh.skola.local/` se aplikace načte a rozvrh zobrazí, ale
**notifikace se nezaregistrují**. Certifikát může být z Let's Encryptu (pokud je
server dostupný z internetu) nebo školní interní CA, kterou mají žáci v
zařízeních — jinak notifikace nezprovozníte.

## Konfigurace

Zkopírujte `.env.example` do `.env` a vyplňte:

| Proměnná | Význam |
|---|---|
| `BAKALARI_USERNAME`, `BAKALARI_PASSWORD` | účet pro čtení veřejných rozvrhů |
| `FIREBASE_SERVICE_ACCOUNT` | celý servisní účet jako JSON na jednom řádku |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | alternativa: cesta k souboru s tímtéž JSON |
| `PORT` | port aplikace (výchozí 3000) |
| `CRON_SECRET` | jen pokud plánované úlohy voláte přes HTTP (viz níže) |
| `DEBUG` | nechte `false` |

`.env` ani soubor se servisním účtem nikdy necommitujte, oba jsou v
`.gitignore`.

## Varianta A: Docker (doporučeno)

```bash
git clone https://github.com/hatcyk/hezci_rozvrhy /srv/lepsi-rozvrh
cd /srv/lepsi-rozvrh
cp .env.example .env && $EDITOR .env
docker compose up -d --build
```

Kontejner poslouchá na `127.0.0.1:3000` a před něj patří reverzní proxy s TLS —
vzor je v `deploy/nginx.conf.example`. Obraz má healthcheck na `/api/status`,
takže `docker ps` rovnou ukazuje, jestli aplikace žije.

Pokud používáte soubor se servisním účtem místo proměnné, nechte v
`docker-compose.yml` odkomentovaný volume; jinak ho smažte a vyplňte
`FIREBASE_SERVICE_ACCOUNT`.

## Varianta B: Node přímo + systemd

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

## Plánované úlohy

Na Vercelu je spouštěl GitHub Actions přes endpointy `/api/cron/*`. Server ve
školní síti z GitHubu většinou dostupný není, takže je pouštějte lokálně přes
cron — nic se nevystavuje ven a `CRON_SECRET` není potřeba. Vzor je v
`deploy/crontab.example`:

| Úloha | Interval | Příkaz |
|---|---|---|
| Stažení rozvrhů a detekce změn | 15 min | `npm run prefetch` |
| Odeslání notifikací o změnách | 5 min | `npm run process-notifications` |
| Upomínky před hodinou | 1 min, Po–Pá 7–16 | `npm run lesson-reminders` |
| Úklid starých záznamů | denně | `npm run cleanup` |

V Dockeru předřaďte `docker compose exec -T app`.

**Důležité:** pokud necháte běžet i GitHub Actions proti Vercelu, obě instance
budou zapisovat do stejného Firestore. Data se nerozbijí, ale notifikace se
mohou poslat dvakrát. Po přechodu workflow vypněte (Actions → Disable).

## Aktualizace

```bash
cd /srv/lepsi-rozvrh && git pull
# Docker:
docker compose up -d --build
# systemd:
npm ci --omit=dev && sudo systemctl restart lepsi-rozvrh
```

Frontend je předsestavený a commitnutý (`public/css/app.css`, `public/js/app.js`),
takže na serveru se nic nebuilduje. Po úpravě zdrojů v `public/` spusťte lokálně
`npm run build` a výsledek commitněte.

## Ověření po nasazení

```bash
curl -s https://rozvrh.skola.cz/api/status          # isHealthy: true
curl -s https://rozvrh.skola.cz/api/groups/ZL       # vrátí skupiny třídy
npm run prefetch                                    # projde 312 rozvrhů
```

V prohlížeči pak zkontrolujte, že se rozvrh načte, že jde zapnout notifikace
(bez HTTPS to selže) a že v konzoli není chyba service workeru.
