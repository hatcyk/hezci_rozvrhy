// Syntetická škola pro end-to-end testy (převzato z ověřovacího skriptu fáze 2).
// Žádná skutečná jména: smyšlení vyučující, obecné třídy a učebny.
// Agregáty skládá skutečný backend/aggregates.js (smlouva S3), takže testy
// ověřují i to, že frontend rozumí přesně tomu, co zapisuje prefetch.
const { buildChangesAggregate, buildFreeRoomsAggregate } = require('../../../backend/aggregates.js');

const CLASSES = [['C1A', '1.A'], ['C2A', '2.A'], ['C2B', '2.B'], ['C3C', '3.C'], ['C4D', '4.D'], ['C10A', '10.A']];
const TEACHERS = [
  ['T1', 'Mgr. Jana Ukázková'], ['T2', 'Ing. Petr Vzorový'], ['T3', 'Mgr. Eva Testová'], ['T4', 'Karel Příkladný'],
  ['T5', 'Mgr. Olga Smyšlená'], ['T6', 'Ing. Tomáš Pokusný'], ['T7', 'Irena Modelová'], ['T8', 'Adam Šablonový'],
  ['T9', 'Mgr. Marta Cvičná'], ['T10', 'Libor Návrhový'],
];
const ROOMS = [['R11', 'U11'], ['R12', 'U12'], ['R15', 'U15'], ['RL1', 'LAB1'], ['RL2', 'LAB2'], ['RA1', 'A101'], ['RA2', 'A102'], ['RTV', 'TV1']];
const SUBJ = ['Matematika', 'Fyzika', 'Programování', 'Český jazyk a literatura', 'Anglický jazyk', 'Databázové systémy', 'Dějepis', 'Elektrotechnika'];
// Testy běží ve středu 4. 11. 2026: aktuální týden začíná 2. 11., příští 9. 11.
const WEEK = { Actual: '2026-11-02', Next: '2026-11-09' };
const DAYN = ['po', 'út', 'st', 'čt', 'pá'];
const GENERATED_AT = '2026-11-04T06:55:00.000Z';

