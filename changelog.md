# Changelog

## [1.9.0] - 2026-01-07
### 🔧 UX vylepšení a čištění kódu

**Shrnutí:**
Tři důležité úpravy pro lepší UX a odstranění nepotřebných funkcí.

### 🐛 Opravy
- **Card-view skupinové hodiny**: Vykřičník o změně hodiny se nyní zobrazuje u konkrétní změněné skupinové hodiny, ne u celého wrapperu

### ⚡ Změny
- **Mobilní rozložení**: Odstraněno week-view (celý týden) z mobilního zobrazení - na malých displejích je nepřehledné, zůstává dostupné pouze na desktopu
- **Notifikace**: Odstraněny globální systémové notifikace (API outage/restored) - informace o stavu API je viditelná v alertu při otevření aplikace

### 📦 Modifikované soubory
**Frontend:**
- `public/js/layout-renderers.js` - přidány badge indikátory do renderSplitLessons()
- `public/js/layout-registry.js` - week-view pouze pro desktop
- `public/index.html` - odstranění week-view toggle a systémových notifikací UI
- `public/js/notifications-modal.js` - odstranění global toggles logiky
- `public/js/notifications-core.js` - odstranění saveGlobalNotificationPreferences()

**Backend:**
- `backend/fcm.js` - odstranění sendApiOutageNotification() a sendApiRestoredNotification()
- `backend/cron.js` - aktualizace volání notifikačních funkcí

---

## [1.8.0] - 2026-01-07
### 🎉 Release: Vylepšení mobilního UX a časové navigace

**Pull Request Summary:**
Tato verze přináší významná vylepšení pro mobilní uživatele - časové zvýraznění hodin ve všech layoutech a intuitivní swipe navigaci pro rychlé přepínání dní.

### 📋 Obsah release
Tato verze kombinuje 3 samostatné commity:
- **v1.7.12** - Časové zvýraznění hodin (card-view, compact-list)
- **v1.7.13** - Swipe navigace pro změnu dne
- **v1.7.14** - UI optimalizace (swipe směry, odstranění hover efektů)

---

## 🎯 Hlavní features

### 1️⃣ Časové zvýraznění hodin napříč všemi layouty
- ✅ **Aktuální hodina** - červené zvýraznění
- ✅ **Nadcházející hodina** - oranžové zvýraznění
- ✅ **Proběhlé hodiny** - zešednutí
- ✅ Jednotný design v layoutech: denní, týdenní, karty, seznam
- ✅ Funguje i u skupinových hodin (split lessons)

### 2️⃣ Swipe navigace pro změnu dne (touch-only)
- ✅ **Karty**: Vertikální swipe ↑↓ (nahoru = další den, dolů = předchozí)
- ✅ **Denní**: Vertikální swipe ↑↓ (nahoru = další den, dolů = předchozí)
- ✅ **Seznam**: Horizontální swipe ←→ (doleva = další den, doprava = předchozí)
- ✅ **Kruhová navigace** - Pátek → Pondělí, Pondělí → Pátek
- ✅ **Inteligentní detekce směru** - žádné konflikty se scrollem nebo card swipe
- ✅ 50px threshold - prevence nechtěných změn dne

### 3️⃣ UI optimalizace
- ✅ Opraven swipe směr v denním layoutu (vertikální místo horizontálního)
- ✅ Odstraněny rušivé hover/select efekty v seznamovém zobrazení
- ✅ Čistší a uživatelsky přívětivější interface

---

## 📦 Modifikované soubory
- `public/js/layout-renderers.js` - časové zvýraznění, swipe navigace, cleanup
- `public/js/timetable.js` - export selectDay() funkce
- `public/css/layout-card-view.css` - časové zvýraznění card-view
- `public/css/layout-compact-list.css` - časové zvýraznění a odstranění hover efektů

---

## 🐛 Opravené bugy
- **Skupinové hodiny v compact-list** - nebyla zobrazována časová zvýraznění (červená/oranžová)
- **Denní layout swipe konflikt** - horizontální swipe kolidoval s horizontálním scrollem

---

## 🧪 Testování
**Časové zvýraznění:**
- [ ] Card-view: červené pro current, oranžové pro upcoming, zešednutí pro past
- [ ] Compact-list: zvýraznění funguje u klasických i skupinových hodin
- [ ] Zobrazuje se pouze v "aktuálním rozvrhu", ne ve "stálém"

**Swipe navigace:**
- [ ] Karty: vertikální swipe mění den, horizontální naviguje mezi kartami hodin
- [ ] Denní: vertikální swipe mění den, horizontální scroll funguje normálně
- [ ] Seznam: horizontální swipe mění den, vertikální scroll funguje normálně
- [ ] Pátek → swipe další → Pondělí (wrapping)
- [ ] Pondělí → swipe předchozí → Pátek (wrapping)
- [ ] Žádné konflikty při scrollování/swipování

**UI čistota:**
- [ ] Seznam nemá hover/active efekty (čistší při scrollování)

---

## 🎨 User Experience Benefits
- ⚡ **Rychlejší navigace** - swipe je přirozenější než klikání na tlačítka
- 👁️ **Lepší orientace v čase** - okamžitě viditelné, která hodina právě probíhá
- 📱 **Mobilní-first design** - optimalizováno pro dotykové ovládání
- 🔄 **Kruhová navigace** - rychlé přepínání bez omezení
- ✨ **Konzistentní UX** - všechny layouty používají stejné vzory

---

## 💡 Technické highlights
- AbortController pattern pro správný cleanup event listenerů
- Inteligentní detekce směru swipe (diffX vs diffY)
- Cirkulární wrapping: `(currentDay + direction + 5) % 5`
- Passive vs non-passive event listenery pro optimální performance
- CSS gradient pozadí pro vizuální odlišení časových stavů

---

**Připraveno k merge do main** ✅

---

## [1.7.14] - 2026-01-07
### fix(ui): úpravy směru swipe gesty a odstranění hover efektů

### Změněno
- **Směr swipe gesty v denním zobrazení**
  - Dříve: Horizontální swipe (←→) pro změnu dne
  - Problém: Denní layout se scrolluje horizontálně (doprava/doleva), což způsobovalo konflikty
  - Nyní: Vertikální swipe (↑↓) pro změnu dne - stejně jako v kartovém zobrazení
  - Swipe nahoru (↑) = další den
  - Swipe dolů (↓) = předchozí den

- **Odstranění interaktivních efektů v seznamovém zobrazení**
  - Odstraněny hover a select efekty u hodin v compact-list layoutu
  - Zahrnuje jak klasické hodiny, tak skupinové hodiny
  - Čistější UI bez rušivých animací při scrollování

