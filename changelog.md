# Changelog

Všechny změny v projektu budou zaznamenány v tomto souboru.

Formát verzování: +0.1 pro menší změny, +1.0 pro větší změny.

---

## [1.6.9] - 2025-12-29
### fix(card-view): oprava offsetu karty při přepnutí z jiných layoutů

### Opraveno
- **CardIndex není resetován při přepnutí layoutu** (KRITICKÝ BUG)
  - Dříve: Při přepnutí z week-view na card-view zůstával starý `cardIndex` v state
  - Problém: Karta se zobrazila s offsetem (např. na pozici 3 místo 0)
  - Body (scroll dots) byly zobrazeny správně, ale aktivní byl nesprávný bod
  - Uživatel očekával zobrazení první karty, ale viděl kartu uprostřed
  - Nyní: Při přepnutí NA card-view se `cardIndex` resetuje na 0
  - Karta vždy začne na první pozici

### Změněno
- **`public/js/layout-manager.js`**:
  - `switchLayout()` funkce (řádky 80-83):
    - Přidána kontrola: `if (layoutId === 'card-view')`
    - Přidán reset: `updateLayoutPreference('card-view', { cardIndex: 0 })`
    - Resetuje cardIndex na 0 při každém přepnutí NA card-view

### Technické detaily
**Scénář který způsoboval bug:**
1. Uživatel v card-view posune na kartu 3 (cardIndex = 3)
2. Přepne na week-view (cardIndex = 3 zůstává v state)
3. Přepne zpět na card-view
4. **Bug:** Karta se zobrazí na pozici 3 (transform: `translateX(-300%)`)
5. **Fix:** Nyní se cardIndex resetuje, karta začne na pozici 0

**Konzistence s existujícím chováním:**
- cardIndex se již resetoval při přepnutí dne (timetable.js:119)
- cardIndex se již resetoval při přepnutí rozvrhu (timetable.js:481)
- **Nově:** cardIndex se resetuje i při přepnutí layoutu

### Vizuální změny
- Při přepnutí na card-view se vždy zobrazí první karta
- První bod (scroll dot) je aktivní
- Transform je vždy `translateX(0%)` po přepnutí layoutu
- Navigační šipky mají správný disabled state
- Konzistentní UX napříč všemi způsoby navigace

### Modifikované soubory
- `public/js/layout-manager.js` - přidání cardIndex reset do switchLayout()

---

## [1.6.8] - 2025-12-29
### fix(timetable): širší kartičky v denním a týdenním zobrazení (desktop i mobil)

### Opraveno
- **Příliš úzké lesson cards v grid layoutu (Desktop)**
  - Dříve: Kartičky měly `min-width: 160px`
  - Problém: V týdenním a denním zobrazení byly kartičky sotva viditelné, text byl stísněný
  - Nyní: Kartičky mají `min-width: 220px` (+37.5% šířky)
  - Lepší čitelnost všech informací (předmět, učitel, místnost, skupina)

- **Příliš úzké lesson cards na mobilu** (KRITICKÝ UX BUG)
  - Dříve: Kartičky měly `min-width: 120px` na mobilu
  - Problém: V týdenním zobrazení na mobilu se sotva vešly informace, text byl stísněný
  - Nyní: Kartičky mají `min-width: 150px` (+25% šířky)
  - Optimalizován padding a velikosti fontů pro mobil

### Změněno
- **`public/css/timetable.css`**:
  - `.lesson-cell` (řádek 121):
    - `min-width: 160px` → `min-width: 220px` (desktop)
    - Zvětšení šířky buněk o 60px (37.5%)

- **`public/css/mobile.css`**:
  - `.lesson-cell` (řádek 256):
    - `min-width: 120px` → `min-width: 150px` (mobil)
    - Zvětšení šířky buněk o 30px (25%)
  - `.lesson-card` (řádek 244):
    - `padding: 12px` → `padding: 10px` (úspora místa)
  - `.lesson-subject` (řádek 248):
    - `font-size: 1rem` → `font-size: 0.95rem` (menší pro mobil)
  - Nová pravidla `.lesson-details` (řádek 252):
    - `font-size: 0.7rem` (menší detaily na mobilu)
  - Nová pravidla `.lesson-group` (řádky 259-264):
    - `font-size: 0.75rem` (menší badge)
    - `padding: 4px 8px` (místo 5px 10px)
    - `bottom: 4px; right: 4px` (těsnější pozice)

### Vizuální změny
**Desktop:**
- Kartičky v denním zobrazení jsou nyní širší a čitelnější
- Kartičky v týdenním zobrazení (celý týden) jsou širší
- Text předmětu, učitele, místnosti a skupiny má více místa
- Lepší využití prostoru na širších obrazovkách

**Mobil:**
- Kartičky jsou širší (150px místo 120px)
- Menší padding a fonty pro lepší využití prostoru
- Group badge je menší a více kompaktní
- Lepší čitelnost i při horizontálním scrollování

### Modifikované soubory
- `public/css/timetable.css` - zvětšení min-width lesson cells (desktop)
- `public/css/mobile.css` - zvětšení min-width a optimalizace pro mobil

