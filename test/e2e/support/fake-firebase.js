// Atrapa Firebase compat SDK pro prohlížeč (vkládá se přes page.addInitScript).
// Skutečné skripty z gstatic.com test zablokuje, takže aplikace najde tuto
// atrapu na `window.firebase`. Funkce se do stránky přenáší jako text:
// nesmí sahat na nic mimo sebe.

/**
 * @param {{ docs: Record<string, object>, storage: Record<string, string>, offline: boolean, userId: string,
 *   slow?: Record<string, number|'hang'>, requireSignIn?: boolean }} opts
 *   slow: zpoždění (ms) nebo zaseknutí ('hang') čtení dokumentu (klíč = cesta, např. 'definitions/current')
 *   nebo přihlášení (klíč 'signIn'); časovače jdou přes setTimeout, takže je posune page.clock.
 *   requireSignIn: čtení bez přihlášení selže jako u Firestore s pravidly (permission-denied).
 */
function installFakeFirebase({ docs, storage, offline, userId, slow = {}, requireSignIn = false }) {
  const store = docs;
  const listeners = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const snap = (p) => ({ exists: store[p] != null, data: () => clone(store[p]) });
  const wait = (key) => {
    const v = slow[key];
    if (v === 'hang') return new Promise(() => {});
    return v ? new Promise((r) => setTimeout(r, v)) : Promise.resolve();
  };
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  let signedIn = !requireSignIn;
  const ref = (p) => ({
    get: async () => {
      (window.__reads ||= []).push(p);
      await wait(p);
      if (!signedIn) throw denied();
      (window.__readsDone ||= []).push(p);
      return snap(p);
    },
    onSnapshot(next) {
      (listeners[p] ||= []).push(next);
      setTimeout(() => next(snap(p)), 0);
      return () => { listeners[p] = listeners[p].filter(f => f !== next); };
    },
  });
  const db = { collection: (c) => ({ doc: (id) => ref(`${c}/${id}`) }) };
  const user = { uid: userId, getIdToken: async () => 'e2e-id-token' };
  const auth = {
    signInWithCustomToken: async () => { await wait('signIn'); signedIn = true; return { user }; },
    get currentUser() { return signedIn ? user : null; },
  };
  window.firebase = {
    initializeApp: () => ({}),
    firestore: () => db,
    auth: () => auth,
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
