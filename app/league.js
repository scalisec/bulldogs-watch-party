/* Watch Party — the league schedule. Reads the teams and games that Alliance Tracker publishes
   (config.js › leagueDataUrl), keeps a copy in this browser for offline use, and draws the schedule picker
   used on the New game form and the game screen, plus the League team setting on the Team page. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, el, toast
  } = App;

  const BASE = String((window.WP_CONFIG && window.WP_CONFIG.leagueDataUrl) || 'https://scalisec.github.io/alliance-tracker/').replace(/\/?$/, '/');
  const GAMES_STALE = 30 * 60 * 1000;      // re-read the schedule after 30 minutes
  const TEAMS_STALE = 24 * 60 * 60 * 1000; // the team list changes rarely
  const K_TEAMS = 'bwp-league-teams-2'; // v1.6.1: new name, so copies saved before club teams existed are dropped
  const K_GAMES = App.teamKey('bwp-league-games');

  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked: keep it in memory */ } };

  const L = { teams: null, teamsAt: 0, games: null, gamesAt: 0, gamesDiv: null, loading: null, error: '' };
  const ct = lsGet(K_TEAMS);
  if (ct && Array.isArray(ct.data)) { L.teams = WP.leagueTeams(ct.data); L.teamsAt = ct.at || 0; }
  const cg = lsGet(K_GAMES);
  if (cg && Array.isArray(cg.data)) { L.games = cg.data; L.gamesAt = cg.at || 0; L.gamesDiv = cg.div; }

  const listeners = new Set();
  const onChange = (fn) => listeners.add(fn);
  const notify = () => { for (const fn of listeners) { try { fn(); } catch (e) { setTimeout(() => { throw e; }); } } };

  const logoUrl = (p) => { const v = WP.leagueLogo(p); return v ? BASE + v : ''; };
  const team = () => S.settings.league || {};

  async function getJson(path) {
    const r = await fetch(BASE + path, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /** Fetch what's missing or stale. force = the Refresh button. Never throws; L.error says what went wrong. */
  function load(force) {
    if (L.loading) return L.loading;
    const lg = team();
    const now = Date.now();
    const needTeams = force || !L.teams || now - L.teamsAt > TEAMS_STALE;
    const needGames = !!lg.teamId && lg.divisionId != null && (force || L.gamesDiv !== lg.divisionId || now - L.gamesAt > GAMES_STALE);
    if (!needTeams && !needGames) return Promise.resolve();
    L.loading = (async () => {
      try {
        const div = WP.divisionKey(lg.divisionId);
        const [alliance, clubs, games] = await Promise.all([
          needTeams ? getJson('data/teams.json') : null,
          needTeams ? getJson('data/clubs.json').catch(() => []) : null, // club teams outside the Alliance (e.g. OWHA)
          needGames && div != null ? getJson('data/games/' + encodeURIComponent(div) + '.json') : null]);
        if (alliance) {
          const teams = alliance.concat(Array.isArray(clubs) ? clubs : []);
          L.teams = WP.leagueTeams(teams); L.teamsAt = Date.now(); lsSet(K_TEAMS, { at: L.teamsAt, data: teams });
        }
        if (games) {
          if (!Array.isArray(games)) throw new Error('unexpected schedule file');
          L.games = games; L.gamesAt = Date.now(); L.gamesDiv = div;
          lsSet(K_GAMES, { at: L.gamesAt, div: L.gamesDiv, data: games });
        }
        L.error = '';
      } catch (e) {
        L.error = 'Couldn’t reach the league schedule' + (navigator.onLine === false ? ' (offline)' : '') + '.';
      } finally {
        L.loading = null;
        notify();
      }
    })();
    notify();
    return L.loading;
  }

  /** The league team's schedule, oldest first, or null when it isn't loaded (or no league team is set). */
  function schedule() {
    const lg = team();
    if (!lg.teamId || !L.games || L.gamesDiv !== lg.divisionId) return null;
    return WP.teamSchedule(L.games, lg.name, L.teams || []);
  }

  /** Opponents (the other teams in the division) and rinks (from the schedule), for the type-ahead lists. */
  function lists() {
    const lg = team();
    const opponents = (L.teams || []).filter((t) => t.divisionId === lg.divisionId && t.name !== lg.name).map((t) => t.name);
    const rinks = [...new Set((schedule() || []).map((g) => g.rink).filter(Boolean))];
    return { opponents, rinks };
  }

  function ago(at) {
    const m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return Math.round(h / 24) + ' days ago';
  }

  function logo(path, size) {
    const src = logoUrl(path);
    const sz = size || 28;
    if (!src) return el('span', { class: 'lglogo none', style: 'width:' + sz + 'px;height:' + sz + 'px', 'aria-hidden': 'true' });
    const img = el('img', { class: 'lglogo', src, alt: '', width: String(sz), height: String(sz), loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: 'lglogo none', style: 'width:' + sz + 'px;height:' + sz + 'px', 'aria-hidden': 'true' })));
    return img;
  }

  const dayName = (iso) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? '' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]; };
  const whenText = (s) => [dayName(s.date) + ' ' + WP.formatDate(s.date), WP.formatClock(s.time)].filter(Boolean).join(' · ');
  const vsText = (s) => (s.homeAway === 'away' ? 'at ' : 'vs ') + s.opponent;
  const metaText = (s) => [s.rink, s.homeAway === 'home' ? 'Home' : s.homeAway === 'away' ? 'Away' : '', s.result || (s.final ? 'Final' : 'Upcoming'), s.code].filter(Boolean).join(' · ');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function statusLine(sched) {
    const lg = team();
    const bits = [lg.name + (lg.division ? ' · ' + lg.division : '')];
    if (sched) bits.push(sched.length + (sched.length === 1 ? ' game' : ' games'));
    if (L.loading) bits.push('loading…');
    else if (L.gamesAt && sched) bits.push('updated ' + ago(L.gamesAt));
    return bits.join(' · ');
  }

  // per-picker view state (which list is open, upcoming shown)
  const views = new Map();

  /**
   * renderSchedulePicker(box, { key, selectedId, auto, onPick(s), onNone(), noneLabel })
   * Shows the chosen game (with Change / Not a league game) or the list of the team's games, newest first.
   */
  function renderSchedulePicker(box, o) {
    const lg = team();
    const v = views.get(o.key) || { open: false, upcoming: false };
    views.set(o.key, v);
    if (!lg.teamId) {
      if (!L.teams && !L.loading && !L.error) load();
      box.replaceChildren(suggestion(o.key + '-suggest') || el('span', { class: 'small muted' }, 'Pick your league team on the ', el('a', { href: '#team/info' }, 'Team page'), ' to fill in games from the league schedule.'));
      return;
    }
    const sched = schedule();
    const rerender = () => renderSchedulePicker(box, o);
    const head = el('div', { class: 'row spread' },
      el('div', { class: 'stack', style: 'gap:0' }, el('h3', {}, 'League schedule'), el('span', { class: 'small muted', id: o.key + '-status' }, statusLine(sched))),
      el('button', { type: 'button', class: 'btn small', disabled: L.loading ? '' : null, onclick: () => load(true) }, L.loading ? 'Loading…' : 'Refresh'));
    if (!sched) {
      box.replaceChildren(head, el('span', { class: 'small ' + (L.error ? 'warn' : 'muted') }, L.loading ? 'Loading the schedule…' : (L.error || 'The schedule isn’t loaded yet.') + ' You can still fill in the details below.'));
      if (!L.loading && !L.error) load();
      return;
    }
    const chosen = o.selectedId ? sched.find((s) => s.id === String(o.selectedId)) || o.selected : null;
    const parts = [head];
    if (L.error) parts.push(el('span', { class: 'small warn' }, L.error + ' Showing the copy saved ' + ago(L.gamesAt) + '.'));
    if (chosen && !v.open) {
      parts.push(el('div', { class: 'lgpick chosen', id: o.key + '-chosen' },
        logo(chosen.opponentLogo, 40),
        el('div', { class: 'grow stack', style: 'gap:0' },
          el('strong', {}, vsText(chosen)),
          el('span', { class: 'small' }, whenText(chosen)),
          el('span', { class: 'small muted' }, metaText(chosen)),
          o.auto ? el('span', { class: 'small note' }, 'Matched to your LiveBarn files — check it’s the right game.') : ''),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small', onclick: () => { v.open = true; rerender(); } }, 'Change'),
          el('button', { type: 'button', class: 'btn small', onclick: () => { v.open = false; o.onNone(); } }, o.noneLabel || 'Not a league game'))));
      box.replaceChildren(...parts);
      return;
    }
    const t = today();
    const past = sched.filter((s) => s.date <= t).reverse();
    const upcoming = sched.filter((s) => s.date > t);
    const row = (s) => el('li', {},
      el('button', { type: 'button', class: 'lgpick' + (chosen && chosen.id === s.id ? ' sel' : ''), 'aria-label': whenText(s) + ' ' + vsText(s), onclick: () => { v.open = false; o.onPick(s); } },
        logo(s.opponentLogo, 32),
        el('span', { class: 'grow stack', style: 'gap:0' }, el('strong', {}, vsText(s)), el('span', { class: 'small muted' }, whenText(s) + ' · ' + metaText(s))),
        s.result ? el('span', { class: 'pill ' + (s.result[0] === 'W' ? 'do' : s.result[0] === 'L' ? 'bad' : '') }, s.result) : ''));
    parts.push(el('ul', { class: 'lglist', id: o.key + '-list' }, ...(past.length ? past.map(row) : [el('li', { class: 'small muted', style: 'padding:10px 12px' }, 'No games played yet this season.')]), ...(v.upcoming ? upcoming.map(row) : [])));
    parts.push(el('div', { class: 'row' },
      upcoming.length ? el('button', { type: 'button', class: 'btn small outline', onclick: () => { v.upcoming = !v.upcoming; rerender(); } }, v.upcoming ? 'Hide upcoming games' : 'Show ' + upcoming.length + ' upcoming games') : '',
      chosen ? el('button', { type: 'button', class: 'btn small', onclick: () => { v.open = false; rerender(); } }, 'Cancel') : '',
      el('span', { class: 'small muted grow' }, 'Pick a game to fill in the opponent, rink, time and result. You can still change any of them.')));
    box.replaceChildren(...parts);
  }

  /** Use this league team for the current team (shared with the coaches). */
  function setLeagueTeam(t) {
    S.settings.league = WP.normalizeLeague(t ? t : { teamId: '' });
    App.teamChanged();
    App.renderSettings();
    load(true);
    toast(t ? 'League team: ' + t.name + ' (' + t.division + ')' : 'Not using the league schedule');
    notify();
  }

  /** "Is this Burlington Barracudas · U13 B (OWHA)? [Use its schedule]" when no league team is set and the name fits one. */
  function suggestion(id) {
    if (team().teamId || !L.teams) return null;
    const g = WP.guessLeagueTeam(L.teams, S.settings.team.name);
    if (!g) return null;
    return el('div', { class: 'row lgsuggest', id: id || null },
      logo(g.team.logo, 32),
      el('span', { class: 'grow' }, 'Is this ', el('strong', {}, g.team.name), ' · ' + g.team.division + '?'),
      el('button', { type: 'button', class: 'btn small primary', onclick: () => setLeagueTeam(g.team) }, 'Use its schedule'));
  }

  // ---------------- Team › Team and league ----------------
  let pickerFilter = '';
  function renderLeagueSetting() {
    const box = $('league-setting');
    if (!box) return;
    const lg = team();
    const teams = L.teams;
    const sel = el('select', { id: 'lg-team', 'aria-label': 'League team', onchange: (e) => {
      const t = (L.teams || []).find((x) => x.teamId === e.target.value);
      pickerFilter = '';
      setLeagueTeam(t);
      renderLeagueSetting();
    } }, el('option', { value: '' }, 'Don’t use the league schedule'));
    if (teams) {
      // club teams (OWHA etc.) first, then the Alliance by division; the Find box narrows the list
      const q = pickerFilter.toLowerCase().split(/\s+/).filter(Boolean);
      const fits = (t) => !q.length || q.every((w) => (t.name + ' ' + t.division + ' ' + (t.association || '')).toLowerCase().includes(w));
      const club = (t) => t.league && t.league !== 'Alliance';
      const shown = teams.filter(fits).sort((a, b) => (club(a) === club(b) ? 0 : club(a) ? -1 : 1));
      const byDiv = new Map();
      for (const t of shown) { const k = club(t) ? t.league + ' · ' + t.division.replace(/\s*\(.*\)/, '') : 'Alliance · ' + t.division; if (!byDiv.has(k)) byDiv.set(k, []); byDiv.get(k).push(t); }
      for (const [div, list] of byDiv) sel.append(el('optgroup', { label: div }, ...list.map((t) => el('option', { value: t.teamId }, t.name))));
      if (q.length && !shown.length) sel.append(el('option', { value: '', disabled: '' }, 'No team matches “' + pickerFilter + '”'));
    }
    if (lg.teamId && !(teams || []).some((t) => t.teamId === lg.teamId)) sel.append(el('option', { value: lg.teamId }, lg.name + (lg.division ? ' (' + lg.division + ')' : '')));
    sel.value = lg.teamId || '';
    const sched = schedule();
    const search = el('input', { type: 'search', id: 'lg-search', placeholder: 'e.g. Barracudas or U13', 'aria-label': 'Find a league team', autocomplete: 'off', value: pickerFilter,
      oninput: (e) => { pickerFilter = e.target.value; renderLeagueSetting(); const n = $('lg-search'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } } });
    box.replaceChildren(
      suggestion('lg-suggest-team') || '',
      el('div', { class: 'row', style: 'align-items:flex-end' },
        lg.teamId ? logo(lg.logo, 48) : '',
        el('label', { class: 'field', style: 'flex:1 1 200px' }, 'Find a team', search),
        el('label', { class: 'field', style: 'flex:2 1 260px' }, 'League team', sel)),
      el('span', { class: 'small muted' }, lg.teamId
        ? (sched ? sched.length + ' games on the schedule · ' : '') + 'New games fill in from this team’s schedule (' + (lg.division && /OWHA/.test(lg.division) ? 'its club site' : 'the Alliance') + '): opponent, rink, time, home or away, and the final score. Shared with every coach.'
        : 'Pick your team to fill in games from its schedule instead of typing them. OWHA club teams are listed first, then Alliance teams by division.'),
      !teams ? el('span', { class: 'small ' + (L.error ? 'warn' : 'muted') }, L.loading ? 'Loading the league’s teams…' : L.error || '') : '');
    if (!teams && !L.loading && !L.error) load();
  }

  onChange(() => { if (!$('view-team').classList.contains('hidden')) renderLeagueSetting(); });

  App.League = { load, schedule, lists, logoUrl, logo, onChange, whenText, vsText, metaText, setLeagueTeam, state: L };
  Object.assign(App, { renderSchedulePicker, renderLeagueSetting });
}).catch((e) => setTimeout(() => { throw e; }));
