// Atrapa Firebase compat SDK pro prohlížeč (vkládá se přes page.addInitScript).
// Skutečné skripty z gstatic.com test zablokuje, takže aplikace najde tuto
// atrapu na `window.firebase`. Funkce se do stránky přenáší jako text:
// nesmí sahat na nic mimo sebe.

/**
 * @param {{ docs: Record<string, object>, storage: Record<string, string>, offline: boolean, userId: string }} opts
 */
function installFakeFirebase({ docs, storage, offline, userId }) {
  const store = docs;
  const listeners = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const snap = (p) => ({ exists: store[p] != null, data: () => clone(store[p]) });
  const ref = (p) => ({
    get: async () => { (window.__reads ||= []).push(p); return snap(p); },
    onSnapshot(next) {
      (listeners[p] ||= []).push(next);
      setTimeout(() => next(snap(p)), 0);
      return () => { listeners[p] = listeners[p].filter(f => f !== next); };
    },
  });
  const db = { collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }) };
  const user = { uid: userId, getIdToken: async () => 'e2e-id-token' };
  window.firebase = {
    initializeApp: () => ({}),
    firestore: () => db,
    auth: () => ({ signInWithCustomToken: async () => ({ user }), currentUser: user }),
  };
  // Pomocníci pro testy: změna dokumentu „na serveru“ (doručí onSnapshot) a počet odběrů
  window.__fakeSet = (p, data) => { store[p] = data; (listeners[p] || []).forEach(fn => fn(snap(p))); };
  window.__listenerCount = (p) => (listeners[p] || []).length;

  // localStorage se naplní jen při prvním načtení v kartě, aby obnovení stránky
  // nepřepsalo to, co si mezitím uložila aplikace (rozvržení, skryté učebny…)
  if (!sessionStorage.getItem('__e2eSeeded')) {
    sessionStorage.setItem('__e2eSeeded', '1');
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }
  if (offline) Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
}

module.exports = { installFakeFirebase };