### Upravené soubory
- **`public/js/layout-renderers.js`** (řádek 150):
  - `renderSingleDayLayout()`: Změna z `initDaySwipeNavigation('horizontal')` na `initDaySwipeNavigation('vertical')`

- **`public/css/layout-compact-list.css`**:
  - Odstraněno `.compact-lesson-item:hover` (border-color, box-shadow, transform)
  - Odstraněno `.compact-lesson-item:active` (transform)
  - Odstraněno `.compact-lesson-half:hover` (border-color, box-shadow)
  - Odstraněna transition animace z `.compact-lesson-half`

### Přehled swipe směrů po změně
| Layout | Scrollovací směr | Swipe směr pro změnu dne | Důvod |
|--------|------------------|--------------------------|-------|
| Denní | Horizontální (←→) | Vertikální (↑↓) | Prevence konfliktu se scrollem |
| Karty | - | Vertikální (↑↓) | Horizontální swipe pro navigaci karet |
| Seznam | Vertikální (↑↓) | Horizontální (←→) | Prevence konfliktu se scrollem |

## [1.7.13] - 2026-01-07
### feat(navigation): swipe gesta pro změnu dne v mobilních layoutech

### Přidáno
- **Swipe navigace pro změnu dne v denním, kartovém a seznamovém zobrazení**
  - Dříve: Změna dne pouze kliknutím na tlačítka Po, Út, St, Čt, Pá
  - Problém: Na mobilu je přepínání dní nepohodlné - nutné vždy kliknout na malé tlačítko
  - Nyní: Přirozená touch navigace pomocí swipe gest
  - Podpora pro všechny mobilní layouty (denní, karty, seznam)

- **Layout-specifické směry swipe gest**
  - **Karty (card-view)**: Vertikální swipe pro změnu dne
    - Swipe nahoru (↑) = další den (Pondělí → Úterý)
    - Swipe dolů (↓) = předchozí den (Úterý → Pondělí)
    - Horizontální swipe zachován pro navigaci mezi kartami hodin
  - **Denní zobrazení (single-day)**: Horizontální swipe
    - Swipe doleva (←) = další den
    - Swipe doprava (→) = předchozí den
  - **Seznam (compact-list)**: Horizontální swipe
    - Swipe doleva (←) = další den
    - Swipe doprava (→) = předchozí den

- **Kruhová navigace (wrapping)**
  - Pátek + swipe k dalšímu dni = Pondělí (začátek týdne)
  - Pondělí + swipe k předchozímu dni = Pátek (konec týdne)
  - Rychlá navigace po celém týdnu bez omezení

### Změněno
- **`public/js/timetable.js`**:
  - Export `selectDay()` funkce (řádek 113)
    - Umožňuje volání z jiných modulů (layout-renderers.js)

- **`public/js/layout-renderers.js`**:
  - Nová proměnná `daySwipeController` (řádek 17)
    - AbortController pro cleanup event listenerů při přepínání layoutů
  - Nová funkce `initDaySwipeNavigation(direction)` (řádky 37-116)
    - `direction`: 'horizontal' pro single-day/compact-list, 'vertical' pro card-view
    - Touch event listeners: touchstart, touchmove, touchend
    - Threshold: 50 pixelů (větší než swipe karet - 30px)
    - Detekce směru: pouze primární směr spouští změnu dne
    - Wrapping math: `(currentDay + direction + 5) % 5`
  - Aktualizace `cleanupLayoutEventListeners()` (řádky 31-34)
    - Přidán cleanup pro daySwipeController
  - Integrace do `renderSingleDayLayout()` (řádek 150)
    - Volání `initDaySwipeNavigation('horizontal')`
  - Integrace do `renderCardLayout()` (řádek 466)
    - Volání `initDaySwipeNavigation('vertical')`
    - Koexistence s horizontálním swipe pro karty
  - Integrace do `renderCompactListLayout()` (řádek 943)
    - Volání `initDaySwipeNavigation('horizontal')`

### Technické detaily

**Směrová detekce:**
| Layout | Směr | Gesto | Akce |
|--------|------|-------|------|
| card-view | vertikální | Swipe ↑ | Další den (+1) |
| card-view | vertikální | Swipe ↓ | Předchozí den (-1) |
| single-day | horizontální | Swipe ← | Další den (+1) |
| single-day | horizontální | Swipe → | Předchozí den (-1) |
| compact-list | horizontální | Swipe ← | Další den (+1) |
| compact-list | horizontální | Swipe → | Předchozí den (-1) |

**Prevence konfliktů v card-view:**
```javascript
// Horizontální swipe (karty): diffX > diffY
// Vertikální swipe (dny): diffY > diffX
// Vzájemně se nevylučují - každý spouští svůj směr
```

**Wrapping algoritmus:**
```javascript
const newDay = (currentDay + dayDirection + 5) % 5;
// Pátek (4) + 1 = (4 + 1 + 5) % 5 = 10 % 5 = 0 (Pondělí)
// Pondělí (0) - 1 = (0 - 1 + 5) % 5 = 4 % 5 = 4 (Pátek)
```

**Event listener flags:**
- `passive: true` pro touchstart/touchend (bez preventDefault)
- `passive: false` pro touchmove (potřebuje preventDefault pro blokování scrollu)
- Všechny používají `signal` pro cleanup přes AbortController

**Threshold & detekce:**
- Minimální vzdálenost swipe: 50 pixelů
- Větší než swipe karet (30px) - předchází nechtěným změnám
- Swipe musí být primárně v očekávaném směru (diffX vs diffY)

### Vizuální změny
- Žádné vizuální změny UI - čistě funkční vylepšení
- Stávající tlačítka dnů (Po, Út, St, Čt, Pá) fungují stejně
- Přidána neviditelná touch navigace pro rychlejší ovládání

### Výhody
- ✅ Přirozená mobilní navigace - swipe gesta odpovídají očekávanému chování
- ✅ Rychlejší přepínání dní než klikání na tlačítka
- ✅ Konzistentní s existujícím swipe chováním v card-view (karty hodin)
- ✅ Kruhová navigace - není nutné vracet se zpět přes celý týden
- ✅ Žádné konflikty mezi různými směry swipe (horizontální vs vertikální)
- ✅ Správný cleanup event listenerů - bez memory leaks
- ✅ Funguje pouze na touch zařízeních (mobil, tablet)
- ✅ Desktop používá klasická tlačítka (zachována původní funkcionalita)

