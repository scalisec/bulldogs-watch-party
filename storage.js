/* Bulldogs Watch Party — saving games and clips in the browser's database (IndexedDB).
   Replaces the old single localStorage entry, which Chrome caps at about 5 MB (roughly 35–40 games).
   Only records that changed are rewritten; writes are grouped and happen a moment after each edit. */
(function (root) {
  'use strict';
  const WP = root.WP;
  const DB_NAME = 'bwp-data';
  const STORE = 'kv';
  const LEGACY_KEY = 'bulldogs-watch-party:v1';

  // One database per team on this device (v1.2): the first team keeps 'bwp-data', others get 'bwp-data:<id>'.
  const dbPs = new Map();
  function open(name) {
    const n = name || DB_NAME;
    if (!dbPs.has(n)) {
      dbPs.set(n, new Promise((res, rej) => {
        const r = indexedDB.open(n, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => {
          const db = r.result;
          db.onversionchange = () => { db.close(); dbPs.delete(n); };
          res(db);
        };
        r.onerror = () => { dbPs.delete(n); rej(r.error); };
        r.onblocked = () => rej(new Error('Close other Watch Party tabs and reload'));
      }));
    }
    return dbPs.get(n);
  }

  /** Delete a team's database from this browser. */
  function deleteDb(name) {
    if (!name || name === DB_NAME) return Promise.reject(new Error('The first team can’t be removed'));
    return new Promise((res, rej) => {
      const p = dbPs.get(name);
      dbPs.delete(name);
      Promise.resolve(p).then((db) => { if (db) db.close(); }).catch(() => {}).then(() => {
        const r = indexedDB.deleteDatabase(name);
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
        r.onblocked = () => res();
      });
    });
  }

  async function readAll(name) {
    const db = await open(name);
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

  async function writeMany(name, puts, dels) {
    const db = await open(name);
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
   * createDb({ name, onError, onSaved }) -> { load(), save(state, force), flush(), pending(), forget(key), touch(key) }
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
      try { recs = await readAll(o.name); } catch (e) { if (o.onError) o.onError(e); }
      let st = WP.stateFromRecords(recs);
      let migrated = false;
      if (!st) {
        let legacy = null;
        try { legacy = !o.name || o.name === DB_NAME ? root.localStorage.getItem(LEGACY_KEY) : null; } catch (e) { legacy = null; }
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
      writing = writeMany(o.name, puts, dels)
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

  // ---------- the teams on this device ----------
  // localStorage 'bwp-teams' = { current: id, teams: [{ id, name, db }] }. The first team ('main') always exists.
  const TEAMS_KEY = 'bwp-teams';
  const MAIN = { id: 'main', name: '', db: DB_NAME };
  function readTeams() {
    let d = null;
    try { d = JSON.parse(root.localStorage.getItem(TEAMS_KEY)); } catch (e) { d = null; }
    const teams = (d && Array.isArray(d.teams) ? d.teams : []).filter((t) => t && /^[\w-]{1,40}$/.test(t.id) && typeof t.db === 'string');
    if (!teams.some((t) => t.id === 'main')) teams.unshift(Object.assign({}, MAIN));
    const current = d && teams.some((t) => t.id === d.current) ? d.current : 'main';
    return { current, teams };
  }
  function writeTeams(d) { try { root.localStorage.setItem(TEAMS_KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }
  const teams = {
    list: () => readTeams().teams,
    current: () => { const d = readTeams(); return d.teams.find((t) => t.id === d.current); },
    setCurrent: (id) => { const d = readTeams(); if (d.teams.some((t) => t.id === id)) { d.current = id; writeTeams(d); } },
    add: (name) => {
      const d = readTeams();
      const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const t = { id, name: String(name || '').trim().slice(0, 60), db: DB_NAME + ':' + id };
      d.teams.push(t);
      if (!writeTeams(d)) throw new Error('This browser won’t save the team list (private window?)');
      return t;
    },
    rename: (id, name) => { const d = readTeams(); const t = d.teams.find((x) => x.id === id); if (t && t.name !== name) { t.name = name; writeTeams(d); } },
    remove: (id) => { const d = readTeams(); d.teams = d.teams.filter((t) => t.id !== id || id === 'main'); if (d.current === id) d.current = 'main'; writeTeams(d); }
  };

  root.WPStore = { createDb, deleteDb, persist, usage, teams, LEGACY_KEY, DB_NAME };
})(window);
