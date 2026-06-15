// Subject name abbreviations
export const subjectAbbreviations = {
    // IT předměty
    'Informační a komunikační technologie': 'IKT',
    'Programové vybavení': 'PV',
    'Databázové systémy': 'DBS',
    'Programování': 'PRG',
    'Hardware': 'HW',
    'Operační systémy': 'OS',
    'Kybernetická bezpečnost': 'KBS',
    'Datové sítě': 'DTS',
    'Počítačové sítě a síťová zařízení': 'PSZ',
    'Grafická tvorba': 'GTV',
    'CAD systémy': 'CAD',
    'Webové aplikace': 'WA',
    'Mobilní aplikace': 'MA',
    'Telekomunikace a sítě': 'TKS',

    // Elektro předměty
    'Elektrická měření': 'EM',
    'Elektronika': 'ELN',
    'Elektrotechnika': 'ELT',
    'Základy elektrotechniky': 'ZEL',
    'Automatizace': 'AUT',
    'Mikroprocesorová technika': 'MPT',
    'Digitální technika': 'DT',
    'Číslicová technika': 'ČT',

    // Základní předměty
    'Tělesná výchova': 'TV',
    'Matematika': 'MAT',
    'Anglický jazyk': 'AJ',
    'Německý jazyk': 'NJ',
    'Český jazyk a literatura': 'ČJ',
    'Občanská nauka': 'OBN',
    'Základy práva': 'ZP',
    'Dějepis': 'DEJ',
    'Fyzika': 'FYZ',
    'Chemie': 'CHE',
    'Biologie': 'BIO',
    'Biologie, ekologie a chemie': 'BECH',
    'Ekologie a chemie': 'ECH',
    'Ekologie': 'EKOL',
    'Zeměpis': 'ZEM',
    'Virtualizace': 'VIR',
    'Webdesign': 'WD',
    'Třídnická hodina': 'TH',

    // Odborné předměty
    'Ekonomika': 'EKO',
    'Ekonomika a finance': 'EF',
    'Ekonomika dopravy': 'ED',
    'Účetnictví': 'ÚČE',
    'Účetnictví na počítači': 'ÚNP',
    'Daně': 'DAN',
    'Obchodní psychologie': 'OP',
    'Praxe': 'PRX',
    'Učební praxe': 'UP',
    'Technické kreslení': 'TK',
    'Technická dokumentace': 'TD',
    'Technologie': 'TCH',
    'Strojnictví': 'STR',
    'Konstruování': 'KON',
    'Logistika': 'LOG',
    'Logistika a zasilatelství': 'LZ',
    'Doprava a přeprava': 'DP',
    'Dopravní zeměpis': 'DZ',
    'Dopravní telematika': 'DTel',
    'Dějiny dopravy': 'DD',
    'Moderní trendy v dopravě': 'MTD',
    'Městská a regionální hromadná doprava': 'MRHD',
    'Zabezpečovací systémy': 'ZS',
    'Úvod do automatizace': 'ÚA',
    'Bezpečnost v digitálním prostředí': 'BDP',

    // Ostatní
    'Konverzace v anglickém jazyce': 'Konv. AJ',
    'Seminář z matematiky': 'Sem. MAT',
    'Seminář z fyziky': 'Sem. FYZ',
    'Seminář k profilové maturitě': 'Sem. PM',
    'Seminář k maturitní zkoušce': 'Sem. MZ',
    'Projektování': 'PRJ',
    'Maturitní projekt': 'MP',
    'Sociální a profesní komunikace': 'SPK'
};

// Časová rozmezí hodin
export const lessonTimes = [
    { hour: 0, start: [7, 10], end: [7, 55], label: '7:10-7:55' },
    { hour: 1, start: [8, 0], end: [8, 45], label: '8:00-8:45' },
    { hour: 2, start: [8, 50], end: [9, 35], label: '8:50-9:35' },
    { hour: 3, start: [9, 45], end: [10, 30], label: '9:45-10:30' },
    { hour: 4, start: [10, 50], end: [11, 35], label: '10:50-11:35' },
    { hour: 5, start: [11, 40], end: [12, 25], label: '11:40-12:25' },
    { hour: 6, start: [12, 35], end: [13, 20], label: '12:35-13:20' },
    { hour: 7, start: [13, 25], end: [14, 10], label: '13:25-14:10' },
    { hour: 8, start: [14, 20], end: [15, 5], label: '14:20-15:05' },
    { hour: 9, start: [15, 10], end: [15, 55], label: '15:10-15:55' },
    { hour: 10, start: [16, 0], end: [16, 45], label: '16:00-16:45' },
    { hour: 11, start: [16, 50], end: [17, 35], label: '16:50-17:35' },
    { hour: 12, start: [17, 40], end: [18, 25], label: '17:40-18:25' }
];

export const days = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
export const daysShort = ['Po', 'Út', 'St', 'Čt', 'Pá'];

// Pixel metrics used to compute how large a layout-aware loading skeleton
// should be so it fills the viewport without overflowing.
export const SKELETON_METRICS = {
    ROW_HEIGHT: 64,
    GRID_ROW_HEIGHT: 88,
    COL_WIDTH: 180,
    HOUR_COL_WIDTH: 60,
    HEADER_HEIGHT: 56,
    GAP: 10,
    MIN_ROWS: 3,
    MAX_HOURS: lessonTimes.length, // 13
    MAX_DAYS: days.length // 5
};
