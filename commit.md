feat: přidání systému výběru layoutů pro mobilní zobrazení rozvrhu

Implementován modulární systém pro výběr různých layoutů rozvrhu v mobilní
aplikaci s Registry Pattern architekturou.

Nové layouty:
- Denní zobrazení - zobrazení jednoho vybraného dne (výchozí)
- Celý týden - zobrazení všech 5 pracovních dní v tabulce
- Karta - swipeable cards s navigation buttons a dots
- Kompaktní seznam - seznam lekcí pod sebou s scroll persistence

Implementace:
- Vytvoření layout registry pro centrální správu layoutů
- Layout manager pro přepínání a persistence v localStorage
- Rendering funkce pro každý layout typ
- Migrace z deprecated showWholeWeek na nový layoutMode systém
- Nahrazení "Zobrazit celý týden" tlačítka v nastavení za "Layout" sekci
- Layout selection modal s vizuálním výběrem

Technické detaily:
- Swipe gestures pro card view (touchstart/touchmove/touchend)
- Scroll position persistence pro compact list
- Modulární architektura umožňující snadné přidání dalších layoutů
- CSS pro všechny nové layouty (modal, card view, compact list)
- Zpětná kompatibilita s původním showWholeWeek stavem

Nové soubory:
- public/js/layout-registry.js
- public/js/layout-manager.js
- public/js/layout-renderers.js
- public/css/layout-modal.css
- public/css/layout-card-view.css
- public/css/layout-compact-list.css

Modifikované soubory:
- public/index.html
- public/js/settings.js
- public/js/state.js
- public/js/timetable.js
- public/js/main.js