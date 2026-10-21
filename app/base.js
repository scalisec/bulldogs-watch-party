/* Bulldogs Watch Party — Shared helpers, saving, error reporting and the App namespace. Loads first; every other file waits for App.ready. */
/* The app is split into files that share one namespace, window.App. Each file runs after base.js has
   loaded the saved data (App.ready), in the order the <script> tags list them. A file takes what it needs from
   earlier files at the top (const { … } = App) and reaches later files as App.name. */
window.App = window.App || {};
App.ready = (async function () {
  'use strict';

  'use strict';

  const $ = (id) => document.getElementById(id);
  App.lastSaveCount = 0;
  const tabs = 'BroadcastChannel' in window ? new BroadcastChannel('bwp-tabs') : null;
  const DB = WPStore.createDb({
    onError: (e) => toast('Could not save: ' + (e && e.message ? e.message : e), { err: true, ms: 10000 }),
    onSaved: (n) => { App.lastSaveCount = n; if (tabs) tabs.postMessage('saved'); }
  });
  const loaded = await DB.load();
  const S = loaded.state; // one shared object for the whole session; replaceState() swaps its contents
  function replaceState(next) {
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, next);
  }
  WPStore.persist();

  // ---------- session (not saved) ----------
  const session = { files: new Map(), draftParts: [] }; // draftParts: [{file, handle, duration}]
  App.G = null;          // current game
  App.TL = null;         // its timeline
  App.player = null;
  App.selectedClipId = null;
  App.openEditorId = null;
  App.pendingStart = null;   // after I
  App.awaiting = null;       // {start, end} after O, waiting for a category
  App.filterCat = 'all';

  // ---------- helpers ----------
  function saveQuiet() { DB.save(S); }
  function save() {
    saveQuiet();
    if (typeof App.libChanged === 'function') App.libChanged();
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  function toast(msg, opts) {
    const o = opts || {};
    const t = el('div', { class: 'toast' + (o.err ? ' err' : ''), role: o.err ? 'alert' : null }, el('span', { text: msg }));
    if (o.action) {
      t.append(el('button', { type: 'button', onclick: () => { o.action.fn(); t.remove(); } }, o.action.label));
    }
    const box = $('toasts');
    // stack up to 3 so a quick second tag doesn't wipe out the first one's Undo
    while (box.children.length >= 3) box.firstElementChild.remove();
    box.append(t);
    setTimeout(() => t.remove(), o.ms || (o.action ? 6000 : 3500));
  }

  /** The app's own yes/no and type-a-name dialogs (instead of the browser's grey pop-ups). */
  function ask(o) {
    return new Promise((resolve) => {
      const d = $('dlg-ask');
      $('ask-h').textContent = o.title;
      $('ask-msg').textContent = o.message || '';
      $('ask-msg').classList.toggle('hidden', !o.message);
      const inp = $('ask-input');
      inp.classList.toggle('hidden', o.input == null);
      inp.value = o.input || '';
      $('ask-ok').textContent = o.ok || 'OK';
      $('ask-ok').className = 'btn ' + (o.danger ? 'danger solid' : 'primary');
      let done = false;
      const finish = (v) => { if (done) return; done = true; d.close(); resolve(v); };
      $('ask-cancel').onclick = () => finish(o.input != null ? null : false);
      $('ask-form').onsubmit = (e) => { e.preventDefault(); finish(o.input != null ? inp.value.trim() || null : true); };
      d.oncancel = (e) => { e.preventDefault(); finish(o.input != null ? null : false); };
      d.showModal();
      if (o.input != null) { inp.focus(); inp.select(); } else $('ask-ok').focus();
    });
  }
  const askYes = (title, message, ok, danger) => ask({ title, message, ok, danger: danger !== false });

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function catById(id) { return S.settings.categories.find((c) => c.id === id) || null; }
  function rangeText(c) { return WP.formatTime(c.start) + '–' + WP.formatTime(c.end); }
  function lenText(c) { return Math.round(c.end - c.start) + 's'; }
  function slug(s) { return String(s || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  // ---------- unexpected errors: say so, and offer details to copy into a bug report ----------
  let lastErrAt = 0;
  function reportError(err) {
    const msg = (err && (err.message || err.reason && err.reason.message)) || String(err || 'Unknown error');
    if (/ResizeObserver loop|AbortError|Stopped/.test(msg) || Date.now() - lastErrAt < 4000) return;
    lastErrAt = Date.now();
    const details = JSON.stringify({ version: WP.APP_VERSION, when: new Date().toISOString(), screen: location.hash, message: msg,
      stack: String((err && err.stack) || '').split('\n').slice(0, 6).join('\n'), browser: navigator.userAgent }, null, 2);
    toast('Something went wrong: ' + msg, { err: true, ms: 12000, action: { label: 'Copy details', fn: () => {
      (navigator.clipboard ? navigator.clipboard.writeText(details) : Promise.reject()).then(() => toast('Details copied \u2014 paste them into your notes'), () => prompt('Copy these details:', details));
    } } });
  }
  window.addEventListener('error', (e) => reportError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

  // ---------- file handle storage (lets Chrome reopen videos without re-choosing) ----------
  const idb = {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('bwp-handles', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('h');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('h', mode);
        const req = fn(tx.objectStore('h'));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    put(k, v) { return this.run('readwrite', (s) => s.put(v, k)).catch(() => {}); },
    get(k) { return this.run('readonly', (s) => s.get(k)).catch(() => undefined); },
    del(k) { return this.run('readwrite', (s) => s.delete(k)).catch(() => {}); }
  };

  function renderWho() {
    const name = S.settings.coachName;
    $('who').replaceChildren(name ? 'Coach: ' + name : el('a', { href: '#settings', style: 'color:#C7D2E3' }, 'Add your name in Settings'));
  }
  Object.assign(App, {
    $, DB, S, ask, askYes, catById, download, el, idb, lenText, loaded, rangeText, renderWho,
    replaceState, save, saveQuiet, session, slug, tabs, toast
  });
})();
