/* Bulldogs Watch Party — Games screen: add a game from LiveBarn files, list, backup and import. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, askYes, download, el, idb, renderWho, replaceState, save, session, slug, toast
  } = App;

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
    if (!autoMatch()) {
      const guess = WP.guessGameDetails(session.draftParts.map((p) => ({ name: p.file.name })));
      if (!$('g-date').value && guess.date) $('g-date').value = guess.date;
      if (!$('g-rink').value && guess.rink) $('g-rink').value = guess.rink;
    }
  }

  // ---- league schedule on the New game form ----
  const FIELDS = { date: 'g-date', time: 'g-time', opponent: 'g-opp', rink: 'g-rink', result: 'g-result', gameType: 'g-type', homeAway: 'g-ha' };

  function pickLeague(s, auto) {
    session.draftLeague = s;
    session.draftLeagueAuto = !!auto;
    const f = WP.scheduleFields(s);
    for (const [k, id] of Object.entries(FIELDS)) $(id).value = f[k] || '';
    renderDraftLeague();
  }

  /** When files are added and no game is picked yet, pick the schedule game they belong to. */
  function autoMatch() {
    if (session.draftLeague || session.leagueDismissed || !session.draftParts.length) return false;
    const sched = App.League.schedule();
    if (!sched) return false;
    const m = WP.matchScheduleGame(sched, session.draftParts.map((p) => ({ name: p.file.name })));
    if (!m) return false;
    pickLeague(m, true);
    return true;
  }

  function renderDraftLeague() {
    App.renderSchedulePicker($('g-league'), {
      key: 'gs', selectedId: session.draftLeague && session.draftLeague.id, selected: session.draftLeague, auto: session.draftLeagueAuto,
      onPick: (s) => { session.leagueDismissed = false; pickLeague(s, false); },
      onNone: () => { session.draftLeague = null; session.leagueDismissed = true; renderDraftLeague(); }
    });
  }

  App.League.onChange(() => {
    if (!$('view-games').classList.contains('hidden')) { renderGames(); return; }
    if ($('view-new').classList.contains('hidden')) return;
    applyNewSched();
    if (!autoMatch()) renderDraftLeague();
    App.renderGameLists();
  });

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
    session.draftLineup = null;
    session.draftLeague = null;
    session.draftLeagueAuto = false;
    session.leagueDismissed = false;
    for (const id of Object.values(FIELDS)) $(id).value = '';
    renderParts();
    renderDraftLineup();
    renderDraftLeague();
  }

  // the new game's lineup: starts with everyone on the roster playing their usual position
  function renderDraftLineup() {
    App.renderLineup($('g-lineup'), { lineup: session.draftLineup, gameId: null, idPrefix: 'gl', title: 'Lineup',
      onChange: (L) => { session.draftLineup = L; renderDraftLineup(); } });
  }

  async function startGame() {
    const parts = orderedDraft();
    let game;
    try {
      game = WP.newGame({
        parts: parts.map((p) => ({ name: p.file.name, size: p.file.size, duration: p.duration, lastModified: p.file.lastModified })),
        date: $('g-date').value, time: $('g-time').value, league: session.draftLeague, opponent: $('g-opp').value, rink: $('g-rink').value, result: $('g-result').value, gameType: $('g-type').value, homeAway: $('g-ha').value
      });
    } catch (e) { toast(e.message, { err: true }); return; }
    if (session.draftLineup) game.lineup = WP.normalizeLineup(session.draftLineup);
    S.games.push(game);
    save();
    let listsChanged = false;
    for (const [key, val] of [['opponents', game.opponent], ['rinks', game.rink]]) {
      if (val && !S.settings[key].some((x) => x.toLowerCase() === val.toLowerCase())) { S.settings[key] = WP.addListItem(S.settings[key], val); listsChanged = true; }
    }
    if (listsChanged) App.teamChanged();
    session.files.set(game.id, parts.map((p) => p.file));
    if (parts.every((p) => p.handle)) await idb.put(game.id, parts.map((p) => p.handle));
    clearDraft();
    location.hash = 'tag/' + game.id;
  }

  // ---- the Games home: waiting league games, then your games ----
  function officialResult(g) {
    if (!g.league || !g.league.id) return '';
    const sched = App.League.schedule();
    const s = sched && sched.find((x) => x.id === g.league.id);
    return s ? s.result : '';
  }
  App.officialResult = officialResult;

  /** League games already played that have no game here yet (newest first, a few). */
  function waitingGames() {
    const sched = App.League.schedule();
    if (!sched) return [];
    const today = new Date().toISOString().slice(0, 10);
    const have = new Set(S.games.map((g) => g.league && g.league.id).filter(Boolean));
    return sched.filter((x) => (x.final || x.date < today) && !have.has(x.id)).slice(-4).reverse();
  }

  function summaryPill(g) {
    const sum = WP.gameSummary(g, S.settings.roster, officialResult(g));
    if (sum.mismatch) return el('span', { class: 'pill work' }, 'Goals don’t match the final score');
    if (sum.marked) return el('span', { class: 'pill good' }, sum.goals.length + (sum.goals.length === 1 ? ' goal' : ' goals') + ' marked');
    if (sum.score) return el('span', { class: 'pill plain' }, 'Score only');
    return el('span', { class: 'pill plain' }, 'No score yet');
  }

  function renderGames() {
    App.League.load();
    renderWho();
    App.renderGameLists();
    // league games waiting for their video
    const wait = waitingGames();
    $('g-waiting-card').hidden = !wait.length;
    $('g-waiting').replaceChildren(...wait.map((x) => el('div', { class: 'waitcard' },
      App.League.logo(x.opponentLogo, 32),
      el('div', { class: 'grow stack', style: 'gap:0' }, el('strong', {}, App.League.whenText(x) + ' · ' + App.League.vsText(x)),
        el('span', { class: 'small muted' }, [x.result ? 'Final ' + x.result : 'Played', x.gamesheet ? 'GameSheet available' : ''].filter(Boolean).join(' · '))),
      el('a', { class: 'btn small outline', href: '#new/' + encodeURIComponent(x.id), style: 'text-decoration:none', 'aria-label': 'Add video for ' + App.League.whenText(x) + ' ' + App.League.vsText(x) }, 'Add video'))));
    // your games
    const q = String($('g-find').value || '').trim().toLowerCase();
    const games = S.games.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt)
      .filter((g) => !q || [WP.gameTitle(g), g.opponent, g.rink, g.date, g.result].join(' ').toLowerCase().includes(q));
    if (!games.length) {
      $('games').replaceChildren(el('div', { class: 'card empty' }, S.games.length ? 'No games match “' + q + '”.' : 'No games yet. Press + New game and add your first LiveBarn download.'));
      return;
    }
    $('games').replaceChildren(el('div', { class: 'tablewrap' }, el('table', { class: 'dtable' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Game'), el('th', {}, 'Result'), el('th', {}, 'Clips'), el('th', {}, 'Summary'), el('th', {}, el('span', { class: 'sr' }, 'Open')))),
      el('tbody', {}, ...games.map((g) => {
        const sum = WP.gameSummary(g, S.settings.roster, officialResult(g));
        const res = WP.summaryResult(sum) || g.result || '';
        const exported = g.clips.filter((c) => c.exported).length;
        return el('tr', { class: 'gamerow click', onclick: (e) => { if (!e.target.closest('a,button')) location.hash = 'tag/' + g.id; } },
          el('td', { style: 'white-space:nowrap' }, g.date ? WP.formatDate(g.date) : 'Undated', el('div', { class: 'small muted' }, WP.formatClock(g.time))),
          el('td', {}, el('div', { class: 'row', style: 'gap:10px;flex-wrap:nowrap' }, g.league ? App.League.logo(g.league.opponentLogo, 32) : '',
            el('div', { class: 'stack', style: 'gap:0' }, el('strong', {}, g.opponent ? (g.homeAway === 'away' ? '@ ' : 'vs ') + g.opponent : WP.gameTitle(g)),
              el('span', { class: 'small muted' }, [g.rink, g.parts.length + (g.parts.length === 1 ? ' part' : ' parts') + ' · ' + WP.formatTime(WP.gameTimeline(g).total), 'video on this computer'].filter(Boolean).join(' · '))))),
          el('td', {}, res ? el('span', { class: 'res ' + (sum.outcome || '') }, res) : el('span', { class: 'muted' }, '—')),
          el('td', { style: 'white-space:nowrap' }, g.clips.length + (g.clips.length === 1 ? ' clip' : ' clips') + (exported ? ' · ' + exported + ' exported' : '')),
          el('td', {}, el('a', { href: '#sum/' + g.id, style: 'text-decoration:none' }, summaryPill(g))),
          el('td', { style: 'text-align:right' }, el('a', { class: 'btn small primary', href: '#tag/' + g.id, style: 'text-decoration:none', 'aria-label': 'Open ' + WP.gameTitle(g) }, 'Open')));
      })))));
  }

  async function deleteGame(g) {
    if (!(await askYes('Delete ' + WP.gameTitle(g) + '?', 'Its ' + g.clips.length + ' clips, marks and summary are removed from this computer. The video files and anything already in Drive are not touched.', 'Delete game'))) return;
    S.games = S.games.filter((x) => x.id !== g.id);
    save(); idb.del(g.id); session.files.delete(g.id);
    if (App.player && App.player.gameId === g.id) { App.player.destroy(); App.player = null; }
    if (App.G && App.G.id === g.id) App.G = null;
    toast(WP.gameTitle(g) + ' deleted');
    location.hash = 'games';
  }

  // ---- New game screen (#new, or #new/<league game id> from "Add video") ----
  function renderNew(schedId) {
    renderDraftLineup();
    App.League.load();
    renderWho();
    App.renderGameLists();
    if (schedId) session.newSched = schedId;
    applyNewSched();
    renderDraftLeague();
  }
  function applyNewSched() {
    if (!session.newSched) return;
    const sched = App.League.schedule();
    if (!sched) return;
    const s = sched.find((x) => x.id === session.newSched);
    session.newSched = null;
    if (s) { session.leagueDismissed = false; pickLeague(s, false); }
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
      replaceState(state); save(); renderGames();
      toast('Imported ' + count + (count === 1 ? ' game' : ' games'));
    } catch (err) { toast(err.message, { err: true }); }
  });
  $('g-find').addEventListener('input', () => renderGames());
  Object.assign(App, {
    renderDraftLineup, renderNew, deleteGame,
    renderGames
  });
}).catch((e) => setTimeout(() => { throw e; }));