### Edge cases
- **Week-view**: NEZÍSKÁVÁ swipe (zobrazuje všechny dny najednou, žádný day selector)
- **Krátké swipes**: < 50px threshold = žádná změna dne
- **Diagonální swipes**: Spouští se pouze pokud je swipe primárně v očekávaném směru
- **Rychlé swipes**: Každý touchend volá selectDay, který řídí state updates
- **Prázdný rozvrh**: Swipe funguje i když není žádná výuka (empty state)

### Modifikované soubory
- `public/js/timetable.js` - export selectDay funkce
- `public/js/layout-renderers.js` - swipe navigace, cleanup, integrace do layoutů

---

## [1.7.12] - 2026-01-07
### feat(layouts): časové zvýraznění hodin v card-view a compact-list

### Přidáno
- **Časové zvýraznění aktuálních, nadcházejících a proběhlých hodin v card-view a compact-list**
  - Dříve: Časové zvýraznění (červená pro aktuální, oranžová pro nadcházející, zešednutí pro proběhlé) fungovalo pouze v týdenním a denním zobrazení
  - Problém: V layoutech "Karty" a "Seznam" nebylo vidět, která hodina právě probíhá nebo už proběhla
  - Nyní: Všechny layouty používají jednotné časové zvýraznění
  - Konzistentní UX napříč všemi pohledy

### Změněno
- **`public/js/layout-renderers.js`**:
  - Import funkcí `getCurrentHour`, `getUpcomingHour`, `isPastLesson`, `getTodayIndex` z utils.js (řádek 12)
  - Card View - renderCardLayout() (řádky 313-327):
    - Přidána logika pro časové zvýraznění
    - Kontrola `selectedScheduleType === 'actual'` - zvýraznění jen v aktuálním rozvrhu
    - Aplikace CSS tříd `.current-time`, `.upcoming`, `.past` na `.lesson-card-full`
  - Compact List - renderSingleCompactLesson() (řádky 581-594):
    - Přidána logika pro časové zvýraznění single lessons
    - Aplikace CSS tříd na `.compact-lesson-item`
  - Compact List - renderSplitCompactLessons() (řádky 655-668):
    - Přidána logika pro časové zvýraznění skupinových hodin
    - Aplikace CSS tříd na `.compact-lesson-item.compact-lesson-split`

- **`public/css/layout-card-view.css`**:
  - Nové CSS pro časové zvýraznění (řádky 42-56):
    - `.lesson-card-full.current-time`: Červený gradient pozadí, červený border
    - `.lesson-card-full.upcoming`: Oranžový gradient pozadí, oranžový border
    - `.lesson-card-full.past`: Zešednuté pozadí, opacity 0.65

- **`public/css/layout-compact-list.css`**:
  - Rozšířené CSS pro časové zvýraznění skupinových hodin (řádky 243-255):
    - `.compact-lesson-item.current-time .compact-lesson-half`: Červený gradient pro jednotlivé skupinové boxy
    - `.compact-lesson-item.upcoming .compact-lesson-half`: Oranžový gradient pro jednotlivé skupinové boxy
    - Řešení problému překrývání pozadí u split lessons

### Opraveno
- **Časové zvýraznění nefungovalo u skupinových hodin v compact-list** (VIZUÁLNÍ BUG)
  - Problém: `.compact-lesson-half` mělo vlastní solid pozadí, které překrývalo gradient pozadí rodiče
  - Důsledek: U hodin se dvěma/více skupinami se nezobrazovalo červené/oranžové zvýraznění
  - Řešení: Přidány specifické CSS styly pro `.compact-lesson-half` uvnitř `.current-time` a `.upcoming` rodičů
  - Nyní funguje zvýraznění i u split lessons (více skupin ve stejné hodině)

### Technické detaily
**Logika časového zvýraznění:**
- Aplikuje se pouze pro `state.selectedScheduleType === 'actual'` (aktuální rozvrh, ne stálý)
- Ignoruje zrušené/nahrazené hodiny (`!isRemovedOrAbsent`, `!allRemoved`)
- Kontroluje:
  1. **Current time** - den === dnes && hodina === aktuální hodina
  2. **Upcoming** - den === dnes && hodina === nadcházející hodina && není aktuální
  3. **Past** - hodina již proběhla (porovnání dne a času konce hodiny)

**CSS hierarchie pro compact-list split lessons:**
- Parent `.compact-lesson-item` má gradient pozadí
- Children `.compact-lesson-half` mají vlastní solid pozadí `var(--card-bg)`
- Řešení: Specifické selektory `.compact-lesson-item.current-time .compact-lesson-half` s gradientem

### Vizuální změny
**Card View:**
- Aktuální hodina: Červený gradient pozadí + červený border (2px)
- Nadcházející hodina: Oranžový gradient pozadí + oranžový border (2px)
- Proběhlé hodiny: Zešednuté pozadí, snížená opacity (0.65)

**Compact List:**
- Single lessons: Stejné zvýraznění jako v card-view
- Skupinové hodiny (split): Gradient aplikován na jednotlivé `.compact-lesson-half` boxy
- Proběhlé hodiny: Celý item má sníženou opacity (0.5)

### Výhody
- ✅ Konzistentní časové zvýraznění napříč všemi layouty
- ✅ Jasná vizuální indikace aktuální hodiny (červená)
- ✅ Upozornění na nadcházející hodinu (oranžová)
- ✅ Zešednutí proběhlých hodin pro lepší orientaci
- ✅ Funguje i u hodin s více skupinami (split lessons)
- ✅ Automatická aktualizace bez nutnosti refresh stránky

### Modifikované soubory
- `public/js/layout-renderers.js` - časová logika pro card-view a compact-list
- `public/css/layout-card-view.css` - CSS styly pro časové zvýraznění
- `public/css/layout-compact-list.css` - CSS styly včetně fix pro split lessons

---

## [1.7.11] - 2026-01-04
### feat(layouts): skupinové hodiny vedle sebe v compact-list + zkratky předmětů

### Změněno (Update 3 - Zjednodušení layoutu split lekcí)
- **Přepracován layout split lekcí pro lepší čitelnost**
  - Předmět zvětšen z 0.95rem na 1.1rem (desktop) a z 0.85rem na 0.95rem (mobile)
  - Učitel a místnost nyní těsně pod předmětem (ne až dole)
  - Vše zarovnáno vlevo podobně jako u single lessons
  - Větší mezera pod předmětem (6px místo 2px)
  - Details zvětšeny z 0.75rem na 0.8rem pro lepší čitelnost

- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-half .compact-lesson-subject`:
    - Zvětšení `font-size: 0.95rem` → `1.1rem`
    - Zvětšení `margin-bottom: 2px` → `6px`
  - `.compact-lesson-half .compact-lesson-details`:
    - Odstranění `margin-top: auto`
    - Změna `align-items: center` → `align-items: flex-start`
    - Přidán `align-self: flex-start`
    - Zvětšení `font-size: 0.75rem` → `0.8rem`
  - `.compact-lesson-half .compact-detail-icon`:
    - Zvětšení z 14px na 15px
  - Mobile responsive:
    - Subject zvětšen z 0.85rem na 0.95rem
    - Details zvětšeny z 0.7rem na 0.75rem

### Změněno (Update 2 - Vylepšení layoutu split lekcí)
- **Přepracován layout `.compact-lesson-half` v compact-list**
  - **Skupina badge** → pravý horní roh (absolute positioning)
  - **Zkratka předmětu** → levý horní roh (align-self: flex-start)
  - **Učitel a místnost** → uprostřed dole (margin-top: auto)
  - **Badge + čas vlevo** → vertikálně vycentrovaný (align-self: center)

- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-meta` - přidán `align-self: center` pro vertikální centrování
  - `.compact-lesson-half`:
    - Změna `overflow: hidden` → `overflow: visible`
    - Upravený padding `10px 12px 12px 12px`
  - `.compact-lesson-half .compact-lesson-subject`:
    - Změna `text-align: center` → `text-align: left`
    - Přidán `align-self: flex-start` pro zarovnání vlevo
    - Přidán `max-width: calc(100% - 50px)` pro prostor pro badge
  - `.compact-lesson-half .compact-lesson-details`:
    - Přidán `margin-top: auto` pro posunutí na spodek
  - `.compact-lesson-half .compact-group-badge`:
    - Změna `position: relative` → `position: absolute`
    - Pozice `top: 6px; right: 6px`
  - Mobile responsive:
    - `.compact-lesson-half` padding `8px 10px 10px 10px`
    - `.compact-group-badge` pozice `top: 4px; right: 4px`, menší velikosti

### Přidáno
- **Skupinové hodiny side-by-side v compact-list layoutu**
  - Dříve: Skupiny ve stejné hodině (např. 1.sk a 2.sk) zobrazovaly oddělené řádky pod sebou
  - Nyní:
    - 2 skupiny = zobrazení vedle sebe (side-by-side)
    - 3+ skupiny = zobrazení pod sebou (vertikální stack)
  - Vizuálně odlišené pomocí boxů s hranicemi
  - Každá skupina samostatně klikatelná pro detail

- **Zkratky názvů předmětů**
  - Použití funkcí `abbreviateSubject()` z utils.js
  - Příklady: "Programování" → "PRG", "Praxe" → "PRX", "Tělesná výchova" → "TV"
  - Úspora místa a lepší čitelnost

- **Nový layout pro compact-list**
  - Badge hodiny (číslo) + čas pod sebou vlevo
  - Badge menší (36px místo 44px)
  - Čas v menší velikosti pod badge
  - Vertikální meta kontejner pro konzistentní zarovnání

### Změněno
- **`public/js/layout-renderers.js`**:
  - Import `abbreviateSubject` z utils.js (řádek 12)
  - Nové funkce:
    - `renderEmptyLesson(hour)` - rendering volné hodiny s novým layoutem
    - `renderSingleCompactLesson(lesson)` - rendering jedné lekce
    - `renderSplitCompactLessons(lessons, isVertical)` - rendering skupinových hodin
  - Refaktor `renderCompactListLayout()` hlavního loopu:
    - 0 lekcí → renderEmptyLesson()
    - 1 lekce → renderSingleCompactLesson()
    - 2 lekce → renderSplitCompactLessons(lessons, false) - side-by-side
    - 3+ lekcí → renderSplitCompactLessons(lessons, true) - vertikální
  - Nové click listeners:
    - Single lessons: celý item klikatelný
    - Split lessons: každý half samostatně klikatelný

- **`public/css/layout-compact-list.css`**:
  - `.compact-lesson-meta` - nový kontejner pro badge + čas vertikálně
  - `.compact-badge-small` - menší badge (36px, font 1rem)
  - `.compact-time-small` - menší čas (0.7rem)
  - `.compact-lessons-split-container` - flexbox kontejner pro split
  - `.compact-lesson-half` - jednotlivé poloviny pro skupiny
  - `.compact-lesson-split-vertical` - vertikální layout pro 3+ skupiny
  - Removed/changed styling pro split lessons
  - Mobile responsive (menší velikosti na <768px)

### HTML Struktura
**Single lesson:**
```html
<div class="compact-lesson-item">
  <div class="compact-lesson-meta">
    <div class="compact-lesson-badge compact-badge-small">4</div>
    <div class="compact-lesson-time compact-time-small">10:50-11:35</div>
  </div>
  <div class="compact-lesson-content">...</div>
</div>
```

**Split lessons (2 skupiny):**
```html
<div class="compact-lesson-item compact-lesson-split">
  <div class="compact-lesson-meta">...</div>
  <div class="compact-lessons-split-container">
    <div class="compact-lesson-half">PRG [1.sk]</div>
    <div class="compact-lesson-half">PRX [2.sk]</div>
  </div>
</div>
```

### Výhody
- ✅ Lepší využití prostoru - skupiny vedle sebe místo pod sebou
- ✅ Jasné vizuální oddělení skupin pomocí boxů
- ✅ Zkratky předmětů → více informací na menším prostoru
- ✅ Menší badge a čas → více prostoru pro obsah
- ✅ Konzistentní layout napříč všemi lekcemi
- ✅ 3+ skupiny automaticky stack vertikálně pro čitelnost
- ✅ Každá skupina samostatně klikatelná
- ✅ Mobile responsive design

### Technické detaily
- Split detekce: `lessons.length > 1`
- Vertical mode: `lessons.length > 2`
- Badge velikost: 44px → 36px (desktop), 40px → 32px (mobile)
- Čas pozice: horizontálně vedle → vertikálně pod badge
- Zkratky fallback: extrahuje velká písmena nebo ořezává s "..."

---

## [1.7.10] - 2026-01-04
### feat(layouts): zkrácená jména učitelů v card-view a compact-list

### Přidáno
- **Zkrácená jména učitelů stejně jako v týdenním a denním rozvrhu**
  - Dříve: V kartách a seznamu byla zobrazena plná jména s tituly (např. "Ing. Kamila Kozakovičová")
  - Nyní: Zobrazují se zkrácená jména ve formátu "K. Kozakovičová"
  - Konzistentní napříč všemi layouty (týden, den, karty, seznam)

