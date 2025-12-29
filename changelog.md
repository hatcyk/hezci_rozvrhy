# Changelog

Všechny změny v projektu budou zaznamenány v tomto souboru.

Formát verzování: +0.1 pro menší změny, +1.0 pro větší změny.

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