const dateOf = (week, day) => {
  const d = new Date(`${WEEK[week]}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
};
const tName = (id) => TEACHERS.find(t => t[0] === id)[1];
const rName = (id) => ROOMS.find(r => r[0] === id)[1];

function buildPermanent() {
  // Každá třída 1.–6. hodina (2.A do 7.), učitel ani učebna nejsou ve slotu dvakrát.
  const permanent = {};
  for (const [cid] of CLASSES) permanent[cid] = [];
  for (let day = 0; day < 5; day++) {
    for (let hour = 1; hour <= 7; hour++) {
      CLASSES.forEach(([cid], ci) => {
        if (hour === 7 && cid !== 'C2A') return;
        const t = TEACHERS[(ci * 3 + day * 2 + hour) % TEACHERS.length][0];
        const r = ROOMS[(ci + day + hour * 2) % (ROOMS.length - 1)][0];
        permanent[cid].push({ day, hour, t, r, subject: SUBJ[(ci + hour + day * 3) % SUBJ.length], group: null });
      });
    }
  }
  // Dělená hodina 2.A ve středu 6.: 1.sk + 2.sk
  const split = permanent.C2A.find(x => x.day === 2 && x.hour === 6);
  split.group = '1.sk';
  permanent.C2A.push({ day: 2, hour: 6, t: 'T10', r: 'RA2', subject: 'Databázové systémy', group: '2.sk' });
  // Kolize: učitel i učebna jsou ve slotu nejvýš jednou
  for (let day = 0; day < 5; day++) {
    for (let hour = 1; hour <= 7; hour++) {
      const used = new Set();
      const usedR = new Set();
      for (const [cid] of CLASSES) {
        for (const l of permanent[cid].filter(x => x.day === day && x.hour === hour)) {
          let k = 0;
          while (used.has(l.t)) l.t = TEACHERS[(TEACHERS.findIndex(t => t[0] === l.t) + 1 + k++) % TEACHERS.length][0];
          used.add(l.t);
          k = 0;
          while (usedR.has(l.r)) l.r = ROOMS[(ROOMS.findIndex(r => r[0] === l.r) + 1 + k++) % ROOMS.length][0];
          usedR.add(l.r);
        }
      }
    }
  }
  return permanent;
}

const lesson = (week, l, extra = {}) => ({
  day: l.day, dayName: DAYN[l.day], date: week ? dateOf(week, l.day) : null, hour: l.hour,
  subject: l.subject, teacher: tName(l.t), room: rName(l.r), group: l.group, theme: null,
  type: 'atom', changed: false, changeInfo: null, ...extra,
});
const removedCopy = (week, l) => lesson(week, l, { type: 'removed', changed: true, changeInfo: { raw: 'Hodina odpadla', description: 'Hodina odpadla' } });
const short = (id) => {
  const p = tName(id).replace(/^(Mgr\.|Ing\.)\s+/, '').split(' ');
  return `${p[1]} ${p[0]}`;
};

/** Týden se změnami: changes = [{ cid, day, hour, group?, kind, … }] */
function week(permanent, weekName, changes) {
  const out = {};
  for (const [cid] of CLASSES) {
    const list = [];
    for (const l of permanent[cid]) {
      const ch = changes.find(c => c.cid === cid && c.day === l.day && c.hour === l.hour && (c.group || null) === (l.group || null));
      if (!ch) { list.push(lesson(weekName, l)); continue; }
      if (ch.kind === 'sub') {
        const subject = ch.subject || l.subject;
        list.push(lesson(weekName, { ...l, t: ch.t, subject, r: ch.r || l.r }, {
          changed: true,
          changeInfo: { raw: 'Suplování', description: `Suplování: ${subject.slice(0, 3).toUpperCase()}, ${short(ch.t)} (${l.subject.slice(0, 3).toUpperCase()}, ${short(l.t)})` },
        }));
        list.push(removedCopy(weekName, l));
      } else if (ch.kind === 'room') {
        list.push(lesson(weekName, { ...l, r: ch.r }, { changed: true, changeInfo: { raw: 'Změna', description: `Změna místnosti: ${rName(l.r)} → ${rName(ch.r)}` } }));
      } else if (ch.kind === 'cancel') {
        list.push(lesson(weekName, l, { type: 'removed', changed: true, changeInfo: { raw: 'Zrušeno', description: `Zrušeno - ${ch.reason}` } }));
      } else if (ch.kind === 'absent') {
        list.push({ ...lesson(weekName, l), subject: 'Exkurze', teacher: '', room: null, type: 'absent', changed: true, changeInfo: { raw: 'Akce', description: 'Exkurze (EXK)' } });
      }
    }
    out[cid] = list;
  }
  return out;
}

/** Rozvrhy učitelů a učeben odvozené z rozvrhů tříd. */
function derive(byClass, key) {
  const out = {};
  for (const [cid, cname] of CLASSES) {
    for (const l of byClass[cid]) {
      if (l.type === 'absent') continue;
      const ownerId = key === 'teacher'
        ? (TEACHERS.find(t => t[1] === l.teacher) || [])[0]
        : (ROOMS.find(r => r[1] === l.room) || [])[0];
      if (!ownerId) continue;
      (out[ownerId] ||= []).push({ ...l, group: `${cname} ${l.group || 'celá'}` });
    }
  }
  return out;
}

/**
 * Dokumenty Firestore („cesta → data“) tak, jak je zapisuje prefetch.
 * @returns {{ docs: Record<string, object>, CLASSES, TEACHERS, ROOMS, WEEK }}
 */
function buildSchool() {
  const permanent = buildPermanent();
  const actual = week(permanent, 'Actual', [
    { cid: 'C2A', day: 2, hour: 3, kind: 'sub', t: 'T8', subject: 'Matematika' },
    { cid: 'C2A', day: 2, hour: 4, kind: 'room', r: 'RL2' },
    { cid: 'C2A', day: 2, hour: 5, kind: 'cancel', reason: 'Nemoc vyučujícího' },
    { cid: 'C2A', day: 2, hour: 6, group: '1.sk', kind: 'sub', t: 'T9' },
    { cid: 'C1A', day: 2, hour: 2, kind: 'sub', t: 'T7' },
    { cid: 'C1A', day: 2, hour: 5, kind: 'room', r: 'RA1' },
    { cid: 'C3C', day: 2, hour: 1, kind: 'absent' }, { cid: 'C3C', day: 2, hour: 2, kind: 'absent' }, { cid: 'C3C', day: 2, hour: 3, kind: 'absent' },
    { cid: 'C10A', day: 2, hour: 6, kind: 'cancel', reason: 'Exkurze' },
    { cid: 'C4D', day: 2, hour: 4, kind: 'sub', t: 'T2', subject: 'Fyzika' },
    { cid: 'C2B', day: 3, hour: 2, kind: 'sub', t: 'T1' },
    { cid: 'C2B', day: 3, hour: 3, kind: 'cancel', reason: 'Akce školy' },
    { cid: 'C2A', day: 0, hour: 2, kind: 'sub', t: 'T5' },
  ]);
  const next = week(permanent, 'Next', [
    { cid: 'C1A', day: 0, hour: 1, kind: 'sub', t: 'T4' },
    { cid: 'C2A', day: 0, hour: 3, kind: 'cancel', reason: 'Lyžařský kurz' },
  ]);
  const perm = {};
  for (const [cid] of CLASSES) perm[cid] = permanent[cid].map(l => lesson(null, l));

  const docs = {};
  docs['definitions/current'] = {
    classes: CLASSES.map(([id, name]) => ({ id, name })),
    teachers: TEACHERS.map(([id, name]) => ({ id, name })),
    rooms: ROOMS.map(([id, name]) => ({ id, name })),
  };
  const put = (type, id, sched, data, weekStart) => { docs[`timetables/${type}_${id}_${sched}`] = { data, weekStart }; };
  for (const [cid] of CLASSES) {
    put('Class', cid, 'Actual', actual[cid], WEEK.Actual);
    put('Class', cid, 'Next', next[cid], WEEK.Next);
    put('Class', cid, 'Permanent', perm[cid], null);
  }
  for (const [sched, src, ws] of [['Actual', actual, WEEK.Actual], ['Next', next, WEEK.Next], ['Permanent', perm, null]]) {
    const t = derive(src, 'teacher');
    for (const [id] of TEACHERS) put('Teacher', id, sched, t[id] || [], ws);
    const r = derive(src, 'room');
    for (const [id] of ROOMS) put('Room', id, sched, r[id] || [], ws);
  }
  const snaps = (src, ws) => CLASSES.map(([id, name]) => ({ id, name, weekStart: ws, lessons: src[id] }));
  docs['aggregates/changes_Actual'] = buildChangesAggregate(snaps(actual, WEEK.Actual), { generatedAt: GENERATED_AT });
  docs['aggregates/changes_Next'] = buildChangesAggregate(snaps(next, WEEK.Next), { generatedAt: GENERATED_AT });
  const roomSnaps = (src, ws) => {
    const r = derive(src, 'room');
    return ROOMS.map(([id, name]) => ({ id, name, weekStart: ws, lessons: r[id] || [] }));
  };
  const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  docs['aggregates/freeRooms_Actual'] = buildFreeRoomsAggregate(roomSnaps(actual, WEEK.Actual), { generatedAt: GENERATED_AT, hours });
  docs['aggregates/freeRooms_Next'] = buildFreeRoomsAggregate(roomSnaps(next, WEEK.Next), { generatedAt: GENERATED_AT, hours });

  return { docs, CLASSES, TEACHERS, ROOMS, WEEK };
}

module.exports = { buildSchool };