### Změněno
- **`public/js/layout-renderers.js`**:
  - Import funkce `abbreviateTeacherName` z utils.js (řádek 12)
  - Card View - renderSingleLesson() (řádek 112): Použití `abbreviateTeacherName(lesson.teacher, state.teacherAbbreviationMap)`
  - Card View - renderSplitLessons() (řádek 180): Použití `abbreviateTeacherName(lesson.teacher, state.teacherAbbreviationMap)`
  - Compact List (řádek 630): Použití `abbreviateTeacherName(lesson.teacher, state.teacherAbbreviationMap)`

### Výhody
- ✅ Konzistentní zobrazení jmen učitelů napříč všemi layouty
- ✅ Úspora místa v kartách a seznamu
- ✅ Lepší čitelnost na mobilních zařízeních
- ✅ Sjednocení UX s týdenním a denním zobrazením

---

## [1.7.9] - 2026-01-04
### feat(layouts): zobrazování volných hodin v card-view a compact-list

### Přidáno
- **Zobrazování volných hodin mezi hodinami s výukou**
  - Dříve: Když měl student hodiny 6, 8, 9 (s volnou 7. hodinou), v kartách se přeskočilo z 6 přímo na 8
  - Problém: Uživatel nevěděl, že má mezi hodinami volno
  - Nyní: Zobrazují se všechny hodiny od první do poslední (minHour až maxHour), včetně volných
  - Volné hodiny jsou vizuálně odlišené a označené jako "Volno"

### Změněno
- **Card View (`renderCardLayout` v layout-renderers.js)**:
  - Výpočet rozsahu hodin z vybraného dne: `minHour` a `maxHour` (řádky 220-223)
  - Vytvoření seznamu všech hodin včetně volných: `allHoursList` (řádky 265-268)
  - Rendering prázdných hodin s ikonou kalendáře a textem "Volno" (řádky 288-306)
  - Opravena navigace (dots a buttons) pro správný počet karet včetně volných (řádky 333-347)
  - Prázdné karty nejsou klikatelné: `.lesson-card-full:not(.empty-lesson-card)` (řádek 495)

- **Compact List (`renderCompactListLayout` v layout-renderers.js)**:
  - Výpočet rozsahu hodin z vybraného dne: `minHour` a `maxHour` (řádky 545-548)
  - Rendering všech hodin včetně volných v for cyklu (řádky 581-651)
  - Prázdné hodiny s odlišným stylingem a textem "Volno" (řádky 584-599)
  - Opraveny click listeners pro neprázdné položky: `.compact-lesson-item:not(.compact-empty-lesson)` (řádky 657-670)

- **CSS styling pro prázdné hodiny**:
  - **layout-card-view.css** (řádky 354-392):
    - `.empty-lesson-card`: Přerušovaný border, snížená opacity 0.75, cursor default
    - `.empty-lesson-content`: Centrovaný layout s ikonou a textem
    - `.empty-lesson-text`: Italický text "Volno" s opacity 0.6
  - **layout-compact-list.css** (řádky 206-229):
    - `.compact-empty-lesson`: Přerušovaný border, opacity 0.6, cursor default
    - `.compact-empty-badge`: Šedý gradient místo oranžového
    - `.compact-empty-subject`: Italický text s opacity 0.6

### Technické detaily
**Výpočet rozsahu hodin:**
- Dříve: `allHours = [...new Set(data.map(d => d.hour))]` - všechny hodiny z celého rozvrhu
- Nyní: `allHours = [...new Set(dayLessons.map(d => d.hour))]` - pouze z vybraného dne
- `minHour = Math.min(...allHours)` - první hodina s výukou
- `maxHour = Math.max(...allHours)` - poslední hodina s výukou
- `for (let hour = minHour; hour <= maxHour; hour++)` - všechny hodiny v rozsahu

**Edge cases:**
- Kompletně prázdný rozvrh (`maxHour < 0`): Zobrazí se "Žádná výuka"
- Event listeners: Prázdné hodiny NEJSOU klikatelné
- Navigace: Počet karet odpovídá všem hodinám včetně volných

### Výhody
- ✅ Uživatel vidí kompletní rozvrh dne včetně volných hodin
- ✅ Jasná vizuální indikace volného času (přerušovaný border, ikona)
- ✅ Konzistentní napříč card-view i compact-list layouty
- ✅ Lepší orientace v rozvrhu dne

### Modifikované soubory
- `public/js/layout-renderers.js` - výpočet minHour/maxHour, rendering volných hodin, oprava navigace
- `public/css/layout-card-view.css` - styling pro prázdné karty
- `public/css/layout-compact-list.css` - styling pro prázdné položky

---

## [1.7.8] - 2026-01-03
### feat(ui): responzivní logo pomocí HTML5 `<picture>` elementu

### Přidáno
- **Responzivní logo systém s automatickým přepínáním**
  - Desktop/Tablet (>768px): Dlouhé logo (`spsd_long_white.png`, `spsd_long_dark.png`)
  - Mobile (≤768px): Krátké logo (`spsd_logo_white.png`, `spsd_logo_dark.png`)
  - Použit HTML5 `<picture>` element s `<source>` media queries
  - Pouze 2 elementy v DOM místo 4 (čistší HTML)
  - Zachována podpora dark/light theme u obou verzí

### Změněno
- **`public/index.html`** (řádky 32-41):
  - Použit `<picture>` element místo 4 samostatných `<img>` tagů
  - Dark mode logo: `<source media="(max-width: 768px)" srcset="spsd_logo_white.png">` + fallback `spsd_long_white.png`
  - Light mode logo: `<source media="(max-width: 768px)" srcset="spsd_logo_dark.png">` + fallback `spsd_long_dark.png`
  - Responzivita řešena nativně v HTML, ne přes CSS display: none

- **`public/css/header.css`** (řádky 37-70):
  - Zjednodušený CSS - odstraněna pravidla pro `.logo-long` a `.logo-short`
  - Přidáno `.logo img { height: 100%; width: auto; }` pro správné škálování
  - Media query jen pro změnu velikosti: `@media (max-width: 768px) { .logo { height: 40px; } }`
  - Zachována dark/light theme logika (`[data-theme="light"]`)

- **`public/css/mobile.css`** (řádky 29-32):
  - Odstraněno `height: 40px` (nyní v header.css media query)
  - Zachováno jen `position: absolute; left: 0;` pro pozicování na mobilu

