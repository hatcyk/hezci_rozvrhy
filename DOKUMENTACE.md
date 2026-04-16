# Lepší Rozvrh

*Rychlejší, přehlednější a chytřejší rozvrh pro studenty SPŠD Motol — s notifikacemi o suplování a moderním designem.*

---

## Úvod a motivace

Oficiální rozvrh v systému Bakaláři, který SPŠD Motol používá, má několik problémů, které studentům každodenně komplikují život. Na mobilu se špatně čte, načítání bývá pomalé, chybí jakékoli notifikace o změnách v rozvrhu a celkový vzhled působí zastarale. Studenti tak často zjišťují, že jim odpadla hodina nebo se změnila učebna, až když dorazí do školy.

Projekt *Lepší Rozvrh* vznikl jako reakce na tyto nedostatky. Cílem je nabídnout studentům alternativní rozhraní, které bere rozvrhová data ze školních Bakalářů, ale zobrazuje je rychleji, přehledněji a doplňuje je o funkce, které v originálu chybí — především push notifikace o změnách a upomínky před začátkem hodiny. Aplikace je postavená jako progresivní webová aplikace (PWA), takže si ji lze přidat na plochu telefonu a používat téměř jako nativní mobilní appku.

## Cíle projektu

Hlavním cílem bylo vytvořit plně funkční náhradu rozvrhové části Bakalářů, která si zachová všechna potřebná data (třídy, učitelé, učebny, stálý i aktuální rozvrh, suplování, odpadlé hodiny) a zároveň přidá funkce, které studentům reálně ušetří čas. Aplikace má fungovat spolehlivě na mobilu i na desktopu, má být rychlá i při horší konektivitě a musí si poradit s tím, že Bakaláři sami občas mají výpadky.

Vedle technických cílů šlo i o to, aby projekt sloužil jako maturitní práce a aby byl natolik použitelný, že ho budou spolužáci skutečně chtít používat. Dílčí cíle zahrnují: spolehlivé notifikace o změnách rozvrhu, systém oblíbených rozvrhů, moderní responzivní design s podporou světlého i tmavého režimu, ukládání uživatelských preferencí a korektní práci s pražským časovým pásmem včetně letního času.

## Použité technologie

**Backend** je postavený na Node.js s frameworkem Express 5. Pro získávání rozvrhových dat projekt využívá knihovny `axios` (HTTP požadavky) a `cheerio`, která umožňuje parsovat HTML podobným způsobem jako jQuery — Bakaláři totiž neposkytují žádné oficiální strojové rozhraní, takže aplikace čte přímo jejich webové stránky. Plánované úlohy obstarává `node-cron`, správu časových pásem (zejména Evropa/Praha s letním časem) pak `date-fns` a `date-fns-tz`.

**Úložiště a notifikace** řeší Google Firebase. Firestore slouží jako hlavní databáze, kam se cacheují stažené rozvrhy, definice tříd/učitelů/učeben a uživatelské preference včetně oblíbených rozvrhů. Firebase Cloud Messaging (FCM) pak posílá push notifikace do prohlížeče a na mobil. Backend s Firebase komunikuje přes `firebase-admin` SDK, klient přes veřejné Firebase JS SDK.

**Frontend** je záměrně napsaný ve vanilla JavaScriptu rozděleném do ES modulů, bez velkých frameworků typu React nebo Vue. Tato volba udržuje aplikaci lehkou, rychle načítatelnou a dává plnou kontrolu nad service workerem a PWA chováním. Styly jsou v čistém CSS rozděleném do logických souborů (proměnné, layout, komponenty, mobilní úpravy). Aplikace je nasazená jako PWA — má manifest, service worker a funguje i v režimu „přidat na plochu". **Hostování** zajišťuje Vercel, který běží jak webovou část, tak serverless funkce backendu a spouští pravidelné cron úlohy.

## Architektura a fungování

