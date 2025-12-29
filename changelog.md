# Changelog

Všechny změny v projektu budou zaznamenány v tomto souboru.

Formát verzování: +0.1 pro menší změny, +1.0 pro větší změny.

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

