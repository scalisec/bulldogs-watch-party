/* Watch Party — Game summaries (v2.0): the Summaries tab, each game's Summary tab, and Season stats.
   Everything is worked out from the coach's own marks (periods, goals, penalties) and clips. */
App.ready.then(() => {
  'use strict';
  const { $, S, el, save, toast } = App;

  const roster = () => S.settings.roster || [];
  const nameOf = (n) => { const p = roster().find((r) => r.number === n); return p && p.name ? p.name : ''; };
  const pl = (n) => '#' + n + (nameOf(n) ? ' ' + nameOf(n) : '');
  const official = (g) => (App.officialResult ? App.officialResult(g) : '');
  const sumOf = (g) => WP.gameSummary(g, roster(), official(g));
  const vs = (g) => g.opponent ? (g.homeAway === 'away' ? '@ ' : 'vs ') + g.opponent : 'Opponent not set';
  const card = (attrs, ...kids) => el('section', Object.assign({ class: 'card stack' }, attrs), ...kids);
  const resEl = (sum, fallback) => {
    const r = WP.summaryResult(sum) || fallback || '';
    return r ? el('span', { class: 'res ' + (sum.outcome || '') }, r) : el('span', { class: 'res muted' }, '—');
  };

  function goalLine(g) {
    if (g.side === 'for') return g.scorer ? '#' + g.scorer + (g.assists && g.assists.length ? ' (' + g.assists.map((x) => '#' + x).join(', ') + ')' : '') : 'Goal (scorer not set)';
    return 'Them' + (g.oppScorer ? ' #' + g.oppScorer : '');
  }

  // =====================================================================
  // SUMMARIES TAB
  // =====================================================================
  function nextGame() {
    const sched = App.League.schedule();
    if (!sched) return null;
    const today = new Date().toISOString().slice(0, 10);
    return sched.find((x) => !x.final && x.date >= today) || null;
  }

  function renderSummaries() {
    App.League.load();
    const games = S.games.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt);
    const leagueOnly = games.some((g) => g.gameType === 'league');
    const st = WP.seasonStats(games, roster(), leagueOnly ? 'league' : '', official);
    const r = st.record;
    const nx = nextGame();
    const tiles = el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Record' + (leagueOnly ? ' (league)' : '')), el('strong', {}, r.w + '–' + r.l + '–' + r.t)),
      el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Goals for / against'), el('strong', {}, r.gf + ' / ' + r.ga)),
      el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Our penalty minutes'), el('strong', {}, String(r.pim))),
      el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Next game'), el('strong', { style: 'font-size:17px' }, nx ? App.League.whenText(nx) + ' ' + App.League.vsText(nx) : '—')));
    const cards = games.map((g) => {
      const sum = sumOf(g);
      const ours = sum.goals.filter((x) => x.side === 'for');
      const pens = sum.penalties.map((p) => WP.penaltyLabel(p).replace(/ · (\d+) min$/, ''));
      const clipsTxt = g.noVideo ? 'No video' : g.clips.length + (g.clips.length === 1 ? ' clip' : ' clips');
      const status = sum.sheetCheck && sum.sheetCheck.differs ? el('span', { class: 'pill work' }, sum.sheetCheck.differs + ' differ from the game sheet')
        : sum.mismatch ? el('span', { class: 'pill work' }, 'Goals don’t match the final score')
        : sum.source === 'sheet' ? el('span', { class: 'pill do' }, g.noVideo ? 'Game sheet · no video' : 'From the game sheet')
        : sum.marked ? el('span', { class: 'pill good' }, sum.sheet ? 'Your marks + game sheet' : 'From your marks') : sum.score ? el('span', { class: 'pill plain' }, 'Score only') : el('span', { class: 'pill plain' }, 'No score yet');
      return el('a', { class: 'sumcard' + (sum.mismatch ? ' flag' : ''), href: '#sum/' + g.id, 'aria-label': 'Summary: ' + WP.gameTitle(g) },
        el('span', { class: 'when' }, el('span', { class: 'small muted' }, [g.date ? WP.formatDate(g.date) : 'Undated', WP.label(WP.HOME_AWAY, g.homeAway)].filter(Boolean).join(' · ')), el('strong', {}, vs(g))),
        resEl(sum, g.result),
        el('span', { class: 'lines' },
          el('span', {}, ours.length ? 'Goals: ' + ours.map(goalLine).join(' · ') : sum.goals.length ? 'No goals for us' : 'Goals not marked yet'),
          el('span', { class: 'muted' }, [pens.length ? 'Penalties: ' + pens.join(' · ') : 'No penalties marked', clipsTxt].join(' · '))),
        status);
    });
    // league games played with no game here yet (no video): score only
    const have = new Set(S.games.map((g) => g.league && g.league.id).filter(Boolean));
    const sched = App.League.schedule() || [];
    const today = new Date().toISOString().slice(0, 10);
    const bare = sched.filter((x) => x.final && x.date <= today && !have.has(x.id)).reverse();
    const bareCards = bare.map((x) => el('div', { class: 'sumcard' },
      el('span', { class: 'when' }, el('span', { class: 'small muted' }, App.League.whenText(x)), el('strong', {}, App.League.vsText(x))),
      el('span', { class: 'res ' + String(x.result).charAt(0) }, x.result || '—'),
      el('span', { class: 'lines' }, el('span', { class: 'muted' }, 'Not added yet. Add the video, or just the game sheet for a summary.')),
      el('span', { class: 'row noprint', style: 'gap:4px' },
        el('a', { class: 'btn small outline', href: '#new/' + encodeURIComponent(x.id), style: 'text-decoration:none', 'aria-label': 'Add video: ' + App.League.whenText(x) + ' ' + App.League.vsText(x) }, 'Add video'),
        el('button', { type: 'button', class: 'btn small', 'aria-label': 'Add game sheet: ' + App.League.whenText(x) + ' ' + App.League.vsText(x), onclick: () => App.importSheet({ sched: x }) }, 'Game sheet'))));
    $('sums').replaceChildren(el('div', { class: 'stack', style: 'gap:20px' },
      el('div', { class: 'row spread', style: 'align-items:center' }, el('h1', {}, 'Game summaries'),
        el('div', { class: 'row noprint' }, el('a', { class: 'btn', href: '#stats', style: 'text-decoration:none' }, 'Season stats'))),
      tiles,
      cards.length || bareCards.length ? el('div', { class: 'stack', style: 'gap:10px', id: 'sum-cards' }, ...cards, ...bareCards)
        : el('div', { class: 'card empty' }, 'No games yet. Add a game, then mark periods (P), goals (G / H) and penalties (X) while you watch.'),
      el('span', { class: 'small muted' }, 'Summaries come from your own marks. Coaches only: nothing here is shared with families.')));
  }

  // =====================================================================
  // ONE GAME'S SUMMARY
  // =====================================================================
  let notesTimer = 0;
  function saveNotes() {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      if (!App.G) return;
      App.G.summaryNotes = { wentWell: $('gsn-well').value.slice(0, 4000), workOn: $('gsn-work').value.slice(0, 4000) };
      save();
    }, 400);
  }

  function renderGameSummary() {
    const g = App.G;
    if (!g) return;
    // goals and penalties marked after the game sheet was added: fill in what they're missing (never the coach's own details)
    if (g.sheet) {
      const r = WP.fillFromSheet(g, g.sheet);
      if (r.filled) {
        g.marks = r.marks;
        for (const x of WP.gameMarks(g).goals) {
          const c = x.clipId && g.clips.find((k) => k.id === x.clipId);
          if (c && !(c.players || []).length) c.players = WP.goalPlayers(x);
          if (c && (!c.note || /^Goal( for| against)?$/.test(c.note))) c.note = WP.goalLabel(x);
        }
        save();
        toast('Filled in ' + r.filled + ' detail' + (r.filled === 1 ? '' : 's') + ' from the game sheet');
      }
    }
    const sum = sumOf(g);
    const us = WP.shortTeamName(S.settings.team.name) || 'Us';
    const them = WP.shortTeamName(g.opponent) || 'Them';
    const watch = (t) => el('button', { type: 'button', class: 'btn small noprint', 'aria-label': 'Watch at ' + WP.formatTime(t), onclick: () => App.watchAt(g.id, t - 6) }, '▶ ' + WP.formatTime(t));

    // score and goals by period
    const periods = sum.byPeriod;
    const scoreCard = card({ 'aria-label': 'Final score' },
      el('div', { class: 'row', style: 'gap:24px;align-items:center' },
        el('div', { class: 'bigscore' },
          el('div', { class: 'stack', style: 'gap:2px;align-items:center' }, el('span', { class: 'who' }, us), el('span', { class: 'n' + (sum.outcome === 'W' ? ' ok' : '') }, sum.score ? String(sum.score.for) : '–')),
          el('span', { class: 'muted', style: 'font-size:24px' }, '–'),
          el('div', { class: 'stack', style: 'gap:2px;align-items:center' }, el('span', { class: 'who' }, them), el('span', { class: 'n' }, sum.score ? String(sum.score.against) : '–')),
          sum.outcome ? el('span', { class: 'pill ' + (sum.outcome === 'W' ? 'good' : sum.outcome === 'L' ? 'bad' : 'work') }, { W: 'Win', L: 'Loss', T: 'Tie' }[sum.outcome]) : ''),
        sum.goals.length ? el('div', { class: 'tablewrap', style: 'flex:1 1 280px;border:0;background:none' }, el('table', { class: 'dtable', style: 'min-width:260px' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Goals'), ...periods.map((p) => el('th', { class: 'num' }, p.n == null ? 'Other' : WP.periodLabel(p.n))), el('th', { class: 'num' }, 'Total'))),
          el('tbody', {},
            el('tr', {}, el('td', {}, us), ...periods.map((p) => el('td', { class: 'num' }, String(p.for))), el('td', { class: 'num' }, el('strong', {}, String(sum.score.for)))),
            el('tr', {}, el('td', {}, them), ...periods.map((p) => el('td', { class: 'num' }, String(p.against))), el('td', { class: 'num' }, el('strong', {}, String(sum.score.against))))))) : ''),
      sum.mismatch ? el('div', { class: 'warnbar' }, 'The goals here add up to ' + sum.score.for + '–' + sum.score.against + ', but ' + (sum.sheet ? 'the game sheet' : 'the final score') + ' says ' + sum.typed.for + '–' + sum.typed.against + '. A goal may be missing' + (sum.sheet ? ' or marked twice.' : ', or the final score may be wrong (Game details).')) : '',
      sum.source === 'sheet' ? el('span', { class: 'small muted' }, 'From the official game sheet' + (g.noVideo ? ' (no video for this game).' : '. Mark goals with G and H on Watch and tag to link them to the video.')) : '',
      sum.source === 'result' || sum.source === 'none' ? el('span', { class: 'small muted' }, sum.score ? 'This score comes from the final score, not your marks. Mark goals with G and H on Watch and tag, or import the game sheet.' : 'Mark goals with G and H on Watch and tag, or import the game sheet.') : '',
      sum.marked && !sum.periodsMarked && !sum.sheet ? el('span', { class: 'small muted' }, 'Mark periods with P to see goals by period.') : '');

    // the official game sheet: import, replace or remove
    const sheetBar = el('section', { class: 'card row noprint', id: 'gs-sheet', style: 'align-items:center' },
      g.sheet ? el('span', { class: 'grow stack', style: 'gap:2px' }, el('strong', {}, 'Game sheet' + (g.sheet.number ? ' ' + g.sheet.number : '')),
        el('span', { class: 'small muted' }, App.sheetLine(g.sheet) + ' · imported ' + new Date(g.sheet.importedAt || Date.now()).toLocaleDateString() +
          (sum.sheetCheck ? ' · ' + [sum.sheetCheck.differs ? sum.sheetCheck.differs + ' differ' : '', sum.sheetCheck.sheetOnly ? sum.sheetCheck.sheetOnly + ' only on the sheet' : '', sum.sheetCheck.markOnly ? sum.sheetCheck.markOnly + ' not on the sheet' : ''].filter(Boolean).join(', ') || ' · matches your marks' : '')))
        : el('span', { class: 'grow small muted' }, 'Add the official game sheet (PDF from GameSheet) to fill in scorers, assists and penalties. It’s read on this computer and never uploaded.'),
      el('button', { type: 'button', class: 'btn small' + (g.sheet ? '' : ' primary'), id: 'gs-import', onclick: importHere }, g.sheet ? 'Replace game sheet' : 'Import game sheet (PDF)'),
      g.sheet ? el('button', { type: 'button', class: 'btn small', onclick: removeSheet }, 'Remove') : '');

    // goals
    const sheetWho = (sg) => (sg.scorer ? '#' + sg.scorer : 'no scorer') + (sg.assists && sg.assists.length ? ' (A: ' + sg.assists.map((n) => '#' + n).join(', ') + ')' : '');
    const sheetCell = (x) => {
      if (x.fromSheet) return el('span', { class: 'pill do' }, 'From game sheet');
      if (x.sheetState === 'same') return el('span', { class: 'pill good' }, 'Matches game sheet');
      if (x.sheetState === 'kept') return el('span', { class: 'small muted' }, 'Kept yours (sheet: ' + sheetWho(x.sheet) + ')');
      if (x.sheetState === 'not-on-sheet') return el('span', { class: 'pill bad' }, 'Not on the game sheet');
      if (x.sheetState === 'differs') return el('div', { class: 'stack', style: 'gap:4px' }, el('span', { class: 'pill work', style: 'align-self:flex-start' }, 'Differs'),
        el('span', { class: 'small muted' }, 'Game sheet: ' + sheetWho(x.sheet)),
        el('span', { class: 'row', style: 'gap:4px' },
          el('button', { type: 'button', class: 'btn small noprint', onclick: () => keepMine(x.id) }, 'Keep mine'),
          el('button', { type: 'button', class: 'btn small noprint', onclick: () => useSheet(x.id, x.sheet) }, 'Use game sheet')));
      return '';
    };
    const goalRows = sum.goals.map((x) => el('tr', { class: x.fromSheet ? 'fromsheet' : '' },
      el('td', { style: 'white-space:nowrap' }, x.n ? WP.periodLabel(x.n) : '—', x.fromSheet || x.sheet ? el('div', { class: 'small muted' }, (x.fromSheet ? x.time : x.sheet.time) + ' left') : ''),
      el('td', { class: x.side === 'for' ? 'ok' : '', style: x.side === 'for' ? '' : 'color:var(--bad)' }, x.side === 'for' ? us : them),
      el('td', {}, x.side === 'for' ? (x.scorer ? el('strong', {}, pl(x.scorer)) : el('span', { class: 'muted' }, 'Not set')) : (x.oppScorer ? '#' + x.oppScorer : el('span', { class: 'muted' }, '—'))),
      el('td', {}, x.side === 'for' ? ((x.assists || []).map(pl).join(', ') || (x.scorer ? 'Unassisted' : '')) : [(x.oppAssists || []).map((n) => '#' + n).join(', '), x.onIce && x.onIce.length ? 'On ice: ' + x.onIce.map((n) => '#' + n).join(' ') : ''].filter(Boolean).join(' · ')),
      el('td', {}, x.strength ? el('span', { class: 'pill ' + (x.side === 'for' ? 'good' : 'work'), title: x.strength === 'pp' ? 'Power-play goal' : 'Short-handed goal' }, (x.side === 'for' ? '' : 'Their ') + (x.strength === 'pp' ? 'PP' : 'SH')) : ''),
      el('td', { class: 'small muted', style: 'white-space:nowrap' }, x.score.for + '–' + x.score.against),
      sum.sheet ? el('td', {}, sheetCell(x)) : '',
      el('td', { style: 'white-space:nowrap;text-align:right' }, x.fromSheet ? '' : [el('button', { type: 'button', class: 'btn small noprint', 'aria-label': 'Edit goal at ' + WP.formatTime(x.t), onclick: () => App.editGoal(x.id, renderGameSummary) }, 'Edit'), ' ', watch(x.t)])));
    const goalsCard = card({ 'aria-labelledby': 'gs-goals-h' },
      el('div', { class: 'row spread', style: 'align-items:baseline' }, el('h2', { id: 'gs-goals-h' }, 'Goals'), el('span', { class: 'small muted' }, sum.sheet ? 'Your marks win; the game sheet fills in what they’re missing.' : 'From your marks. Edit fixes who scored; the goal clip follows.')),
      sum.goals.length ? el('div', { class: 'tablewrap', style: 'border:0;background:none' }, el('table', { class: 'dtable', id: 'gs-goals', style: 'min-width:640px' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Period'), el('th', {}, 'Team'), el('th', {}, 'Scorer'), el('th', {}, 'Assists'), el('th', {}, ''), el('th', {}, 'Score'), sum.sheet ? el('th', {}, 'Game sheet') : '', el('th', {}, el('span', { class: 'sr' }, 'Actions')))),
        el('tbody', {}, ...goalRows))) : el('span', { class: 'small muted' }, 'No goals marked yet.'));

    // penalties
    const penRows = sum.penalties.map((p) => el('tr', { class: p.fromSheet ? 'fromsheet' : '' },
      el('td', { style: 'white-space:nowrap' }, p.n ? WP.periodLabel(p.n) : '—', p.fromSheet && p.time ? el('div', { class: 'small muted' }, p.time + ' left') : ''),
      el('td', {}, p.team === 'us' ? (p.player ? pl(p.player) : us) : them + (p.player ? ' #' + p.player : '')),
      el('td', {}, WP.label(WP.PENALTY_TYPES, p.type) || 'Penalty'),
      el('td', { class: 'num' }, p.minutes === 10 ? '10 (misc.)' : String(p.minutes)),
      el('td', {}, p.fromSheet ? el('span', { class: 'pill do' }, 'From game sheet') : WP.OUTCOME_LABELS[p.outcome] || ''),
      el('td', { style: 'text-align:right' }, p.fromSheet ? '' : watch(p.t))));
    const pensCard = card({ 'aria-labelledby': 'gs-pens-h' },
      el('div', { class: 'row spread', style: 'align-items:baseline' }, el('h2', { id: 'gs-pens-h' }, 'Penalties'),
        el('span', { class: 'small muted' }, 'PIM: ' + us + ' ' + sum.pim.us + ' · ' + them + ' ' + sum.pim.them)),
      sum.penalties.length ? el('div', { class: 'tablewrap', style: 'border:0;background:none' }, el('table', { class: 'dtable', id: 'gs-pens', style: 'min-width:560px' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Period'), el('th', {}, 'Player'), el('th', {}, 'Infraction'), el('th', { class: 'num' }, 'Min'), el('th', {}, 'Result'), el('th', {}, el('span', { class: 'sr' }, 'Watch')))),
        el('tbody', {}, ...penRows))) : el('span', { class: 'small muted' }, 'No penalties marked.'),
      sum.penalties.some((p) => p.fromSheet) ? el('span', { class: 'small muted' }, 'Penalties “from game sheet” aren’t marked on the video. Mark them with X on Watch and tag if you want clips for them.') : '');

    // clips
    const clips = g.clips.slice().sort((a, b) => a.start - b.start);
    const clipsCard = card({ 'aria-labelledby': 'gs-clips-h' },
      el('div', { class: 'row spread', style: 'align-items:baseline' }, el('h2', { id: 'gs-clips-h' }, 'Clips from this game'),
        el('span', { class: 'small muted' }, clips.length + (clips.length === 1 ? ' clip' : ' clips') + ' · ' + clips.filter((c) => c.exported).length + ' exported')),
      clips.length ? el('div', { class: 'cliptiles' }, ...clips.map((c) => {
        const cat = WP.clipCategoryLabel(c, S.settings.categories);
        const per = WP.periodAt(g, c.start);
        return el('a', { class: 'cliptile', href: '#edit/' + g.id + '/' + c.id, style: 'border-left-color:' + (cat ? cat.color : '#64748B') },
          el('strong', {}, cat ? cat.name : 'Clip'),
          el('span', { class: 'small muted' }, [per ? WP.periodLabel(per) : '', WP.formatTime(c.start), (c.players || []).map((n) => '#' + n).join(' ')].filter(Boolean).join(' · ')),
          c.note ? el('span', { class: 'small' }, '“' + c.note + '”') : '');
      })) : el('span', { class: 'small muted' }, 'No clips yet.'));

    // side: notes, points, actions
    const notes = WP.summaryNotes(g);
    const notesCard = card({ 'aria-labelledby': 'gs-notes-h' }, el('h2', { id: 'gs-notes-h' }, 'Coach’s notes'),
      el('label', { class: 'field' }, 'What went well', el('textarea', { id: 'gsn-well', class: 'notebox', rows: '3', oninput: saveNotes }, notes.wentWell)),
      el('label', { class: 'field' }, 'Work on', el('textarea', { id: 'gsn-work', class: 'notebox', rows: '3', oninput: saveNotes }, notes.workOn)));
    const ptsCard = card({ 'aria-labelledby': 'gs-pts-h' }, el('h2', { id: 'gs-pts-h' }, 'Points this game'),
      ...(sum.points.length ? sum.points.map((p) => el('div', { class: 'ptsrow' }, el('span', {}, pl(p.number)),
        el('span', { class: 'muted' }, [p.g + ' G', p.a + ' A', p.pim ? p.pim + ' PIM' : '', p.ppg ? p.ppg + ' PPG' : ''].filter(Boolean).join(' · '))))
        : [el('span', { class: 'small muted' }, 'Nobody yet. Points come from the scorer and assists on each goal.')]),
      sum.score && sum.goalies.length ? el('div', { class: 'ptsrow' }, el('span', {}, sum.goalies.map(pl).join(', ') + ' (G)'), el('span', { class: 'muted' }, sum.score.against + ' GA')) : '');
    const goalClips = sum.goals.filter((x) => x.clipId && g.clips.some((c) => c.id === x.clipId));
    const actCard = card({ class: 'card stack noprint', 'aria-label': 'Actions' },
      g.noVideo ? '' : el('button', { type: 'button', class: 'btn primary', id: 'gs-export-goals', disabled: goalClips.length ? null : '', onclick: () => App.exportGoalClips(g) }, 'Export all goal clips (' + goalClips.length + ')'),
      g.noVideo ? '' : el('span', { class: 'small muted' }, 'Uses the “Save to” choices from your last export.'),
      el('button', { type: 'button', class: 'btn', onclick: () => window.print() }, 'Print or save as PDF'));

    $('gsum').replaceChildren(el('div', { class: 'sumgrid' },
      el('div', { class: 'sum-main' }, scoreCard, sheetBar, goalsCard, pensCard, g.noVideo ? '' : clipsCard),
      el('div', { class: 'sum-side' }, notesCard, ptsCard, actCard)));
  }

  // ---- game sheet actions on the summary ----
  async function importHere() {
    const g = App.G;
    if (!g) return;
    const file = await App.pickPdf();
    if (!file) return;
    let facts;
    try { facts = await App.readSheet(file); } catch (e) { toast('Couldn’t read the game sheet: ' + e.message, { err: true, ms: 9000 }); return; }
    if (facts && await App.attachSheet(g, facts)) renderGameSummary();
  }
  async function removeSheet() {
    const g = App.G;
    if (!g || !(await App.askYes('Remove the game sheet from this game?', 'Goals and penalties that came only from the sheet disappear from the summary. Details it filled into your marks (scorers, assists) stay.', 'Remove'))) return;
    delete g.sheet;
    save();
    renderGameSummary();
  }
  function setGoal(id, fn) {
    const g = App.G;
    const m = WP.gameMarks(g);
    g.marks = Object.assign({}, m, { goals: m.goals.map((x) => (x.id === id ? fn(x) : x)) });
    save();
    renderGameSummary();
  }
  function keepMine(id) { setGoal(id, (x) => Object.assign({}, x, { sheetKeep: true })); }
  function useSheet(id, sg) {
    const g = App.G;
    const before = WP.gameMarks(g).goals.find((x) => x.id === id);
    g.marks = WP.updateGoal(g, id, WP.sheetGoalDetails(sg, before));
    const goal = WP.gameMarks(g).goals.find((x) => x.id === id);
    const clip = before && before.clipId ? g.clips.find((c) => c.id === before.clipId) : null;
    if (clip) { clip.players = WP.goalPlayers(goal); if (!clip.note || clip.note === WP.goalLabel(before)) clip.note = WP.goalLabel(goal); }
    save();
    toast('Goal updated from the game sheet: ' + WP.goalLabel(goal));
    renderGameSummary();
  }

  // =====================================================================
  // SEASON STATS
  // =====================================================================
  const ST = { type: null };
  function renderStats() {
    App.League.load();
    const games = S.games;
    if (ST.type == null) ST.type = games.some((g) => g.gameType === 'league') ? 'league' : '';
    const st = WP.seasonStats(games, roster(), ST.type, official);
    const r = st.record;
    const types = [['league', 'League'], ['tournament', 'Tournament'], ['exhibition', 'Exhibition'], ['playoff', 'Playoff'], ['', 'All games']];
    const toReview = (n) => { App.R.filters = WP.emptyFilters(); App.R.filters.players = [n]; App.R.viewId = null; location.hash = 'review'; };
    const skaters = st.players.filter((p) => !p.goalie || p.pts || p.pim);
    const goalies = st.players.filter((p) => p.goalie);
    const num = (v) => el('td', { class: 'num' }, String(v));
    $('stats').replaceChildren(el('div', { class: 'stack', style: 'gap:16px' },
      el('div', { class: 'row spread', style: 'align-items:center' },
        el('div', { class: 'row' }, el('a', { class: 'btn noprint', href: '#summaries', style: 'text-decoration:none' }, '← Summaries'), el('h1', {}, 'Season stats')),
        el('div', { class: 'chips noprint', role: 'group', 'aria-label': 'Which games' }, ...types.map(([v, l]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(ST.type === v), onclick: () => { ST.type = v; renderStats(); } }, l)))),
      el('div', { class: 'tiles' },
        el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Games with a score'), el('strong', {}, String(r.games))),
        el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Record'), el('strong', {}, r.w + '–' + r.l + '–' + r.t)),
        el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Goals for / against'), el('strong', {}, r.gf + ' / ' + r.ga)),
        el('div', { class: 'tile' }, el('span', { class: 'small muted' }, 'Our penalty minutes'), el('strong', {}, String(r.pim)))),
      el('div', { class: 'tablewrap' }, el('table', { class: 'dtable', id: 'stats-skaters', style: 'min-width:720px' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Player'), ...['GP', 'G', 'A', 'PTS', 'PIM', 'PPG'].map((h) => el('th', { class: 'num' }, h)), el('th', {}, 'Clips'))),
        el('tbody', {}, ...(skaters.length ? skaters.map((p) => el('tr', {},
          el('td', {}, el('strong', {}, '#' + p.number), p.name ? ' ' + p.name : ''),
          num(p.gp), num(p.g), num(p.a), el('td', { class: 'num' }, el('strong', {}, String(p.pts))), num(p.pim), num(p.ppg),
          el('td', {}, p.clips ? el('button', { type: 'button', class: 'btn small', onclick: () => toReview(p.number), 'aria-label': p.clips + ' clips of #' + p.number + ' in Review' }, p.clips + (p.clips === 1 ? ' clip' : ' clips')) : el('span', { class: 'muted' }, '—'))))
          : [el('tr', {}, el('td', { colspan: '8', class: 'empty' }, 'No players yet. Add your roster on the Team tab.'))])))),
      goalies.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'dtable', id: 'stats-goalies', style: 'min-width:520px' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Goalie'), ...['GP', 'GA', 'GAA', 'W', 'L', 'T'].map((h) => el('th', { class: 'num' }, h)))),
        el('tbody', {}, ...goalies.map((p) => el('tr', {}, el('td', {}, el('strong', {}, '#' + p.number), p.name ? ' ' + p.name : ''),
          num(p.gGp), num(p.ga), num(p.gGp ? (p.ga / p.gGp).toFixed(2) : '—'), num(p.gw), num(p.gl), num(p.gt)))))) : '',
      el('span', { class: 'small muted' }, 'From your goal and penalty marks; the record also counts games with only a final score. A goalie is credited when the game’s lineup has exactly one goalie. Click a player’s clips to see them in Review.')));
  }

  Object.assign(App, { renderSummaries, renderGameSummary, renderStats });
}).catch((e) => setTimeout(() => { throw e; }));
