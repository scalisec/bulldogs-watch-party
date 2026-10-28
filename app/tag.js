/* Bulldogs Watch Party — Game screen: watch, zoom, tag clips, mark periods and goals. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, catById, createPlayer, download, el, idb, lenText, rangeText, renderWho, save, session,
    slug, toast
  } = App;

  // =====================================================================
  // TAG VIEW
  // =====================================================================
  function openGame(id) {
    const game = S.games.find((g) => g.id === id);
    if (!game) { toast('That game isn’t on this computer', { err: true }); location.hash = 'games'; return false; }
    renderWho();
    if (App.G && App.G.id === id && App.player) { renderTagView(); return true; }
    if (App.player) { App.player.destroy(); App.player = null; }
    App.G = game;
    App.TL = WP.gameTimeline(App.G);
    App.selectedClipId = null; App.openEditorId = null; App.pendingStart = null; App.awaiting = null; App.filterCat = 'all';
    $('b-rate').value = '1';
    applyZoom(WP.FIT);
    renderTagView();
    const files = session.files.get(id);
    if (files) startPlayer(files); else showRelink();
    return true;
  }

  function startPlayer(files) {
    $('relink').classList.add('hidden');
    App.player = createPlayer($('video'), files, App.TL, App.G.id, onTick);
    App.player.seek(0);
  }

  // ---- zoom ----
  App.zoom = WP.FIT;

  function applyZoom(z) {
    App.zoom = WP.normalizeZoom(z || WP.FIT);
    const on = WP.isZoomed(App.zoom);
    $('video').style.transform = WP.zoomTransform(App.zoom);
    $('z-level').textContent = (Math.round(App.zoom.scale * 10) / 10) + '×';
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
      if (!App.player) return;
      e.preventDefault();
      const { fx, fy } = frameFrac(e);
      applyZoom(WP.zoomAt(App.zoom, e.deltaY < 0 ? 1.15 : 1 / 1.15, fx, fy));
    }, { passive: false });
    f.addEventListener('dblclick', (e) => {
      if (!App.player) return;
      const { fx, fy } = frameFrac(e);
      applyZoom(WP.isZoomed(App.zoom) ? WP.FIT : WP.zoomAt(WP.FIT, 2.5, fx, fy));
    });
    let drag = null;
    f.addEventListener('pointerdown', (e) => {
      if (!WP.isZoomed(App.zoom) || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, z: App.zoom, r: f.getBoundingClientRect() };
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
  $('z-in').addEventListener('click', () => applyZoom(WP.zoomAt(App.zoom, 1.25)));
  $('z-out').addEventListener('click', () => applyZoom(WP.zoomAt(App.zoom, 1 / 1.25)));
  $('z-fit').addEventListener('click', () => applyZoom(WP.FIT));
  function currentZoom() { return WP.isZoomed(App.zoom) ? App.zoom : null; }
  function zoomLabel(z) { return 'Zoom ' + (Math.round(z.scale * 10) / 10) + '×'; }

  async function showRelink() {
    $('relink').classList.remove('hidden');
    $('relink-names').textContent = App.G.parts.map((p) => p.name).join(' · ');
    const handles = await idb.get(App.G.id);
    $('relink-handles').hidden = !(handles && handles.length && handles[0].queryPermission);
    $('relink-msg').textContent = handles ? 'Reconnect this game’s video files' : 'Choose this game’s video files again';
  }

  $('relink-handles').addEventListener('click', async () => {
    try {
      const handles = await idb.get(App.G.id);
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
    const m = WP.matchFiles(App.G.parts, files);
    if (!m.files) { toast('Missing: ' + m.missing.join(', '), { err: true, ms: 7000 }); return; }
    session.files.set(App.G.id, m.files);
    startPlayer(m.files);
  }

  function renderTagView() {
    $('t-title').textContent = WP.gameTitle(App.G);
    $('t-logo').replaceChildren(App.G.league ? App.League.logo(App.G.league.opponentLogo, 40) : '');
    $('t-sub').textContent = [WP.formatClock(App.G.time), App.G.rink, App.G.result, App.G.parts.length + (App.G.parts.length === 1 ? ' part' : ' parts') + ' · ' + WP.formatTime(App.TL.total)].filter(Boolean).join(' · ');
    renderTags();
    renderGameStatus(true);
    renderLeagueBar();
    renderTagLineup();
    renderMarks();
    renderTimelineStatic();
    renderClips();
    updateMarks();
    onTick();
  }

  // ---- league: links for a linked game, or link this game to the schedule ----
  function renderLeagueBar() {
    const g = App.G;
    const box = $('t-league');
    const lg = S.settings.league;
    if (!g.league) {
      box.replaceChildren(lg && lg.teamId ? el('button', { type: 'button', class: 'btn small outline', onclick: openLeagueDialog }, 'Link to league schedule') : '');
      return;
    }
    const link = (href, text) => href ? el('a', { class: 'btn small', href, target: '_blank', rel: 'noopener noreferrer', style: 'text-decoration:none' }, text) : '';
    box.replaceChildren(
      el('span', { class: 'pill do' }, 'League game' + (g.league.code ? ' · ' + g.league.code : '')),
      link(g.league.liveBarn, 'Open in LiveBarn ↗'),
      link(g.league.gamesheet, 'GameSheet ↗'),
      el('button', { type: 'button', class: 'btn small', onclick: openLeagueDialog }, 'Change'));
  }

  function renderLeagueDialog() {
    const g = App.G;
    App.renderSchedulePicker($('dl-picker'), {
      key: 'dls', selectedId: g.league && g.league.id, selected: null, noneLabel: 'Unlink',
      onPick: (s) => {
        const next = WP.linkGame(g, s);
        Object.assign(g, next);
        save();
        $('dlg-league').close();
        renderTagView();
        toast('Linked to ' + App.League.whenText(s) + ' ' + App.League.vsText(s));
      },
      onNone: () => { g.league = null; save(); $('dlg-league').close(); renderTagView(); toast('No longer linked to the league schedule'); }
    });
  }

  function openLeagueDialog() {
    renderLeagueDialog();
    $('dlg-league').showModal();
    App.League.load();
    // suggest the game the video files belong to
    const sched = App.League.schedule();
    if (sched && !App.G.league) {
      const m = WP.matchScheduleGame(sched, App.G.parts);
      if (m) setTimeout(() => { const b = document.querySelector('#dls-list button[aria-label="' + CSS.escape(App.League.whenText(m) + ' ' + App.League.vsText(m)) + '"]'); if (b) { b.classList.add('sel'); b.scrollIntoView({ block: 'nearest' }); } }, 0);
    }
  }
  $('dl-close').addEventListener('click', () => $('dlg-league').close());
  App.League.onChange(() => { if ($('dlg-league').open) renderLeagueDialog(); });

  function renderTagLineup() {
    if (!App.G) return;
    $('t-lineup-sum').textContent = App.lineupSummary(App.G);
    App.renderLineup($('t-lineup'), { lineup: App.G.lineup, gameId: App.G.id, idPrefix: 'tl',
      onChange: (L) => { App.G.lineup = L; save(); renderTagLineup(); } });
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
  function pct(t) { return App.TL.total ? (t / App.TL.total) * 100 : 0; }

  function renderTimelineStatic() {
    const tl = $('tl');
    tl.replaceChildren();
    tl.setAttribute('aria-valuemax', String(Math.round(App.TL.total)));
    App.TL.offsets.forEach((o, i) => { if (i > 0) tl.append(el('div', { class: 'sep', style: 'left:' + pct(o) + '%' })); });
    for (const c of App.G.clips) {
      const cat = WP.clipCategoryLabel(c, S.settings.categories);
      tl.append(el('div', {
        class: 'mk' + (c.id === App.selectedClipId ? ' sel' : ''), 'data-clip': c.id,
        title: (cat ? cat.name : 'Clip') + ' ' + rangeText(c),
        style: 'left:' + pct(c.start) + '%;width:' + Math.max(0.3, pct(c.end - c.start)) + '%;background:' + (cat ? cat.color : '#64748B')
      }));
    }
    const gm = WP.gameMarks(App.G);
    for (const p of gm.periods) tl.append(el('div', { class: 'pband', title: WP.periodName(p.n), style: 'left:' + pct(p.start) + '%;width:' + Math.max(0.3, pct((p.end != null ? p.end : App.TL.total) - p.start)) + '%' }));
    for (const sb of WP.strengthBands(App.G, App.TL.total)) tl.append(el('div', { class: 'sband ' + sb.situation, title: (sb.situation === 'pp' ? 'Power play ' : 'Penalty kill ') + WP.formatTime(sb.start) + '–' + WP.formatTime(sb.end), style: 'left:' + pct(sb.start) + '%;width:' + Math.max(0.3, pct(sb.end - sb.start)) + '%' }));
    for (const g of gm.goals) tl.append(el('div', { class: 'gmk', title: (g.side === 'for' ? 'Goal for ' : 'Goal against ') + WP.formatTime(g.t), style: 'left:' + pct(g.t) + '%;background:' + (g.side === 'for' ? '#16A34A' : '#DC2626') }));
    tl.append(el('div', { class: 'pending hidden', id: 'tl-pending' }));
    tl.append(el('div', { class: 'head', id: 'tl-head' }));
    $('tl-labels').replaceChildren(...App.TL.durations.map((d, i) => el('span', { style: 'flex:' + d + ' 1 0' }, App.TL.durations.length > 1 ? 'Part ' + (i + 1) : 'Full game')));
  }

  // ---- game status under the video: period and score, strength, who's in the box (with Back now) ----
  let gsKey = '';
  let gsAt = 0;
  function renderGameStatus(force) {
    if (!App.G) return;
    const now = performance.now();
    if (!force && now - gsAt < 400) return; // called from the play loop: a few times a second is plenty
    gsAt = now;
    const t = App.player ? App.player.time() : 0;
    const a = WP.clipAuto(App.G, { start: t + 0.02, end: t + 0.02 });
    const st = WP.strengthAt(App.G, t);
    const box = WP.unendedPenalties(App.G, t);
    const m = WP.gameMarks(App.G);
    const key = [a.period, a.score.for, a.score.against, st.us, st.them, ...box.map((x) => x.p.id + (x.over ? '!' : '') + Math.round(x.left / 5))].join('|');
    if (!force && key === gsKey) return;
    gsKey = key;
    $('gs-score').textContent = (a.period ? WP.periodName(a.period) + ' · ' : m.periods.length ? 'Between periods · ' : '') + (m.goals.length ? 'Score ' + a.score.for + '–' + a.score.against : 'No goals marked');
    const strText = st.situation === 'pp' ? 'Power play ' + st.us + '-on-' + st.them : st.situation === 'pk' ? 'Penalty kill ' + st.us + '-on-' + st.them : st.us < 5 ? 'Even ' + st.us + '-on-' + st.them : 'Even strength';
    $('gs-str').textContent = strText;
    $('gs-str').className = 'gs-str ' + st.situation;
    $('gs-box').replaceChildren(...box.map((x) => el('li', { class: 'gs-pen ' + x.p.team + (x.over ? ' over' : '') },
      el('span', { class: 'grow' }, el('strong', {}, x.p.team === 'us' ? 'Us ' : 'Them '), WP.penaltyLabel(x.p).replace(/^(Us|Them) ?(· )?/, '')),
      el('span', { class: 'small muted' }, 'since ' + WP.formatTime(x.p.t) + ' · ' + (x.p.minutes === 10 ? 'misconduct' : x.over ? 'past its estimated end' : '~' + WP.formatTime(x.left) + ' left (est.)')),
      el('button', { type: 'button', class: 'btn small primary', 'aria-label': 'End penalty: ' + WP.penaltyLabel(x.p), onclick: () => endPenaltyAt(x.p, App.player ? App.player.time() : t) }, 'End penalty'))));
    $('gs-box').hidden = !box.length;
  }

  function endPenaltyAt(p, t) {
    try {
      App.G.marks = WP.endPenalty(App.G, p.id, t);
      marksChanged();
      toast(WP.penaltyLabel(p) + ': back at ' + WP.formatTime(t), { action: { label: 'Undo', fn: () => { const m = WP.gameMarks(App.G); m.penalties = m.penalties.map((x) => (x.id === p.id ? Object.assign({}, x, { end: null }) : x)); App.G.marks = m; marksChanged(); } } });
    } catch (e) { toast(e.message, { err: true }); }
  }

  function onTick() {
    if (!App.G) return;
    renderGameStatus();
    const t = App.player ? App.player.time() : 0;
    $('clock').textContent = WP.formatTime(t) + ' / ' + WP.formatTime(App.TL.total);
    const loc = WP.locate(App.TL, t);
    $('ov-time').textContent = (App.TL.durations.length > 1 ? 'Part ' + (loc.part + 1) + ' · ' : '') + WP.formatTime(t, true);
    const head = $('tl-head');
    if (head) head.style.left = pct(t) + '%';
    $('tl').setAttribute('aria-valuenow', String(Math.round(t)));
    $('tl').setAttribute('aria-valuetext', WP.formatTime(t));
    const pend = $('tl-pending');
    if (pend) {
      const s = App.awaiting ? App.awaiting.start : App.pendingStart;
      const e = App.awaiting ? App.awaiting.end : t;
      if (s == null) pend.classList.add('hidden');
      else {
        pend.classList.remove('hidden');
        pend.style.left = pct(Math.min(s, e)) + '%';
        pend.style.width = pct(Math.abs(e - s)) + '%';
      }
    }
    const playing = App.player && App.player.isPlaying();
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
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * App.TL.total;
    }
    tl.addEventListener('pointerdown', (e) => {
      if (!App.player) return;
      const mk = e.target.closest('.mk');
      if (mk) { selectClip(mk.dataset.clip, true); return; }
      down = true;
      tl.setPointerCapture(e.pointerId);
      App.player.seek(tAt(e));
    });
    tl.addEventListener('pointermove', (e) => {
      if (!down) return;
      const fresh = pendingT == null;
      pendingT = tAt(e);
      $('tl-head').style.left = pct(pendingT) + '%';
      if (fresh) requestAnimationFrame(() => { if (pendingT != null) App.player.seek(pendingT); pendingT = null; });
    });
    tl.addEventListener('pointerup', () => { down = false; });
    tl.addEventListener('pointercancel', () => { down = false; });
  })();

  // ---- tagging ----
  function addClip(fields, cat) {
    let clip;
    try {
      clip = WP.makeClip(Object.assign({ total: App.TL.total, by: S.settings.coachName }, fields));
      if (fields.tags) clip.tags = WP.normalizeTags(fields.tags);
      const pp = WP.penaltyPlayers(App.G, clip.start, clip.end);
      if (pp.length) clip.players = WP.normalizePlayers(clip.players.concat(pp));
    } catch (e) { toast(e.message, { err: true }); return null; }
    App.G.clips.push(clip);
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
    const clip = App.G.clips.find((c) => c.id === id);
    if (!clip) return;
    App.G.clips = App.G.clips.filter((c) => c.id !== id);
    if (!S.lib.deleted.includes(id)) S.lib.deleted.push(id);
    if (App.selectedClipId === id) App.selectedClipId = null;
    if (App.openEditorId === id) App.openEditorId = null;
    save();
    renderTimelineStatic();
    renderClips();
    onTick();
    if (!quiet) toast('Clip deleted', { action: { label: 'Undo', fn: () => { App.G.clips.push(clip); S.lib.deleted = S.lib.deleted.filter((x) => x !== clip.id); save(); renderTimelineStatic(); renderClips(); onTick(); } } });
  }

  function onCategory(cat) {
    if (!App.player) { toast('Connect the video files first', { err: true }); return; }
    if (App.awaiting) {
      const c = addClip({ start: App.awaiting.start, end: App.awaiting.end, categoryId: cat.id, method: 'marks', zoom: currentZoom() }, cat);
      if (c) { App.pendingStart = null; App.awaiting = null; updateMarks(); }
      return;
    }
    const w = WP.autoWindow(App.player.time(), cat, App.TL.total);
    addClip({ start: w.start, end: w.end, categoryId: cat.id, method: 'tap', zoom: currentZoom() }, cat);
  }

  function markIn() {
    if (!App.player) return;
    App.pendingStart = App.player.time();
    App.awaiting = null;
    updateMarks();
  }

  function markOut() {
    if (!App.player) return;
    if (App.pendingStart == null) { toast('Press I (Mark start) at the start of the play first'); return; }
    let s = App.pendingStart;
    let e = App.player.time();
    if (e < s) [s, e] = [e, s];
    const err = WP.validateRange(s, e, App.TL.total);
    if (err) { toast(err, { err: true }); return; }
    App.awaiting = { start: s, end: e };
    updateMarks();
  }

  function cancelMarks() { App.pendingStart = null; App.awaiting = null; updateMarks(); }

  function updateMarks() {
    const b = $('marks-banner');
    $('tags').classList.toggle('choose', !!App.awaiting);
    if (App.awaiting) {
      b.replaceChildren('Clip ' + WP.formatTime(App.awaiting.start) + '–' + WP.formatTime(App.awaiting.end) + ' marked — pick a category (1–9). ', el('button', { type: 'button', class: 'btn small', onclick: cancelMarks }, 'Cancel'));
      b.classList.remove('hidden');
    } else if (App.pendingStart != null) {
      b.replaceChildren('Start marked at ' + WP.formatTime(App.pendingStart) + ' — press O (Mark end) when the play is over. ', el('button', { type: 'button', class: 'btn small', onclick: cancelMarks }, 'Cancel'));
      b.classList.remove('hidden');
    } else b.classList.add('hidden');
    onTick();
  }

  // ---- controls ----
  $('b-play').addEventListener('click', () => App.player && App.player.toggle());
  $('b-back').addEventListener('click', () => App.player && App.player.nudge(-5));
  $('b-fwd').addEventListener('click', () => App.player && App.player.nudge(5));
  $('b-rate').addEventListener('change', (e) => App.player && App.player.setRate(Number(e.target.value)));
  $('b-in').addEventListener('click', markIn);
  $('b-out').addEventListener('click', markOut);
  $('b-backup').addEventListener('click', () => App.G && download('watch-party-' + slug(WP.gameTitle(App.G)) + '.json', WP.exportBackup(S, App.G.id)));

  // ---- manual dialog ----
  function openManual() {
    if (!App.player) { toast('Connect the video files first', { err: true }); return; }
    const t = App.player.time();
    $('dm-start').value = WP.formatTime(Math.max(0, t - WP.DEFAULT_BEFORE));
    $('dm-end').value = WP.formatTime(Math.min(App.TL.total, t + WP.DEFAULT_AFTER));
    $('dm-cat').replaceChildren(...S.settings.categories.map((c) => el('option', { value: c.id }, c.name + (c.hidden ? ' (hidden)' : ''))));
    $('dm-err').textContent = '';
    $('dlg-manual').showModal();
    $('dm-start').focus();
    $('dm-start').select();
  }
  $('b-manual').addEventListener('click', openManual);
  $('dm-start-now').addEventListener('click', () => { $('dm-start').value = WP.formatTime(App.player.time(), true); });
  $('dm-end-now').addEventListener('click', () => { $('dm-end').value = WP.formatTime(App.player.time(), true); });
  $('dm-cancel').addEventListener('click', () => $('dlg-manual').close());
  $('dm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = WP.parseTime($('dm-start').value);
    const end = WP.parseTime($('dm-end').value);
    const err = WP.validateRange(start, end, App.TL.total);
    if (err) { $('dm-err').textContent = err; return; }
    const cat = catById($('dm-cat').value);
    const clip = addClip({ start, end, categoryId: cat.id, method: 'manual', zoom: currentZoom() }, cat);
    if (clip) { $('dlg-manual').close(); selectClip(clip.id, true); }
  });

  // ---- clip list ----
  function selectClip(id, seek) {
    App.selectedClipId = id;
    const clip = App.G.clips.find((c) => c.id === id);
    renderTimelineStatic();
    renderClips();
    onTick();
    if (clip && seek && App.player) App.player.seek(clip.start);
    const card = document.querySelector('.clip[data-clip="' + id + '"]');
    if (card) card.scrollIntoView({ block: 'nearest' });
  }

  function renderClipFilter() {
    const counts = {};
    for (const c of App.G.clips) for (const id of WP.clipCategoryIds(c)) counts[id] = (counts[id] || 0) + 1;
    const opts = [el('option', { value: 'all' }, 'All categories (' + App.G.clips.length + ')')];
    for (const c of S.settings.categories) if (counts[c.id]) opts.push(el('option', { value: c.id }, c.name + ' (' + counts[c.id] + ')'));
    $('clip-filter').replaceChildren(...opts);
    if (App.filterCat !== 'all' && !counts[App.filterCat]) App.filterCat = 'all';
    $('clip-filter').value = App.filterCat;
  }
  $('clip-filter').addEventListener('change', (e) => { App.filterCat = e.target.value; renderClips(); });

  function renderClips() {
    renderClipFilter();
    $('clip-count').textContent = App.G.clips.length + (App.G.clips.length === 1 ? ' clip' : ' clips');
    const clips = WP.sortClips(App.G.clips).filter((c) => App.filterCat === 'all' || WP.clipCategoryIds(c).includes(App.filterCat));
    if (!clips.length) {
      $('clips').replaceChildren(el('div', { class: 'empty' }, App.G.clips.length ? 'No clips in this category.' : 'No clips yet. Play the game and tap a category when something happens.'));
      return;
    }
    $('clips').replaceChildren(...clips.map(clipCard));
  }

  function clipCard(c) {
    const cat = WP.clipCategoryLabel(c, S.settings.categories);
    const card = el('div', { class: 'clip' + (c.id === App.selectedClipId ? ' sel' : ''), 'data-clip': c.id },
      el('div', { class: 'row', style: 'gap:8px; flex-wrap:nowrap' },
        el('span', { class: 'dot', style: 'background:' + (cat ? cat.color : '#64748B') }),
        el('button', { type: 'button', class: 'grow', style: 'border:none;background:none;padding:0;text-align:left;font-weight:600', onclick: () => selectClip(c.id, true) }, cat ? cat.name : 'Deleted category'),
        el('span', { class: 'small muted', style: 'font-variant-numeric:tabular-nums;white-space:nowrap' }, rangeText(c) + ' · ' + lenText(c))
      ),
      el('div', { class: 'meta' },
        el('span', {}, c.players.length ? c.players.map((p) => '#' + p).join(' ') : 'No players'),
        el('span', { class: 'pill ' + c.flag }, c.flag === 'work' ? 'Work on this' : 'Do this'),
        WP.hasRec(c) ? el('span', { class: 'pill recpill' }, '\u25CF Breakdown' + (c.rec.voice ? ' + voice' : '')) : (c.zoom ? el('span', { class: 'pill zoompill' }, zoomLabel(c.zoom)) : null),
        ...(c.tags || []).map((t) => el('span', { class: 'pill tagpill' }, '#' + t)),
        c.by ? el('span', {}, 'by ' + c.by) : null
      ),
      (WP.clipEvents(App.G, c).length || autoLine(App.G, c) || c.private || c.starred) ? el('div', { class: 'meta' }, ...evBadges(App.G, c), autoLine(App.G, c) ? el('span', {}, autoLine(App.G, c)) : '', c.starred ? el('span', { style: 'color:#FACC15' }, '\u2605') : '', c.private ? el('span', { class: 'pill lockpill' }, '\uD83D\uDD12 Private') : '') : null,
      c.note ? el('div', { class: 'small' }, c.note) : null,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small', onclick: () => { App.selectedClipId = c.id; renderTimelineStatic(); renderClips(); applyZoom(c.zoom); App.player && App.player.playRange(c.start, c.end); } }, '▶ Play clip'),
        el('a', { class: 'btn small', href: '#edit/' + App.G.id + '/' + c.id, style: 'text-decoration:none' }, 'Edit'),
        c.exported ? el('span', { class: 'small muted', title: c.exported.name }, '\u2713 Exported') : null
      )
    );
    return card;
  }


  // =====================================================================
  // PERIODS, GOALS AND CLIP TAGS (milestone 3b)
  // =====================================================================
  const sameJ = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function selectOpts(sel, list, value, blank) {
    sel.replaceChildren(...(blank ? [el('option', { value: '' }, blank)] : []), ...list.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = value || '';
  }

  function renderMarks() {
    if (!App.G) return;
    const m = WP.gameMarks(App.G);
    const open = m.periods.find((p) => p.end == null);
    $('b-period').replaceChildren(open ? 'Period ' + WP.periodName(open.n) + ' end ' : 'Period ' + WP.periodName(m.periods.length + 1) + ' start ', el('kbd', {}, 'P'));
    const items = [];
    for (const p of m.periods) {
      items.push(el('span', { class: 'mark' }, WP.periodName(p.n) + ' ' + WP.formatTime(p.start) + '–' + (p.end != null ? WP.formatTime(p.end) : '…'),
        el('button', { type: 'button', 'aria-label': 'Delete ' + WP.periodName(p.n) + ' marks', onclick: () => { App.G.marks = WP.removePeriod(App.G, p.n); marksChanged(); } }, '✕')));
    }
    let f = 0, a = 0;
    for (const g of m.goals) {
      if (g.side === 'for') f += 1; else a += 1;
      items.push(el('span', { class: 'mark ' + (g.side === 'for' ? 'gf' : 'ga') },
        el('button', { type: 'button', style: 'width:auto;padding:0 4px;background:none', title: 'Go to this goal', onclick: () => App.player && App.player.seek(Math.max(0, g.t - 3)) }, (g.side === 'for' ? 'Goal for ' : 'Goal against ') + WP.formatTime(g.t) + ' (' + f + '–' + a + ')'),
        el('button', { type: 'button', 'aria-label': 'Delete goal at ' + WP.formatTime(g.t), onclick: () => { App.G.marks = WP.removeGoal(App.G, g.id); marksChanged(); } }, '✕')));
    }
    for (const p of m.penalties) {
      const end = WP.penaltyEnd(App.G, p);
      const endText = end.why === 'marked' ? 'back ' + WP.formatTime(end.t) : end.why === 'goal' ? 'ended by goal ' + WP.formatTime(end.t) : 'end not marked';
      items.push(el('span', { class: 'mark ' + (p.team === 'us' ? 'pk' : 'pp') },
        el('button', { type: 'button', style: 'width:auto;padding:0 4px;background:none', title: 'Go to this penalty', onclick: () => App.player && App.player.seek(Math.max(0, p.t - 3)) }, WP.penaltyLabel(p) + ' · ' + WP.formatTime(p.t) + ' (' + endText + ')'),
        el('button', { type: 'button', 'aria-label': 'Delete penalty ' + WP.penaltyLabel(p), onclick: () => { App.G.marks = WP.removePenalty(App.G, p.id); marksChanged(); } }, '✕')));
    }
    $('marks-list').replaceChildren(...(items.length ? items : [el('span', { class: 'small muted' }, 'No periods, goals or penalties marked yet.')]));
    selectOpts($('t-gtype'), WP.GAME_TYPES, App.G.gameType, 'Not set');
    selectOpts($('t-gha'), WP.HOME_AWAY, App.G.homeAway, 'Not set');
  }

  function marksChanged() {
    save();
    renderGameStatus(true);
    renderMarks();
    renderTimelineStatic();
    renderClips();
    onTick();
  }

  function markPeriod() {
    if (!App.player) return;
    try {
      const r = WP.togglePeriod(App.G, App.player.time());
      App.G.marks = r.marks;
      marksChanged();
      toast(WP.periodName(r.n) + (r.did === 'start' ? ' started' : ' ended') + ' at ' + WP.formatTime(App.player.time()));
    } catch (e) { toast(e.message, { err: true }); }
  }

  function markGoal(side) {
    if (!App.player) return;
    const t = App.player.time();
    App.G.marks = WP.addGoal(App.G, t, side);
    const m = WP.gameMarks(App.G);
    const f = m.goals.filter((g) => g.side === 'for').length;
    const a = m.goals.length - f;
    marksChanged();
    const id = m.goals.find((g) => Math.abs(g.t - Math.round(t * 10) / 10) < 0.01 && g.side === side).id;
    toast((side === 'for' ? 'Goal for' : 'Goal against') + ' at ' + WP.formatTime(t) + ' — score ' + f + '–' + a, { action: { label: 'Undo', fn: () => { App.G.marks = WP.removeGoal(App.G, id); marksChanged(); } } });
  }

  // ---- custom tag (T): a new clip at this moment with a tag you type ----
  const QT = { t: 0, wasPlaying: false, catId: null, range: null };
  function openQuickTag() {
    if (!App.player || !App.G) { toast('Connect the video files first', { err: true }); return; }
    QT.t = App.player.time();
    QT.range = App.awaiting ? { start: App.awaiting.start, end: App.awaiting.end } : App.pendingStart != null && QT.t > App.pendingStart ? { start: App.pendingStart, end: QT.t } : null;
    QT.wasPlaying = App.player.isPlaying();
    if (QT.wasPlaying) App.player.pause();
    const cats = S.settings.categories.filter((c) => !c.hidden);
    const last = App.G.clips.length ? App.G.clips[App.G.clips.length - 1].categoryId : null;
    QT.catId = cats.some((c) => c.id === QT.catId) ? QT.catId : cats.some((c) => c.id === last) ? last : (cats[0] || {}).id;
    $('qt-cat').replaceChildren(...cats.map((c) => el('option', { value: c.id }, c.name)));
    $('qt-cat').value = QT.catId || '';
    $('dl-qtags').replaceChildren(...App.allTags().map((t) => el('option', { value: t })));
    $('qt-at').textContent = QT.range ? 'Clip ' + WP.formatTime(QT.range.start) + '–' + WP.formatTime(QT.range.end) + ' (your start/end marks)' : 'At ' + WP.formatTime(QT.t) + ' · uses the category’s before/after window';
    $('qt-tag').value = '';
    $('dlg-qtag').showModal();
    $('qt-tag').focus();
  }
  function closeQuickTag() {
    if ($('dlg-qtag').open) $('dlg-qtag').close();
    if (QT.wasPlaying && App.player) App.player.resume();
    QT.wasPlaying = false;
  }
  function saveQuickTag() {
    const tags = WP.normalizeTags($('qt-tag').value.split(','));
    if (!tags.length) { toast('Type a tag first', { err: true }); $('qt-tag').focus(); return; }
    const cat = catById($('qt-cat').value);
    if (!cat) { toast('Pick a category', { err: true }); return; }
    QT.catId = cat.id;
    const w = QT.range || WP.autoWindow(QT.t, cat, App.TL.total);
    const c = addClip({ start: w.start, end: w.end, categoryId: cat.id, method: QT.range ? 'marks' : 'tap', zoom: currentZoom(), tags }, { name: cat.name + ' · ' + tags.join(', ') });
    if (c && QT.range) { App.pendingStart = null; App.awaiting = null; updateMarks(); }
    closeQuickTag();
  }
  $('qt-form').addEventListener('submit', (e) => { e.preventDefault(); saveQuickTag(); });
  $('qt-cancel').addEventListener('click', closeQuickTag);
  $('dlg-qtag').addEventListener('cancel', (e) => { e.preventDefault(); closeQuickTag(); });
  $('b-qtag').addEventListener('click', openQuickTag);
  $('gs-tag').addEventListener('click', openQuickTag);
  $('gs-pen').addEventListener('click', () => openPenalty());
  $('gs-gf').addEventListener('click', () => markGoal('for'));
  $('gs-ga').addEventListener('click', () => markGoal('against'));

  // ---- penalties (X): call a penalty, or mark a player back ----
  const PEN = { team: 'us', player: '', type: 'tripping', minutes: 2, t: 0, wasPlaying: false };

  function openPenalty() {
    if (!App.player || !App.G) return;
    PEN.t = App.player.time();
    PEN.wasPlaying = App.player.isPlaying();
    if (PEN.wasPlaying) App.player.pause();
    PEN.player = '';
    $('pen-num').value = '';
    $('pen-at').textContent = 'At ' + WP.formatTime(PEN.t) + (WP.clipAuto(App.G, { start: PEN.t, end: PEN.t }).period ? ' · ' + WP.periodName(WP.clipAuto(App.G, { start: PEN.t, end: PEN.t }).period) : '');
    selectOpts($('pen-type'), WP.PENALTY_TYPES, PEN.type, null);
    renderPenaltyForm();
    $('dlg-penalty').showModal();
  }

  function renderPenaltyForm() {
    const open = WP.unendedPenalties(App.G, PEN.t).map((x) => x.p); // includes ones past their estimated end
    $('pen-open').replaceChildren(...(open.length ? [el('span', { style: 'font-weight:600;font-size:13px' }, 'In the box now')] : []),
      ...open.map((p) => el('div', { class: 'row', style: 'gap:8px' },
        el('span', { class: 'grow small' }, WP.penaltyLabel(p) + ' · since ' + WP.formatTime(p.t)),
        el('button', { type: 'button', class: 'btn small primary', 'aria-label': 'Back now: ' + WP.penaltyLabel(p), onclick: () => endPenaltyNow(p) }, 'Back now'))));
    $('pen-h').textContent = open.length ? 'Penalty, or a player back' : 'Penalty';
    for (const b of $('pen-team').children) b.setAttribute('aria-pressed', String(b.dataset.team === PEN.team));
    const rows = WP.gameLineup(App.G, S.settings.roster).filter((r) => !r.away);
    $('pen-players').hidden = PEN.team !== 'us' || !rows.length;
    $('pen-players').replaceChildren(...rows.map((r) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(PEN.player === r.number), title: r.name || null,
      onclick: () => { PEN.player = PEN.player === r.number ? '' : r.number; renderPenaltyForm(); } }, '#' + r.number + (r.name ? ' ' + r.name : ''))));
    $('pen-num-wrap').classList.toggle('hidden', PEN.team !== 'them');
    $('pen-len').replaceChildren(...WP.PENALTY_LENGTHS.map(([m, lab]) => el('button', { type: 'button', class: 'btn small', 'aria-pressed': String(PEN.minutes === m), onclick: () => { PEN.minutes = m; renderPenaltyForm(); } }, lab)));
  }

  function closePenalty() {
    if ($('dlg-penalty').open) $('dlg-penalty').close();
    if (PEN.wasPlaying && App.player) App.player.resume();
    PEN.wasPlaying = false;
  }

  function endPenaltyNow(p) {
    try {
      App.G.marks = WP.endPenalty(App.G, p.id, PEN.t);
      marksChanged();
      toast(WP.penaltyLabel(p) + ': back at ' + WP.formatTime(PEN.t), { action: { label: 'Undo', fn: () => { const m = WP.gameMarks(App.G); m.penalties = m.penalties.map((x) => (x.id === p.id ? Object.assign({}, x, { end: null }) : x)); App.G.marks = m; marksChanged(); } } });
      closePenalty();
    } catch (e) { toast(e.message, { err: true }); }
  }

  function savePenalty() {
    const player = PEN.team === 'us' ? PEN.player : $('pen-num').value;
    PEN.type = $('pen-type').value;
    const r = WP.addPenalty(App.G, PEN.t, { team: PEN.team, player, type: PEN.type, minutes: PEN.minutes });
    App.G.marks = r.marks;
    // the player goes on clips that already include the call (new clips get it when they're made)
    if (r.penalty.team === 'us' && r.penalty.player) {
      App.G.clips = App.G.clips.map((c) => (c.start <= r.penalty.t + 0.01 && c.end >= r.penalty.t - 0.01 && !c.players.includes(r.penalty.player) ? Object.assign({}, c, { players: WP.normalizePlayers(c.players.concat([r.penalty.player])) }) : c));
    }
    marksChanged();
    toast(WP.penaltyLabel(r.penalty) + ' at ' + WP.formatTime(r.penalty.t) + (r.penalty.minutes === 10 ? '' : r.penalty.team === 'us' ? ' — penalty kill' : ' — power play'),
      { action: { label: 'Undo', fn: () => { App.G.marks = WP.removePenalty(App.G, r.penalty.id); marksChanged(); } } });
    closePenalty();
  }

  for (const b of $('pen-team').children) b.addEventListener('click', () => { PEN.team = b.dataset.team; PEN.player = ''; renderPenaltyForm(); });
  $('pen-form').addEventListener('submit', (e) => { e.preventDefault(); savePenalty(); });
  $('pen-cancel').addEventListener('click', closePenalty);
  $('dlg-penalty').addEventListener('cancel', (e) => { e.preventDefault(); closePenalty(); });
  $('b-penalty').addEventListener('click', openPenalty);

  $('b-period').addEventListener('click', markPeriod);
  $('b-goal-for').addEventListener('click', () => markGoal('for'));
  $('b-goal-against').addEventListener('click', () => markGoal('against'));
  $('t-gtype').addEventListener('change', (e) => { App.G.gameType = e.target.value; save(); renderTagView(); });
  $('t-gha').addEventListener('change', (e) => { App.G.homeAway = e.target.value; save(); renderTagView(); });

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
  Object.assign(App, {
    renderTagLineup,
    applyZoom, autoLine, cancelMarks, evBadges, markGoal, markIn, markOut, markPeriod, onCategory, openPenalty, openQuickTag,
    openGame, removeClip, renderClips, renderTags, sameJ, selectOpts, zoomLabel
  });
}).catch((e) => setTimeout(() => { throw e; }));
