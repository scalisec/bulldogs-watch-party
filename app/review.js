/* Bulldogs Watch Party — Review screen: filter, search, saved views and playlists of clips. */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, LIB, S, allTags, ask, askYes, catById, createPlayer, el, evBadges, myLibrary, renderWho,
    save, saveQuiet, selectOpts, session, toast
  } = App;

  // =====================================================================
  // REVIEW SCREEN
  // =====================================================================
  const PAGE = 48; // cards shown at a time (a season can have well over a thousand clips)
  const R = { filters: WP.emptyFilters(), viewId: null, queue: [], idx: -1, cleanup: null, sort: 'oldest', shown: PAGE, listKey: '' };
  let localIdx = null; // clip id -> { game, clip }, rebuilt each time Review draws

  function scopeEntries() {
    const team = Object.values(myLibrary('team').entries);
    const priv = Object.values(myLibrary('priv').entries).map((e) => Object.assign({}, e, { private: true }));
    const sc = S.lib.scope;
    return sc === 'private' ? priv : sc === 'both' ? team.concat(priv) : team;
  }

  function localClip(id) {
    const hit = localIdx && localIdx.get(id);
    if (hit && S.games.includes(hit.game) && hit.game.clips.includes(hit.clip)) return hit;
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
    localIdx = new Map();
    for (const g of S.games) for (const c of g.clips) localIdx.set(c.id, { game: g, clip: c });
    const all = scopeEntries();
    const fc = WP.filterCount(R.filters);
    $('rv-filter-toggle').textContent = (fc ? 'Filters (' + fc + ')' : 'Filters') + ' and saved views';
    for (const b of $('rv-scope').children) b.setAttribute('aria-pressed', String(b.dataset.scope === S.lib.scope));
    if (document.activeElement !== $('rv-q')) $('rv-q').value = R.filters.q;
    // saved views
    const views = S.lib.team.views || [];
    $('rv-views').replaceChildren(...(views.length ? views.map((v) => el('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
      el('button', { type: 'button', class: 'vbtn grow', 'aria-pressed': String(R.viewId === v.id), onclick: () => { R.filters = WP.normalizeFilters(v.filters); R.viewId = v.id; renderReview(); } },
        el('span', {}, v.name), el('span', { class: 'small muted' }, String(all.filter((e) => WP.entryMatches(e, v.filters)).length))),
      el('button', { type: 'button', class: 'btn small', style: 'min-height:32px;padding:0 8px', 'aria-label': 'Delete saved view ' + v.name, onclick: async () => { if (!(await askYes('Delete the saved view \u201c' + v.name + '\u201d?', 'It is removed for all coaches.', 'Delete view'))) return; S.lib.team.views = WP.removeView(views, v.id); if (R.viewId === v.id) R.viewId = null; save(); renderReview(); } }, '✕')))
      : [el('span', { class: 'small muted' }, 'None yet. Pick filters, then Save view.')]));
    // filter groups
    const F = R.filters;
    const groups = [];
    const group = (title, kids) => groups.push(el('div', { class: 'stack', style: 'gap:6px;border-top:1px solid var(--line);padding-top:12px' }, el('h3', { class: 'fh' }, title), el('div', { class: 'chips' }, ...kids)));
    const usedCats = new Set(all.map((e) => e.categoryId));
    group('Category', S.settings.categories.filter((c) => !c.hidden || usedCats.has(c.id)).map((c) => chipBtn(c.name, F.categories.includes(c.id), () => toggleIn('categories', c.id), el('span', { class: 'dot', style: 'width:9px;height:9px;margin-right:6px;display:inline-block;background:' + c.color }))));
    group('Events', WP.EVENTS.map((ev) => chipBtn(ev.label, F.events.includes(ev.id), () => toggleIn('events', ev.id))));
    const nums = new Set(S.settings.roster.map((p) => p.number));
    for (const e of all) for (const p of e.players) nums.add(p);
    group('Players', [...nums].sort((a, b) => a - b).map((n) => chipBtn('#' + n, F.players.includes(n), () => toggleIn('players', n))));
    group('Position', WP.POSITION_GROUPS.map(([g, label]) => chipBtn(label, F.positions.includes(g), () => toggleIn('positions', g))));
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
    groups.push(el('div', { class: 'stack', style: 'gap:6px;border-top:1px solid var(--line);padding-top:12px' }, el('h3', { class: 'fh' }, 'Game'), gsel, el('div', { class: 'grid2', style: 'gap:6px' }, tsel, hsel),
      el('label', { class: 'row small', style: 'gap:8px' }, driveCb, 'Only clips saved in Drive')));
    $('rv-groups').replaceChildren(...groups);
    // results
    const list = WP.sortEntries(all.filter((e) => WP.entryMatches(e, F)), R.sort);
    const view = views.find((v) => v.id === R.viewId);
    $('rv-title').textContent = view ? view.name : WP.describeFilters(F, S.settings.categories);
    const secs = Math.round(lenSum(list));
    $('rv-count').textContent = list.length + (list.length === 1 ? ' clip' : ' clips') + ' · ' + Math.floor(secs / 60) + ' min ' + (secs % 60) + ' s · ' + ({ team: 'team library', private: 'my private clips', both: 'team and private' })[S.lib.scope];
    const pills = [];
    const pill = (text, fn) => pills.push(el('span', { class: 'mark', style: 'background:var(--accent-soft);color:var(--accent-text)' }, text, el('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onclick: fn }, '✕')));
    for (const id of F.categories) pill('Category: ' + ((catById(id) || {}).name || id), () => toggleIn('categories', id));
    for (const id of F.events) pill('Event: ' + WP.eventLabel(id), () => toggleIn('events', id));
    for (const n of F.players) pill('#' + n, () => toggleIn('players', n));
    for (const g of F.positions) pill((WP.POSITION_GROUPS.find((x) => x[0] === g) || [g, g])[1], () => toggleIn('positions', g));
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
    const key = JSON.stringify([R.filters, S.lib.scope, R.sort]);
    if (key !== R.listKey) { R.listKey = key; R.shown = PAGE; }
    const nowId = R.idx >= 0 && R.queue[R.idx] ? R.queue[R.idx].id : null;
    const nowAt = nowId ? list.findIndex((x) => x.id === nowId) : -1;
    if (nowAt >= R.shown) R.shown = Math.ceil((nowAt + 1) / PAGE) * PAGE; // keep the playing clip's card on screen
    const more = list.length - R.shown;
    $('rv-more-btn').classList.toggle('hidden', more <= 0);
    $('rv-more-btn').textContent = 'Show ' + Math.min(PAGE, Math.max(0, more)) + ' more (' + Math.max(0, more) + ' left)';
    $('rv-results').replaceChildren(...(list.length ? list.slice(0, R.shown).map((e, i) => {
      const w = whereInfo(e);
      const feats = Object.entries(e.features || {}).filter(([, v]) => v).map(([k]) => ({ drawing: 'Drawing', slow: 'Slow-mo', zoom: 'Zoom', voice: 'Voice' })[k]);
      return el('button', { type: 'button', class: 'rvcard' + (e.id === nowId ? ' now' : ''), 'data-entry': e.id, onclick: () => startQueue(list, i) },
        el('div', { class: 'row', style: 'gap:6px' }, el('span', { class: 'dot', style: 'background:' + (e.color || '#64748B') }), el('strong', {}, e.category || 'Clip'), ...evBadges(null, null, e.events), e.starred ? el('span', { style: 'color:#FACC15', 'aria-label': 'Starred' }, '★') : ''),
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
  $('rv-save').addEventListener('click', async () => {
    const name = await ask({ title: 'Save this view', message: 'Saved views are shared with all coaches.', input: WP.describeFilters(R.filters, S.settings.categories), ok: 'Save view' });
    if (name == null) return;
    try { S.lib.team.views = WP.addView(S.lib.team.views, name, R.filters); R.viewId = S.lib.team.views[S.lib.team.views.length - 1].id; save(); renderReview(); toast('View saved'); }
    catch (err) { toast(err.message, { err: true }); }
  });
  $('rv-play').addEventListener('click', () => R.list && R.list.length && startQueue(R.list, 0));
  $('rv-more-btn').addEventListener('click', () => { R.shown += PAGE; renderReview(); });
  $('rv-filter-toggle').addEventListener('click', () => {
    const open = !$('rv-more').classList.contains('open');
    $('rv-more').classList.toggle('open', open);
    $('rv-filter-toggle').setAttribute('aria-expanded', String(open));
  });
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

  // Drive clips already downloaded (or downloading): the next clip is fetched while the current one plays
  const blobCache = new Map(); // fileId -> Promise<Blob>
  function driveBlob(fileId) {
    if (blobCache.has(fileId)) { const p = blobCache.get(fileId); blobCache.delete(fileId); blobCache.set(fileId, p); return p; }
    const p = WPDrive.downloadBlob(fileId);
    p.catch(() => blobCache.delete(fileId));
    blobCache.set(fileId, p);
    while (blobCache.size > 5) blobCache.delete(blobCache.keys().next().value);
    return p;
  }
  function prefetchAfter(i) {
    const n = R.queue[i + 1];
    const f = n && (n.drive || [])[0];
    if (f && WPDrive.hasToken()) driveBlob(f.fileId).catch(() => {});
  }

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
        const blob = await driveBlob(file.fileId);
        if (R.token !== token) return;
        prefetchAfter(i);
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
      const fresh = WP.libraryEntry(loc.game, next, S.settings.categories, S.settings.coachName, S.settings.roster);
      if (patch.private !== undefined) fresh.private = next.private;
      R.queue[R.idx] = fresh;
    } else {
      const lib = e.private ? S.lib.priv : S.lib.team;
      const upd = Object.assign({}, lib.entries[e.id] || e, patch);
      lib.entries[e.id] = upd;
      DB.touch(e.private ? 'lib:priv' : 'lib:team');
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
  Object.assign(App, {
    R, renderReview, stopReviewPlayer
  });
}).catch((e) => setTimeout(() => { throw e; }));