Aplikace má tři hlavní vrstvy: zdrojová data v Bakalářích, vlastní backend s cache vrstvou v Firebase a klientskou PWA v prohlížeči. Srdcem celého systému je **prefetch modul** — úloha, která se v pravidelných intervalech přihlásí do Bakalářů, projde všechny třídy, učitele a učebny pro všechny tři typy rozvrhů (stálý, aktuální, příští týden) a každý z nich stáhne a rozparsuje z HTML. Výsledek uloží do Firestore jako snapshot. Tato vrstva je klíčová, protože Bakaláři jsou pomalí a ne vždy dostupní; díky cache dostává student data v řádu milisekund a výpadek Bakalářů aplikaci nerozbije — uživatel jen uvidí banner s informací, z jaké doby jsou poslední data.

Při každém novém stažení projekt spouští **detektor změn**, který porovná nový snapshot s tím předchozím. Dokáže rozpoznat suplování, změnu učebny, zrušení hodiny nebo naopak přidání nové. Pokud najde změnu, která se týká rozvrhu, jejž si někdo uložil jako oblíbený, sestaví push notifikaci a odešle ji přes FCM na všechna registrovaná zařízení. Paralelně běží ještě **lesson reminder** — cron úloha, která pár minut před začátkem hodiny pošle uživateli upomínku s předmětem, učebnou a vyučujícím. Deduplikace notifikací probíhá přes záznamy ve Firestore, aby uživatel nedostal stejnou upomínku dvakrát.

**Klientská PWA** se chová jako tenká vrstva nad cache: po spuštění se autentizuje proti Firebase (anonymně pro běžné uživatele), načte definice tříd, učitelů a učeben a zobrazí vybraný rozvrh. Backend vystavuje REST endpointy pod `/api/*` (`timetable`, `definitions`, `groups`, `favorites`, `fcm`, `status`…) a klient je volá přes jednoduchou vrstvu v `public/js/api.js`. Uživatelské preference jako vybrané zobrazení (karty nebo kompaktní seznam), téma nebo oblíbené rozvrhy se synchronizují zpět do Firestore, takže přežijí i přeinstalaci aplikace. Service worker obstarává offline zobrazení posledního načteného rozvrhu a zpracování příchozích push notifikací i ve chvíli, kdy je stránka zavřená.

## Klíčové funkce

**Kompletní rozvrh všech tří typů** — aplikace umí zobrazit stálý rozvrh, aktuální týden i rozvrh na příští týden, a to pro libovolnou třídu, učitele nebo učebnu v rámci školy. Součástí je i zvýraznění změn: odpadlé hodiny se zobrazují přeškrtnuté, suplování a změny učebny mají vlastní barevné označení a detailní popis je dostupný po rozkliknutí.

**Push notifikace o změnách** patří k nejdůležitějším přidaným funkcím. Uživatel si označí libovolný rozvrh (nejčastěji svou třídu) jako oblíbený a od té chvíle mu na telefon chodí upozornění, jakmile se v daném rozvrhu něco změní — suplování, přesun do jiné učebny, odpadlá hodina. Vedle toho aplikace posílá upomínku před začátkem každé hodiny s informací, co a kde se bude učit.

**Moderní a přizpůsobitelný design** — aplikace podporuje světlý i tmavý režim, dva různé layouty (přehledné karty nebo hustší kompaktní seznam), je plně responzivní a na mobilu se chová jako nativní aplikace díky PWA manifestu a service workeru. Součástí jsou i drobnosti jako zobrazení času východu a západu slunce, automatické přepínání na příští týden přes víkend nebo zkracování dlouhých jmen učitelů a názvů předmětů na smysluplné zkratky.

**Robustnost vůči výpadkům** — protože Bakaláři jsou reálně nestabilní, aplikace nikdy nečte data přímo z nich. Všechno teče přes cache ve Firestore, a když backend detekuje výpadek Bakalářů, klient zobrazí nenápadný banner s časem posledního úspěšného stažení. Rozvrh přesto zůstává plně funkční.