### Technické detaily
**HTML5 `<picture>` element:**
```html
<picture class="logo logo-dark">
    <source media="(max-width: 768px)" srcset="spsd_logo_white.png">
    <img src="spsd_long_white.png" alt="SPŠD Logo">
</picture>
```
- Browser automaticky vybere správný obrázek podle media query
- Žádné zbytečné requesty na nepoužité obrázky
- Nativní HTML řešení bez CSS hacků

**Výhody oproti CSS display: none:**
1. **Performance**: Browser načte jen 1 obrázek (long nebo short), ne oba
2. **Čistší DOM**: Pouze 2 `<picture>` elementy místo 4 `<img>` tagů
3. **Sémantičtější**: `<picture>` je přesně pro responzivní obrázky navržený
4. **Jednodušší CSS**: Méně pravidel, žádné `.logo-long` / `.logo-short` třídy

### Výhody
- ✅ Lepší využití prostoru na mobilu (kratší logo se lépe vejde)
- ✅ Profesionálnější vzhled na desktopu (dlouhé logo s plným názvem)
- ✅ Nativní HTML5 responzivní řešení (standardní přístup)
- ✅ Lepší performance - načítá se jen potřebný obrázek
- ✅ Zachována podpora dark/light theme
- ✅ Čistší HTML a jednodušší CSS

---

## [1.7.7] - 2026-01-03
### feat(ui): dynamická outage banner s časem posledního fetch

### Změněno
- **Outage banner nyní zobrazuje čas posledních dat**
  - Dříve: Zobrazoval generickou zprávu "Alfa verze systému"
  - Nyní: "Bakaláři nedostupní - data z HH:MM" když API nefunguje
  - Dynamicky načítá `lastPrefetch` timestamp z Firebase
  - Zobrazuje přesný čas posledního úspěšného fetchnání dat

### Modifikované soubory
- **`public/index.html`** (řádek 130):
  - Přidáno `id="outageBannerText"` na `<span>` pro dynamickou aktualizaci
  - Změněn výchozí text z "Alfa verze..." na "Bakaláři nedostupní..."

- **`public/js/main.js`** (řádky 10, 57-77, 163, 176):
  - Import `getLastUpdateTime` z firebase-client.js
  - Nová funkce `updateOutageBannerText()`:
    - Načítá `lastPrefetch` timestamp z Firebase metadata kolekce
    - Formátuje čas ve formátu HH:MM (padded)
    - Aktualizuje text banneru: "Bakaláři nedostupní - data z {čas}"
    - Fallback: "Bakaláři nedostupní - zobrazuji uložená data" pokud timestamp chybí
  - Volá se automaticky při zobrazení banneru (Bakaláři API je down)
  - Volá se periodicky každé 2 minuty při kontrole statusu

### Výhody
- ✅ Uživatel vidí, jak stará data zobrazuje
- ✅ Transparentnější informace o stavu systému
- ✅ Automatická aktualizace času při každé kontrole API statusu
- ✅ Graceful fallback pokud timestamp není dostupný

---

## [1.7.6] - 2026-01-03
### fix(ui): konzistence modal headers a zavíracích tlačítek

### Opraveno
- **Zavírací tlačítka v modálech**
  - Problém: `&times;` mělo velký hover background (36x36px) který neseděl k velikosti X
  - Oprava: Nahrazeno SVG ikonami (24x24px) sjednocenými napříč všemi modály
  - Padding: 8px, border-radius: 8px (konzistentní s base modal-close class)
  - Hover background přesně sedí kolem ikony X
  - Konzistentní rotace (90deg) při hoveru

- **Chybějící ikony v headerech**
  - Settings modal: Přidána ikona user-cog (👤⚙️) - lépe vystihuje uživatelská nastavení
  - Layout modal: Přidána ikona rozvržení (⊞ grid)
  - Notifications modal: Již mělo ikonu zvonečku (🔔)