---

## [1.6.7] - 2025-12-29
### fix(lesson-card): zašednutí a z-index group badge u zrušených hodin

### Opraveno
- **Z-index group badge u zrušených hodin**
  - Dříve: Group badge byl nad červenou diagonální čárou (`z-index: 5`)
  - Problém: Badge byl viditelný přes čáru, což bylo vizuálně matoucí
  - Nyní: Group badge je pod červenou čárou (`z-index: 1`)
  - Červená čára překrývá badge, což jasně indikuje zrušenou hodinu

- **Zašednutí group badge u zrušených hodin**
  - Dříve: Oranžový badge byl výrazný i u zrušených hodin
  - Problém: Matoucí - badge byl stejně výrazný jako u aktivních hodin
  - Nyní: Badge je zašedlý a ztlumený u zrušených hodin
  - Jasně indikuje, že skupina je také zrušena

### Změněno
- **`public/css/lesson-card.css`**:
  - `.lesson-group` (řádek 193):
    - `z-index: 5` → `z-index: 1`
    - Badge je nyní pod diagonální čárou
  - Nové pravidlo `.lesson-card.removed .lesson-group` (řádky 197-202):
    - `background: rgba(128, 128, 128, 0.5)` - šedé pozadí místo oranžové
    - `color: rgba(255, 255, 255, 0.7)` - ztlumený bílý text
    - `box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2)` - jemnější stín
    - `opacity: 0.6` - snížená celková viditelnost

### Z-index hierarchie
Nové pořadí vrstev (od nejvyšší po nejnižší):
1. Exclamation mark (removed::after): `z-index: 3` - červený vykřičník vždy nahoře
2. Crossing line (removed::before): `z-index: 2` - červená diagonální čára
3. Group badge (.lesson-group): `z-index: 1` - badge pod čárou

### Vizuální změny
- U zrušených hodin je group badge zašedlý a ztlumený
- Badge je přeškrtnutý červenou čárou (pod čárou v z-index)
- Jasná vizuální indikace, že celá hodina včetně skupiny je zrušena
- Konzistentní napříč všemi layouty (single-day, week-view)
- U aktivních hodin zůstává badge výrazný a oranžový

### Modifikované soubory
- `public/css/lesson-card.css` - změna z-index a zašednutí badge pro removed lessons

---

## [1.6.6] - 2025-12-29
### fix(compact-list): výrazný group badge v pravém dolním rohu a oprava překrývání

### Opraveno
- **Group badge (indikátor skupiny) v compact list layoutu**
  - Dříve: Skupina zobrazena inline v detailech s malou ikonou uživatelů
  - Problém: Nevýrazné, těžko viditelné, nekonzistentní s card view
  - Nyní: Výrazný oranžový badge v pravém dolním rohu
  - Konzistentní styling napříč všemi layouty

- **Překrývání group badge s obsahem a warning ikonou** (KRITICKÝ VIZUÁLNÍ BUG)
  - Problém: Group badge se překrýval s textem předmětu a warning ikonou
  - Text předmětu a detailů šel pod badge
  - U změněných/zrušených hodin se badge překrýval s warning ikonou v pravém horním rohu
  - Řešení:
    - Přidán `padding-right: 80px` do `.compact-lesson-content` pro rezervaci místa pro badge
    - Přidán `min-height: 80px` do `.compact-lesson-item` pro dostatečnou výšku karty
    - Zajištěno, že warning ikona (top-right) a group badge (bottom-right) se nepřekrývají

### Změněno
- **`public/js/layout-renderers.js`**:
  - Compact list rendering (řádek 552):
    - Skupina přesunuta z `.compact-lesson-details` ven z `.compact-lesson-content`
    - Změněna z `<span class="compact-detail-item">` na `<div class="compact-group-badge">`
    - Odstraněna SVG ikona uživatelů (již nepotřebná)
    - Přidána na konec `.compact-lesson-item` pro absolutní pozicování

- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-item` (řádek 47):
    - Přidán `min-height: 80px` pro zajištění dostatečné výšky
  - `.compact-lesson-content` (řádek 94):
    - Přidán `padding-right: 80px` pro rezervaci místa pro group badge
  - Nová CSS třída `.compact-group-badge` (řádky 236-249):
    - `position: absolute; bottom: 8px; right: 8px`
    - `background: var(--spsd-orange)` (oranžový gradient)
    - `color: white` (bílý text)
    - `font-size: 0.85rem; font-weight: 700`
    - `padding: 6px 12px; border-radius: 8px`
    - `box-shadow: 0 2px 6px rgba(235, 93, 67, 0.4)`
    - `z-index: 5` (vždy nahoře)

### Vizuální změny
- Badge je nyní výrazný oranžový obdélník v pravém dolním rohu
- Bílý text na oranžovém pozadí pro maximální čitelnost
- Konzistentní s designem card view a lesson-card layoutů
- Stín pro zvýraznění a oddělení od pozadí
- Text předmětu a detailů nikdy nejde pod badge (rezervován prostor vpravo)
- Warning ikona a group badge se nikdy nepřekrývají (dostatečná výška karty)

### Modifikované soubory
- `public/js/layout-renderers.js` - přesun group badge z inline do samostatného elementu
- `public/css/layout-compact-list.css` - styling pro výrazný badge, fix překrývání

---

## [1.6.5] - 2025-12-29
### fix(card-view): přesun navigačních šipek k dolním indikátorům

### Změněno
- **Navigační šipky přesunuty z vertikálního středu dolů k indikátorům**
  - Dříve: Šipky byly vertikálně vycentrované (`top: 50%; transform: translateY(-50%)`)
  - Nyní: Šipky jsou v dolní části zarovnané s tečkovými indikátory (`bottom: 20px`)
  - Lepší vizuální soudržnost - šipky a indikátory jsou nyní na stejné úrovni
  - Uvolněn prostor v horní části pro lepší zobrazení obsahu karty

### Aktualizované soubory
- **`public/css/layout-card-view.css`**:
  - `.card-view-navigation` (řádky 310-318):
    - Změněno z `top: 50%; transform: translateY(-50%);` na `bottom: 20px;`
    - Odstraněn `transform: translateY(-50%)` (již nepotřebný)

### Vizuální změny
- Navigační tlačítka (prev/next) jsou nyní zarovnána s `.card-view-dots` indikátory
- Šipky jsou na stejné vertikální úrovni jako tečky ukazující aktuální kartu
- Čistší a konzistentnější layout s lepším využitím prostoru

### Modifikované soubory
- `public/css/layout-card-view.css` - změna pozice navigačních tlačítek

---

## [1.6.4] - 2025-12-29
### feat(icons): aktualizace ikony dveří na Lucide door-open

### Změněno
- **Ikona dveří nahrazena za Lucide door-open icon**
  - Dříve: Jednoduchá ikona obdélníku s vertikální linií a klikou
  - Nyní: Detailnější ikona otevřených dveří z Lucide icon setu
  - Realističtější a profesionálnější vzhled
  - Jednotná napříč všemi layouty

### Aktualizované soubory
- **`public/js/layout-renderers.js`**:
  - Card view - renderSingleLesson() a renderSplitLessons()
  - Compact list - renderCompactListLayout()
  - Nová SVG cesta pro door-open icon

- **`public/js/timetable.js`**:
  - Teacher view - zobrazení místnosti
  - Class view - zobrazení místnosti
  - Nová SVG cesta pro door-open icon

### Vizuální změny
Ikona nyní zobrazuje otevřené dveře místo zavřených:
- Více detailů (rám dveří, klika, podlaha)
- Lepší rozpoznatelnost jako ikona místnosti
- Konzistentní s moderními icon sety (Lucide)

### Modifikované soubory
- `public/js/layout-renderers.js` - aktualizace SVG ikony (3 místa)
- `public/js/timetable.js` - aktualizace SVG ikony (2 místa)

---

## [1.6.3] - 2025-12-29
### feat(ui): vylepšení group badge - přesun do pravého dolního rohu

### Vylepšeno
- **Group badge (indikátor skupiny) přesunut do pravého dolního rohu**
  - Dříve: Badge byl v levém horním rohu s menším stylingem
  - Nyní: Badge je v pravém dolním rohu s výraznějším designem
  - Inspirováno stylingem z card view
  - Lepší viditelnost a konzistence napříč layouty

### Změněno
- **`public/css/lesson-card.css`**:
  - `.lesson-group` (řádky 181-194):
    - Přidáno `position: absolute; bottom: 6px; right: 6px`
    - Font-size: 0.75rem → 0.85rem (větší)
    - Padding: 3px 8px → 5px 10px (větší)
    - Border-radius: 6px → 8px (zaoblenější)
    - Box-shadow: silnější stín `0 2px 6px rgba(235, 93, 67, 0.4)`
    - Přidán `z-index: 5` (vždy navrchu)
    - Odstraněno `margin-top` a `align-self` (již nepotřebné)

### Vizuální změny
- Badge je nyní výraznější a lépe viditelný
- Pozice v pravém dolním rohu lépe odděluje skupinu od ostatních informací
- Konzistentní s designem card view layoutu

### Modifikované soubory
- `public/css/lesson-card.css` - přesun a vylepšení group badge

---

## [1.6.2] - 2025-12-29
### feat(icons): jednotná ikona dveří pro místnost ve všech layoutech

### Přidáno
- **Ikona dveří pro místnost v single-day a week-view layoutech**
  - Dříve: Místnost zobrazena pouze jako prostý text
  - Nyní: SVG ikona dveří před číslem místnosti
  - Konzistentní s card-view a compact-list layouty
  - Lepší vizuální hierarchie a rozpoznatelnost

### Změněno
- **`public/js/timetable.js`**:
  - Teacher view (řádky 367-376):
    - Přidán wrapper `<span class="lesson-detail-item">` s SVG ikonu dveří
  - Class view (řádky 395-404):
    - Přidán wrapper `<span class="lesson-detail-item">` s SVG ikonu dveří
  - SVG ikona: Stejná jako v card-view (door icon)

- **`public/css/lesson-card.css`**:
  - Nové CSS pravidla (řádky 168-179):
    - `.lesson-detail-item`: flex container pro SVG ikony (gap: 4px)
    - `.lesson-detail-icon`: 14x14px SVG s `stroke: var(--text-dim)`

### Vizuální konzistence
Ikona dveří je nyní jednotná napříč všemi layouty:
- ✓ Single-day view (timetable grid)
- ✓ Week view (timetable grid)
- ✓ Card view (swipeable cards)
- ✓ Compact list view (vertical list)

### Modifikované soubory
- `public/js/timetable.js` - přidání SVG ikony pro místnost
- `public/css/lesson-card.css` - CSS pro ikonu

---

## [1.6.1] - 2025-12-29
### fix(compact-list): oprava left border a status indikátorů

### Opraveno
- **Odstranění levého borderu (KRITICKÝ VIZUÁLNÍ BUG)**
  - Všechny lesson items měly žlutý/oranžový levý border (4px)
  - Border byl redundantní a rušivý
  - Řešení: Odstraněn `border-left` z `.compact-lesson-item`, `.compact-lesson-item.current-time`, `.compact-lesson-item.upcoming`, a `.compact-lesson-item.changed`

- **Překrývání ikon changed a removed**
  - `.compact-lesson-item.changed` používal `::before`
  - `.compact-lesson-item.removed` používal `::after`
  - Když byla lekce zároveň changed i removed, zobrazovaly se obě ikony na stejném místě
  - Řešení:
    - Changed přesunut z `::before` na `::after` (warning triangle)
    - Removed přesunut z `::after` na `::before` (diagonal line)
    - Nyní se nepřekrývají

- **Přepracování zrušené/odstraněné lekce**
  - Dříve: Pouze škrtnutý text předmětu
  - Problém: Vizuálně nedostatečné, nebylo jasné, že celá lekce je zrušena
  - Řešení: Diagonální červená linie přes celou kartu
    - Použit `linear-gradient` s průhledností
    - Linie od top-left do bottom-right
    - Šířka: 2px (calc(50% ± 1px))
    - Barva: `rgba(220, 53, 69, 0.8)` (červená)
    - Border-radius: 12px (kopíruje kartu)
    - `pointer-events: none` (nečeká na kliknutí)

### Změněno
- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-item` (řádek 42):
    - Odstraněn `border-left: 4px solid var(--border)`
  - `.compact-lesson-item.current-time` (řádek 132-134):
    - Odstraněn `border-left: 4px solid rgba(239, 68, 68, 0.8)`
  - `.compact-lesson-item.upcoming` (řádek 140-142):
    - Odstraněn `border-left: 4px solid var(--accent)`
  - `.compact-lesson-item.removed::before` (řádky 152-170):
    - Změněno z `::after` na `::before` (aby se nepřekrývalo s changed)
    - Nahrazeno X icon → diagonal line gradient
    - Pokrývá celou kartu (top/left/right/bottom: 0)
  - `.compact-lesson-item.removed .compact-lesson-subject` (řádky 172-174):
    - Odstraněn `text-decoration: line-through`
  - `.compact-lesson-item.changed::after` (řádky 176-186):
    - Změněno z `::before` na `::after`

