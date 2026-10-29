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

  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const UP = { all: false };

  function summaryPill(g) {
    const sum = WP.gameSummary(g, S.settings.roster, officialResult(g));
    if (sum.mismatch) return el('span', { class: 'pill work' }, 'Goals don’t match the final score');
    if (sum.marked) return el('span', { class: 'pill good' }, sum.goals.length + (sum.goals.length === 1 ? ' goal' : ' goals') + ' marked');
    if (sum.score) return el('span', { class: 'pill plain' }, 'Score only');
    return el('span', { class: 'pill plain' }, 'No score yet');
  }

  const linkBtn = (href, text) => href ? el('a', { class: 'btn small', href, target: '_blank', rel: 'noopener noreferrer', style: 'text-decoration:none' }, text) : '';

  /**
   * The season as one list: every league schedule game (with your game, when you've added it) and your other
   * games (tournaments, exhibitions, games not on the schedule) by date.
   */
  function seasonRows() {
    const sched = App.League.schedule() || [];
    const mine = new Map();
    for (const g of S.games) if (g.league && g.league.id) mine.set(g.league.id, g);
    const used = new Set();
    const rows = sched.map((x) => {
      const g = mine.get(x.id) || null;
      if (g) used.add(g.id);
      return { s: x, g, date: x.date, time: x.time };
    });
    for (const g of S.games) if (!used.has(g.id)) rows.push({ s: null, g, date: g.date || '', time: g.time || '' });
    return rows;
  }

  function rowText(r) {
    const g = r.g, x = r.s;
    return [g && WP.gameTitle(g), g && g.opponent, g && g.rink, x && x.opponent, x && x.rink, r.date, g && g.result, x && x.result].filter(Boolean).join(' ').toLowerCase();
  }

  function gameRow(r) {
    const g = r.g, x = r.s;
    const opp = g && g.opponent ? g.opponent : x ? x.opponent : '';
    const ha = (g && g.homeAway) || (x && x.homeAway) || '';
    const rink = (g && g.rink) || (x && x.rink) || '';
    const type = (g && g.gameType) || (x && x.gameType) || '';
    const logoPath = x ? x.opponentLogo : g && g.league ? g.league.opponentLogo : '';
    const sum = g ? WP.gameSummary(g, S.settings.roster, officialResult(g)) : null;
    const res = (sum && WP.summaryResult(sum)) || (g && g.result) || (x && x.result) || '';
    const outcome = (sum && sum.outcome) || res.charAt(0);
    const live = (x && x.liveBarn) || (g && g.league && g.league.liveBarn) || '';
    const gs = (x && x.gamesheet) || (g && g.league && g.league.gamesheet) || '';
    const played = !!g || !x || x.final || x.date <= todayIso();
    const exported = g ? g.clips.filter((c) => c.exported).length : 0;
    const title = (r.date ? WP.formatDate(r.date) : 'Undated') + ' ' + (opp ? (ha === 'away' ? 'at ' : 'vs ') + opp : '');
    return el('tr', { class: (g ? 'gamerow click' : 'schedrow') + (played ? '' : ' upcoming'), onclick: g ? (e) => { if (!e.target.closest('a,button')) location.hash = 'tag/' + g.id; } : null },
      el('td', { style: 'white-space:nowrap' }, r.date ? WP.formatDate(r.date) : 'Undated', el('div', { class: 'small muted' }, WP.formatClock(r.time))),
      el('td', {}, el('div', { class: 'row', style: 'gap:10px;flex-wrap:nowrap' }, logoPath ? App.League.logo(logoPath, 32) : el('span', { class: 'lglogo none', style: 'width:32px;height:32px', 'aria-hidden': 'true' }),
        el('div', { class: 'stack', style: 'gap:0;min-width:0' },
          el('strong', {}, opp ? (ha === 'away' ? '@ ' : 'vs ') + opp : (g ? WP.gameTitle(g) : '')),
          el('span', { class: 'small muted' }, [rink, ha === 'home' ? 'Home' : ha === 'away' ? 'Away' : '', type && type !== 'league' ? WP.label(WP.GAME_TYPES, type) : '', !x && g && !type ? 'Not on the league schedule' : ''].filter(Boolean).join(' · '))))),
      el('td', {}, res ? el('span', { class: 'res ' + outcome }, res) : el('span', { class: 'muted' }, played ? '—' : 'Upcoming')),
      el('td', {}, g ? el('a', { href: '#sum/' + g.id, style: 'text-decoration:none' }, summaryPill(g)) : played ? el('span', { class: 'small muted' }, 'No video yet') : ''),
      el('td', { style: 'white-space:nowrap' }, g ? g.clips.length + (g.clips.length === 1 ? ' clip' : ' clips') + (exported ? ' · ' + exported + ' exported' : '') : ''),
      el('td', {}, el('div', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, linkBtn(live, 'LiveBarn ↗'), played ? linkBtn(gs, 'GameSheet ↗') : '')),
      el('td', { style: 'text-align:right' },
        g ? el('a', { class: 'btn small primary', href: '#tag/' + g.id, style: 'text-decoration:none', 'aria-label': 'Open ' + WP.gameTitle(g) }, 'Open')
          : played ? el('a', { class: 'btn small outline', href: '#new/' + encodeURIComponent(x.id), style: 'text-decoration:none', 'aria-label': 'Add video for ' + title }, 'Add video') : ''));
  }

  function table(rows, id, caption) {
    return el('div', { class: 'tablewrap' }, el('table', { class: 'dtable', id, style: 'min-width:900px' },
      el('caption', { class: 'sr' }, caption),
      el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Game'), el('th', {}, 'Result'), el('th', {}, 'Summary'), el('th', {}, 'Clips'), el('th', {}, 'Links'), el('th', {}, el('span', { class: 'sr' }, 'Open or add video')))),
      el('tbody', {}, ...rows.map(gameRow))));
  }

  function renderGames() {
    App.League.load();
    renderWho();
    App.renderGameLists();
    const q = String($('g-find').value || '').trim().toLowerCase();
    const t = todayIso();
    const all = seasonRows().filter((r) => !q || rowText(r).includes(q));
    const isUp = (r) => !r.g && r.s && !r.s.final && r.s.date > t;
    const key = (r) => String(r.date) + ' ' + String(r.time);
    const upcoming = all.filter(isUp).sort((a, b) => key(a).localeCompare(key(b)));
    const played = all.filter((r) => !isUp(r)).sort((a, b) => key(b).localeCompare(key(a)) || ((b.g && b.g.createdAt) || 0) - ((a.g && a.g.createdAt) || 0));
    const lg = S.settings.league;
    const parts = [];
    if (upcoming.length) {
      const shown = UP.all ? upcoming : upcoming.slice(0, 2);
      parts.push(el('section', { class: 'stack', style: 'gap:8px', 'aria-labelledby': 'up-h' },
        el('div', { class: 'row spread', style: 'align-items:baseline' }, el('h2', { id: 'up-h' }, 'Coming up'),
          upcoming.length > 2 ? el('button', { type: 'button', class: 'btn small', id: 'g-up-all', onclick: () => { UP.all = !UP.all; renderGames(); } }, UP.all ? 'Show the next 2' : 'Show all ' + upcoming.length + ' upcoming') : ''),
        table(shown, 'g-upcoming', 'Upcoming games')));
    }
    parts.push(el('section', { class: 'stack', style: 'gap:8px', 'aria-labelledby': 'played-h' },
      el('div', { class: 'row spread', style: 'align-items:baseline' }, el('h2', { id: 'played-h' }, 'Played'),
        el('span', { class: 'small muted' }, lg && lg.teamId ? 'League schedule and your own games. Videos stay on this computer.' : 'Your games. Pick your league team on the Team page to list the whole schedule here.')),
      played.length ? table(played, 'g-played', 'Played games')
        : el('div', { class: 'card empty' }, q ? 'No games match “' + q + '”.' : 'No games yet. Press + New game and add your first LiveBarn download.')));
    $('games').replaceChildren(...parts);
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
