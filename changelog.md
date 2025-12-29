# Changelog

Všechny změny v projektu budou zaznamenány v tomto souboru.

Formát verzování: +0.1 pro menší změny, +1.0 pro větší změny.

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