### Modifikované soubory
- `public/css/layout-compact-list.css` - odstranění left border, fix status indikátorů

---

## [1.6] - 2025-12-29
### redesign(compact-list): kompletní přepracování seznamu layoutu

### Přejmenováno
- **"Kompaktní seznam" → "Seznam"**
  - Jednodušší a stručnější název v nastavení layoutu
  - Lepší čitelnost na mobilních zařízeních

### Opraveno
- **Redundantní hlavička dne (KRITICKÝ UX BUG)**
  - Zobrazoval se "Pondělí" header nad seznamem, i když je den již vybraný v day pickeru
  - Řešení: Kompletně odstraněna hlavička dne z renderování
  - Šetří prostor a eliminuje duplicitu

- **Duplicitní zobrazení čísla lekce**
  - Badge: "1", Čas: "1. 8:00-8:45" → zobrazeno dvakrát
  - Řešení: Odstraněno "1." z časové sekce, zůstává pouze v badge
  - Čistší a logičtější zobrazení

- **Emoji ikony nahrazeny SVG ikonami**
  - Problém: 📍 (room) a 👥 (group) emoji se špatně zobrazovaly na některých zařízeních
  - Řešení: SVG ikony konzistentní s card-view layoutem
  - Room: SVG ikona dveří (stejná jako v card-view)
  - Group: SVG ikona skupiny uživatelů
  - Lepší viditelnost v dark mode díky `stroke: var(--text-dim)`

