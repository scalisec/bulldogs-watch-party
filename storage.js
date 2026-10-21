/* Bulldogs Watch Party — saving games and clips in the browser's database (IndexedDB).
   Replaces the old single localStorage entry, which Chrome caps at about 5 MB (roughly 35–40 games).
   Only records that changed are rewritten; writes are grouped and happen a moment after each edit. */
(function (root) {
  'use strict';
  const WP = root.WP;
  const DB_NAME = 'bwp-data';
  const STORE = 'kv';
  const LEGACY_KEY = 'bulldogs-watch-party:v1';

  let dbP = null;
  function open() {
    if (!dbP) {
      dbP = new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { db.close(); dbP = null; };
          res(db);
        };
        r.onerror = () => { dbP = null; rej(r.error); };
        r.onblocked = () => rej(new Error('Close other Watch Party tabs and reload'));
      });
    }
    return dbP;
  }

  async function readAll() {
    const db = await open();
    return new Promise((res, rej) => {
      const out = new Map();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out.set(c.key, c.value); c.continue(); }
      };
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function writeMany(puts, dels) {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const [k, v] of puts) st.put(v, k);
      for (const k of dels) st.delete(k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('Could not save'));
      tx.onabort = () => rej(tx.error || new Error('Could not save'));
    });
  }

  /**
   * createDb({ onError, onSaved }) -> { load(), save(state, force), flush(), pending(), forget(key), touch(key) }
   * load() returns { state, migrated } — migrated=true the first time, when the old localStorage data is moved over.
   */
  function createDb(opts) {
    const o = opts || {};
    const sigs = new Map();      // key -> fingerprint last written
    const forced = new Set();    // keys a caller changed deep inside (see touch)
    let state = null;
    let timer = 0;
    let scheduled = false;
    let writing = null;
    let again = false;

    async function load() {
      let recs = new Map();
      try { recs = await readAll(); } catch (e) { if (o.onError) o.onError(e); }
      let st = WP.stateFromRecords(recs);
      let migrated = false;
      if (!st) {
        let legacy = null;
        try { legacy = root.localStorage.getItem(LEGACY_KEY); } catch (e) { legacy = null; }
        try { st = WP.migrate(legacy ? JSON.parse(legacy) : null); } catch (e) { st = WP.defaultState(); }
        migrated = !!legacy;
        state = st;
        await flushNow(true);
      } else {
        state = st;
        for (const r of WP.stateRecords(st)) if (r.track) sigs.set(r.key, WP.recordSig(r.value));
        for (const k of recs.keys()) if (k !== 'meta' && !sigs.has(k)) sigs.set(k, null); // leftovers get deleted on the next save
      }
      return { state: st, migrated };
    }

    function save(st) {
      state = st;
      clearTimeout(timer);
      scheduled = true;
      timer = setTimeout(() => { flushNow(false); }, 0); // only changed records are written, so saving right away is cheap
    }

    /** Mark a record as changed when it was edited in place (e.g. lib.team.entries[id] = …). */
    function touch(key) { forced.add(key); }

    async function flushNow(all) {
      clearTimeout(timer);
      scheduled = false;
      if (!state) return;
      if (writing) { again = true; return writing; }
      const recs = WP.stateRecords(state);
      const puts = [];
      const nextSigs = new Map();
      for (const r of recs) {
        const s = r.track ? WP.recordSig(r.value) : null;
        if (r.track) nextSigs.set(r.key, s);
        if (all || !r.track || forced.has(r.key) || !WP.sameSig(sigs.get(r.key), s)) puts.push([r.key, r.value]);
      }
      const keep = new Set(recs.map((r) => r.key));
      const dels = [...sigs.keys()].filter((k) => !keep.has(k));
      forced.clear();
      writing = writeMany(puts, dels)
        .then(() => {
          for (const k of dels) sigs.delete(k);
          for (const [k, s] of nextSigs) sigs.set(k, s);
          if (o.onSaved) o.onSaved(puts.length, dels.length);
        })
        .catch((e) => { if (o.onError) o.onError(e); })
        .finally(() => {
          writing = null;
          if (again) { again = false; flushNow(false); }
        });
      return writing;
    }

    return {
      load, save, touch,
      flush: () => flushNow(false),
      pending: () => scheduled || !!writing,
      writeAll: () => flushNow(true)
    };
  }

  /** Ask Chrome to keep this app's data even when the disk is low. Returns true/false (or null if unknown). */
  async function persist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return null;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) { return null; }
  }

  async function usage() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      const e = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      return { used: e.usage || 0, quota: e.quota || 0, persisted };
    } catch (e) { return null; }
  }

  root.WPStore = { createDb, persist, usage, LEGACY_KEY, DB_NAME };
})(window);