## Postup vývoje

Začal jsem na projektu pracovat jako na hobby — prostě mě štvalo, jak jsou oficiální Bakaláři pomalí, nepřehlední na mobilu a jak v nich chybí notifikace o změnách. Chtěl jsem si postavit něco, co budu sám rád používat, a při tom se naučit, jak funguje backend, Firebase a PWA. Teprve později jsem se rozhodl, že projekt použiju jako maturitní práci, takže na něm od začátku vlastně nebylo žádné formální zadání — směr jsem si určoval sám podle toho, co mi dávalo smysl.

Jednoznačně nejtěžší část celého projektu byla práce se zdrojovými daty z Bakalářů. Každý okrajový případ znamenal novou chybu: učitelé zapsaní jednou jako „Radko Kozakovič" a jindy jako „Kozakovič Radko", skupiny pojmenované různě („1. sk", „skupina 1", „1.sk", „TVDi", „TVk1"), odpadlé hodiny, které v jednom snapshotu jsou a v druhém zmizí, absence, které Bakaláři hlásí v úplně jiném formátu než suplování. Postupně jsem kolem toho napsal normalizační vrstvu a detektor změn, který dokáže porovnat dva snapshoty a říct, co se mezi nimi reálně stalo.

Druhý velký oříšek byly **notifikace a časová pásma**. Notifikace musí dorazit ve správný čas podle pražského času včetně letního času, nesmí přijít dvakrát, musí fungovat i v serverless prostředí na Vercelu, kde cron úlohy nemají žádný perzistentní stav, a zároveň nesmí zatopit uživatele spoustou upozornění najednou. Vyřešil jsem to kombinací explicitní práce s časovou zónou (`date-fns-tz`), dedupikačními záznamy ve Firestore a plovoucím oknem pro odesílání upomínek — každá hodina má několikaminutové okno, ve kterém se může notifikace poslat, a jakmile se jednou odešle, Firestore si to zapamatuje a znovu už neprojde. Třetím menším milníkem bylo doladění PWA — zbavit se duplicitních service workerů, správně nastavit FCM worker a zajistit, aby aplikace fungovala i offline.

## Výsledek a využití

Výsledkem je plně funkční progresivní webová aplikace, která pokrývá všechny rozvrhové potřeby studenta SPŠD Motol lépe než oficiální Bakaláři. Rozvrh se načítá v řádu stovek milisekund místo několika sekund, má moderní vzhled, na mobilu se chová jako nativní aplikace a posílá notifikace o změnách a upomínky před hodinami. Ačkoli projekt není oficiálně nasazený školou, průběžně ho používají kamarádi a spolužáci a pozitivní zpětná vazba je hlavním důvodem, proč na něm pokračuji.

Pro mě osobně má projekt hodnotu i jako ucelené portfolio — pokrývá zpracování dat, návrh cache vrstvy, serverless hostování, práci s Firebase, push notifikace, PWA, offline režim, responzivní design i ladění napříč platformami. Jako maturitní práce ukazuje, že umím dotáhnout nápad od prototypu až do něčeho, co reálně běží a co někdo reálně používá.

## Možná budoucí vylepšení

Největší směr, kterým by aplikace mohla růst, je **podpora více škol**. Aktuálně je backend napsaný konkrétně pro instanci Bakalářů SPŠD Motol, ale principiálně nic nebrání tomu, aby se rozšířil i na další školy, které Bakaláře používají — stačilo by zobecnit konfiguraci endpointů a přihlašování a umožnit uživateli vybrat si svou školu při prvním spuštění. Díky tomu by z projektu mohla být plnohodnotná alternativa k oficiální mobilní aplikaci Bakalářů, kterou by mohli používat studenti napříč celou republikou.

---

*Autor: Štefan Barát — SPŠD Motol, obor IT, 3. ročník. Maturitní projekt 2026.*