- **Nekonzistentní barvy napříč modály**
  - Dříve: Settings a Layout měly hardcoded modrý gradient (#002B4F)
  - Nyní: Všechny modály používají CSS proměnné
  - `var(--header-bg)` a `var(--sidebar-accent)` pro gradient
  - `var(--text-main)` pro text, `var(--text-dim)` pro close button
  - Theme-aware: Automaticky se přizpůsobí světlému/tmavému režimu

- **Nekonzistentní font sizes v headerech**
  - Sjednoceno: `font-size: 1.5rem`, `font-weight: 700`
  - Odstraněno: `letter-spacing`, `font-weight: 800`
  - Přidáno: `display: flex`, `align-items: center` pro správné zarovnání ikon

### Modifikované soubory
- **`public/index.html`**:
  - Settings modal (řádky 338-351): Přidána ikona a SVG close button
  - Layout modal (řádky 424-439): Přidána ikona a SVG close button

- **`public/css/settings.css`** (řádky 32-70):
  - Header: CSS proměnné místo hardcoded barev
  - Close button: Zmenšeno z 36px na 32px, SVG místo &times;
  - Přidán border-bottom a theme transitions

- **`public/css/layout-modal.css`** (řádky 13-51):
  - Header: CSS proměnné místo hardcoded barev
  - Close button: Zmenšeno z 36px na 32px, SVG místo &times;
  - Přidán border-bottom a theme transitions

### Výhody
- ✅ Konzistentní UX napříč všemi modály
- ✅ Přesnější hover targeting na close buttonu
- ✅ Theme-aware barvy (automatické přizpůsobení)
- ✅ Lepší vizuální hierarchie s ikonami v headerech
- ✅ Menší, elegantnější close button

---

## [1.7.5] - 2026-01-03
### feat(ui): přesun footeru do nastavení a skrytí refresh tlačítka

### Změněno
- **Footer přesunut do nastavení na mobilu**
  - Desktop (>768px): Footer zůstává viditelný dole na stránce
  - Mobile (≤768px): Footer skrytý ze stránky, zobrazen na konci settings modalu
  - Obsah zůstává stejný: "Created by Štefan Barát" s odkazem na GitHub

- **Refresh button kompletně skrytý**
  - Manuální refresh tlačítko skryto na desktop i mobile
  - Auto-refresh (každých 10 minut) nadále funguje na pozadí
  - Uživatelé nemusí manuálně obnovovat rozvrh

### Modifikované soubory
- **`public/css/header.css`** (řádky 186-189):
  - Přidáno `display: none !important;` na `.refresh-btn`
  - Skrytí refresh buttonu na všech platformách

- **`public/css/footer.css`** (řádky 67-71):
  - V mobile media query změněno na `display: none;`
  - Footer skrytý jen na mobilu, desktop beze změny

- **`public/index.html`** (řádky 402-405):
  - Přidán `.settings-footer` div do settings modalu
  - Obsahuje stejný obsah jako původní footer
  - Umístěn na konci `.modal-content`

- **`public/css/settings.css`** (řádky 191-233):
  - Nové CSS pro `.settings-footer`
  - Top border pro oddělení (1px solid var(--border))
  - Centrovaný text, oranžový odkaz s hover efektem
  - GitHub ikona (16x16px SVG) před odkazem přes `::before`
  - Hover efekt: zvětšení ikony a rotace (scale 1.1, rotate 5deg)
  - Font-size: 0.85rem, color: var(--text-dim)

### Výhody
- ✅ Více prostoru na mobilu (footer nezabírá místo dole)
- ✅ Čistší UI bez manuálního refresh tlačítka
- ✅ Auto-refresh zajišťuje aktuálnost dat bez zásahu uživatele
- ✅ Desktop uživatelé mají stále snadný přístup k footeru
- ✅ Konzistentní zobrazení na všech platformách

---

## [1.7.4] - 2026-01-03
### fix(ui): optimalizace velikosti skupinových badge

### Opraveno
- **Velikost skupinového badge ve všech layoutech**
  - Problém: Badge byl příliš velký a zakrýval část karty (desktop i mobile)
  - Oprava: Optimalizována velikost, padding a font-size pro kompaktní zobrazení
  - Desktop: `font-size: 0.75rem`, `padding: 4px 8px`, `border-radius: 6px`
  - Mobile: `font-size: 0.7rem`, `padding: 3px 7px`, `border-radius: 6px`
  - Přidáno `width: fit-content`, `height: auto`, `white-space: nowrap` pro zabránění roztažení přes celou výšku karty

### Modifikované soubory
- **`public/css/lesson-card.css`**:
  - `.lesson-group`: Optimalizována velikost (font-size: 0.85rem → 0.75rem, padding: 5px 10px → 4px 8px)
  - Přidáno `width: fit-content`, `height: auto`, `white-space: nowrap`

- **`public/css/layout-compact-list.css`**:
  - `.compact-group-badge`: Již optimalizováno v 1.7.3, přidány constraints pro správné rozměry

- **`public/css/mobile.css`**:
  - `.lesson-group`: Optimalizována velikost pro mobil (font-size: 0.75rem → 0.7rem, padding: 4px 8px → 3px 7px)
  - Přidáno `width: fit-content`, `height: auto`, `white-space: nowrap`, `border-radius: 6px`

### Dotčené platformy
- ✅ Desktop (PC)
- ✅ Mobile (mobilní zařízení)

---

## [1.7.3] - 2026-01-03
### fix(ui): přesunuta skupinová indikace do pravého horního rohu karty

### Změněno
- **Pozice skupinového badge (1.sk, 2.sk, atd.) přesunuta z dolního do horního pravého rohu**
  - Dříve: Skupinový indikátor byl v dolním pravém rohu (`bottom: 6px/8px`)
  - Nyní: Skupinový indikátor je v horním pravém rohu (`top: 6px/8px`)
  - Inteligentní pozicování: Pokud je přítomen i indikátor změny/zrušení hodiny, skupinový badge se automaticky posune níž, aby nedocházelo k překrytí

### Modifikované soubory
- **`public/css/lesson-card.css`**:
  - `.lesson-group`: Změněno `bottom: 6px` → `top: 6px`
  - Přidáno inteligentní pozicování při konfliktu s change/removed indikátory (`top: 34px`)

- **`public/css/layout-compact-list.css`**:
  - `.compact-group-badge`: Změněno `bottom: 8px` → `top: 8px`
  - Přidáno inteligentní pozicování při konfliktu s change indikátorem (`top: 38px`)

- **`public/css/mobile.css`**:
  - `.lesson-group`: Změněno `bottom: 4px` → `top: 4px`

### Dotčené layouty
- ✅ Week view (týdenní zobrazení)
- ✅ Single-day view (denní zobrazení)
- ✅ Compact list (seznam)

---

## [1.7.2] - 2025-12-30
### fix(ui): přidána ikona učitele do všech zobrazení rozvrhu

### Opraveno
- **Chybějící ikona učitele v týdenním, denním a compact list zobrazení** (UX BUG)
  - Dříve: Ikona učitele se zobrazovala pouze v kartovém zobrazení (card view)
  - Problém: Nekonzistentní UX - místnost měla ikonu, učitel ne
  - V normal view (týdenní/denní) byl učitel zobrazený pouze jako text bez ikony
  - V compact list view byl učitel zobrazený pouze jako text bez ikony
  - Nyní: SVG ikona učitele (osobička) se zobrazuje ve všech layoutech
  - Výsledek: Konzistentní zobrazení ikon napříč všemi pohledy

### Změněno
- **`public/js/layout-renderers.js`** (řádky 551-558):
  - `renderCompactListLayout()` - Compact list layout:
    - Přidán wrapper `<span class="compact-detail-item">` s SVG ikonou učitele
    - Ikona učitele nyní zobrazena stejně jako ikona místnosti
    - Použita stejná SVG ikona jako v card view (user icon - osobička)

- **`public/js/timetable.js`**:
  - Room view (řádky 387-395):
    - Přidán wrapper `<span class="lesson-detail-item">` s SVG ikonou učitele
    - Ikona zobrazena před zkráceným jménem učitele
  - Class view (řádky 404-412):
    - Přidán wrapper `<span class="lesson-detail-item">` s SVG ikonou učitele
    - Ikona zobrazena před zkráceným jménem učitele
    - Stejný vizuální styl jako ikona místnosti

### Vizuální konzistence
Ikona učitele je nyní jednotná napříč VŠEMI layouty:
- ✅ Card view (swipeable cards) - již fungovala
- ✅ Compact list (vertikální seznam) - **OPRAVENO**
- ✅ Week view (týdenní zobrazení) - **OPRAVENO**
- ✅ Single-day view (denní zobrazení) - **OPRAVENO**

### Modifikované soubory
- `public/js/layout-renderers.js` - přidána ikona učitele do compact list
- `public/js/timetable.js` - přidána ikona učitele do week/single-day view (Room a Class view)

---

## [1.7.1] - 2025-12-29
### fix(layouts): oprava blokovaného scrollu v týdenním zobrazení po přepnutí z karet

### Opraveno
- **Scroll nefungoval v týdenním/denním zobrazení po přepnutí z kartového layoutu** (KRITICKÝ BUG)
  - Dříve: Touch event listenery z card-view zůstávaly aktivní i po přepnutí na week-view/single-day
  - Problém: Touch listenery preventovaly default scroll behavior (`e.preventDefault()` v touchmove)
  - Výsledek: Horizontální scroll v týdenním zobrazení nefungoval, bylo nutné refreshnout browser
  - Nyní: Event listenery se čistí při každém přepnutí layoutu pomocí `cleanupLayoutEventListeners()`
  - Scroll v týdnu/dnu funguje normálně ✅

- **Scroll se resetoval i při načtení nových dat** (REGRESSION)
  - Dříve: Reset scrollu byl v `applyLayout()`, která se volá i při `loadTimetable()`
  - Problém: Při každém načtení dat (změna třídy) se scroll resetoval, i když uživatel scrolloval
  - Nyní: Reset scrollu POUZE v `switchLayout()` při explicitním přepnutí layoutu
  - Scroll se resetuje jen když to má ✅

### Změněno
- **`public/js/layout-renderers.js`** (řádky 17-29):
  - Nová exportovaná funkce `cleanupLayoutEventListeners()`
  - Abortuje `swipeController` a `navigationController` pro odstranění event listenerů
  - Nastaví controllery na `null` pro garbage collection

- **`public/js/layout-manager.js`** (řádky 88-97):
  - `switchLayout()`: Přidán cleanup event listenerů PŘED aplikací nového layoutu
  - `switchLayout()`: Přesunut reset scroll pozice ze `applyLayout()` sem
  - `applyLayout()`: Odstraněn reset scrollu (řádky 115-117 už neexistují)

### Technické detaily
**Problém 1 - Touch event listenery:**
1. Card-view používá touch listenery pro swipe navigaci (layout-renderers.js:384-441)
2. V `touchmove` event handleru: `if (diffX > diffY) e.preventDefault()` - blokuje default scroll
3. Listenery používají `AbortController` pro cleanup, ale `abort()` se nevolalo při přepnutí layoutu
4. Když se přepnulo Z card-view NA week-view, listenery zůstaly aktivní
5. Result: Horizontální scroll v týdenním zobrazení nefungoval

**Problém 2 - Reset scrollu:**
1. Reset scrollu byl v `applyLayout()` (layout-manager.js:115-117)
2. `applyLayout()` se volá i z `loadTimetable()` při načtení nových dat
3. Při každém načtení dat se scroll resetoval
4. Result: Uživatel nemohl scrollovat, protože se to neustále resetovalo

**Řešení:**
1. Vytvořit `cleanupLayoutEventListeners()` exportovanou funkci
2. Volat ji v `switchLayout()` PŘED aplikací nového layoutu
3. Přesunout reset scrollu ze `applyLayout()` do `switchLayout()`
4. Tím se cleanup i reset dějí POUZE při explicitním přepnutí layoutu

**Tok při přepnutí layoutu:**
```
User clicks layout button
  ↓
switchLayout('week-view')
  ↓
cleanupLayoutEventListeners() → abort card-view touch listeners ✅
  ↓
container.scrollLeft = 0 → reset scroll ✅
  ↓
applyLayout() → render week-view
  ↓
Week-view s funkčním scrollem bez blokování ✅
```

### Vizuální změny
- Scroll v týdenním/denním zobrazení funguje i po přepnutí z karet
- Scroll se neresetuje při načtení nových dat (změna třídy/učitele)
- Karty fungují normálně (swipe navigace)
- Původní bug fix (scroll se přenáší mezi layouty) zůstává funkční

### Modifikované soubory
- `public/js/layout-renderers.js` - přidána cleanup funkce
- `public/js/layout-manager.js` - přesunut reset scrollu a přidán cleanup do switchLayout()

---

## [1.7] - 2025-12-29
### fix(layouts): oprava scroll pozice a zarovnání ikon při přepínání layoutů

### Opraveno
- **Scroll pozice se přenášela mezi layouty** (BUG)
  - Dříve: Při horizontálním scrollu v týdenním/denním zobrazení a následném přepnutí na kartový layout zůstala scroll pozice uložená
  - Problém: Kartový layout se zobrazil posunutý doprava, karty nezačínaly od začátku
  - Nyní: Při každém přepnutí layoutu se resetuje `scrollLeft` i `scrollTop` na 0
  - Výsledek: Všechny layouty vždy začínají s čistou scroll pozicí

- **Ikona učitele moc daleko od textu u skupinových hodin v card-view** (UX)
  - Dříve: V kartovém layoutu u split lessons (skupinových hodin) byla mezera mezi ikonou učitele a textem 8px
  - Problém: Vizuálně příliš velká mezera, ikona působila odděleně od textu
  - Nyní: Mezera zmenšena na 4px specificky pro `.card-lesson-half .card-detail-item`
  - Výsledek: Kompaktnější a vizuálně příjemnější zobrazení detailů u skupinových hodin

### Změněno
- **`public/js/layout-manager.js`** (řádky 115-117):
  - `applyLayout()` funkce: Přidán reset scroll pozice
  - `container.scrollLeft = 0;` - Reset horizontálního scrollu
  - `container.scrollTop = 0;` - Reset vertikálního scrollu

- **`public/css/layout-card-view.css`** (řádek 180):
  - `.card-lesson-half .card-detail-item`: Přidán `gap: 4px`
  - Zmenšena mezera mezi ikonou a textem ze 8px na 4px pro split lessons

### Technické detaily
**Scénář bug 1 - scroll pozice:**
1. Uživatel otevře týdenní zobrazení s mnoha hodinami
2. Scrollne horizontálně doprava (`.timetable-container` má `overflow-x: auto`)
3. Přepne na kartový layout
4. **Bug:** Kartový layout byl posunutý, protože `scrollLeft` nebyl resetován
5. **Fix:** `scrollLeft` a `scrollTop` se resetují při každém přepnutí layoutu

**Scénář bug 2 - gap u ikony:**
1. Uživatel otevře kartový layout s grupovou hodinou (např. TVD 1.sk, 2.sk)
2. **Bug:** Ikona učitele byla vizuálně moc daleko od jména učitele
3. **Fix:** Gap zmenšen z 8px na 4px pro lepší kompaktnost

### Vizuální změny
- Kartový layout vždy začíná od první karty po přepnutí z jiného layoutu
- Ikony učitelů jsou blíže k textům u skupinových hodin
- Konzistentnější UX při přepínání mezi layouty

### Modifikované soubory
- `public/js/layout-manager.js` - reset scroll pozice
- `public/css/layout-card-view.css` - zmenšení gap u detail-item

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

