# Design: Oblíbené rozvrhy

**Datum:** 2026-03-05

## Shrnutí

Uživatel si může označit libovolný rozvrh (třída, učitel, učebna) jako oblíbený. Oblíbené se ukládají do Firestore pod existujícím user dokumentem. Rychlý přístup k oblíbeným je dostupný přes nové tlačítko v hlavičce.

## Datový model

Nové pole v existujícím user dokumentu ve Firestore:

```json
{
  "favoriteTimetables": [
    { "type": "Class", "id": "3.A" },
    { "type": "Teacher", "id": "KOZ" },
    { "type": "Room", "id": "04" }
  ]
}
```

Oddělené od `watchedTimetables` (notifikace). Nezávislé.

## Backend

Nové API endpointy v `routes/`:

- `GET /api/favorites/:userId` — vrátí `favoriteTimetables[]`
- `POST /api/favorites/:userId` — uloží celý seznam (body: `{ favoriteTimetables }`)

Vzor konzistentní s existujícím `/api/fcm/preferences/:userId`.

## Frontend

### Nový modul: `public/js/favorites.js`

- `loadFavorites()` — načte z API, uloží do `state.favoriteTimetables`
- `saveFavorites(list)` — odešle na API
- `toggleFavorite(type, id)` — přidá/odebere, uloží
- `isFavorite(type, id)` — boolean check

### Změny v `state.js`

Přidat `favoriteTimetables: []` do výchozího stavu.

### UI — srdíčko v dropdownu

- Desktop (`dropdown.js`): každá `.custom-dropdown-option` dostane srdíčko tlačítko na pravé straně
- Mobile sheet (`dropdown.js` openMobileSheet): stejný vzor v rendered options listu
- Klik na srdíčko toggleuje oblíbenost bez zavření dropdownu
- Vizuál: vyplněné srdíčko = oblíbené, outline = není

### UI — indikátor ve spouštěči dropdownu

Pokud je aktuálně vybraný rozvrh oblíbený, zobrazí se malé vyplněné srdíčko vedle labelu v `#valueDropdownTrigger`.

### UI — tlačítko rychlého přístupu

- Nové tlačítko s ikonou srdíčka (`#favoritesBtn`) v `.dropdown-row`, před existujícím dropdownem
- Otevře bottom sheet `#favoritesModal`
- Flat list oblíbených bez kategorií: `3.A`, `3.C`, `Kozakovičová`, `04`
- Klik na položku: nastaví type + id, zavře sheet, načte rozvrh
- Pokud seznam prázdný: zobrazí "Zatím žádné oblíbené"

### Inicializace

`loadFavorites()` se zavolá v `main.js` v `init()` po `authenticateWithFirebase()`, paralelně s načítáním definic.

## Soubory ke změně

| Soubor | Změna |
|--------|-------|
| `routes/` | Nový soubor `favorites.js` s GET/POST endpointy |
| `index.js` | Registrace nové route |
| `public/js/favorites.js` | Nový modul |
| `public/js/state.js` | Přidat `favoriteTimetables: []` |
| `public/js/main.js` | Volat `loadFavorites()` při init |
| `public/js/dropdown.js` | Srdíčka u položek, indikátor v triggeru |
| `public/index.html` | Tlačítko `#favoritesBtn`, bottom sheet `#favoritesModal` |
| `public/css/` | Nový `favorites.css` pro srdíčka a modal |
