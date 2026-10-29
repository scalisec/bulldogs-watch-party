/* Bulldogs Watch Party — Routing, keyboard, shortcuts, other tabs, update banner and start-up. Loads last. */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, LIB, R, S, Team, applyZoom, cancelMarks, closeEditor, edBusy, edRecording, editorKey, el,
    libSyncAll, libSyncIfStale, loaded, markGoal, markIn, markOut, markPeriod, onCategory, openPenalty, openQuickTag,
    openEditor, openGame, renderGames, renderReview, renderSettings, renderSyncBadge, replaceState,
    stopReviewPlayer, syncNow, tabs, toast
  } = App;

  // ---------- routing ----------
  function show(view) {
    for (const v of ['games', 'new', 'tag', 'edit', 'ginfo', 'gsum', 'sums', 'stats', 'review', 'team', 'settings']) $('view-' + v).classList.toggle('hidden', v !== view);
    if (view !== 'edit') closeEditor();
    const navOf = { tag: 'games', edit: 'games', new: 'games', ginfo: 'games', gsum: 'games', sums: 'summaries', stats: 'summaries' };
    for (const a of document.querySelectorAll('[data-nav]')) {
      if (a.dataset.nav === (navOf[view] || view)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    // the game header (title, league links, Watch and tag / Summary / Game details) on a game's screens
    const tab = { tag: 'tag', ginfo: 'info', gsum: 'sum' }[view];
    $('game-head').classList.toggle('hidden', !tab || !App.G);
    if (tab && App.G) {
      for (const a of document.querySelectorAll('[data-gtab]')) {
        a.href = '#' + a.dataset.gtab + '/' + App.G.id;
        if (a.dataset.gtab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      }
    }
    if (view !== 'tag' && App.player) App.player.pause();
    if (view !== 'review' && R.idx >= 0) stopReviewPlayer();
    window.scrollTo(0, 0);
  }

  function route() {
    const [view, id, sub] = (location.hash.replace('#', '') || 'games').split('/');
    if (view === 'tag' && id) { if (openGame(id)) show('tag'); }
    else if (view === 'edit' && id && sub) { show('edit'); if (!openEditor(id, sub)) return; }
    else if (view === 'sum' && id) { if (App.selectGame(id)) { show('gsum'); App.renderGameSummary(); } }
    else if (view === 'info' && id) { if (App.selectGame(id)) { show('ginfo'); App.renderDetails(); } }
    else if (view === 'new') { App.renderNew(id ? decodeURIComponent(id) : ''); show('new'); }
    else if (view === 'summaries') { show('sums'); App.renderSummaries(); }
    else if (view === 'stats') { show('stats'); App.renderStats(); }
    else if (view === 'settings') { renderSettings(); show('settings'); }
    else if (view === 'team') { renderSettings(); App.renderTeam(id); show('team'); }
    else if (view === 'review') { show('review'); renderReview(); libSyncIfStale(20000); }
    else { renderGames(); show('games'); }
  }
  App.route = route;

  // ---- shortcuts overlay (? key) ----
  function keyCells(k) { return k.split(/( \/ | or | \+ | \u00b7 )/).map((bit) => (/^ (\/|or|\+|\u00b7) $/.test(bit) ? bit : el('kbd', {}, bit))); }
  function openKeys() {
    $('keys-body').replaceChildren(...WP.SHORTCUTS.map((sec) => el('div', { class: 'stack', style: 'gap:4px' }, el('h3', {}, sec.title),
      el('table', { class: 'keystable' }, el('tbody', {}, ...sec.keys.map(([k, what]) => el('tr', {}, el('td', {}, ...keyCells(k)), el('td', {}, what))))))));
    $('dlg-keys').showModal();
  }
  $('keys-open').addEventListener('click', openKeys);
  App.openKeys = openKeys;
  $('keys-close').addEventListener('click', () => $('dlg-keys').close());

  // ---- keyboard ----
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && !/^(input|select|textarea)$/i.test(e.target.tagName || '') && !document.querySelector('dialog[open]')) { e.preventDefault(); openKeys(); return; }
    if (!$('view-edit').classList.contains('hidden')) { editorKey(e); return; }
    if ($('view-tag').classList.contains('hidden') || !App.G) return;
    if (document.querySelector('dialog[open]')) return; // a popup (penalty, manual clip, …) has the keyboard
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); App.player && App.player.toggle(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); App.player && App.player.nudge(e.shiftKey ? -1 : -5); }
    else if (k === 'ArrowRight') { e.preventDefault(); App.player && App.player.nudge(e.shiftKey ? 1 : 5); }
    else if (k === 'i' || k === 'I') { e.preventDefault(); markIn(); }
    else if (k === 'o' || k === 'O') { e.preventDefault(); markOut(); }
    else if (k === 'Escape') { cancelMarks(); }
    else if (k === '+' || k === '=') { e.preventDefault(); App.userZoom(WP.zoomAt(App.zoom, 1.25)); }
    else if (k === '-' || k === '_') { e.preventDefault(); App.userZoom(WP.zoomAt(App.zoom, 1 / 1.25)); }
    else if (k === '0') { e.preventDefault(); App.userZoom(WP.FIT); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); markPeriod(); }
    else if (k === 'g' || k === 'G') { e.preventDefault(); markGoal('for'); } // either case, so Caps Lock can't flip it
    else if (k === 'h' || k === 'H') { e.preventDefault(); markGoal('against'); }
    else if (k === 'x' || k === 'X') { e.preventDefault(); openPenalty(); }
    else if (k === 't' || k === 'T') { e.preventDefault(); openQuickTag(); }
    else if (/^[1-9]$/.test(k)) {
      const cat = WP.categoryForKey(S.settings.categories, k);
      if (cat) { e.preventDefault(); onCategory(cat); }
    }
  });

  // keep other open tabs in sync (each tab saves to the same database)
  if (tabs) tabs.onmessage = async () => {
    if (DB.pending() || App.E) return; // this tab has its own unsaved edits or an open editor
    replaceState((await DB.load()).state);
    if (App.G) { App.G = S.games.find((g) => g.id === App.G.id) || App.G; App.TL = WP.gameTimeline(App.G); }
    route();
  };
  // write right away when the app is hidden or closed
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') DB.flush(); });
  window.addEventListener('pagehide', () => DB.flush());
  // warn before closing the tab in the middle of something
  window.addEventListener('beforeunload', (e) => {
    const busy = (App.E && (edBusy() || edRecording())) || DB.pending() || Team.busy || LIB.busy;
    if (busy) { e.preventDefault(); e.returnValue = ''; }
  });
  if (loaded.migrated) toast('Your games and clips were moved to the browser\u2019s database \u2014 no more storage limit.', { ms: 6000 });

  $('brand-version').textContent = 'v' + WP.APP_VERSION;

  // ---- new version available? (GitHub Pages caches files for about 10 minutes, and phones can't press Ctrl+F5) ----
  let lastUpdateCheck = 0;
  async function checkForUpdate() {
    if (location.protocol === 'file:' || Date.now() - lastUpdateCheck < 10 * 60000) return;
    lastUpdateCheck = Date.now();
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = String((await r.json()).version || '');
      if (v && WP.compareVersions(v, WP.APP_VERSION) > 0) {
        $('update-text').textContent = 'A new version of Watch Party is ready (v' + v + ').' + (App.E && edBusy() ? ' Finish your export first.' : '');
        $('update-banner').classList.remove('hidden');
        $('update-go').onclick = async () => { await DB.flush(); location.replace(location.pathname + '?v=' + encodeURIComponent(v) + location.hash); };
      }
    } catch (e) { /* offline: try later */ }
  }
  $('update-later').addEventListener('click', () => $('update-banner').classList.add('hidden'));
  window.addEventListener('focus', checkForUpdate);
  setInterval(checkForUpdate, 30 * 60000);
  setTimeout(checkForUpdate, 4000);
  renderSyncBadge();
  if (S.sync && WPDrive.hasToken()) setTimeout(() => syncNow(false), 300);
  if (WPDrive.hasToken()) setTimeout(() => libSyncAll(false), 900);
  window.addEventListener('hashchange', route);
  window.__bwp = { get state() { return S; }, saveAll: () => DB.writeAll(), flush: () => DB.flush(), get lastSaveCount() { return App.lastSaveCount; }, get player() { return App.player; }, get editor() { return App.E; }, get team() { return Team; }, get lib() { return LIB; }, get review() { return R; }, lastExport: null }; // for testing
  route();
}).catch((e) => setTimeout(() => { throw e; }));