- **Bugged warning emoji v pravém horním rohu** (KRITICKÝ BUG)
  - `.compact-lesson-item.changed::before` používal `position: absolute` bez `position: relative` na rodiči
  - Emoji se zobrazoval mimo element nebo na špatné pozici
  - Řešení:
    - Přidán `position: relative` na `.compact-lesson-item`
    - Nahrazeno emoji za SVG warning triangle icon
    - Přidána podobná SVG ikona (X) pro removed lessons

### Vylepšeno
- **Redesign vizuální hierarchie**
  - Badge:
    - Velikost: 36px → 44px (desktop), 32px → 40px (mobile)
    - Barva: tmavě modrá → oranžový gradient (`var(--spsd-orange)`)
    - Font: 700 / 1rem → 800 / 1.2rem
    - Přidán box-shadow pro zvýraznění
  - Čas:
    - Odstraněno duplicitní číslo lekce
    - Font: 700 / 0.7rem → 600 / 0.85rem
    - Lepší centrování pomocí flexbox
  - Status ikony:
    - Changed: SVG warning triangle (žlutá)
    - Removed: SVG X icon (červená)
    - Konzistentní velikost 20x20px
    - Správné pozicování v pravém horním rohu

### Změněno
- **`public/js/layout-registry.js`**:
  - Řádek 52: `name: 'Seznam'` (změněno z 'Kompaktní seznam')

- **`public/js/layout-renderers.js`**:
  - `renderCompactListLayout()` (řádek 509-511):
    - Odstraněna hlavička dne (`compact-day-header`)
    - Odstraněna proměnná `dayName`
  - Řádek 527-529: Odstraněno duplicitní `${lesson.hour}.` z časové sekce
  - Řádky 534-554: Nahrazeny emoji za SVG ikony
    - Room: SVG door icon s `compact-detail-item` wrapperem
    - Group: SVG users icon s `compact-detail-item` wrapperem

- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-item` (řádek 36): Přidán `position: relative`
  - `.compact-lesson-badge` (řádky 60-73):
    - Velikost: 36px → 44px
    - Background: `var(--accent)` → `linear-gradient(135deg, var(--spsd-orange), #d94e37)`
    - Border-radius: 8px → 12px
    - Font: 700 / 1rem → 800 / 1.2rem
    - Přidán `box-shadow: 0 2px 8px rgba(235, 93, 67, 0.3)`
  - `.compact-lesson-time` (řádky 75-84):
    - Width: 60px → min-width: 70px
    - Font: 700 → 600
    - Přidán flexbox pro lepší centrování
  - `.compact-lesson-time-label` (řádky 86-90):
    - Font-size: 0.7rem → 0.85rem
    - Font-weight: 400 → 500
    - Odstraněn margin-top (již není potřeba)
  - Nové CSS pravidla (řádky 119-130):
    - `.compact-detail-item`: flex container pro SVG ikony
    - `.compact-detail-icon`: 16x16px SVG s `stroke: var(--text-dim)`
  - `.compact-lesson-item.removed` (řádky 151-170):
    - Zjednodušen design: pouze opacity 0.6
    - Odstraněn background gradient
    - Odstraněna border změna
    - Přidán `::after` s SVG X icon
  - `.compact-lesson-item.changed::before` (řádky 176-186):
    - Content: '⚠️' → '' (prázdný)
    - Přidán SVG warning triangle jako background-image
    - Velikost: 1rem → 20px
    - Pozice: 8px → 12px (better spacing)
  - Mobile responsive (řádky 215-223):
    - Badge: 32px → 40px, font 0.9rem → 1rem
    - Time: width 50px → min-width 60px

### Modifikované soubory
- `public/js/layout-registry.js` - přejmenování layoutu
- `public/js/layout-renderers.js` - odstranění hlavičky, SVG ikony, cleanup duplicit
- `public/css/layout-compact-list.css` - redesign, fix positioning, SVG ikony

---

## [1.5] - 2025-12-29
### fix(ui): vylepšení ikon a viditelnosti v dark mode

### Opraveno
- **Ikona místnosti (room) nahrazena za ikonu dveří**
  - Původní ikona dokumentu s klíčem byla matoucí
  - Nová ikona: čistý design dveří s klikou, konzistentní se stávajícími SVG ikonami
  - Aplikováno v card-view i compact-list layoutech

- **Viditelnost vybraného layoutu v dark mode** (KRITICKÝ UX BUG)
  - Checkmark na vybraném layoutu byl špatně viditelný (tmavě modrý na tmavém pozadí)
  - Border vybraného layoutu byl téměř neviditelný v dark mode
  - Řešení:
    - Checkmark background změněn z `var(--accent)` (#002B4F) na `var(--spsd-orange)` (#EB5D43)
    - Zvětšen checkmark z 28px na 32px pro lepší viditelnost
    - Border změněn na oranžovou barvu (`--spsd-orange`) se zvětšením na 3px
    - Přidán silnější box-shadow pro zvýraznění

- **X tlačítko (zavřít) v modálním okně**
  - Offset při hoveru způsobený transform rotate
  - Řešení: Přidán scale(1.1) a jemné pozadí pro lepší vizuální feedback

### Změněno
- **`public/js/layout-renderers.js`**:
  - Řádky 100-110, 167-177: Aktualizována SVG ikona pro místnost (room)
    - Nový design: `<rect>` + vertikální linie + kruh pro kliku

- **`public/css/layout-modal.css`**:
  - `.layout-option.active` (řádek 72-77):
    - `border-color: var(--spsd-orange)` místo `var(--accent)`
    - `border-width: 3px` pro výraznější ohraničení
  - `.layout-option.active::after` (řádek 79-95):
    - `background: var(--spsd-orange)` místo `var(--accent)`
    - Velikost zvětšena z 28px na 32px
    - Font-size zvětšen z 1rem na 1.2rem
    - Přidán `box-shadow: 0 2px 8px rgba(235, 93, 67, 0.4)`
  - `#layoutModal .modal-close:hover` (řádek 43-48):
    - Přidán `scale(1.1)` k transformaci
    - Přidáno pozadí `rgba(255, 255, 255, 0.1)`
    - Přidán `border-radius: 8px`

### Modifikované soubory
- `public/js/layout-renderers.js` - aktualizace ikony místnosti
- `public/css/layout-modal.css` - zlepšení viditelnosti v dark mode

---

## [1.4.1] - 2025-12-29
### fix(card-view): cleanup event listeners při prázdném rozvrhu

### Opraveno
- **Event listeners přetrvávaly při přepnutí na prázdný rozvrh** (KRITICKÝ BUG)
  - Scénář: Rozvrh A s hodinami → Rozvrh B s 0 hodinami → stále lze scrollovat
  - `renderCardLayout()` při 0 hodinách dělal early return bez abortu starých listenerů
  - Swipe a navigation listeners z předchozího rozvrhu zůstávaly aktivní na prázdném rozvrhu
  - Řešení: Abort `swipeController` a `navigationController` před early return

### Změněno
- **`public/js/layout-renderers.js`**:
  - `renderCardLayout()` (řádek 201-228):
    - Přidán cleanup event listeners před early return při 0 hodinách
    - Kontrola a abort obou controllerů pokud existují
    - Nastavení na null pro cleanup

### Modifikované soubory
- `public/js/layout-renderers.js` - cleanup listeners při prázdném rozvrhu

---

## [1.4] - 2025-12-29
### fix(card-view): oprava násobení scrollování, validace a resetování cardIndex

### Opraveno
- **Event listeners se akumulovaly při přepínání rozvrhů** (KRITICKÝ BUG)
  - Každé kliknutí na aktuální/stálý/příští přidávalo nové event listeners bez odstranění starých
  - Výsledek: scrollování se násobilo (0→200%, 400%, 600% místo 0→100%, 200%)
  - Řešení: Implementován **AbortController** pro automatický cleanup listenerů

- **cardIndex se neresetoval při načtení nového rozvrhu**
  - cardIndex zůstával uložený v state i po přepnutí na rozvrh s jiným počtem hodin
  - Scénář: Třída s 8 hodinami (cardIndex: 5) → Učitel s 0 hodinami → stále scrollovalo na index 5
  - Řešení: Validace cardIndex proti skutečnému počtu karet s automatickým clampingem

- **cardIndex persistoval při přepínání mezi rozvrhy a dny** (NOVÝ FIX)
  - Po přepnutí rozvrhu nebo dne uživatel mohl scrollovat na počet hodin z předchozího rozvrhu
  - Scénář: Pondělí s 5 hodinami (karta 3) → Úterý s 2 hodinami → transform stále -300%
  - Řešení: Explicitní reset cardIndex na 0 při přepnutí rozvrhu nebo dne

- **Disabled state navigation buttons používal špatný počet**
  - Next button porovnával cardIndex s `dayLessons.length` (celkový počet lekcí) místo `hours.length` (počet karet)
  - Řešení: Opraven na `currentCardIndex >= hours.length - 1`

### Změněno
- **`public/js/timetable.js`**:
  - `selectDay()` (řádek 113-122):
    - Přidán reset cardIndex na 0 při přepnutí dne
  - `loadTimetable()` (řádek 457-462):
    - Přidán reset cardIndex na 0 při načtení nového rozvrhu

- **`public/js/layout-renderers.js`**:
  - Přidány module-level proměnné: `swipeController`, `navigationController` (řádky 14-15)
  - `initCardViewSwipe()` (řádek 354-411):
    - Abort starého controlleru před vytvořením nového
    - Přidán `signal` parameter do všech addEventListener()
  - `initCardViewNavigation()` (řádek 298-323):
    - Abort starého controlleru před vytvořením nového
    - Přidán `signal` parameter do všech addEventListener()
  - `renderCardLayout()` (řádky 233-241):
    - Validace cardIndex: `Math.max(0, Math.min(rawCardIndex, maxCardIndex))`
    - Automatický reset v state pokud byl cardIndex mimo rozsah
  - Navigation button disabled state (řádek 288):
    - Změněno z `dayLessons.length - 1` na `hours.length - 1`

### Technické detaily
- **AbortController pattern**: Moderní přístup k cleanup event listenerů
  - Automaticky odstraní VŠECHNY listeners při `controller.abort()`
  - Není nutné ukládat reference na jednotlivé handler funkce
  - Čistší a bezpečnější než manuální `removeEventListener()`

- **cardIndex validace**:
  - `rawCardIndex` načten ze state
  - `maxCardIndex = Math.max(0, hours.length - 1)` vypočítán z aktuálního počtu karet
  - `currentCardIndex = Math.max(0, Math.min(rawCardIndex, maxCardIndex))` - clamping do validního rozsahu
  - Pokud `rawCardIndex !== currentCardIndex`, state je aktualizován

### Modifikované soubory
- `public/js/layout-renderers.js` - AbortController cleanup, validace cardIndex, fixed disabled state

---

## [1.3] - 2025-12-29
### feat(layout): modernizace card view layoutu s SVG ikonami a responzivním designem

### Přidáno
- **Moderní design karet s vizuální hierarchií**:
  - Velké číslo hodiny (1.3rem font, font-weight 800) v card-header-row
  - Barevný status dot (8px průměr) - oranžový gradient pro změny, červený pro zrušené hodiny
  - Nová struktura: card-header-row, lesson-subject-name, card-details, card-badges
  - Groupování lekcí po hodinách (řeší problém "13 hodin vedle sebe")

- **Split layout pro hodiny po skupinách**:
  - Automatické seskupení lekcí stejné hodiny s více skupinami
  - Split zobrazení 50/50 pro 2+ skupiny v rámečcích `.card-lesson-half`
  - Group badges nahoře (oranžové, bílý text)
  - Diagonální čára přes zrušené hodiny (CSS gradient `::after`)

- **SVG ikony místo emoji**:
  - Badge ikony: Warning trojúhelník (⚠️ → SVG) a Ban kruh (🚫 → SVG)
  - Detail ikony: Učitel (user icon), Místnost (door icon), Skupina (users icon)
  - Lepší škálovatelnost a profesionální vzhled

- **Responzivní navigace**:
  - Mobile (max-width: 768px): Navigation šipky skryté, jen swipe gestures + dots
  - Desktop (min-width: 769px): Navigation šipky viditelné
  - Enhanced dots na mobilu (větší velikost pro lepší touch target)
  - Vylepšený swipe handler s threshold 30px a horizontal/vertical detection

### Změněno
- **Unified design pro single a split hodiny**:
  - Single hodiny nyní používají stejný `.card-lesson-half` container jako split hodiny
  - Konzistentní vizuální styl: border, padding, box-shadow, centered layout
  - Flexbox s `:only-child` selector pro full-width single lessons

- **CSS (`public/css/layout-card-view.css`)**:
  - Přepsány styly pro `.lesson-card-full` - min/max-width: calc(100% - 16px)
  - Card header row s flexbox: subject (hodina) + time-meta (čas + status dot)
  - Status dot s box-shadow glow efektem
  - Split layout styly: `.card-lessons-split`, `.card-lesson-half`, `.lesson-group-badge`
  - Diagonal line pro removed lessons pomocí gradient v `::after`
  - Media query pro mobil: skrytí `.card-view-navigation`, zvětšení dots

- **JavaScript (`public/js/layout-renderers.js`)**:
  - Přidán grouping algorithm: `lessonsByHour` seskupuje lekce podle `lesson.hour`
  - `renderSingleLesson()` - nyní používá `.card-lesson-half` wrapper (unified design)
  - `renderSplitLessons()` - helper pro split layout s group badges
  - Conditional rendering: `lessons.length === 1 ? renderSingleLesson() : renderSplitLessons()`
  - Swipe gestures s touchstart/touchmove/touchend event listeners
  - Click handlers pro modal otevření - separate pro single i split lessons

### UI/UX vylepšení
- Čitelnější struktura: hodina + čas na jednom řádku
- Barevná vizuální indikace změn/zrušení pomocí status dots s glow efektem
- Minimalistický design s lepším spacing (gap: 12px)
- Touch-friendly na mobilu (swipe only, žádné šipky, lower threshold)
- Profesionální vzhled se SVG ikonami místo emoji
- Konzistentní design mezi single a split hodinami (stejný rámečkový styl)
- Group badges viditelné v dark mode (SPŠD orange + white text)

### Modifikované soubory
- `public/css/layout-card-view.css` - kompletní redesign stylů, split layout, unified design
- `public/js/layout-renderers.js` - grouping algorithm, renderSingleLesson/renderSplitLessons helpers, unified wrapper

---

## [1.2] - 2025-12-29
### fix(layout): kompletní oprava layout rendering systému

### Opraveno
- **7 kritických bugů v layout rendering systému**:

  1. **První načtení stránky** - den se nezobrazoval ani po refreshi
     - Příčina: `loadTimetable()` nevolal `applyLayout()` po vygenerování HTML
     - Řešení: Přidán `await applyLayout()` na konec `loadTimetable()`

  2. **Week view button nefungoval** - při kliknutí se nezobrazil celý týden
     - Příčina: `initWeekViewToggle()` měnil deprecated `showWholeWeek` místo `layoutMode`
     - Řešení: Přepsán na `switchLayout()` s `layoutMode`

  3. **DaySelector zmizel** - při přepínání layoutů zmizely day buttony (PO, ÚT, ST...)
     - Příčina: `renderSingleDayLayout()` a `renderWeekLayout()` mažou `.timetable-container` včetně daySelectoru
     - Řešení: Odstraněno mazání containeru, mazat se má jen grid

  4. **Race conditions** - asynchronní operace bez await
     - Příčina: `selectDay()` a `updateMobileDayView()` volaly `applyLayout()` bez await
     - Řešení: Přidány async/await všude kde chyběly

  5. **State mismatch** - dva systémy vedle sebe
     - Příčina: `showWholeWeek` vs `layoutMode`
     - Řešení: Unifikováno na `layoutMode`, `showWholeWeek` je deprecated

  6. **Nekonečný loop** (již opraveno dříve)
     - Příčina: `renderTimetable()` volal `updateMobileDayView()` → loop
     - Řešení: Odstraněno volání, což vytvořilo problém #1 (nyní opraven)

### Změněno
- `loadTimetable()` nyní volá `await applyLayout()` po renderování HTML
- `initWeekViewToggle()` nyní mění `layoutMode` a volá `switchLayout()`
- `renderSingleDayLayout()` a `renderWeekLayout()` již nemažou `.timetable-container`
- `selectDay()` je nyní async funkce s `await updateMobileDayView()`
- `updateMobileDayView()` nyní používá `await applyLayout()`

### Modifikované soubory
- `public/js/timetable.js` - opraveny loadTimetable, initWeekViewToggle, selectDay, updateMobileDayView
- `public/js/layout-renderers.js` - odstraněno mazání containeru

---

## [1.1] - 2025-12-29
### fix(ui): odstranění hover animací a lokalizace layout systému

### Změněno
- Překlad "Layout" → "Rozvržení" ve všech výskytech (UI texty)
- Konzistentní design mezi settings a layout modaly
  - Layout modal nyní má stejný modrý gradient header jako settings modal
  - Close button (×) - bílá barva, větší velikost, rotate animace
  - Sticky header pro lepší UX při scrollování

### Odebráno
- **Hover animace** ze settings a layout options pro čistší UI:
  - Shine effect (gradient animation)
  - Transform translateY (vyskakovací efekt)
  - Box-shadow změny
  - Icon scale a rotate animace
  - Arrow translateX animace
- Ponechán pouze **subtle border zvýraznění** při hoveru

### UI/UX vylepšení
- Minimalistický, nerušivý hover efekt - jen jemné zvýraznění borderu oranžovou barvou
- Konzistentní chování napříč všemi modaly
- Lepší čitelnost a profesionální vzhled

---

## [1.0] - 2025-12-29
### feat: přidání systému výběru layoutů pro mobilní zobrazení rozvrhu

### Přidáno
- **Systém výběru layoutů pro mobilní zobrazení rozvrhu**
  - Modulární systém s Registry Pattern architekturou
  - 4 typy layoutů: Denní zobrazení, Celý týden, Karta, Kompaktní seznam

- **Nové layouty:**
  - **Denní zobrazení** - zobrazení jednoho vybraného dne (výchozí)
  - **Celý týden** - zobrazení všech 5 pracovních dní v tabulce
  - **Karta** - swipeable cards s navigation buttons a dots
  - **Kompaktní seznam** - seznam lekcí pod sebou s scroll persistence

- **Layout selection modal**
  - Vizuální výběr layoutu v nastavení
  - Indikace aktivního layoutu
  - Ikony a popisy pro každý layout

- **Nové soubory:**
  - `public/js/layout-registry.js` - centrální registr layoutů
  - `public/js/layout-manager.js` - správa layoutů a persistence
  - `public/js/layout-renderers.js` - rendering funkce
  - `public/css/layout-modal.css` - styly pro modal
  - `public/css/layout-card-view.css` - styly pro card view
  - `public/css/layout-compact-list.css` - styly pro compact list

### Změněno
- Nahrazeno tlačítko "Zobrazit celý týden" v nastavení za sekci "Layout"
- `showWholeWeek` označen jako deprecated, migrace na nový `layoutMode` systém
- Refaktorován `updateMobileDayView()` - nyní deleguje na layout manager

### Technické detaily
- Swipe gestures pro card view (touchstart/touchmove/touchend)
- Scroll position persistence pro compact list
- Persistence layoutu v localStorage
- Modulární architektura umožňující snadné přidání dalších layoutů
- Zpětná kompatibilita s původním showWholeWeek stavem
- Automatická migrace starých nastavení na nový systém

### Modifikované soubory
- `public/index.html` - přidán layoutModal, změněn settingsCalendar na settingsLayout
- `public/js/settings.js` - handlers pro layout modal
- `public/js/state.js` - přidány layoutMode a layoutPreferences
- `public/js/timetable.js` - delegování na layout manager
- `public/js/main.js` - inicializace layout systému

