/* Bulldogs Watch Party — milestone 1 UI: import, watch and tag. Depends on core.js (window.WP). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const store = WP.createStore(window.localStorage);
  let S = store.load();

  // ---------- session (not saved) ----------
  const session = { files: new Map(), draftParts: [] }; // draftParts: [{file, handle, duration}]
  let G = null;          // current game
  let TL = null;         // its timeline
  let player = null;
  let selectedClipId = null;
  let openEditorId = null;
  let pendingStart = null;   // after I
  let awaiting = null;       // {start, end} after O, waiting for a category
  let filterCat = 'all';

  // ---------- helpers ----------
  function saveQuiet() {
    try { store.save(S); } catch (e) { toast('Could not save: ' + e.message, { err: true }); }
  }
  function save() {
    saveQuiet();
    if (typeof libChanged === 'function') libChanged();
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
    box.replaceChildren();
    box.append(t);
    setTimeout(() => t.remove(), o.ms || (o.action ? 6000 : 3500));
  }

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

  // ---------- routing ----------
  function show(view) {
    for (const v of ['games', 'tag', 'edit', 'review', 'settings']) $('view-' + v).classList.toggle('hidden', v !== view);
    if (view !== 'edit') closeEditor();
    for (const a of document.querySelectorAll('[data-nav]')) {
      const on = a.dataset.nav === view || ((view === 'tag' || view === 'edit') && a.dataset.nav === 'games');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    if (view !== 'tag' && player) player.pause();
    if (view !== 'review' && R.idx >= 0) stopReviewPlayer();
    window.scrollTo(0, 0);
  }

  function route() {
    const [view, id, sub] = (location.hash.replace('#', '') || 'games').split('/');
    if (view === 'tag' && id) { if (openGame(id)) show('tag'); }
    else if (view === 'edit' && id && sub) { show('edit'); if (!openEditor(id, sub)) return; }
    else if (view === 'settings') { renderSettings(); show('settings'); }
    else if (view === 'review') { show('review'); renderReview(); }
    else { renderGames(); show('games'); }
  }

  function renderWho() {
    const name = S.settings.coachName;
    $('who').replaceChildren(name ? 'Coach: ' + name : el('a', { href: '#settings', style: 'color:#C7D2E3' }, 'Add your name in Settings'));
  }

  // =====================================================================
  // GAMES
  // =====================================================================
  function probeDuration(file) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (fn, val) => { clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); fn(val); };
      const timer = setTimeout(() => done(reject, new Error('Timed out reading ' + file.name)), 20000);
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        if (Number.isFinite(v.duration) && v.duration > 0) done(resolve, v.duration);
        else done(reject, new Error('Could not read the length of ' + file.name));
      };
      v.onerror = () => done(reject, new Error('This browser can’t open ' + file.name + '. Use Chrome or Edge.'));
      v.src = url;
    });
  }

  async function addFiles(entries) {
    const vids = entries.filter((e) => e.file && (/^video\//.test(e.file.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(e.file.name)));
    if (!vids.length) { toast('Those aren’t video files', { err: true }); return; }
    for (const e of vids) {
      if (session.draftParts.some((p) => p.file.name === e.file.name && p.file.size === e.file.size)) continue;
      const row = { file: e.file, handle: e.handle || null, duration: null };
      session.draftParts.push(row);
      renderParts();
      try { row.duration = await probeDuration(e.file); }
      catch (err) {
        session.draftParts = session.draftParts.filter((p) => p !== row);
        toast(err.message, { err: true });
      }
      renderParts();
    }
    const guess = WP.guessGameDetails(session.draftParts.map((p) => ({ name: p.file.name })));
    if (!$('g-date').value && guess.date) $('g-date').value = guess.date;
    if (!$('g-rink').value && guess.rink) $('g-rink').value = guess.rink;
  }

  function orderedDraft() {
    const order = WP.orderParts(session.draftParts.map((p) => ({ name: p.file.name, ref: p })));
    return order.map((o) => o.ref);
  }

  function renderParts() {
    const parts = orderedDraft();
    $('parts-wrap').hidden = !parts.length;
    $('parts').replaceChildren(...parts.map((p, i) => el('div', { class: 'partrow' },
      el('strong', { style: 'width:56px' }, 'Part ' + (i + 1)),
      el('span', { class: 'name', title: p.file.name }, p.file.name),
      el('span', { class: 'muted', style: 'font-variant-numeric:tabular-nums' }, p.duration ? WP.formatTime(p.duration) : 'reading…'),
      el('button', {
        type: 'button', class: 'btn iconbtn', 'aria-label': 'Remove ' + p.file.name,
        onclick: () => { session.draftParts = session.draftParts.filter((x) => x !== p); renderParts(); }
      }, '✕')
    )));
    const total = parts.reduce((s, p) => s + (p.duration || 0), 0);
    const bytes = parts.reduce((s, p) => s + p.file.size, 0);
    $('parts-total').textContent = parts.length ? 'Total ' + WP.formatTime(total) + ' · ' + (bytes / 1e9).toFixed(2) + ' GB on this computer' : '';
    $('g-start').disabled = !parts.length || parts.some((p) => !p.duration);
  }

  function clearDraft() {
    session.draftParts = [];
    for (const id of ['g-date', 'g-opp', 'g-rink', 'g-result', 'g-type', 'g-ha']) $(id).value = '';
    renderParts();
  }

  async function startGame() {
    const parts = orderedDraft();
    let game;
    try {
      game = WP.newGame({
        parts: parts.map((p) => ({ name: p.file.name, size: p.file.size, duration: p.duration, lastModified: p.file.lastModified })),
        date: $('g-date').value, opponent: $('g-opp').value, rink: $('g-rink').value, result: $('g-result').value, gameType: $('g-type').value, homeAway: $('g-ha').value
      });
    } catch (e) { toast(e.message, { err: true }); return; }
    S.games.push(game);
    save();
    let listsChanged = false;
    for (const [key, val] of [['opponents', game.opponent], ['rinks', game.rink]]) {
      if (val && !S.settings[key].some((x) => x.toLowerCase() === val.toLowerCase())) { S.settings[key] = WP.addListItem(S.settings[key], val); listsChanged = true; }
    }
    if (listsChanged) teamChanged();
    session.files.set(game.id, parts.map((p) => p.file));
    if (parts.every((p) => p.handle)) await idb.put(game.id, parts.map((p) => p.handle));
    clearDraft();
    location.hash = 'tag/' + game.id;
  }

  function renderGames() {
    renderWho();
    renderGameLists();
    const games = S.games.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt);
    if (!games.length) {
      $('games').replaceChildren(el('div', { class: 'empty' }, 'No games yet. Add your first LiveBarn download on the left.'));
      return;
    }
    $('games').replaceChildren(...games.map((g) => {
      const total = WP.gameTimeline(g).total;
      return el('div', { class: 'gamerow' },
        el('div', { class: 'grow stack', style: 'gap:2px' },
          el('strong', {}, WP.gameTitle(g)),
          el('span', { class: 'small muted' }, [g.rink, g.parts.length + (g.parts.length === 1 ? ' part' : ' parts'), WP.formatTime(total), g.clips.length + (g.clips.length === 1 ? ' clip' : ' clips')].filter(Boolean).join(' · '))
        ),
        el('div', { class: 'row' },
          el('a', { class: 'btn small primary', href: '#tag/' + g.id, style: 'text-decoration:none' }, 'Open'),
          el('button', { type: 'button', class: 'btn small', onclick: () => download('watch-party-' + slug(WP.gameTitle(g)) + '.json', WP.exportBackup(S, g.id)) }, 'Backup'),
          el('button', {
            type: 'button', class: 'btn small danger', 'aria-label': 'Delete ' + WP.gameTitle(g),
            onclick: () => {
              if (!confirm('Delete ' + WP.gameTitle(g) + ' and its ' + g.clips.length + ' clips from this computer? The video files are not touched.')) return;
              S.games = S.games.filter((x) => x.id !== g.id);
              save(); idb.del(g.id); session.files.delete(g.id);
              if (player && player.gameId === g.id) { player.destroy(); player = null; G = null; }
              renderGames();
            }
          }, 'Delete')
        )
      );
    }));
  }

  // pick / drop
  $('pick-files').addEventListener('click', async () => {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'] } }] });
        const entries = await Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h })));
        addFiles(entries);
      } catch (e) { if (e.name !== 'AbortError') $('file-input').click(); }
    } else $('file-input').click();
  });
  $('file-input').addEventListener('change', (e) => { addFiles([...e.target.files].map((f) => ({ file: f }))); e.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file');
    const pending = items.map((i) => ({ file: i.getAsFile(), handleP: i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null) }));
    const entries = [];
    for (const p of pending) entries.push({ file: p.file, handle: await p.handleP });
    if (!entries.length) for (const f of e.dataTransfer.files) entries.push({ file: f });
    addFiles(entries);
  });
  $('g-start').addEventListener('click', startGame);
  $('g-clear').addEventListener('click', clearDraft);
  $('import-backup').addEventListener('click', () => $('backup-input').click());
  $('backup-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { state, count } = WP.importBackup(S, await f.text());
      S = state; save(); renderGames();
      toast('Imported ' + count + (count === 1 ? ' game' : ' games'));
    } catch (err) { toast(err.message, { err: true }); }
  });

  // =====================================================================
  // PLAYER — plays several part files as one timeline
  // =====================================================================
  function createPlayer(video, files, tl, gameId, onTick) {
    const urls = files.map((f) => URL.createObjectURL(f));
    let cur = -1;
    let rate = 1;
    let wantPlay = false;
    let rangeEnd = null;
    let raf = 0;
    let chain = Promise.resolve();
    let dead = false;

    function once(name, ms) {
      return new Promise((res) => {
        const t = setTimeout(done, ms || 4000);
        function done() { clearTimeout(t); video.removeEventListener(name, done); res(); }
        video.addEventListener(name, done);
      });
    }

    function loadPart(i) {
      if (i === cur) return Promise.resolve();
      cur = i;
      return new Promise((res, rej) => {
        const ok = () => { off(); res(); };
        const bad = () => { off(); rej(new Error('This browser can’t play ' + files[i].name + '. Use Chrome or Edge.')); };
        function off() { video.removeEventListener('loadedmetadata', ok); video.removeEventListener('error', bad); }
        video.addEventListener('loadedmetadata', ok);
        video.addEventListener('error', bad);
        video.src = urls[i];
        video.defaultPlaybackRate = rate;
        video.playbackRate = rate;
      });
    }

    async function doSeek(t) {
      if (dead) return;
      const loc = WP.locate(tl, t);
      await loadPart(loc.part);
      video.playbackRate = rate;
      if (Math.abs(video.currentTime - loc.local) > 0.01) {
        video.currentTime = loc.local;
        if (video.seeking) await once('seeked');
      }
      onTick();
      if (wantPlay) video.play().catch(() => {});
    }

    function seek(t) {
      chain = chain.then(() => doSeek(t)).catch((e) => { toast(e.message, { err: true }); });
      return chain;
    }

    function time() { return cur < 0 ? 0 : tl.offsets[cur] + (video.currentTime || 0); }

    function loop() {
      cancelAnimationFrame(raf);
      if (rangeEnd != null && time() >= rangeEnd) { api.pause(); }
      onTick();
      if (!video.paused) raf = requestAnimationFrame(loop);
    }

    const handlers = {
      play: () => loop(),
      pause: () => { cancelAnimationFrame(raf); onTick(); },
      seeked: () => onTick(),
      ended: () => {
        if (wantPlay && cur < files.length - 1) seek(tl.offsets[cur + 1]);
        else { wantPlay = false; onTick(); }
      }
    };
    for (const [k, fn] of Object.entries(handlers)) video.addEventListener(k, fn);

    const api = {
      gameId,
      time,
      seek,
      isPlaying: () => wantPlay,
      play() {
        wantPlay = true;
        if (time() >= tl.total - 0.05) return seek(0);
        if (cur < 0) return seek(0);
        video.play().catch(() => {});
        onTick();
        return chain;
      },
      pause() { wantPlay = false; rangeEnd = null; video.pause(); onTick(); },
      toggle() { return wantPlay ? api.pause() : api.play(); },
      nudge(d) { return seek(Math.max(0, Math.min(tl.total, time() + d))); },
      setRate(r) { rate = r; video.defaultPlaybackRate = r; video.playbackRate = r; },
      playRange(s, e) { rangeEnd = e; wantPlay = true; return seek(s); },
      resume() { wantPlay = true; rangeEnd = null; video.play().catch(() => {}); },
      partOffset() { return cur < 0 ? 0 : tl.offsets[cur]; },
      partIndex() { return cur; },
      partCount() { return files.length; },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        video.pause();
        for (const [k, fn] of Object.entries(handlers)) video.removeEventListener(k, fn);
        video.removeAttribute('src');
        video.load();
        urls.forEach((u) => URL.revokeObjectURL(u));
      }
    };
    return api;
  }

  // =====================================================================
  // TAG VIEW
  // =====================================================================
  function openGame(id) {
    const game = S.games.find((g) => g.id === id);
    if (!game) { toast('That game isn’t on this computer', { err: true }); location.hash = 'games'; return false; }
    renderWho();
    if (G && G.id === id && player) { renderTagView(); return true; }
    if (player) { player.destroy(); player = null; }
    G = game;
    TL = WP.gameTimeline(G);
    selectedClipId = null; openEditorId = null; pendingStart = null; awaiting = null; filterCat = 'all';
    $('b-rate').value = '1';
    applyZoom(WP.FIT);
    renderTagView();
    const files = session.files.get(id);
    if (files) startPlayer(files); else showRelink();
    return true;
  }

  function startPlayer(files) {
    $('relink').classList.add('hidden');
    player = createPlayer($('video'), files, TL, G.id, onTick);
    player.seek(0);
  }

  // ---- zoom ----
  let zoom = WP.FIT;

  function applyZoom(z) {
    zoom = WP.normalizeZoom(z || WP.FIT);
    const on = WP.isZoomed(zoom);
    $('video').style.transform = WP.zoomTransform(zoom);
    $('z-level').textContent = (Math.round(zoom.scale * 10) / 10) + '×';
    $('vframe').classList.toggle('zoomed', on);
    $('ov-zoom').classList.toggle('hidden', !on);
  }

  function sizeFrame() {
    const v = $('video');
    if (!v.videoWidth || !v.videoHeight) return;
    const aspect = v.videoWidth / v.videoHeight;
    const f = $('vframe');
    f.style.aspectRatio = String(aspect);
    f.style.width = 'min(100%, calc(52vh * ' + aspect.toFixed(4) + '))';
  }
  $('video').addEventListener('loadedmetadata', sizeFrame);

  function frameFrac(e) {
    const r = $('vframe').getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, r };
  }

  (function () {
    const f = $('vframe');
    f.addEventListener('wheel', (e) => {
      if (!player) return;
      e.preventDefault();
      const { fx, fy } = frameFrac(e);
      applyZoom(WP.zoomAt(zoom, e.deltaY < 0 ? 1.15 : 1 / 1.15, fx, fy));
    }, { passive: false });
    f.addEventListener('dblclick', (e) => {
      if (!player) return;
      const { fx, fy } = frameFrac(e);
      applyZoom(WP.isZoomed(zoom) ? WP.FIT : WP.zoomAt(WP.FIT, 2.5, fx, fy));
    });
    let drag = null;
    f.addEventListener('pointerdown', (e) => {
      if (!WP.isZoomed(zoom) || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, z: zoom, r: f.getBoundingClientRect() };
      f.setPointerCapture(e.pointerId);
      f.classList.add('dragging');
    });
    f.addEventListener('pointermove', (e) => {
      if (!drag) return;
      applyZoom(WP.panZoom(drag.z, (e.clientX - drag.x) / drag.r.width, (e.clientY - drag.y) / drag.r.height));
    });
    const end = () => { drag = null; f.classList.remove('dragging'); };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
  })();
  $('z-in').addEventListener('click', () => applyZoom(WP.zoomAt(zoom, 1.25)));
  $('z-out').addEventListener('click', () => applyZoom(WP.zoomAt(zoom, 1 / 1.25)));
  $('z-fit').addEventListener('click', () => applyZoom(WP.FIT));
  function currentZoom() { return WP.isZoomed(zoom) ? zoom : null; }
  function zoomLabel(z) { return 'Zoom ' + (Math.round(z.scale * 10) / 10) + '×'; }

  async function showRelink() {
    $('relink').classList.remove('hidden');
    $('relink-names').textContent = G.parts.map((p) => p.name).join(' · ');
    const handles = await idb.get(G.id);
    $('relink-handles').hidden = !(handles && handles.length && handles[0].queryPermission);
    $('relink-msg').textContent = handles ? 'Reconnect this game’s video files' : 'Choose this game’s video files again';
  }

  $('relink-handles').addEventListener('click', async () => {
    try {
      const handles = await idb.get(G.id);
      for (const h of handles) {
        let p = await h.queryPermission({ mode: 'read' });
        if (p !== 'granted') p = await h.requestPermission({ mode: 'read' });
        if (p !== 'granted') { toast('Permission needed to open the videos', { err: true }); return; }
      }
      const files = await Promise.all(handles.map((h) => h.getFile()));
      useRelinked(files);
    } catch (e) { toast('Couldn’t reopen the files. Choose them instead.', { err: true }); }
  });
  $('relink-pick').addEventListener('click', () => $('relink-input').click());
  $('relink-input').addEventListener('change', (e) => { useRelinked([...e.target.files]); e.target.value = ''; });

  function useRelinked(files) {
    const m = WP.matchFiles(G.parts, files);
    if (!m.files) { toast('Missing: ' + m.missing.join(', '), { err: true, ms: 7000 }); return; }
    session.files.set(G.id, m.files);
    startPlayer(m.files);
  }

  function renderTagView() {
    $('t-title').textContent = WP.gameTitle(G);
    $('t-sub').textContent = [G.rink, G.result, G.parts.length + (G.parts.length === 1 ? ' part' : ' parts') + ' · ' + WP.formatTime(TL.total)].filter(Boolean).join(' · ');
    renderTags();
    renderMarks();
    renderTimelineStatic();
    renderClips();
    updateMarks();
    onTick();
  }

  function renderTags() {
    const cats = WP.keyedCategories(S.settings.categories);
    $('tags').replaceChildren(...cats.map((c) => el('button', {
      type: 'button', class: 'tagbtn', 'data-cat': c.id,
      title: c.key ? 'Key ' + c.key : null,
      onclick: (e) => { onCategory(c); e.currentTarget.blur(); }
    },
    el('span', { class: 'key' }, c.key || '·'),
    el('span', { class: 'dot', style: 'background:' + c.color }),
    el('span', { class: 'grow' }, c.name),
    el('span', { class: 'win', 'aria-label': c.before + ' seconds before, ' + c.after + ' after' }, c.before + 's / ' + c.after + 's')
    )));
  }

  // ---- timeline ----
  function pct(t) { return TL.total ? (t / TL.total) * 100 : 0; }

  function renderTimelineStatic() {
    const tl = $('tl');
    tl.replaceChildren();
    tl.setAttribute('aria-valuemax', String(Math.round(TL.total)));
    TL.offsets.forEach((o, i) => { if (i > 0) tl.append(el('div', { class: 'sep', style: 'left:' + pct(o) + '%' })); });
    for (const c of G.clips) {
      const cat = catById(c.categoryId);
      tl.append(el('div', {
        class: 'mk' + (c.id === selectedClipId ? ' sel' : ''), 'data-clip': c.id,
        title: (cat ? cat.name : 'Clip') + ' ' + rangeText(c),
        style: 'left:' + pct(c.start) + '%;width:' + Math.max(0.3, pct(c.end - c.start)) + '%;background:' + (cat ? cat.color : '#64748B')
      }));
    }
    const gm = WP.gameMarks(G);
    for (const p of gm.periods) tl.append(el('div', { class: 'pband', title: WP.periodName(p.n), style: 'left:' + pct(p.start) + '%;width:' + Math.max(0.3, pct((p.end != null ? p.end : TL.total) - p.start)) + '%' }));
    for (const g of gm.goals) tl.append(el('div', { class: 'gmk', title: (g.side === 'for' ? 'Goal for ' : 'Goal against ') + WP.formatTime(g.t), style: 'left:' + pct(g.t) + '%;background:' + (g.side === 'for' ? '#16A34A' : '#DC2626') }));
    tl.append(el('div', { class: 'pending hidden', id: 'tl-pending' }));
    tl.append(el('div', { class: 'head', id: 'tl-head' }));
    $('tl-labels').replaceChildren(...TL.durations.map((d, i) => el('span', { style: 'flex:' + d + ' 1 0' }, TL.durations.length > 1 ? 'Part ' + (i + 1) : 'Full game')));
  }

  function onTick() {
    if (!G) return;
    const t = player ? player.time() : 0;
    $('clock').textContent = WP.formatTime(t) + ' / ' + WP.formatTime(TL.total);
    const loc = WP.locate(TL, t);
    $('ov-time').textContent = (TL.durations.length > 1 ? 'Part ' + (loc.part + 1) + ' · ' : '') + WP.formatTime(t, true);
    const head = $('tl-head');
    if (head) head.style.left = pct(t) + '%';
    $('tl').setAttribute('aria-valuenow', String(Math.round(t)));
    $('tl').setAttribute('aria-valuetext', WP.formatTime(t));
    const pend = $('tl-pending');
    if (pend) {
      const s = awaiting ? awaiting.start : pendingStart;
      const e = awaiting ? awaiting.end : t;
      if (s == null) pend.classList.add('hidden');
      else {
        pend.classList.remove('hidden');
        pend.style.left = pct(Math.min(s, e)) + '%';
        pend.style.width = pct(Math.abs(e - s)) + '%';
      }
    }
    const playing = player && player.isPlaying();
    $('ic-play').classList.toggle('hidden', !!playing);
    $('ic-pause').classList.toggle('hidden', !playing);
    $('b-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  // scrub
  (function () {
    const tl = $('tl');
    let down = false;
    let pendingT = null;
    function tAt(e) {
      const r = tl.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * TL.total;
    }
    tl.addEventListener('pointerdown', (e) => {
      if (!player) return;
      const mk = e.target.closest('.mk');
      if (mk) { selectClip(mk.dataset.clip, true); return; }
      down = true;
      tl.setPointerCapture(e.pointerId);
      player.seek(tAt(e));
    });
    tl.addEventListener('pointermove', (e) => {
      if (!down) return;
      const fresh = pendingT == null;
      pendingT = tAt(e);
      $('tl-head').style.left = pct(pendingT) + '%';
      if (fresh) requestAnimationFrame(() => { if (pendingT != null) player.seek(pendingT); pendingT = null; });
    });
    tl.addEventListener('pointerup', () => { down = false; });
    tl.addEventListener('pointercancel', () => { down = false; });
  })();

  // ---- tagging ----
  function addClip(fields, cat) {
    let clip;
    try {
      clip = WP.makeClip(Object.assign({ total: TL.total, by: S.settings.coachName }, fields));
    } catch (e) { toast(e.message, { err: true }); return null; }
    G.clips.push(clip);
    save();
    renderTimelineStatic();
    renderClips();
    onTick();
    const name = cat ? cat.name : 'Clip';
    const btn = document.querySelector('.tagbtn[data-cat="' + clip.categoryId + '"]');
    if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 400); }
    const ov = $('ov-tag');
    ov.textContent = 'Tagged: ' + name;
    ov.classList.remove('hidden');
    clearTimeout(addClip.t);
    addClip.t = setTimeout(() => ov.classList.add('hidden'), 1600);
    toast(name + ' · ' + rangeText(clip) + (clip.zoom ? ' · ' + zoomLabel(clip.zoom) : ''), { action: { label: 'Undo', fn: () => removeClip(clip.id, true) } });
    return clip;
  }

  function removeClip(id, quiet) {
    const clip = G.clips.find((c) => c.id === id);
    if (!clip) return;
    G.clips = G.clips.filter((c) => c.id !== id);
    if (!S.lib.deleted.includes(id)) S.lib.deleted.push(id);
    if (selectedClipId === id) selectedClipId = null;
    if (openEditorId === id) openEditorId = null;
    save();
    renderTimelineStatic();
    renderClips();
    onTick();
    if (!quiet) toast('Clip deleted', { action: { label: 'Undo', fn: () => { G.clips.push(clip); S.lib.deleted = S.lib.deleted.filter((x) => x !== clip.id); save(); renderTimelineStatic(); renderClips(); onTick(); } } });
  }

  function onCategory(cat) {
    if (!player) { toast('Connect the video files first', { err: true }); return; }
    if (awaiting) {
      const c = addClip({ start: awaiting.start, end: awaiting.end, categoryId: cat.id, method: 'marks', zoom: currentZoom() }, cat);
      if (c) { pendingStart = null; awaiting = null; updateMarks(); }
      return;
    }
    const w = WP.autoWindow(player.time(), cat, TL.total);
    addClip({ start: w.start, end: w.end, categoryId: cat.id, method: 'tap', zoom: currentZoom() }, cat);
  }

  function markIn() {
    if (!player) return;
    pendingStart = player.time();
    awaiting = null;
    updateMarks();
  }

  function markOut() {
    if (!player) return;
    if (pendingStart == null) { toast('Press I (Mark start) at the start of the play first'); return; }
    let s = pendingStart;
    let e = player.time();
    if (e < s) [s, e] = [e, s];
    const err = WP.validateRange(s, e, TL.total);
    if (err) { toast(err, { err: true }); return; }
    awaiting = { start: s, end: e };
    updateMarks();
  }

  function cancelMarks() { pendingStart = null; awaiting = null; updateMarks(); }

  function updateMarks() {
    const b = $('marks-banner');
    $('tags').classList.toggle('choose', !!awaiting);
    if (awaiting) {
      b.replaceChildren('Clip ' + WP.formatTime(awaiting.start) + '–' + WP.formatTime(awaiting.end) + ' marked — pick a category (1–9). ', el('button', { type: 'button', class: 'btn small', onclick: cancelMarks }, 'Cancel'));
      b.classList.remove('hidden');
    } else if (pendingStart != null) {
      b.replaceChildren('Start marked at ' + WP.formatTime(pendingStart) + ' — press O (Mark end) when the play is over. ', el('button', { type: 'button', class: 'btn small', onclick: cancelMarks }, 'Cancel'));
      b.classList.remove('hidden');
    } else b.classList.add('hidden');
    onTick();
  }

  // ---- controls ----
  $('b-play').addEventListener('click', () => player && player.toggle());
  $('b-back').addEventListener('click', () => player && player.nudge(-5));
  $('b-fwd').addEventListener('click', () => player && player.nudge(5));
  $('b-rate').addEventListener('change', (e) => player && player.setRate(Number(e.target.value)));
  $('b-in').addEventListener('click', markIn);
  $('b-out').addEventListener('click', markOut);
  $('b-backup').addEventListener('click', () => G && download('watch-party-' + slug(WP.gameTitle(G)) + '.json', WP.exportBackup(S, G.id)));

  // ---- manual dialog ----
  function openManual() {
    if (!player) { toast('Connect the video files first', { err: true }); return; }
    const t = player.time();
    $('dm-start').value = WP.formatTime(Math.max(0, t - WP.DEFAULT_BEFORE));
    $('dm-end').value = WP.formatTime(Math.min(TL.total, t + WP.DEFAULT_AFTER));
    $('dm-cat').replaceChildren(...S.settings.categories.map((c) => el('option', { value: c.id }, c.name + (c.hidden ? ' (hidden)' : ''))));
    $('dm-err').textContent = '';
    $('dlg-manual').showModal();
    $('dm-start').focus();
    $('dm-start').select();
  }
  $('b-manual').addEventListener('click', openManual);
  $('dm-start-now').addEventListener('click', () => { $('dm-start').value = WP.formatTime(player.time(), true); });
  $('dm-end-now').addEventListener('click', () => { $('dm-end').value = WP.formatTime(player.time(), true); });
  $('dm-cancel').addEventListener('click', () => $('dlg-manual').close());
  $('dm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = WP.parseTime($('dm-start').value);
    const end = WP.parseTime($('dm-end').value);
    const err = WP.validateRange(start, end, TL.total);
    if (err) { $('dm-err').textContent = err; return; }
    const cat = catById($('dm-cat').value);
    const clip = addClip({ start, end, categoryId: cat.id, method: 'manual', zoom: currentZoom() }, cat);
    if (clip) { $('dlg-manual').close(); selectClip(clip.id, true); }
  });

  // ---- clip list ----
  function selectClip(id, seek) {
    selectedClipId = id;
    const clip = G.clips.find((c) => c.id === id);
    renderTimelineStatic();
    renderClips();
    onTick();
    if (clip && seek && player) player.seek(clip.start);
    const card = document.querySelector('.clip[data-clip="' + id + '"]');
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function renderClipFilter() {
    const counts = {};
    for (const c of G.clips) counts[c.categoryId] = (counts[c.categoryId] || 0) + 1;
    const opts = [el('option', { value: 'all' }, 'All categories (' + G.clips.length + ')')];
    for (const c of S.settings.categories) if (counts[c.id]) opts.push(el('option', { value: c.id }, c.name + ' (' + counts[c.id] + ')'));
    $('clip-filter').replaceChildren(...opts);
    if (filterCat !== 'all' && !counts[filterCat]) filterCat = 'all';
    $('clip-filter').value = filterCat;
  }
  $('clip-filter').addEventListener('change', (e) => { filterCat = e.target.value; renderClips(); });

  function renderClips() {
    renderClipFilter();
    $('clip-count').textContent = G.clips.length + (G.clips.length === 1 ? ' clip' : ' clips');
    const clips = WP.sortClips(G.clips).filter((c) => filterCat === 'all' || c.categoryId === filterCat);
    if (!clips.length) {
      $('clips').replaceChildren(el('div', { class: 'empty' }, G.clips.length ? 'No clips in this category.' : 'No clips yet. Play the game and tap a category when something happens.'));
      return;
    }
    $('clips').replaceChildren(...clips.map(clipCard));
  }

  function clipCard(c) {
    const cat = catById(c.categoryId);
    const card = el('div', { class: 'clip' + (c.id === selectedClipId ? ' sel' : ''), 'data-clip': c.id },
      el('div', { class: 'row', style: 'gap:8px; flex-wrap:nowrap' },
        el('span', { class: 'dot', style: 'background:' + (cat ? cat.color : '#64748B') }),
        el('button', { type: 'button', class: 'grow', style: 'border:none;background:none;padding:0;text-align:left;font-weight:600', onclick: () => selectClip(c.id, true) }, cat ? cat.name : 'Deleted category'),
        el('span', { class: 'small muted', style: 'font-variant-numeric:tabular-nums;white-space:nowrap' }, rangeText(c) + ' · ' + lenText(c))
      ),
      el('div', { class: 'meta' },
        el('span', {}, c.players.length ? c.players.map((p) => '#' + p).join(' ') : 'No players'),
        el('span', { class: 'pill ' + c.flag }, c.flag === 'work' ? 'Work on this' : 'Do this'),
        WP.hasRec(c) ? el('span', { class: 'pill recpill' }, '\u25CF Breakdown' + (c.rec.voice ? ' + voice' : '')) : (c.zoom ? el('span', { class: 'pill zoompill' }, zoomLabel(c.zoom)) : null),
        c.by ? el('span', {}, 'by ' + c.by) : null
      ),
      (WP.clipEvents(G, c).length || autoLine(G, c) || c.private || c.starred) ? el('div', { class: 'meta' }, ...evBadges(G, c), autoLine(G, c) ? el('span', {}, autoLine(G, c)) : '', c.starred ? el('span', { style: 'color:#CA8A04' }, '\u2605') : '', c.private ? el('span', { class: 'pill lockpill' }, '\uD83D\uDD12 Private') : '') : null,
      c.note ? el('div', { class: 'small' }, c.note) : null,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small', onclick: () => { selectedClipId = c.id; renderTimelineStatic(); renderClips(); applyZoom(c.zoom); player && player.playRange(c.start, c.end); } }, '▶ Play clip'),
        el('a', { class: 'btn small', href: '#edit/' + G.id + '/' + c.id, style: 'text-decoration:none' }, 'Edit'),
        c.exported ? el('span', { class: 'small muted', title: c.exported.name }, '\u2713 Exported') : null
      )
    );
    return card;
  }

  // =====================================================================
  // CLIP EDITOR (milestone 2a)
  // =====================================================================
  let E = null; // { clipId, d, player, raf, mode, tool, color, ctrl, drawDraft, holdActive, W, H, wa, wb, outT }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function edClip() { return E && G ? G.clips.find((c) => c.id === E.clipId) : null; }
  function edCtx() { return $('e-canvas').getContext('2d'); }
  function edBusy() { return E && (E.mode === 'export'); }
  function edRecording() { return E && (E.mode === 'record' || E.mode === 'countdown'); }

  function openEditor(gameId, clipId) {
    const game = S.games.find((g) => g.id === gameId);
    if (!game) { location.hash = 'games'; return false; }
    if (!G || G.id !== gameId) { if (!openGame(gameId)) return false; }
    const clip = G.clips.find((c) => c.id === clipId);
    if (!clip) { toast('That clip no longer exists', { err: true }); location.hash = 'tag/' + gameId; return false; }
    const files = session.files.get(gameId);
    if (!files) { toast('Reconnect the video files first'); location.hash = 'tag/' + gameId; return false; }
    if (player) player.pause();
    if (E && E.clipId === clipId && E.player) { renderEditor(); return true; }
    closeEditor();
    E = { clipId, d: clone(clip), mode: 'idle', tool: 'arrow', color: WP.COLORS.yellow, W: 1280, H: 568, outT: 0 };
    setWindow();
    E.player = createPlayer($('e-video'), files, TL, G.id, () => {});
    E.player.seek(clip.start).then(() => { if (E && E.clipId === clipId) renderEditor(); });
    renderEditor();
    const loop = () => { if (!E) return; drawStage(); E.raf = requestAnimationFrame(loop); };
    E.raf = requestAnimationFrame(loop);
    return true;
  }

  function closeEditor() {
    if (!E) return;
    if (E.ctrl) E.ctrl.abort();
    if (E.recStream) E.recStream.getTracks().forEach((tr) => tr.stop());
    if (E.recorder && E.recorder.state !== 'inactive') { try { E.recorder.stop(); } catch (e) { /* ignore */ } }
    cancelAnimationFrame(E.raf);
    if (E.player) E.player.destroy();
    E = null;
  }

  function setWindow() {
    const d = E.d;
    E.wa = Math.max(0, d.start - 10);
    E.wb = Math.min(TL.total, d.end + 10);
  }

  $('e-video').addEventListener('loadedmetadata', () => {
    if (!E) return;
    const v = $('e-video');
    const size = WP.exportSize(v.videoWidth, v.videoHeight, 1280);
    if (size.width !== E.W || size.height !== E.H) {
      E.W = size.width; E.H = size.height;
      $('e-canvas').width = E.W; $('e-canvas').height = E.H;
    }
  });

  function commit(patch, quiet) {
    const clip = edClip();
    if (!clip) return false;
    try {
      const next = WP.updateClip(clip, patch, TL.total);
      G.clips = G.clips.map((x) => (x.id === clip.id ? next : x));
      E.d = clone(next);
      save();
      const s = $('e-saved');
      s.textContent = 'Saved';
      clearTimeout(commit.t);
      commit.t = setTimeout(() => { s.textContent = ''; }, 1500);
      if (!quiet) renderEditor();
      return true;
    } catch (e) {
      toast(e.message, { err: true });
      renderEditor();
      return false;
    }
  }

  function recT() { return E && E.rec ? Math.max(0, (E.player.time() - E.d.start) / E.rec.rate) : 0; }

  function drawStage() {
    const d = E.d;
    const v = $('e-video');
    const t = E.player.time();
    const paused = !E.player.isPlaying();
    const cat = catById(d.categoryId);
    const title = d.titleBar !== false ? WP.titleLines(d, cat, G) : null;
    if (E.mode === 'record' && E.rec) {
      const rt = recT();
      WP.addRecKey(E.rec, rt, d.zoom);
      WPRender.renderFrame(edCtx(), v, { zoom: d.zoom, W: E.W, H: E.H, shapes: WP.recShapesAt(E.rec, WP.recOut(E.rec, rt)), draft: E.drawDraft || null, title });
      $('e-ov').replaceChildren(el('span', { class: 'recdot' }), 'REC ' + WP.formatTime(rt, true) + (E.rec.rate === 0.5 ? ' \u00b7 half speed' : '') + (E.rec.voice ? ' \u00b7 mic on' : ''));
      if (t >= d.end - 0.03 || (E.recStarted && paused)) stopRecording();
      const head0 = $('e-trim-head');
      if (head0) head0.style.left = trimPct(t) + '%';
      return;
    }
    if (WP.hasRec(d) && E.mode !== 'countdown') {
      const outT = E.mode === 'preview' ? E.outT : Math.max(0, (t - d.start) / WP.recExportRate(d.rec));
      WPRender.renderFrame(edCtx(), v, { zoom: WP.recZoomAt(d.rec, outT), W: E.W, H: E.H, shapes: WP.recShapesAt(d.rec, outT), title });
    } else {
      const atFreeze = d.freeze && Math.abs(t - d.freeze.at) < 0.06 && paused && E.mode !== 'preview';
      const showShapes = d.freeze && (E.mode === 'draw' || E.holdActive || atFreeze);
      WPRender.renderFrame(edCtx(), v, {
        zoom: d.zoom, W: E.W, H: E.H,
        shapes: showShapes ? d.freeze.shapes : null,
        draft: E.drawDraft || null,
        title
      });
    }
    const inClip = Math.max(0, t - d.start);
    $('e-ov').textContent = E.mode === 'preview'
      ? 'Finished clip ' + WP.formatTime(E.outT, true) + ' / ' + WP.formatTime(WP.planDuration(WP.buildPlan(d)), true)
      : 'Clip ' + WP.formatTime(Math.min(inClip, d.end - d.start), true) + ' · game ' + WP.formatTime(t, true);
    $('e-clock').textContent = 'Playhead ' + WP.formatTime(t, true);
    const head = $('e-trim-head');
    if (head) head.style.left = trimPct(t) + '%';
  }

  function trimPct(t) { return E.wb > E.wa ? ((t - E.wa) / (E.wb - E.wa)) * 100 : 0; }

  function renderEditor() {
    if (!E) return;
    const d = E.d;
    const cat = catById(d.categoryId);
    $('e-title').textContent = (cat ? cat.name : 'Clip') + ' · ' + rangeText(d);
    $('e-back').setAttribute('href', '#tag/' + G.id);
    const order = WP.sortClips(G.clips);
    const i = order.findIndex((c) => c.id === d.id);
    $('e-prev').disabled = i <= 0;
    $('e-next').disabled = i < 0 || i >= order.length - 1;
    $('e-prev').onclick = () => { if (i > 0) location.hash = 'edit/' + G.id + '/' + order[i - 1].id; };
    $('e-next').onclick = () => { if (i < order.length - 1) location.hash = 'edit/' + G.id + '/' + order[i + 1].id; };
    // trim bar
    const tr = $('e-trim');
    tr.replaceChildren(
      el('div', { class: 'range', style: 'left:' + trimPct(d.start) + '%;width:' + (trimPct(d.end) - trimPct(d.start)) + '%' }),
      ...(d.speeds || []).map((x) => el('div', { class: 'spd', style: 'left:' + trimPct(x.start) + '%;width:' + (trimPct(x.end) - trimPct(x.start)) + '%' }, x.rate + '×')),
      d.freeze ? el('div', { class: 'frz', style: 'left:' + trimPct(d.freeze.at) + '%', title: 'Freeze' }) : null,
      el('button', { type: 'button', class: 'handle', 'data-h': 'start', 'aria-label': 'Clip start ' + WP.formatTime(d.start), style: 'left:' + trimPct(d.start) + '%' }),
      el('button', { type: 'button', class: 'handle', 'data-h': 'end', 'aria-label': 'Clip end ' + WP.formatTime(d.end), style: 'left:' + trimPct(d.end) + '%' }),
      el('div', { class: 'head', id: 'e-trim-head' })
    );
    $('e-wa').textContent = WP.formatTime(E.wa);
    $('e-wb').textContent = WP.formatTime(E.wb);
    $('e-start').value = WP.formatTime(d.start, true);
    $('e-end').value = WP.formatTime(d.end, true);
    const plan = WP.buildPlan(d);
    $('e-len').textContent = 'Clip ' + Math.round((d.end - d.start) * 10) / 10 + ' s → finished video ' + Math.round(WP.planDuration(plan) * 10) / 10 + ' s';
    renderFreezePanel();
    renderSpeedPanel();
    renderRecPanel();
    $('e-edits').classList.toggle('dim', WP.hasRec(d) || E.mode === 'record' || E.mode === 'countdown');
    $('stage').classList.toggle('recording', E.mode === 'record');
    // details
    $('e-cat').replaceChildren(...S.settings.categories.map((x) => el('option', { value: x.id }, x.name + (x.hidden ? ' (hidden)' : ''))));
    $('e-cat').value = d.categoryId;
    $('e-chips').replaceChildren(...S.settings.roster.map((p) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(d.players.includes(p.number)), title: p.name || null,
      onclick: () => {
        const has = d.players.includes(p.number);
        commit({ players: has ? d.players.filter((n) => n !== p.number) : d.players.concat([p.number]) });
      }
    }, '#' + p.number)));
    $('e-chips').hidden = !S.settings.roster.length;
    if (document.activeElement !== $('e-players')) $('e-players').value = d.players.join(', ');
    for (const b of $('e-flag').children) b.setAttribute('aria-pressed', String(b.dataset.flag === d.flag));
    if (document.activeElement !== $('e-note')) $('e-note').value = d.note;
    $('e-zoom-text').textContent = d.zoom ? zoomLabel(d.zoom) : 'Whole rink';
    $('ez-level').textContent = (d.zoom ? Math.round(d.zoom.scale * 10) / 10 : 1) + '×';
    $('stage').classList.toggle('zoomed', !!d.zoom && E.mode !== 'draw');
    $('stage').classList.toggle('draw', E.mode === 'draw');
    $('e-title-on').checked = d.titleBar !== false;
    renderEditorTags();
    $('e-export-note').textContent = d.exported
      ? 'Last exported ' + new Date(d.exported.at).toLocaleString() + ' as “' + d.exported.name + '”'
      : 'Makes a ' + E.W + '×' + E.H + ' MP4 on this computer. Drive sharing comes in milestone 3.';
    $('e-ov-mode').classList.toggle('hidden', E.mode !== 'draw');
    $('e-ov-mode').textContent = 'Drawing — drag on the picture';
    $('e-play-label').textContent = E.mode === 'preview' ? '⏸ Stop preview' : '▶ Preview finished clip';
    const busy = edBusy() || E.mode === 'record' || E.mode === 'countdown';
    for (const id of ['e-export', 'e-play', 'e-delete']) $(id).disabled = busy;
    if (busy) { $('e-prev').disabled = true; $('e-next').disabled = true; }
  }

  function renderFreezePanel() {
    const d = E.d;
    const box = $('e-freeze');
    const t = E.player ? E.player.time() : d.start;
    if (!d.freeze) {
      const inside = t >= d.start - 0.01 && t <= d.end + 0.01;
      box.replaceChildren(
        el('span', { class: 'small muted' }, 'Pause on the moment you want to explain, then freeze it. The video holds that frame with your drawings, then plays on.'),
        el('button', { type: 'button', class: 'btn outline', id: 'e-freeze-here', disabled: !inside, onclick: () => {
          E.player.pause();
          const at = E.player.time();
          if (commit({ freeze: WP.setFreeze(E.d, at, WP.DEFAULT_HOLD) })) enterDraw();
        } }, 'Freeze here and draw'),
        inside ? '' : el('span', { class: 'small', style: 'color:var(--work)' }, 'Move the playhead inside the clip first.')
      );
      return;
    }
    const f = d.freeze;
    const tool = (id, label) => el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(E.tool === id && E.mode === 'draw'), onclick: () => { E.tool = id; enterDraw(); } }, label);
    const sw = (name, hex) => el('button', { type: 'button', class: 'swatch', 'aria-label': name, 'aria-pressed': String(E.color === hex), style: 'background:' + hex, onclick: () => { E.color = hex; if (E.mode !== 'draw') enterDraw(); else renderEditor(); } });
    const holdSel = el('select', { 'aria-label': 'Hold length', style: 'min-height:36px', onchange: (e) => commit({ freeze: WP.setFreeze(E.d, f.at, Number(e.target.value)) }) },
      ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => el('option', { value: String(n) }, n + ' s')));
    holdSel.value = String(f.hold);
    box.replaceChildren(
      el('div', { class: 'row' }, el('span', {}, 'Frozen at ' + WP.formatTime(f.at, true) + ' for'), holdSel),
      el('div', { class: 'row' }, tool('arrow', 'Arrow'), tool('circle', 'Circle'), tool('free', 'Freehand')),
      el('div', { class: 'row' }, sw('Yellow', WP.COLORS.yellow), sw('White', WP.COLORS.white), sw('Red', WP.COLORS.red),
        el('button', { type: 'button', class: 'btn small', disabled: !f.shapes.length, onclick: undoShape }, 'Undo'),
        el('button', { type: 'button', class: 'btn small', disabled: !f.shapes.length, onclick: () => commit({ freeze: Object.assign({}, f, { shapes: [] }) }) }, 'Clear')),
      el('span', { class: 'small muted' }, f.shapes.length + (f.shapes.length === 1 ? ' drawing' : ' drawings') + (E.mode === 'draw' ? ' · drag on the picture to draw' : '')),
      el('div', { class: 'row' },
        E.mode === 'draw'
          ? el('button', { type: 'button', class: 'btn small primary', onclick: exitDraw }, 'Done drawing')
          : el('button', { type: 'button', class: 'btn small', onclick: enterDraw }, 'Go to freeze and draw'),
        el('button', { type: 'button', class: 'btn small', onclick: () => {
          const at = E.player.time();
          if (commit({ freeze: WP.setFreeze(E.d, at, f.hold) })) enterDraw();
        } }, 'Move freeze to playhead'),
        el('button', { type: 'button', class: 'btn small danger', onclick: () => { exitDraw(true); commit({ freeze: null }); } }, 'Remove freeze'))
    );
  }


  // ---- record a breakdown (milestone 2b) ----
  function renderRecPanel() {
    if (!E) return;
    const d = E.d;
    const box = $('e-rec');
    $('e-rec-sum').textContent = WP.hasRec(d) ? WP.recSummary(d.rec) : '';
    if (E.mode === 'record' || E.mode === 'countdown') {
      const tool = (id, label) => el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(E.recDraw && E.tool === id), onclick: () => { E.tool = id; E.recDraw = true; renderRecPanel(); } }, label);
      const sw = (name, hex) => el('button', { type: 'button', class: 'swatch', 'aria-label': name, 'aria-pressed': String(E.color === hex), style: 'background:' + hex, onclick: () => { E.color = hex; E.recDraw = true; renderRecPanel(); } });
      box.replaceChildren(
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(!E.recDraw), onclick: () => { E.recDraw = false; renderRecPanel(); } }, 'Move / zoom'),
          tool('arrow', 'Arrow'), tool('circle', 'Circle'), tool('free', 'Freehand'),
          sw('Yellow', WP.COLORS.yellow), sw('White', WP.COLORS.white), sw('Red', WP.COLORS.red),
          el('button', { type: 'button', class: 'btn small', onclick: () => E.rec && WP.addRecClear(E.rec, recT()) }, 'Clear drawings'),
          el('button', { type: 'button', class: 'btn small danger', id: 'e-rec-stop', onclick: () => stopRecording() }, '\u25A0 Stop')),
        el('span', { class: 'small muted' }, 'Scroll to zoom, drag to move. Press D to switch between moving and drawing, C to clear drawings, Esc to stop. Drawings fade after 3 s.' + (E.rec ? ' ' + (E.rec.shapes.length) + ' drawings so far.' : ''))
      );
      return;
    }
    const voiceCb = el('input', { type: 'checkbox', id: 'e-rec-voice', style: 'width:20px;height:20px;flex:none' });
    const halfCb = el('input', { type: 'checkbox', id: 'e-rec-half', style: 'width:20px;height:20px;flex:none' });
    voiceCb.checked = E.recOpts ? E.recOpts.voice : true;
    halfCb.checked = E.recOpts ? E.recOpts.half : true;
    const opts = el('div', { class: 'row', style: 'gap:16px' },
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px' }, voiceCb, 'Voice-over (uses the microphone)'),
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px' }, halfCb, 'Record at half speed'));
    const startBtn = el('button', { type: 'button', class: 'btn primary', id: 'e-rec-start', disabled: edBusy() || E.mode === 'preview', onclick: () => startRecording({ voice: voiceCb.checked, half: halfCb.checked }) },
      WP.hasRec(d) ? '\u25CF Record again' : '\u25CF Record breakdown');
    const rule = el('span', { class: 'small muted' }, 'The clip plays from its start while you zoom, drag and draw' + ' \u2014 and talk, with voice-over on. With voice, the finished video plays at the speed you recorded so your words stay in sync; without voice it plays at normal speed.');
    if (WP.hasRec(d)) {
      box.replaceChildren(
        el('span', { class: 'small' }, 'The export uses this recording. Slow-motion sections, freeze and the fixed zoom aren\u2019t used while it exists.'),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small', onclick: () => startPreview() }, '\u25B6 Play recording'),
          el('button', { type: 'button', class: 'btn small danger', onclick: () => { if (!confirm('Delete this recording?')) return; idb.del('voice:' + d.id); commit({ rec: null }); } }, 'Delete recording')),
        opts, startBtn);
    } else box.replaceChildren(rule, opts, startBtn);
  }

  async function startRecording(opts) {
    if (!E || edBusy() || edRecording()) return;
    stopPreview();
    exitDraw(true);
    E.recOpts = opts;
    const d = E.d;
    let stream = null;
    if (opts.voice) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('This browser can\u2019t record sound. Use Chrome or Edge.', { err: true }); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
      catch (e) { toast('Microphone not available: ' + (e.name === 'NotAllowedError' ? 'permission was refused' : e.message), { err: true }); return; }
    }
    E.mode = 'countdown';
    E.recStarted = false;
    E.rec = WP.newRecording(opts.half ? 0.5 : 1, opts.voice);
    E.recDraw = false;
    E.recStream = stream;
    E.d.zoom = null;
    renderEditor();
    showStage();
    E.player.pause();
    E.player.setRate(E.rec.rate);
    await E.player.seek(d.start);
    const cd = $('e-count');
    cd.classList.remove('hidden');
    for (const n of ['3', '2', '1']) {
      if (!E || E.mode !== 'countdown') { cd.classList.add('hidden'); return; }
      cd.textContent = n;
      await new Promise((r) => setTimeout(r, 700));
    }
    cd.classList.add('hidden');
    if (!E || E.mode !== 'countdown') return;
    E.recChunks = [];
    if (stream) {
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      E.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      E.recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) E.recChunks.push(ev.data); };
      E.recorder.start(250);
    }
    WP.addRecKey(E.rec, 0, null, true);
    E.mode = 'record';
    renderEditor();
    E.player.resume();
    setTimeout(() => { if (E) E.recStarted = true; }, 400);
  }

  async function stopRecording() {
    if (!E || !edRecording() || E.stopping) return;
    if (E.mode === 'countdown') {
      E.mode = 'idle';
      if (E.recStream) E.recStream.getTracks().forEach((t) => t.stop());
      E.recStream = null;
      E.rec = null;
      E.player.setRate(1);
      E.d = clone(edClip());
      renderEditor();
      return;
    }
    E.stopping = true;
    const rec = E.rec;
    const atEnd = E.player.time() >= E.d.end - 0.1;
    rec.duration = atEnd ? Math.round(((E.d.end - E.d.start) / rec.rate) * 100) / 100 : Math.round(recT() * 100) / 100;
    WP.addRecKey(rec, rec.duration, E.d.zoom, true);
    E.player.pause();
    let blob = null;
    if (E.recorder) {
      const r = E.recorder;
      await new Promise((res) => { r.onstop = res; try { r.stop(); } catch (e) { res(); } });
      blob = new Blob(E.recChunks, { type: r.mimeType || 'audio/webm' });
      E.recorder = null;
    }
    if (E.recStream) { E.recStream.getTracks().forEach((t) => t.stop()); E.recStream = null; }
    E.mode = 'idle';
    E.stopping = false;
    E.player.setRate(1);
    const clipId = E.d.id;
    E.rec = null;
    if (rec.duration < 1) { toast('Recording too short \u2014 nothing saved', { err: true }); renderEditor(); return; }
    if (rec.voice) {
      if (!blob || !blob.size) { toast('No sound was recorded \u2014 check the microphone', { err: true }); renderEditor(); return; }
      await idb.put('voice:' + clipId, blob);
    }
    commit({ rec });
    toast(WP.recSummary(rec) + '. Press Play recording to watch it.', { ms: 6000 });
    E.player.seek(E.d.start);
  }

  function undoShape() {
    const f = E.d.freeze;
    if (!f || !f.shapes.length) return;
    commit({ freeze: Object.assign({}, f, { shapes: f.shapes.slice(0, -1) }) });
  }

  function enterDraw() {
    if (!E.d.freeze || edBusy()) return;
    stopPreview();
    E.player.pause();
    E.player.seek(E.d.freeze.at);
    E.mode = 'draw';
    renderEditor();
    showStage();
  }

  function showStage() {
    const r = $('stage').getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) $('stage').scrollIntoView({ block: 'start' });
  }

  function exitDraw(quiet) {
    if (E.mode !== 'draw') return;
    E.mode = 'idle';
    E.drawDraft = null;
    if (!quiet) renderEditor();
  }

  function renderSpeedPanel() {
    const d = E.d;
    const list = d.speeds || [];
    const rows = list.map((x) => {
      const rate = el('select', { 'aria-label': 'Speed', style: 'min-height:36px', onchange: (e) => commit({ speeds: WP.updateSpeed(E.d, x.id, { rate: Number(e.target.value) }) }) },
        el('option', { value: '0.25' }, '0.25× slow'), el('option', { value: '0.5' }, '0.5× slow'), el('option', { value: '1.5' }, '1.5× fast'), el('option', { value: '2' }, '2× fast'));
      rate.value = String(x.rate);
      const timeIn = (key) => el('input', { type: 'text', class: 'time', value: WP.formatTime(x[key], true), 'aria-label': key === 'start' ? 'Speed section start' : 'Speed section end', style: 'width:84px',
        onchange: (e) => {
          const v = WP.parseTime(e.target.value);
          if (!Number.isFinite(v)) { toast('Use m:ss, e.g. 4:09.5', { err: true }); renderEditor(); return; }
          try { commit({ speeds: WP.updateSpeed(E.d, x.id, { [key]: v }) }); } catch (err) { toast(err.message, { err: true }); renderEditor(); }
        } });
      const now = (key, label) => el('button', { type: 'button', class: 'btn small', onclick: () => {
        try { commit({ speeds: WP.updateSpeed(E.d, x.id, { [key]: E.player.time() }) }); } catch (err) { toast(err.message, { err: true }); }
      } }, label);
      return el('div', { class: 'spdrow' }, rate, el('span', { class: 'small muted' }, 'from'), timeIn('start'), now('start', 'Start = playhead'),
        el('span', { class: 'small muted' }, 'to'), timeIn('end'), now('end', 'End = playhead'),
        el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove speed section', onclick: () => commit({ speeds: WP.removeSpeed(E.d, x.id) }) }, 'Remove'));
    });
    $('e-speeds').replaceChildren(...[
      list.length ? null : el('span', { class: 'small muted' }, 'Slow down (or speed up) part of the clip. Move the playhead to where it should start, then add a section.'),
      ...rows,
      el('button', { type: 'button', class: 'btn outline small', disabled: list.length >= WP.MAX_SPEEDS, style: 'align-self:flex-start', onclick: () => {
        try { commit({ speeds: WP.addSpeed(E.d, E.player.time(), 0.5) }); } catch (err) { toast(err.message, { err: true }); }
      } }, list.length >= WP.MAX_SPEEDS ? 'Up to 3 sections' : 'Add slow-motion section at playhead')
    ].filter(Boolean));
  }

  // ---- preview (same timing as the export) ----
  async function startPreview() {
    if (!E || edBusy() || edRecording()) return;
    exitDraw(true);
    E.ctrl = new AbortController();
    E.mode = 'preview';
    E.outT = 0;
    renderEditor();
    let audio = null;
    if (WP.hasRec(E.d) && E.d.rec.voice) {
      const blob = await idb.get('voice:' + E.d.id);
      if (blob) { audio = new Audio(URL.createObjectURL(blob)); audio.preload = 'auto'; }
      else toast('The voice-over for this clip isn\u2019t on this computer.', { err: true });
    }
    try {
      await WPRender.runPlan(E.player, $('e-video'), WP.buildPlan(E.d), {
        mode: 'preview', signal: E.ctrl.signal,
        onFrame: (s, outT) => { if (E) E.outT = outT; },
        onTick: (outT) => { if (E) E.outT = outT; },
        onSegment: (seg) => {
          if (E) E.holdActive = seg.kind === 'hold';
          if (audio && seg.outStart === 0) { audio.currentTime = 0; audio.play().catch(() => {}); }
        }
      });
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, { err: true }); }
    if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); }
    if (!E) return;
    E.holdActive = false;
    if (E.mode === 'preview') E.mode = 'idle';
    E.ctrl = null;
    renderEditor();
  }

  function stopPreview() {
    if (E && E.mode === 'preview' && E.ctrl) E.ctrl.abort();
  }

  $('e-play').addEventListener('click', () => { if (E.mode === 'preview') stopPreview(); else startPreview(); });
  const edSeek = (t) => { if (!E || edBusy()) return; stopPreview(); exitDraw(); E.player.pause(); E.player.seek(Math.max(0, Math.min(TL.total, t))); setTimeout(() => E && renderFreezePanel(), 120); };
  $('e-back1').addEventListener('click', () => edSeek(E.player.time() - 1));
  $('e-fwd1').addEventListener('click', () => edSeek(E.player.time() + 1));
  $('e-frame-b').addEventListener('click', () => edSeek(E.player.time() - 1 / 30));
  $('e-frame-f').addEventListener('click', () => edSeek(E.player.time() + 1 / 30));

  // ---- trim bar ----
  (function () {
    const tr = $('e-trim');
    let drag = null;
    const tAt = (e) => {
      const r = tr.getBoundingClientRect();
      return Math.round((E.wa + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (E.wb - E.wa)) * 10) / 10;
    };
    tr.addEventListener('pointerdown', (e) => {
      if (!E || edBusy() || edRecording()) return;
      const h = e.target.closest('.handle');
      tr.setPointerCapture(e.pointerId);
      stopPreview(); exitDraw();
      if (h) { drag = { which: h.dataset.h, el: h }; return; }
      drag = { which: 'seek' };
      edSeek(tAt(e));
    });
    tr.addEventListener('pointermove', (e) => {
      if (!drag || !E) return;
      const t = tAt(e);
      if (drag.which === 'seek') { E.player.seek(t); return; }
      const d = E.d;
      const v = drag.which === 'start' ? Math.min(t, d.end - WP.MIN_CLIP) : Math.max(t, d.start + WP.MIN_CLIP);
      drag.value = v;
      drag.el.style.left = trimPct(v) + '%';
      const range = tr.querySelector('.range');
      const a = drag.which === 'start' ? v : d.start;
      const b = drag.which === 'end' ? v : d.end;
      range.style.left = trimPct(a) + '%';
      range.style.width = (trimPct(b) - trimPct(a)) + '%';
      E.player.seek(v);
    });
    const end = () => {
      if (!drag || !E) { drag = null; return; }
      const dd = drag;
      drag = null;
      if (dd.which === 'start' || dd.which === 'end') {
        if (dd.value != null && okToRetrim()) commit({ [dd.which]: dd.value });
        setWindow();
        renderEditor();
      } else renderFreezePanel();
    };
    tr.addEventListener('pointerup', end);
    tr.addEventListener('pointercancel', end);
  })();

  const okToRetrim = () => !WP.hasRec(E.d) || confirm('Changing the trim deletes the recorded breakdown. Continue?');
  const setTrim = (key, v) => {
    if (!Number.isFinite(v)) { toast('Use m:ss, e.g. 4:09.5', { err: true }); renderEditor(); return; }
    if (v !== E.d[key] && !okToRetrim()) { renderEditor(); return; }
    if (commit({ [key]: v })) { setWindow(); renderEditor(); }
  };
  $('e-start').addEventListener('change', (e) => setTrim('start', WP.parseTime(e.target.value)));
  $('e-end').addEventListener('change', (e) => setTrim('end', WP.parseTime(e.target.value)));
  $('e-start-now').addEventListener('click', () => setTrim('start', Math.round(E.player.time() * 10) / 10));
  $('e-end-now').addEventListener('click', () => setTrim('end', Math.round(E.player.time() * 10) / 10));

  // ---- stage: draw or zoom ----
  (function () {
    const cv = $('e-canvas');
    const frac = (e) => { const r = cv.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, r }; };
    let act = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!E || edBusy() || e.button !== 0) return;
      const { fx, fy, r } = frac(e);
      cv.setPointerCapture(e.pointerId);
      if (E.mode === 'countdown') return;
      if (E.mode === 'draw' || (E.mode === 'record' && E.recDraw)) {
        const p = WP.viewToFrame(E.d.zoom, fx, fy);
        E.drawDraft = { type: E.tool, color: E.color, pts: [[p.x, p.y], [p.x, p.y]] };
        act = { kind: 'draw', x: e.clientX, y: e.clientY };
      } else if (E.d.zoom) {
        act = { kind: 'pan', x: e.clientX, y: e.clientY, z: E.d.zoom, r };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!act || !E) return;
      const { fx, fy } = frac(e);
      if (act.kind === 'draw') {
        const p = WP.viewToFrame(E.d.zoom, fx, fy);
        const pt = [Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y))];
        if (E.drawDraft.type === 'free') E.drawDraft.pts.push(pt); else E.drawDraft.pts[1] = pt;
      } else if (act.kind === 'pan') {
        E.d.zoom = WP.panZoom(act.z, (e.clientX - act.x) / act.r.width, (e.clientY - act.y) / act.r.height);
      }
    });
    const end = (e) => {
      if (!act || !E) { act = null; return; }
      const a = act;
      act = null;
      if (a.kind === 'draw') {
        const moved = Math.hypot(e.clientX - a.x, e.clientY - a.y) > 6;
        const shape = E.drawDraft;
        E.drawDraft = null;
        if (moved && shape) {
          try {
            if (E.mode === 'record') { WP.addRecShape(E.rec, recT(), shape); renderRecPanel(); }
            else commit({ freeze: WP.addShape(E.d.freeze, shape) });
          } catch (err) { toast(err.message, { err: true }); }
        }
      } else if (a.kind === 'pan' && E.mode !== 'record') commit({ zoom: E.d.zoom }, true);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (!E || edBusy() || E.mode === 'draw' || E.mode === 'countdown') return;
      if (WP.hasRec(E.d) && E.mode !== 'record') return;
      e.preventDefault();
      const { fx, fy } = frac(e);
      const z = WP.zoomAt(E.d.zoom || WP.FIT, e.deltaY < 0 ? 1.15 : 1 / 1.15, fx, fy);
      E.d.zoom = WP.isZoomed(z) ? z : null;
      clearTimeout(cv.t);
      if (E.mode !== 'record') cv.t = setTimeout(() => commit({ zoom: E.d.zoom }), 250);
      $('ez-level').textContent = (E.d.zoom ? Math.round(E.d.zoom.scale * 10) / 10 : 1) + '×';
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      if (!E || edBusy() || E.mode === 'draw' || E.mode === 'countdown') return;
      const { fx, fy } = frac(e);
      setEdZoom(E.d.zoom ? null : WP.zoomAt(WP.FIT, 2.5, fx, fy));
    });
  })();
  function setEdZoom(z) {
    const v = z && WP.isZoomed(z) ? z : null;
    if (E.mode === 'record') { E.d.zoom = v; $('ez-level').textContent = (v ? Math.round(v.scale * 10) / 10 : 1) + '\u00d7'; }
    else if (WP.hasRec(E.d)) toast('This clip uses its recorded zoom moves. Delete the recording to set a fixed zoom.');
    else commit({ zoom: v });
  }
  $('ez-in').addEventListener('click', () => setEdZoom(WP.zoomAt(E.d.zoom || WP.FIT, 1.25)));
  $('ez-out').addEventListener('click', () => setEdZoom(WP.zoomAt(E.d.zoom || WP.FIT, 1 / 1.25)));
  $('ez-fit').addEventListener('click', () => setEdZoom(null));

  // ---- details ----
  $('e-cat').addEventListener('change', (e) => commit({ categoryId: e.target.value }));
  $('e-players').addEventListener('change', (e) => commit({ players: e.target.value.split(/[ ,]+/) }));
  $('e-note').addEventListener('change', (e) => commit({ note: e.target.value }));
  for (const b of $('e-flag').children) b.addEventListener('click', () => commit({ flag: b.dataset.flag }));
  $('e-title-on').addEventListener('change', (e) => commit({ titleBar: e.target.checked }));
  $('e-delete').addEventListener('click', () => {
    if (!confirm('Delete this clip?')) return;
    const id = E.clipId;
    const gid = G.id;
    closeEditor();
    location.hash = 'tag/' + gid;
    setTimeout(() => removeClip(id), 0);
  });

  // ---- export ----
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportCurrent() {
    if (!E || edBusy() || edRecording()) return;
    stopPreview();
    exitDraw(true);
    const d = E.d;
    const cat = catById(d.categoryId);
    const name = WP.exportFileName(d, cat, G);
    const dests = chosenDests(d);
    if (!destPick.local && !dests.length) { toast('Choose where to save the MP4 (this computer or a Drive folder)', { err: true }); return; }
    let handle = null;
    if (destPick.local && window.showSaveFilePicker && !navigator.webdriver) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (e) {
        if (e.name === 'AbortError') return;
        handle = null;
      }
    }
    E.ctrl = new AbortController();
    E.mode = 'export';
    $('e-exporting').classList.remove('hidden');
    renderEditor();
    const setPct = (p) => { $('e-pct').textContent = Math.round(p * 100) + '%'; $('e-bar').style.width = (p * 100) + '%'; };
    setPct(0);
    try {
      const rec = WP.hasRec(d) ? d.rec : null;
      let voiceBlob = null;
      if (rec && rec.voice) {
        voiceBlob = await idb.get('voice:' + d.id);
        if (!voiceBlob) throw new Error('the voice-over for this clip isn\u2019t on this computer. Record it again.');
      }
      const res = await WPRender.exportClip({
        player: E.player, video: $('e-video'), plan: WP.buildPlan(d), W: E.W, H: E.H,
        zoom: d.zoom, shapes: d.freeze ? d.freeze.shapes : [], title: d.titleBar !== false ? WP.titleLines(d, cat, G) : null,
        frameAt: rec ? (outT) => ({ zoom: WP.recZoomAt(rec, outT), shapes: WP.recShapesAt(rec, outT) }) : null,
        voiceBlob,
        signal: E.ctrl.signal, onProgress: setPct
      });
      const finalName = handle ? handle.name : name;
      if (handle) {
        const w = await handle.createWritable();
        await w.write(res.blob);
        await w.close();
      } else if (destPick.local) downloadBlob(name, res.blob);
      if (dests.length) {
        $('e-pct').textContent = 'uploading to Drive\u2026';
        try {
          const up = await uploadToDrive(d, res.blob, name, dests, (dest) => { $('e-pct').textContent = 'uploading to ' + WP.destLabel(dest, S.settings.roster) + '\u2026'; });
          commit({ drive: up.list }, true);
          toast('Saved to Drive: ' + up.done.map((x) => WP.destLabel(x, S.settings.roster)).join(', '), { ms: 7000 });
        } catch (err) { toast('Drive upload failed: ' + err.message, { err: true, ms: 10000 }); }
      }
      window.__bwp.lastExport = { dests, name: finalName, size: res.blob.size, codec: res.codec, h264: res.h264, audio: res.audio, frames: res.frames, duration: res.duration, blob: res.blob };
      E.mode = 'idle';
      commit({ exported: { at: Date.now(), name: finalName, size: res.blob.size, codec: res.codec } });
      const mb = (res.blob.size / 1e6).toFixed(1);
      if (destPick.local) toast('Saved “' + finalName + '” (' + mb + ' MB)' + (res.h264 ? '' : ' — this browser made VP9 video, which may not play on iPhones. Use Chrome or Edge on Windows for H.264.'), { ms: 8000 });
    } catch (e) {
      if (e.name === 'AbortError') toast('Export cancelled');
      else toast('Export failed: ' + e.message, { err: true, ms: 8000 });
    } finally {
      if (E) {
        E.mode = 'idle';
        E.ctrl = null;
        $('e-exporting').classList.add('hidden');
        renderEditor();
        E.player.seek(E.d.start);
      }
    }
  }
  $('e-export').addEventListener('click', exportCurrent);
  $('e-cancel').addEventListener('click', () => E && E.ctrl && E.ctrl.abort());

  function editorKey(e) {
    if (!E || edBusy()) return;
    if (edRecording()) {
      const tg = (e.target.tagName || '').toLowerCase();
      if (tg === 'input' || tg === 'select' || tg === 'textarea') return;
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); stopRecording(); }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); E.recDraw = !E.recDraw; renderRecPanel(); }
      else if ((e.key === 'c' || e.key === 'C') && E.rec) { e.preventDefault(); WP.addRecClear(E.rec, recT()); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setEdZoom(WP.zoomAt(E.d.zoom || WP.FIT, 1.25)); }
      else if (e.key === '-') { e.preventDefault(); setEdZoom(WP.zoomAt(E.d.zoom || WP.FIT, 1 / 1.25)); }
      else if (e.key === '0') { e.preventDefault(); setEdZoom(null); }
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && E.mode === 'draw') { e.preventDefault(); undoShape(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (E.mode === 'preview') stopPreview(); else startPreview(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); edSeek(E.player.time() - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); edSeek(E.player.time() + 1); }
    else if (k === ',') { e.preventDefault(); edSeek(E.player.time() - 1 / 30); }
    else if (k === '.') { e.preventDefault(); edSeek(E.player.time() + 1 / 30); }
    else if (k === 'Escape') { exitDraw(); }
  }

  // ---- keyboard ----
  document.addEventListener('keydown', (e) => {
    if (!$('view-edit').classList.contains('hidden')) { editorKey(e); return; }
    if ($('view-tag').classList.contains('hidden') || !G) return;
    if ($('dlg-manual').open) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); player && player.toggle(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); player && player.nudge(e.shiftKey ? -1 : -5); }
    else if (k === 'ArrowRight') { e.preventDefault(); player && player.nudge(e.shiftKey ? 1 : 5); }
    else if (k === 'i' || k === 'I') { e.preventDefault(); markIn(); }
    else if (k === 'o' || k === 'O') { e.preventDefault(); markOut(); }
    else if (k === 'Escape') { cancelMarks(); }
    else if (k === '+' || k === '=') { e.preventDefault(); applyZoom(WP.zoomAt(zoom, 1.25)); }
    else if (k === '-' || k === '_') { e.preventDefault(); applyZoom(WP.zoomAt(zoom, 1 / 1.25)); }
    else if (k === '0') { e.preventDefault(); applyZoom(WP.FIT); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); markPeriod(); }
    else if (k === 'g') { e.preventDefault(); markGoal('for'); }
    else if (k === 'G') { e.preventDefault(); markGoal('against'); }
    else if (/^[1-9]$/.test(k)) {
      const cat = WP.categoryForKey(S.settings.categories, k);
      if (cat) { e.preventDefault(); onCategory(cat); }
    }
  });

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function renderSettings() {
    renderWho();
    renderTeamSettings();
    $('app-version').textContent = 'v' + WP.APP_VERSION;
    $('app-released').textContent = 'Released ' + WP.formatDate(WP.APP_RELEASED);
    $('app-schema').textContent = String(WP.SCHEMA_VERSION);
    $('s-coach').value = S.settings.coachName;
    const keyed = WP.keyedCategories(S.settings.categories);
    const keyOf = (id) => (keyed.find((k) => k.id === id) || {}).key;
    const cats = S.settings.categories;
    $('cat-rows').replaceChildren(...cats.map((c, i) => {
      const inUse = WP.categoryInUse(S.games, c.id);
      const upd = (patch) => {
        try { S.settings.categories = WP.updateCategory(S.settings.categories, c.id, patch); teamChanged(); }
        catch (e) { toast(e.message, { err: true }); }
        renderSettings();
      };
      return el('tr', {},
        el('td', { class: 'muted' }, keyOf(c.id) || '–'),
        el('td', {}, el('input', { type: 'color', value: c.color, 'aria-label': 'Colour for ' + c.name, onchange: (e) => upd({ color: e.target.value }) })),
        el('td', {}, el('input', { type: 'text', value: c.name, 'aria-label': 'Name', style: 'width:100%;min-width:160px', onchange: (e) => upd({ name: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.before), 'aria-label': 'Seconds before for ' + c.name, onchange: (e) => upd({ before: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.after), 'aria-label': 'Seconds after for ' + c.name, onchange: (e) => upd({ after: e.target.value }) })),
        el('td', {}, el('input', { type: 'checkbox', checked: !c.hidden, 'aria-label': 'Show ' + c.name, style: 'width:20px;height:20px', onchange: (e) => upd({ hidden: !e.target.checked }) })),
        el('td', { style: 'white-space:nowrap' },
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' up', disabled: i === 0, onclick: () => { S.settings.categories = WP.moveCategory(cats, c.id, -1); teamChanged(); renderSettings(); } }, '↑'),
          ' ',
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' down', disabled: i === cats.length - 1, onclick: () => { S.settings.categories = WP.moveCategory(cats, c.id, 1); teamChanged(); renderSettings(); } }, '↓'),
          ' ',
          el('button', {
            type: 'button', class: 'btn small danger', disabled: inUse, title: inUse ? 'Has clips — hide it instead' : null, 'aria-label': 'Delete ' + c.name,
            onclick: () => { try { S.settings.categories = WP.removeCategory(cats, c.id, S.games); teamChanged(); renderSettings(); } catch (e) { toast(e.message, { err: true }); } }
          }, 'Delete')
        )
      );
    }));
    $('roster').replaceChildren(...(S.settings.roster.length ? S.settings.roster.map((p) => el('button', {
      type: 'button', class: 'chip', 'aria-label': 'Remove #' + p.number + (p.name ? ' ' + p.name : ''),
      onclick: () => { S.settings.roster = WP.removePlayer(S.settings.roster, p.number); teamChanged(); renderSettings(); }
    }, '#' + p.number + (p.name ? ' ' + p.name : '') + ' ✕')) : [el('span', { class: 'small muted' }, 'No players yet.')]));
  }

  $('s-coach').addEventListener('change', (e) => { S.settings.coachName = e.target.value.trim().slice(0, 40); save(); renderWho(); });
  $('cat-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.categories = WP.addCategory(S.settings.categories, $('cat-new').value, '#475569');
      $('cat-new').value = '';
      teamChanged(); renderSettings();
    } catch (err) { toast(err.message, { err: true }); }
  });
  $('roster-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.roster = WP.addPlayer(S.settings.roster, $('r-num').value, $('r-name').value);
      $('r-num').value = ''; $('r-name').value = '';
      teamChanged(); renderSettings(); $('r-num').focus();
    } catch (err) { toast(err.message, { err: true }); }
  });


  // =====================================================================
  // SHARED TEAM DATA IN GOOGLE DRIVE (milestone 3a)
  // =====================================================================
  const Team = { busy: false, again: false, lastErr: null, account: null };
  let pushTimer = 0;

  function teamChanged() {
    if (S.sync) S.sync.dirty = true;
    save();
    renderSyncBadge();
    clearTimeout(pushTimer);
    if (S.sync && WPDrive.hasToken()) pushTimer = setTimeout(() => syncNow(false), 1200);
  }

  function renderSyncBadge() {
    const b = $('sync-badge');
    if (!b) return;
    if (!S.sync) { b.textContent = ''; b.className = 'syncbadge'; return; }
    if (Team.busy) { b.textContent = 'Syncing team data…'; b.className = 'syncbadge'; return; }
    if (Team.lastErr) { b.textContent = 'Team data: sync problem'; b.className = 'syncbadge warn'; return; }
    if (S.sync.dirty) { b.textContent = 'Team data: not synced yet'; b.className = 'syncbadge warn'; return; }
    b.textContent = 'Team data synced';
    b.className = 'syncbadge ok';
  }

  async function ensureSignedIn() {
    if (WPDrive.hasToken()) return;
    await WPDrive.signIn(S.sync && S.sync.account);
  }

  async function syncNow(interactive) {
    if (!S.sync || !S.sync.fileId) return;
    if (!WPDrive.hasToken()) {
      if (!interactive) { renderSyncBadge(); renderTeamCard(); return; }
      try { await ensureSignedIn(); } catch (e) { toast(e.message, { err: true }); return; }
    }
    if (Team.busy) { Team.again = true; return; }
    Team.busy = true;
    renderSyncBadge(); renderTeamCard();
    try {
      const meta = await WPDrive.getMeta(S.sync.fileId);
      if (meta.trashed) throw new Error('The team data file is in the Google Drive trash');
      const fresh = !(String(meta.version) === String(S.sync.version) && S.sync.base);
      const theirs = fresh ? WP.parseTeamFile(await WPDrive.readText(S.sync.fileId)) : S.sync.base;
      const step = WP.syncStep({ base: S.sync.base, mine: WP.teamSnapshot(S.settings), theirs, dirty: !!S.sync.dirty });
      S.settings = WP.applyTeamData(S.settings, step.data);
      let version = meta.version;
      let by = meta.lastModifyingUser ? (meta.lastModifyingUser.displayName || meta.lastModifyingUser.emailAddress) : '';
      if (step.push) {
        const up = await WPDrive.updateText(S.sync.fileId, WP.teamFileText(S.settings, S.sync.account));
        version = up.version;
        by = 'you';
      }
      Object.assign(S.sync, { base: WP.normalizeTeamData(step.data), version, dirty: false, lastSyncAt: Date.now(), lastBy: by });
      Team.lastErr = null;
      save();
      if (step.conflicts.length) {
        toast('Another coach changed the same thing at the same time (' + step.conflicts.join(', ') + '). Their version was kept — check it and redo your change if needed.', { err: true, ms: 12000 });
      }
    } catch (e) {
      Team.lastErr = e.message;
      if (interactive || e.code !== 0) toast('Team data: ' + e.message, { err: true, ms: 7000 });
    } finally {
      Team.busy = false;
      renderSyncBadge();
      refreshAfterSync();
      if (Team.again) { Team.again = false; syncNow(false); }
    }
  }

  function refreshAfterSync() {
    if (!$('view-settings').classList.contains('hidden')) renderSettings();
    else if (!$('view-tag').classList.contains('hidden') && G) { renderTags(); renderClips(); }
    else if (!$('view-games').classList.contains('hidden')) renderGameLists();
    if (E) renderEditor();
  }

  async function connectGoogle() {
    try {
      await WPDrive.signIn(S.sync && S.sync.account);
      const who = await WPDrive.whoAmI();
      Team.account = who.email;
      if (!S.settings.coachName && who.name) { S.settings.coachName = who.name.slice(0, 40); save(); renderWho(); }
      if (S.sync && S.sync.fileId) {
        if (S.sync.account && S.sync.account !== who.email) toast('Signed in as ' + who.email + ' (this device was set up with ' + S.sync.account + ')');
        S.sync.account = who.email;
        await syncNow(true);
      } else renderTeamCard();
      libSyncAll(true);
    } catch (e) { toast(e.message, { err: true }); renderTeamCard(); }
  }

  async function createTeamData() {
    try {
      await ensureSignedIn();
      const who = Team.account ? { email: Team.account } : await WPDrive.whoAmI();
      Team.account = who.email;
      Team.busy = true; renderTeamCard();
      if (!S.settings.coaches.some((c) => c.email === who.email)) S.settings.coaches = WP.addCoach(S.settings.coaches, S.settings.coachName || 'Head coach', who.email);
      const root = await WPDrive.createFolder('Bulldogs Watch Party');
      const appFolder = await WPDrive.createFolder('_App', root.id);
      const file = await WPDrive.createFile('Watch Party team data.json', appFolder.id, WP.teamFileText(S.settings, who.email));
      S.sync = { fileId: file.id, folderId: root.id, appFolderId: appFolder.id, version: file.version, base: WP.normalizeTeamData(WP.teamSnapshot(S.settings)), dirty: false, account: who.email, owner: true, lastSyncAt: Date.now(), lastBy: 'you', sharedWith: [] };
      Team.lastErr = null;
      save();
      Team.busy = false;
      toast('Team data created in your Google Drive (Bulldogs Watch Party › _App)');
      libSyncAll(true);
      if (S.settings.coaches.length > 1) await shareWithCoaches();
    } catch (e) { toast('Couldn’t create team data: ' + e.message, { err: true, ms: 8000 }); }
    finally { Team.busy = false; renderTeamCard(); renderSyncBadge(); }
  }

  async function shareWithCoaches() {
    if (!S.sync || !S.sync.owner) { toast('Only the coach who created the team data can share it from the app. They can also share the folder in Google Drive.'); return; }
    try { await ensureSignedIn(); } catch (e) { toast(e.message, { err: true }); return; }
    const todo = S.settings.coaches.filter((c) => c.email !== S.sync.account && !(S.sync.sharedWith || []).includes(c.email));
    if (!todo.length) { toast('Everyone on the coach list already has access'); return; }
    const done = [];
    const failed = [];
    for (const c of todo) {
      try {
        await WPDrive.share(S.sync.folderId, c.email, 'You’ve been added to the Bulldogs U10 Blue coaching staff in Bulldogs Watch Party. Open the app, go to Settings, sign in with Google and choose “Open shared team data”.');
        done.push(c.email);
      } catch (e) { failed.push(c.email + ' (' + e.message + ')'); }
    }
    S.sync.sharedWith = (S.sync.sharedWith || []).concat(done);
    save();
    renderTeamCard();
    if (done.length) toast('Shared with ' + done.join(', ') + '. They’ll get an email from Google.', { ms: 7000 });
    if (failed.length) toast('Couldn’t share with ' + failed.join('; '), { err: true, ms: 9000 });
  }

  async function openSharedTeamData() {
    try {
      await ensureSignedIn();
      const who = Team.account ? { email: Team.account } : await WPDrive.whoAmI();
      Team.account = who.email;
      let id = null;
      let owner = false;
      let libId = null;
      const mineFound = await WPDrive.findByName('Watch Party team data.json');
      if (mineFound.length) { id = mineFound[0].id; owner = true; }
      else {
        const picked = await WPDrive.pickFile({ multi: true });
        if (!picked || !picked.length) return;
        const t = picked.find((x) => /team data/i.test(x.name || '')) || picked[0];
        const l = picked.find((x) => /clip library/i.test(x.name || ''));
        id = t.id;
        libId = l ? l.id : null;
      }
      Team.busy = true; renderTeamCard();
      const meta = await WPDrive.getMeta(id);
      const data = WP.parseTeamFile(await WPDrive.readText(id));
      S.settings = WP.applyTeamData(S.settings, data);
      let rootId = null;
      if (owner && meta.parents && meta.parents[0]) { try { rootId = ((await WPDrive.getMeta(meta.parents[0])).parents || [])[0] || null; } catch (e) { rootId = null; } }
      if (libId) S.lib.teamSync = { fileId: libId, version: null, base: null };
      S.sync = { fileId: id, folderId: rootId, appFolderId: (meta.parents || [])[0] || null, version: meta.version, base: data, dirty: false, account: who.email, owner, lastSyncAt: Date.now(), lastBy: meta.lastModifyingUser ? (meta.lastModifyingUser.displayName || meta.lastModifyingUser.emailAddress) : '' };
      Team.lastErr = null;
      save();
      toast(owner ? 'Found your team data in Google Drive' : 'Connected to the team’s shared roster and categories' + (libId ? ' and clip library' : ''));
      libSyncAll(true);
    } catch (e) { toast('Couldn’t open team data: ' + e.message, { err: true, ms: 8000 }); }
    finally { Team.busy = false; renderTeamCard(); renderSyncBadge(); refreshAfterSync(); }
  }

  async function openSharedLibrary() {
    try {
      await ensureSignedIn();
      const picked = await WPDrive.pickFile({ query: 'Watch Party clip library', title: 'Pick \u201cWatch Party clip library\u201d (Bulldogs Watch Party \u203a _App)' });
      if (!picked) return;
      S.lib.teamSync = { fileId: picked, version: null, base: null };
      save();
      await libSyncAll(true);
      toast('Connected to the team clip library');
    } catch (e) { toast('Couldn\u2019t open the clip library: ' + e.message, { err: true }); }
    renderTeamCard();
  }

  function disconnectTeam() {
    if (!confirm('Stop syncing team data on this device? The roster and categories stay here; nothing is deleted from Google Drive.')) return;
    S.sync = null;
    S.lib.teamSync = null;
    S.lib.privSync = null;
    Team.lastErr = null;
    WPDrive.signOut();
    save();
    renderTeamCard();
    renderSyncBadge();
  }

  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ms).toLocaleDateString();
  }

  function renderTeamCard() {
    const box = $('team-sync');
    if (!box) return;
    const btn = (label, fn, cls) => el('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), disabled: Team.busy, onclick: fn }, label);
    const lines = [];
    const actions = [];
    if (!WPDrive.configured()) {
      lines.push(el('span', { class: 'small muted' }, 'Google sign-in isn’t set up yet. Until it is, the roster and categories are kept on this device only.'));
    } else if (!WPDrive.webOrigin()) {
      lines.push(el('span', { class: 'small muted' }, 'Google sign-in only works on the web version: '), el('a', { href: 'https://scalisec.github.io/bulldogs-watch-party/', target: '_blank', rel: 'noopener' }, 'scalisec.github.io/bulldogs-watch-party'));
    } else if (!S.sync) {
      if (!WPDrive.hasToken()) {
        lines.push(el('span', { class: 'small muted' }, 'Sign in with Google to share the roster, categories, coaches, opponents and rinks with the other coaches.'));
        actions.push(btn('Sign in with Google', connectGoogle, 'primary'));
      } else {
        lines.push(el('span', { class: 'small' }, 'Signed in' + (Team.account ? ' as ' + Team.account : '') + '. Set up the team data:'));
        actions.push(btn('Create team data in my Drive', createTeamData, 'primary'));
        actions.push(btn('Open shared team data', openSharedTeamData));
        lines.push(el('span', { class: 'small muted' }, 'Head coach: create it once — it goes in a “Bulldogs Watch Party” folder in your Drive and is shared with the coaches listed below. Other coaches: open the one that was shared with you.'));
      }
    } else {
      const st = Team.busy ? 'Syncing…' : Team.lastErr ? 'Problem: ' + Team.lastErr : S.sync.dirty ? 'Changes on this device not synced yet' : 'In sync';
      lines.push(el('div', { class: 'row', style: 'gap:8px' }, el('strong', {}, st),
        el('span', { class: 'small muted' }, (S.sync.lastSyncAt ? 'Last synced ' + ago(S.sync.lastSyncAt) : '') + (S.sync.lastBy ? ' · last change by ' + S.sync.lastBy : '') + ' · ' + S.sync.account + (S.sync.owner ? ' (owner)' : ''))));
      if (!WPDrive.hasToken()) actions.push(btn('Sign in to sync', connectGoogle, 'primary'));
      else actions.push(btn('Sync now', () => syncNow(true), 'primary'));
      lines.push(el('span', { class: 'small muted' }, S.lib.teamSync ? 'Clip library: ' + (LIB.err ? 'problem — ' + LIB.err : 'connected' + (S.lib.teamSync.lastSyncAt ? ', synced ' + ago(S.lib.teamSync.lastSyncAt) : '')) + ' · ' + Object.keys(S.lib.team.entries).length + ' team clips' : S.sync.owner ? 'Clip library: created on next sync' : 'Clip library: not opened yet on this device'));
      if (!S.lib.teamSync && !S.sync.owner) actions.push(btn('Open shared clip library', openSharedLibrary));
      if (S.sync.owner) actions.push(btn('Share with coaches', shareWithCoaches));
      actions.push(btn('Stop syncing on this device', disconnectTeam, 'danger'));
    }
    box.replaceChildren(...lines, actions.length ? el('div', { class: 'row' }, ...actions) : '');
  }

  function renderTeamSettings() {
    const t = S.settings.team;
    if (document.activeElement !== $('t-name')) $('t-name').value = t.name;
    if (document.activeElement !== $('t-season')) $('t-season').value = t.season;
    $('coaches').replaceChildren(...(S.settings.coaches.length ? S.settings.coaches.map((c) => el('div', { class: 'row', style: 'gap:8px' },
      el('span', { style: 'font-weight:600' }, c.name || '(no name)'), el('span', { class: 'small muted' }, c.email),
      S.sync && S.sync.sharedWith && S.sync.sharedWith.includes(c.email) ? el('span', { class: 'pill do' }, 'Shared') : '',
      S.sync && c.email === S.sync.account ? el('span', { class: 'pill zoompill' }, 'You') : '',
      el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + c.email, onclick: () => { S.settings.coaches = WP.removeCoach(S.settings.coaches, c.email); teamChanged(); renderSettings(); } }, 'Remove')))
      : [el('span', { class: 'small muted' }, 'No coaches yet.')]));
    const chips = (list, key, label) => list.length ? list.map((v) => el('button', { type: 'button', class: 'chip', 'aria-label': 'Remove ' + v, onclick: () => { S.settings[key] = WP.removeListItem(S.settings[key], v); teamChanged(); renderSettings(); } }, v + ' ✕')) : [el('span', { class: 'small muted' }, 'No ' + label + ' yet.')];
    $('opponents').replaceChildren(...chips(S.settings.opponents, 'opponents', 'opponents'));
    $('rinks').replaceChildren(...chips(S.settings.rinks, 'rinks', 'rinks'));
    renderTeamCard();
  }

  function renderGameLists() {
    $('dl-opp').replaceChildren(...S.settings.opponents.map((v) => el('option', { value: v })));
    $('dl-rink').replaceChildren(...S.settings.rinks.map((v) => el('option', { value: v })));
  }

  $('t-name').addEventListener('change', (e) => { S.settings.team = Object.assign({}, S.settings.team, { name: e.target.value.trim().slice(0, 60) || WP.DEFAULT_TEAM.name }); teamChanged(); renderSettings(); });
  $('t-season').addEventListener('change', (e) => { S.settings.team = Object.assign({}, S.settings.team, { season: e.target.value.trim().slice(0, 30) }); teamChanged(); renderSettings(); });
  $('coach-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.coaches = WP.addCoach(S.settings.coaches, $('c-name').value, $('c-email').value);
      $('c-name').value = ''; $('c-email').value = '';
      teamChanged(); renderSettings();
      if (S.sync && S.sync.owner) toast('Added. Click “Share with coaches” to give them access, and add their email as a test user in Google Cloud.', { ms: 8000 });
    } catch (err) { toast(err.message, { err: true }); }
  });
  for (const [form, input, key] of [['opp-add', 'o-new', 'opponents'], ['rink-add', 'k-new', 'rinks']]) {
    $(form).addEventListener('submit', (e) => {
      e.preventDefault();
      try { S.settings[key] = WP.addListItem(S.settings[key], $(input).value); $(input).value = ''; teamChanged(); renderSettings(); }
      catch (err) { toast(err.message, { err: true }); }
    });
  }
  window.addEventListener('focus', () => {
    if (S.sync && WPDrive.hasToken() && !Team.busy && (!S.sync.lastSyncAt || Date.now() - S.sync.lastSyncAt > 60000)) syncNow(false);
  });


  // =====================================================================
  // PERIODS, GOALS AND CLIP TAGS (milestone 3b)
  // =====================================================================
  const sameJ = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function selectOpts(sel, list, value, blank) {
    sel.replaceChildren(...(blank ? [el('option', { value: '' }, blank)] : []), ...list.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = value || '';
  }

  function renderMarks() {
    if (!G) return;
    const m = WP.gameMarks(G);
    const open = m.periods.find((p) => p.end == null);
    $('b-period').replaceChildren(open ? 'Period ' + WP.periodName(open.n) + ' end ' : 'Period ' + WP.periodName(m.periods.length + 1) + ' start ', el('kbd', {}, 'P'));
    const items = [];
    for (const p of m.periods) {
      items.push(el('span', { class: 'mark' }, WP.periodName(p.n) + ' ' + WP.formatTime(p.start) + '–' + (p.end != null ? WP.formatTime(p.end) : '…'),
        el('button', { type: 'button', 'aria-label': 'Delete ' + WP.periodName(p.n) + ' marks', onclick: () => { G.marks = WP.removePeriod(G, p.n); marksChanged(); } }, '✕')));
    }
    let f = 0, a = 0;
    for (const g of m.goals) {
      if (g.side === 'for') f += 1; else a += 1;
      items.push(el('span', { class: 'mark ' + (g.side === 'for' ? 'gf' : 'ga') },
        el('button', { type: 'button', style: 'width:auto;padding:0 4px;background:none', title: 'Go to this goal', onclick: () => player && player.seek(Math.max(0, g.t - 3)) }, (g.side === 'for' ? 'Goal for ' : 'Goal against ') + WP.formatTime(g.t) + ' (' + f + '–' + a + ')'),
        el('button', { type: 'button', 'aria-label': 'Delete goal at ' + WP.formatTime(g.t), onclick: () => { G.marks = WP.removeGoal(G, g.id); marksChanged(); } }, '✕')));
    }
    $('marks-list').replaceChildren(...(items.length ? items : [el('span', { class: 'small muted' }, 'No periods or goals marked yet.')]));
    selectOpts($('t-gtype'), WP.GAME_TYPES, G.gameType, 'Not set');
    selectOpts($('t-gha'), WP.HOME_AWAY, G.homeAway, 'Not set');
  }

  function marksChanged() {
    save();
    renderMarks();
    renderTimelineStatic();
    renderClips();
    onTick();
  }

  function markPeriod() {
    if (!player) return;
    try {
      const r = WP.togglePeriod(G, player.time());
      G.marks = r.marks;
      marksChanged();
      toast(WP.periodName(r.n) + (r.did === 'start' ? ' started' : ' ended') + ' at ' + WP.formatTime(player.time()));
    } catch (e) { toast(e.message, { err: true }); }
  }

  function markGoal(side) {
    if (!player) return;
    const t = player.time();
    G.marks = WP.addGoal(G, t, side);
    const m = WP.gameMarks(G);
    const f = m.goals.filter((g) => g.side === 'for').length;
    const a = m.goals.length - f;
    marksChanged();
    const id = m.goals.find((g) => Math.abs(g.t - Math.round(t * 10) / 10) < 0.01 && g.side === side).id;
    toast((side === 'for' ? 'Goal for' : 'Goal against') + ' at ' + WP.formatTime(t) + ' — score ' + f + '–' + a, { action: { label: 'Undo', fn: () => { G.marks = WP.removeGoal(G, id); marksChanged(); } } });
  }

  $('b-period').addEventListener('click', markPeriod);
  $('b-goal-for').addEventListener('click', () => markGoal('for'));
  $('b-goal-against').addEventListener('click', () => markGoal('against'));
  $('t-gtype').addEventListener('change', (e) => { G.gameType = e.target.value; save(); renderTagView(); });
  $('t-gha').addEventListener('change', (e) => { G.homeAway = e.target.value; save(); renderTagView(); });

  function evBadges(game, clip, events) {
    const evs = events || WP.clipEvents(game, clip);
    return evs.map((id) => { const ev = WP.EVENTS.find((x) => x.id === id) || {}; return el('span', { class: 'evb' + (ev.kind ? ' ' + ev.kind : '') }, WP.eventLabel(id)); });
  }

  function autoLine(game, clip) {
    const a = WP.clipAuto(game, clip);
    const bits = [];
    if (a.period) bits.push(WP.periodName(a.period) + ' ' + WP.formatTime(a.periodTime));
    if (a.state) bits.push(a.state + ' ' + a.score.for + '–' + a.score.against);
    return bits.join(' · ');
  }

  // ---- editor: tags ----
  function renderEditorTags() {
    if (!E || !G) return;
    const d = E.d;
    const auto = WP.clipAuto(G, d);
    const shown = WP.clipEvents(G, d);
    $('e-events').replaceChildren(...WP.EVENTS.map((ev) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(shown.includes(ev.id)),
      title: auto.events.includes(ev.id) ? 'From your goal marks' : null,
      onclick: () => commit(WP.toggleEvent(G, E.d, ev.id))
    }, auto.events.includes(ev.id) ? el('span', { class: 'autodot' }) : '', ev.label)));
    $('e-zone').value = d.zone || '';
    $('e-sit').value = d.situation || 'even';
    $('e-tags').replaceChildren(...(d.tags || []).map((t) => el('button', { type: 'button', class: 'chip', 'aria-label': 'Remove tag ' + t, onclick: () => commit({ tags: d.tags.filter((x) => x !== t) }) }, t + ' ✕')));
    $('dl-tags').replaceChildren(...allTags().map((t) => el('option', { value: t })));
    $('e-star').setAttribute('aria-pressed', String(!!d.starred));
    $('e-star').textContent = d.starred ? '★ Starred' : '☆ Star';
    $('e-private').checked = !!d.private;
    const al = autoLine(G, d);
    $('e-auto').textContent = al ? 'Automatic: ' + al + '. From your period and goal marks.' : 'Mark periods and goals on the game screen and the period and score fill in here.';
    renderDests();
  }

  function allTags() {
    const set = new Set();
    for (const g of S.games) for (const c of g.clips) for (const t of c.tags || []) set.add(t);
    for (const k of ['team', 'priv']) for (const e of Object.values(S.lib[k].entries)) for (const t of e.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  $('e-zone').addEventListener('change', (e) => commit({ zone: e.target.value }));
  $('e-sit').addEventListener('change', (e) => commit({ situation: e.target.value }));
  $('e-star').addEventListener('click', () => commit({ starred: !E.d.starred }));
  $('e-private').addEventListener('change', (e) => {
    const goingPrivate = e.target.checked;
    if (goingPrivate && (E.d.drive || []).some((x) => x.folder !== 'private')) toast('This clip is already in team Drive folders. Making it private removes it from the team library; delete the team copies in Drive if you don’t want them there.', { ms: 9000 });
    commit({ private: goingPrivate });
  });
  $('e-tag-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('e-tag-new').value.trim();
    if (!v) return;
    $('e-tag-new').value = '';
    commit({ tags: (E.d.tags || []).concat([v]) });
  });

  // ---- editor: where the export goes ----
  const destPick = { local: true, team: false, coaches: false, players: false, private: false };

  function driveReady(priv) {
    if (!WPDrive.configured() || !WPDrive.webOrigin()) return 'Saving to Google Drive works on the web version once you sign in (Settings).';
    if (!WPDrive.hasToken()) return 'Sign in with Google in Settings to also save clips to Drive.';
    if (!priv && !S.sync) return 'Set up team data in Settings to save to the team’s Drive folders.';
    return null;
  }

  function renderDests() {
    if (!E) return;
    const d = E.d;
    const box = $('e-dests');
    const cb = (key, text, disabled) => {
      const i = el('input', { type: 'checkbox', style: 'width:18px;height:18px;flex:none', disabled: !!disabled, onchange: (e) => { destPick[key] = e.target.checked; } });
      i.checked = !!destPick[key] && !disabled;
      return el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px' }, i, text);
    };
    const why = driveReady(d.private);
    const rows = [el('span', { style: 'font-weight:600;font-size:13px' }, 'Save the MP4 to'), cb('local', 'This computer')];
    if (d.private) rows.push(cb('private', '🔒 My private Drive folder', !!why));
    else {
      rows.push(cb('team', 'Drive: Team (players and families)', !!why));
      rows.push(cb('coaches', 'Drive: Coaches only', !!why));
      const fam = d.players.length ? 'Drive: family folder of ' + d.players.map((p) => '#' + p).join(', ') : 'Drive: family folders (tag players first)';
      rows.push(cb('players', fam, !!why || !d.players.length));
    }
    if (why) rows.push(el('span', { class: 'small muted' }, why));
    if ((d.drive || []).length) rows.push(el('span', { class: 'small muted' }, 'In Drive: ' + d.drive.map((x) => WP.destLabel(x.folder, S.settings.roster)).join(', ')));
    box.replaceChildren(...rows);
  }

  function chosenDests(d) {
    if (driveReady(d.private)) return [];
    if (d.private) return destPick.private ? ['private'] : [];
    const out = [];
    if (destPick.team) out.push('team');
    if (destPick.coaches) out.push('coaches');
    if (destPick.players) for (const p of d.players) out.push('player:' + p);
    return out;
  }

  async function ensureDestFolder(dest) {
    if (dest === 'private') { await ensurePrivateLibrary(); return S.lib.privSync.folderId; }
    const folders = S.lib.team.folders || (S.lib.team.folders = {});
    if (folders[dest]) return folders[dest];
    const root = (S.sync && S.sync.folderId) || folders.root;
    if (!root) throw new Error('the team’s Drive folders haven’t been set up yet. The head coach sets them up by saving one clip to Drive.');
    let parent = root;
    if (dest.startsWith('player:')) {
      if (!folders.players) { folders.players = (await WPDrive.createFolder('Players (one folder per family)', root)).id; }
      parent = folders.players;
    }
    folders[dest] = (await WPDrive.createFolder(WP.folderName(dest, S.settings.roster), parent)).id;
    folders.root = root;
    save();
    return folders[dest];
  }

  async function uploadToDrive(d, blob, name, dests, onStep) {
    const cat = catById(d.categoryId);
    const auto = WP.clipAuto(G, d);
    const desc = [cat ? cat.name : 'Clip', WP.gameTitle(G), auto.period ? WP.periodName(auto.period) : ''].filter(Boolean).join(' · ') + ' — Bulldogs Watch Party';
    let list = (d.drive || []).slice();
    const done = [];
    for (const dest of dests) {
      if (onStep) onStep(dest);
      const folderId = await ensureDestFolder(dest);
      const f = await WPDrive.uploadBlob(name, folderId, blob, desc);
      list = list.filter((x) => x.folder !== dest).concat([{ folder: dest, fileId: f.id, name: f.name || name, at: Date.now() }]);
      done.push(dest);
    }
    return { list, done };
  }

  // =====================================================================
  // CLIP LIBRARY IN DRIVE (team: _App; private: the coach's own folder)
  // =====================================================================
  const LIB = { busy: false, again: false, err: null };
  const TEAM_LIB_NAME = 'Watch Party clip library.json';
  const PRIV_FOLDER_NAME = 'My Watch Party clips (private)';
  const PRIV_LIB_NAME = 'My private clip library.json';
  let libTimer = 0;

  function libChanged() {
    clearTimeout(libTimer);
    if (!WPDrive.hasToken() || (!S.lib.teamSync && !S.lib.privSync)) return;
    libTimer = setTimeout(() => libSyncAll(false), 2500);
  }

  function myLibrary(kind) {
    return WP.buildMyLibrary(S.lib[kind], S.games, S.settings.categories, S.settings.coachName, kind === 'priv', S.lib.deleted);
  }

  async function ensureTeamLibrary() {
    if (S.lib.teamSync || !S.sync) return;
    if (!S.sync.owner) return; // other coaches pick it with the team data
    const found = await WPDrive.findByName(TEAM_LIB_NAME);
    if (found.length) {
      S.lib.teamSync = { fileId: found[0].id, version: null, base: null };
    } else {
      const lib = myLibrary('team');
      lib.folders = Object.assign({}, lib.folders, { root: S.sync.folderId });
      const f = await WPDrive.createFile(TEAM_LIB_NAME, S.sync.appFolderId, WP.libraryFileText(lib, 'team', S.sync.account));
      S.lib.team = WP.normalizeLibrary(lib);
      S.lib.teamSync = { fileId: f.id, version: f.version, base: WP.normalizeLibrary(lib) };
    }
    save();
  }

  async function ensurePrivateLibrary() {
    if (S.lib.privSync) return;
    const found = await WPDrive.findByName(PRIV_LIB_NAME);
    if (found.length) {
      S.lib.privSync = { fileId: found[0].id, folderId: (found[0].parents || [])[0] || null, version: null, base: null };
    } else {
      const folders = await WPDrive.findByName(PRIV_FOLDER_NAME, WPDrive.FOLDER);
      const folderId = folders.length ? folders[0].id : (await WPDrive.createFolder(PRIV_FOLDER_NAME)).id;
      const lib = myLibrary('priv');
      const f = await WPDrive.createFile(PRIV_LIB_NAME, folderId, WP.libraryFileText(lib, 'private', ''));
      S.lib.priv = WP.normalizeLibrary(lib);
      S.lib.privSync = { fileId: f.id, folderId, version: f.version, base: WP.normalizeLibrary(lib) };
    }
    save();
  }

  async function libSync(kind) {
    const cfg = kind === 'team' ? S.lib.teamSync : S.lib.privSync;
    if (!cfg || !cfg.fileId) return;
    const fileKind = kind === 'team' ? 'team' : 'private';
    const meta = await WPDrive.getMeta(cfg.fileId);
    if (meta.trashed) throw new Error('the clip library file is in the Google Drive trash');
    const theirs = String(meta.version) === String(cfg.version) && cfg.base ? cfg.base : WP.parseLibraryFile(await WPDrive.readText(cfg.fileId), fileKind);
    // other coaches' tag edits to my clips come back into my clips
    if (cfg.base) {
      for (const g of S.games) {
        g.clips = g.clips.map((c) => {
          if (!!c.private !== (kind === 'priv')) return c;
          const te = theirs.entries[c.id];
          const be = cfg.base.entries[c.id];
          return te && be && !sameJ(te, be) ? WP.applyEntryTags(c, te, be) : c;
        });
      }
    }
    const step = WP.syncLibraryStep({ base: cfg.base, mine: myLibrary(kind), theirs, dirty: true });
    S.lib[kind] = WP.normalizeLibrary(step.data);
    let version = meta.version;
    if (step.push) version = (await WPDrive.updateText(cfg.fileId, WP.libraryFileText(S.lib[kind], fileKind, S.sync && S.sync.account))).version;
    cfg.base = WP.normalizeLibrary(step.data);
    cfg.version = version;
    cfg.lastSyncAt = Date.now();
    if (step.conflicts.length) toast('Clip library: another coach changed the same thing at the same time (' + step.conflicts.slice(0, 3).join(', ') + '). Their version was kept.', { err: true, ms: 10000 });
  }

  async function libSyncAll(interactive) {
    if (!WPDrive.hasToken()) return;
    if (LIB.busy) { LIB.again = true; return; }
    LIB.busy = true;
    try {
      await ensureTeamLibrary();
      await ensurePrivateLibrary();
      if (S.lib.teamSync) await libSync('team');
      await libSync('priv');
      const keep = new Set([...Object.keys(S.lib.team.entries), ...Object.keys(S.lib.priv.entries)]);
      S.lib.deleted = S.lib.deleted.filter((id) => keep.has(id));
      LIB.err = null;
      saveQuiet();
    } catch (e) {
      LIB.err = e.message;
      if (interactive || e.code !== 0) toast('Clip library: ' + e.message, { err: true, ms: 7000 });
    } finally {
      LIB.busy = false;
      if (!$('view-review').classList.contains('hidden')) renderReview();
      if (!$('view-settings').classList.contains('hidden')) renderTeamCard();
      if (LIB.again) { LIB.again = false; libSyncAll(false); }
    }
  }

  // =====================================================================
  // REVIEW SCREEN
  // =====================================================================
  const R = { filters: WP.emptyFilters(), viewId: null, queue: [], idx: -1, cleanup: null, sort: 'oldest' };

  function scopeEntries() {
    const team = Object.values(myLibrary('team').entries);
    const priv = Object.values(myLibrary('priv').entries).map((e) => Object.assign({}, e, { private: true }));
    const sc = S.lib.scope;
    return sc === 'private' ? priv : sc === 'both' ? team.concat(priv) : team;
  }

  function localClip(id) {
    for (const g of S.games) { const c = g.clips.find((x) => x.id === id); if (c) return { game: g, clip: c }; }
    return null;
  }

  function lenSum(list) { return list.reduce((s, e) => s + (e.end - e.start), 0); }

  function whereInfo(e) {
    if (e.private) return { color: '#B45309', text: '🔒 Private' + ((e.drive || []).length ? ' · in my Drive folder' : ' · on this device only') };
    if ((e.drive || []).length) return { color: '#16A34A', text: 'In Drive · ' + e.drive.map((x) => WP.destLabel(x.folder, S.settings.roster)).join(', ') };
    const mine = localClip(e.id);
    return { color: '#F59E0B', text: mine ? 'On this PC (not in Drive yet)' : 'Only on ' + (e.owner || 'another coach') + '’s PC' };
  }

  function chipBtn(text, on, fn, extra) {
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!on), onclick: fn }, extra || '', text);
  }

  function toggleIn(key, val) {
    const list = R.filters[key];
    const i = list.indexOf(val);
    if (i >= 0) list.splice(i, 1); else list.push(val);
    R.viewId = null;
    renderReview();
  }

  function setOne(key, val) { R.filters[key] = R.filters[key] === val ? '' : val; R.viewId = null; renderReview(); }

  function renderReview() {
    renderWho();
    const all = scopeEntries();
    for (const b of $('rv-scope').children) b.setAttribute('aria-pressed', String(b.dataset.scope === S.lib.scope));
    if (document.activeElement !== $('rv-q')) $('rv-q').value = R.filters.q;
    // saved views
    const views = S.lib.team.views || [];
    $('rv-views').replaceChildren(...(views.length ? views.map((v) => el('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
      el('button', { type: 'button', class: 'vbtn grow', 'aria-pressed': String(R.viewId === v.id), onclick: () => { R.filters = WP.normalizeFilters(v.filters); R.viewId = v.id; renderReview(); } },
        el('span', {}, v.name), el('span', { class: 'small muted' }, String(all.filter((e) => WP.entryMatches(e, v.filters)).length))),
      el('button', { type: 'button', class: 'btn small', style: 'min-height:32px;padding:0 8px', 'aria-label': 'Delete saved view ' + v.name, onclick: () => { if (!confirm('Delete the saved view “' + v.name + '” for all coaches?')) return; S.lib.team.views = WP.removeView(views, v.id); if (R.viewId === v.id) R.viewId = null; save(); renderReview(); } }, '✕')))
      : [el('span', { class: 'small muted' }, 'None yet. Pick filters, then Save view.')]));
    // filter groups
    const F = R.filters;
    const groups = [];
    const group = (title, kids) => groups.push(el('div', { class: 'stack', style: 'gap:6px;border-top:1px solid #E6EAF0;padding-top:12px' }, el('h3', { class: 'fh' }, title), el('div', { class: 'chips' }, ...kids)));
    const usedCats = new Set(all.map((e) => e.categoryId));
    group('Category', S.settings.categories.filter((c) => !c.hidden || usedCats.has(c.id)).map((c) => chipBtn(c.name, F.categories.includes(c.id), () => toggleIn('categories', c.id), el('span', { class: 'dot', style: 'width:9px;height:9px;margin-right:6px;display:inline-block;background:' + c.color }))));
    group('Events', WP.EVENTS.map((ev) => chipBtn(ev.label, F.events.includes(ev.id), () => toggleIn('events', ev.id))));
    const nums = new Set(S.settings.roster.map((p) => p.number));
    for (const e of all) for (const p of e.players) nums.add(p);
    group('Players', [...nums].sort((a, b) => a - b).map((n) => chipBtn('#' + n, F.players.includes(n), () => toggleIn('players', n))));
    group('Period', ['1', '2', '3', '4'].map((n) => chipBtn(WP.periodName(Number(n)), F.periods.includes(n), () => toggleIn('periods', n))));
    group('Message', [['do', 'Do this'], ['work', 'Work on this'], ['starred', '★ Starred']].map(([v, l]) => chipBtn(l, F.flags.includes(v), () => toggleIn('flags', v))));
    group('Score when it happened', [['leading', 'Leading'], ['tied', 'Tied'], ['trailing', 'Trailing']].map(([v, l]) => chipBtn(l, F.state === v, () => setOne('state', v))));
    group('Zone', WP.ZONES.map(([v, l]) => chipBtn(l, F.zone === v, () => setOne('zone', v))));
    group('Situation', WP.SITUATIONS.map(([v, l]) => chipBtn(l, F.situation === v, () => setOne('situation', v))));
    const tags = allTags();
    if (tags.length) group('Custom tags', tags.map((t) => chipBtn(t, F.tags.includes(t), () => toggleIn('tags', t))));
    const games = new Map();
    for (const e of all) games.set(e.gameId, e.game);
    const gsel = el('select', { 'aria-label': 'Game', style: 'min-height:40px', onchange: (ev) => { R.filters.gameIds = ev.target.value ? [ev.target.value] : []; R.viewId = null; renderReview(); } },
      el('option', { value: '' }, 'All games (' + games.size + ')'),
      ...[...games.entries()].sort((a, b) => String(a[1].date).localeCompare(String(b[1].date))).map(([id, g]) => el('option', { value: id }, g.title)));
    gsel.value = F.gameIds[0] || '';
    const tsel = el('select', { 'aria-label': 'Game type', style: 'min-height:40px', onchange: (ev) => { R.filters.gameType = ev.target.value; R.viewId = null; renderReview(); } });
    selectOpts(tsel, WP.GAME_TYPES, F.gameType, 'Any game type');
    const hsel = el('select', { 'aria-label': 'Home or away', style: 'min-height:40px', onchange: (ev) => { R.filters.homeAway = ev.target.value; R.viewId = null; renderReview(); } });
    selectOpts(hsel, WP.HOME_AWAY, F.homeAway, 'Home and away');
    const driveCb = el('input', { type: 'checkbox', style: 'width:18px;height:18px', onchange: (ev) => { R.filters.inDrive = ev.target.checked; R.viewId = null; renderReview(); } });
    driveCb.checked = F.inDrive;
    groups.push(el('div', { class: 'stack', style: 'gap:6px;border-top:1px solid #E6EAF0;padding-top:12px' }, el('h3', { class: 'fh' }, 'Game'), gsel, el('div', { class: 'grid2', style: 'gap:6px' }, tsel, hsel),
      el('label', { class: 'row small', style: 'gap:8px' }, driveCb, 'Only clips saved in Drive')));
    $('rv-groups').replaceChildren(...groups);
    // results
    const list = WP.sortEntries(all.filter((e) => WP.entryMatches(e, F)), R.sort);
    const view = views.find((v) => v.id === R.viewId);
    $('rv-title').textContent = view ? view.name : WP.describeFilters(F, S.settings.categories);
    const secs = Math.round(lenSum(list));
    $('rv-count').textContent = list.length + (list.length === 1 ? ' clip' : ' clips') + ' · ' + Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s · ' + ({ team: 'team library', private: 'my private clips', both: 'team and private' })[S.lib.scope];
    const pills = [];
    const pill = (text, fn) => pills.push(el('span', { class: 'mark', style: 'background:var(--accent-soft);color:var(--accent-dark)' }, text, el('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onclick: fn }, '✕')));
    for (const id of F.categories) pill('Category: ' + ((catById(id) || {}).name || id), () => toggleIn('categories', id));
    for (const id of F.events) pill('Event: ' + WP.eventLabel(id), () => toggleIn('events', id));
    for (const n of F.players) pill('#' + n, () => toggleIn('players', n));
    for (const n of F.periods) pill(WP.periodName(Number(n)), () => toggleIn('periods', n));
    for (const v of F.flags) pill(v === 'do' ? 'Do this' : v === 'work' ? 'Work on this' : 'Starred', () => toggleIn('flags', v));
    for (const t of F.tags) pill('Tag: ' + t, () => toggleIn('tags', t));
    for (const [k, lab] of [['state', 'Score'], ['zone', 'Zone'], ['situation', 'Situation'], ['gameType', 'Game type'], ['homeAway', 'Home/away']]) if (F[k]) pill(lab + ': ' + F[k], () => setOne(k, F[k]));
    if (F.gameIds.length) pill('Game: ' + ((games.get(F.gameIds[0]) || {}).title || ''), () => { R.filters.gameIds = []; renderReview(); });
    if (F.inDrive) pill('In Drive', () => { R.filters.inDrive = false; renderReview(); });
    if (F.q) pill('“' + F.q + '”', () => { R.filters.q = ''; renderReview(); });
    const sortSel = el('select', { 'aria-label': 'Sort', style: 'min-height:36px;margin-left:auto', onchange: (ev) => { R.sort = ev.target.value; renderReview(); } }, el('option', { value: 'oldest' }, 'Oldest game first'), el('option', { value: 'newest' }, 'Newest game first'));
    sortSel.value = R.sort;
    $('rv-active').replaceChildren(...pills, pills.length ? el('button', { type: 'button', class: 'btn small', onclick: () => { R.filters = WP.emptyFilters(); R.viewId = null; renderReview(); } }, 'Clear all') : el('span', { class: 'small muted' }, 'No filters — showing everything.'), sortSel);
    $('rv-play').disabled = !list.length;
    R.list = list;
    const nowId = R.idx >= 0 && R.queue[R.idx] ? R.queue[R.idx].id : null;
    $('rv-results').replaceChildren(...(list.length ? list.map((e, i) => {
      const w = whereInfo(e);
      const feats = Object.entries(e.features || {}).filter(([, v]) => v).map(([k]) => ({ drawing: 'Drawing', slow: 'Slow-mo', zoom: 'Zoom', voice: 'Voice' })[k]);
      return el('button', { type: 'button', class: 'rvcard' + (e.id === nowId ? ' now' : ''), 'data-entry': e.id, onclick: () => startQueue(list, i) },
        el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'dot', style: 'background:' + (e.color || '#64748B') }), el('strong', {}, e.category || 'Clip'), ...evBadges(null, null, e.events), e.starred ? el('span', { style: 'color:#CA8A04', 'aria-label': 'Starred' }, '★') : ''),
        el('span', { class: 'small' }, [e.game.title, WP.label(WP.GAME_TYPES, e.game.type), WP.label(WP.HOME_AWAY, e.game.homeAway)].filter(Boolean).join(' · ')),
        el('span', { class: 'small muted' }, [e.period ? WP.periodName(e.period) + ' ' + WP.formatTime(e.periodTime) : 'game ' + WP.formatTime(e.start), e.state ? e.state + ' ' + e.score.for + '–' + e.score.against : '', Math.round(e.end - e.start) + ' s'].filter(Boolean).join(' · ')),
        el('div', { class: 'row small', style: 'gap:6px' }, el('strong', {}, e.players.length ? e.players.map((p) => '#' + p).join(' ') : 'No players'), el('span', { class: 'pill ' + e.flag }, e.flag === 'work' ? 'Work on this' : 'Do this'), ...feats.map((f) => el('span', { class: 'pill zoompill' }, f))),
        e.note ? el('span', { class: 'small' }, e.note) : '',
        el('span', { class: 'where' }, el('span', { class: 'wdot', style: 'background:' + w.color }), w.text, el('span', { style: 'margin-left:auto' }, 'by ' + (e.by || '?'))));
    }) : [el('div', { class: 'empty', style: 'grid-column:1/-1' }, all.length ? 'No clips match these filters.' : S.lib.scope === 'private' ? 'No private clips yet. Tick “Private (only me)” in the clip editor.' : 'No clips yet. Tag some on the game screen.')]));
    const lib = S.lib.teamSync ? 'Team library ' + (LIB.err ? 'has a sync problem: ' + LIB.err : 'synced with Drive') : S.sync ? 'Team library not connected yet — see Settings.' : 'Sign in and set up team data in Settings to share clips with the other coaches.';
    $('rv-lib-status').textContent = lib;
    if (R.idx >= 0) renderReviewTags();
  }

  $('rv-scope').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]');
    if (!b) return;
    S.lib.scope = b.dataset.scope;
    saveQuiet();
    renderReview();
  });
  $('rv-q').addEventListener('input', (e) => { R.filters.q = e.target.value; R.viewId = null; clearTimeout(R.qt); R.qt = setTimeout(renderReview, 200); });
  $('rv-save').addEventListener('click', () => {
    const name = prompt('Name this view (shared with all coaches):', WP.describeFilters(R.filters, S.settings.categories));
    if (name == null) return;
    try { S.lib.team.views = WP.addView(S.lib.team.views, name, R.filters); R.viewId = S.lib.team.views[S.lib.team.views.length - 1].id; save(); renderReview(); toast('View saved'); }
    catch (err) { toast(err.message, { err: true }); }
  });
  $('rv-play').addEventListener('click', () => R.list && R.list.length && startQueue(R.list, 0));
  $('rv-prev').addEventListener('click', () => playAt(R.idx - 1));
  $('rv-next').addEventListener('click', () => playAt(R.idx + 1));
  $('rv-close').addEventListener('click', stopReviewPlayer);

  function startQueue(list, i) {
    R.queue = list.slice();
    R.qname = $('rv-title').textContent;
    $('rv-player-card').classList.remove('hidden');
    playAt(i);
    $('rv-player-card').scrollIntoView({ block: 'nearest' });
  }

  function stopReviewPlayer() {
    if (R.cleanup) { R.cleanup(); R.cleanup = null; }
    R.idx = -1;
    $('rv-player-card').classList.add('hidden');
    $('rv-stage').replaceChildren();
    renderReview();
  }

  function nextAfterEnd() { if ($('rv-auto').checked && R.idx < R.queue.length - 1) playAt(R.idx + 1); }

  async function playAt(i) {
    if (i < 0 || i >= R.queue.length) return;
    if (R.cleanup) { R.cleanup(); R.cleanup = null; }
    R.idx = i;
    const e = R.queue[i];
    const token = {};
    R.token = token;
    $('rv-pl-title').textContent = R.qname + ' · clip ' + (i + 1) + ' of ' + R.queue.length;
    $('rv-pl-now').textContent = (e.category || 'Clip') + ' · ' + e.game.title;
    $('rv-prev').disabled = i === 0;
    $('rv-next').disabled = i >= R.queue.length - 1;
    for (const c of document.querySelectorAll('.rvcard')) c.classList.toggle('now', c.dataset.entry === e.id);
    renderReviewTags();
    const stage = $('rv-stage');
    const msg = (text, ...kids) => stage.replaceChildren(el('div', { class: 'msg' }, el('span', {}, text), ...kids));
    msg('Loading…');
    const file = (e.drive || [])[0];
    if (file && WPDrive.hasToken()) {
      try {
        const blob = await WPDrive.downloadBlob(file.fileId);
        if (R.token !== token) return;
        const url = URL.createObjectURL(blob);
        const v = el('video', { src: url, controls: true, autoplay: true, playsinline: true });
        v.addEventListener('ended', nextAfterEnd);
        stage.replaceChildren(v);
        R.cleanup = () => { v.pause(); URL.revokeObjectURL(url); };
        return;
      } catch (err) {
        if (R.token !== token) return;
        stage.replaceChildren(el('iframe', { src: 'https://drive.google.com/file/d/' + encodeURIComponent(file.fileId) + '/preview', allow: 'autoplay', title: 'Clip from Google Drive' }));
        return;
      }
    }
    const loc = localClip(e.id);
    if (loc) {
      const files = session.files.get(loc.game.id);
      if (!files) {
        msg('This clip’s game video isn’t connected on this computer yet.', el('a', { class: 'btn small', href: '#tag/' + loc.game.id, style: 'text-decoration:none' }, 'Open the game to reconnect its videos'));
        return;
      }
      const v = el('video', { playsinline: true });
      const wrap = el('div', { class: 'vwrap' }, v);
      stage.replaceChildren(wrap);
      v.style.transform = WP.zoomTransform(loc.clip.zoom);
      const p = createPlayer(v, files, WP.gameTimeline(loc.game), loc.game.id, () => {});
      let started = false;
      const iv = setInterval(() => { if (p.isPlaying()) started = true; else if (started) { clearInterval(iv); nextAfterEnd(); } }, 250);
      R.cleanup = () => { clearInterval(iv); p.destroy(); };
      await p.playRange(loc.clip.start, loc.clip.end);
      return;
    }
    if (file) { msg('Sign in with Google (Settings) to play clips from Drive.'); return; }
    msg('Only on ' + (e.owner || 'another coach') + '’s PC — not saved to Drive yet.');
  }

  function editEntry(e, patch) {
    const loc = localClip(e.id);
    if (loc) {
      const next = WP.updateClip(loc.clip, patch, WP.gameTimeline(loc.game).total);
      loc.game.clips = loc.game.clips.map((x) => (x.id === e.id ? next : x));
      save();
      const fresh = WP.libraryEntry(loc.game, next, S.settings.categories, S.settings.coachName);
      if (patch.private !== undefined) fresh.private = next.private;
      R.queue[R.idx] = fresh;
    } else {
      const lib = e.private ? S.lib.priv : S.lib.team;
      const upd = Object.assign({}, lib.entries[e.id] || e, patch);
      lib.entries[e.id] = upd;
      save();
      R.queue[R.idx] = upd;
    }
    renderReview();
  }

  function renderReviewTags() {
    const e = R.queue[R.idx];
    if (!e) return;
    const loc = localClip(e.id);
    const toggleEv = (id) => {
      if (loc) editEntry(e, WP.toggleEvent(loc.game, loc.clip, id));
      else editEntry(e, { events: e.events.includes(id) ? e.events.filter((x) => x !== id) : WP.EVENT_IDS.filter((x) => x === id || e.events.includes(x)) });
    };
    const catSel = el('select', { 'aria-label': 'Category', onchange: (ev) => { const c = catById(ev.target.value); editEntry(e, loc ? { categoryId: ev.target.value } : { categoryId: ev.target.value, category: c ? c.name : '', color: c ? c.color : e.color }); } },
      ...S.settings.categories.map((c) => el('option', { value: c.id }, c.name)));
    catSel.value = e.categoryId;
    const nums = new Set(S.settings.roster.map((p) => p.number).concat(e.players));
    const zsel = el('select', { 'aria-label': 'Zone', onchange: (ev) => editEntry(e, { zone: ev.target.value }) });
    selectOpts(zsel, WP.ZONES, e.zone, 'Not set');
    const ssel = el('select', { 'aria-label': 'Situation', onchange: (ev) => editEntry(e, { situation: ev.target.value }) });
    selectOpts(ssel, WP.SITUATIONS, e.situation || 'even');
    const note = el('input', { type: 'text', value: e.note || '', maxlength: '140', 'aria-label': 'Note', onchange: (ev) => editEntry(e, { note: ev.target.value }) });
    const auto = [e.game.title, WP.label(WP.GAME_TYPES, e.game.type), e.period ? WP.periodName(e.period) + ' ' + WP.formatTime(e.periodTime) : '', e.state ? e.state + ' ' + e.score.for + '–' + e.score.against : ''].filter(Boolean).join(' · ');
    const privCb = el('input', { type: 'checkbox', style: 'width:18px;height:18px', disabled: !loc, onchange: (ev) => editEntry(e, { private: ev.target.checked }) });
    privCb.checked = !!e.private;
    $('rv-tags').replaceChildren(
      el('div', { class: 'row spread' }, el('h3', {}, 'Clip tags'),
        el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(!!e.starred), onclick: () => editEntry(e, { starred: !e.starred }) }, e.starred ? '★ Starred' : '☆ Star')),
      el('span', { class: 'small muted' }, auto + ' · by ' + (e.by || '?')),
      el('label', { class: 'field' }, 'Category', catSel),
      el('div', { class: 'stack', style: 'gap:6px' }, el('span', { style: 'font-weight:600;font-size:13px' }, 'Events'), el('div', { class: 'chips' }, ...WP.EVENTS.map((ev) => chipBtn(ev.label, e.events.includes(ev.id), () => toggleEv(ev.id))))),
      el('div', { class: 'stack', style: 'gap:6px' }, el('span', { style: 'font-weight:600;font-size:13px' }, 'Players'), el('div', { class: 'chips' }, ...[...nums].sort((a, b) => a - b).map((n) => chipBtn('#' + n, e.players.includes(n), () => editEntry(e, { players: e.players.includes(n) ? e.players.filter((x) => x !== n) : e.players.concat([n]).sort((a, b) => a - b) }))))),
      el('div', { class: 'grid2', style: 'gap:8px' }, el('label', { class: 'field' }, 'Zone', zsel), el('label', { class: 'field' }, 'Situation', ssel)),
      el('div', { class: 'seg' }, chipBtn('Do this', e.flag !== 'work', () => editEntry(e, { flag: 'do' })), chipBtn('Work on this', e.flag === 'work', () => editEntry(e, { flag: 'work' }))),
      el('label', { class: 'field' }, 'Note', note),
      el('label', { class: 'row small', style: 'gap:8px', title: loc ? null : 'Only the coach who made this clip can make it private' }, privCb, '🔒 Private (only me)'),
      el('div', { class: 'row' },
        (e.drive || []).length ? el('a', { class: 'btn small', href: 'https://drive.google.com/file/d/' + encodeURIComponent(e.drive[0].fileId) + '/view', target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Open in Drive') : '',
        (e.drive || []).length ? el('button', { type: 'button', class: 'btn small', onclick: () => copyLink(e.drive[0].fileId) }, 'Copy link') : '',
        loc ? el('a', { class: 'btn small', href: '#edit/' + loc.game.id + '/' + e.id, style: 'text-decoration:none' }, 'Open in clip editor') : ''),
      el('span', { class: 'small muted' }, loc ? 'Changes save to this clip and the library.' : 'Changes save to the team library; ' + (e.owner || 'the coach who made it') + '’s copy updates when they next sync.'));
  }

  async function copyLink(fileId) {
    const url = 'https://drive.google.com/file/d/' + fileId + '/view';
    try { await navigator.clipboard.writeText(url); toast('Link copied — paste it into WhatsApp'); }
    catch (e) { prompt('Copy this link:', url); }
  }

  // keep other open tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key !== 'bulldogs-watch-party:v1') return;
    S = store.load();
    if (G) { G = S.games.find((g) => g.id === G.id) || G; }
    route();
  });

  $('brand-version').textContent = 'v' + WP.APP_VERSION;
  renderSyncBadge();
  if (S.sync && WPDrive.hasToken()) setTimeout(() => syncNow(false), 300);
  if (WPDrive.hasToken()) setTimeout(() => libSyncAll(false), 900);
  window.addEventListener('hashchange', route);
  window.__bwp = { get state() { return S; }, get player() { return player; }, get editor() { return E; }, get team() { return Team; }, get lib() { return LIB; }, get review() { return R; }, lastExport: null }; // for testing
  route();
})();
