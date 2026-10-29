/* Watch Party — Official game sheets (v2.1): read a GameSheet PDF on this computer (it is never uploaded), keep the
   goals, penalties and score (jersey numbers only, no names), fill in what the coach's marks are missing, and make
   summary-only games for games with no video. */
App.ready.then(() => {
  'use strict';
  const { $, S, el, save, toast } = App;

  // ---- pdf.js, loaded the first time a sheet is opened (bundled in vendor/, runs on this computer) ----
  let pdfReady = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Couldn’t load the PDF reader (' + src + ')'));
      document.head.append(s);
    });
  }
  function pdfjs() {
    if (!pdfReady) {
      // the worker script on the page first: pdf.js then reads on the page itself (works from a file:// copy too)
      pdfReady = loadScript('vendor/pdf.worker.min.js').then(() => loadScript('vendor/pdf.min.js')).then(() => window.pdfjsLib)
        .catch((e) => { pdfReady = null; throw e; });
    }
    return pdfReady;
  }

  /** The first page's text items, y measured down from the top. */
  async function pdfItems(file) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    doc.destroy();
    return tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width }));
  }

  /** Read a game sheet PDF into the facts the app keeps. Asks which team is ours when the names don't say. */
  async function readSheet(file) {
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') throw new Error('That isn’t a PDF. Download the game sheet from GameSheet as a PDF.');
    const parsed = WP.parseGameSheet(await pdfItems(file));
    const names = [S.settings.team.name, S.settings.league && S.settings.league.name].filter(Boolean);
    let side = WP.sheetSide(parsed, names);
    if (!side) {
      side = await App.askChoice('Which team are you on this game sheet?', 'The team names on the sheet don’t match ' + (names[0] || 'your team') + '.',
        [{ value: 'home', label: parsed.home.name || 'Home team', note: 'Home' }, { value: 'visitor', label: parsed.visitor.name || 'Visiting team', note: 'Visitor' }]);
      if (!side) return null;
    }
    return WP.sheetFacts(parsed, side);
  }

  function pickPdf() {
    return new Promise((resolve) => {
      const inp = el('input', { type: 'file', accept: '.pdf,application/pdf', class: 'hidden' });
      inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); resolve(f || null); });
      document.body.append(inp);
      inp.click();
    });
  }

  const sheetLine = (f) => [f.number ? 'Game ' + f.number : '', f.date ? WP.formatDate(f.date) : '', f.us + ' ' + f.score.for + '–' + f.score.against + ' ' + f.them].filter(Boolean).join(' · ');

  /** Attach a sheet to a game: fill in what the marks are missing; the coach's own details are never changed. */
  async function attachSheet(game, facts) {
    if (game.date && facts.date && game.date !== facts.date) {
      const go = await App.ask({ title: 'This game sheet is for a different date', message: 'The sheet is for ' + WP.formatDate(facts.date) + ' (' + sheetLine(facts) + '), but this game is ' + WP.formatDate(game.date) + '. Use it for this game anyway?', ok: 'Use it anyway', danger: false });
      if (!go) return false;
    }
    game.sheet = facts;
    const r = WP.fillFromSheet(game, facts);
    game.marks = r.marks;
    if (!game.result) game.result = (facts.score.for > facts.score.against ? 'W ' : facts.score.for < facts.score.against ? 'L ' : 'T ') + facts.score.for + '–' + facts.score.against;
    // goal clips follow the filled-in scorers
    for (const g of WP.gameMarks(game).goals) {
      const c = g.clipId && game.clips.find((x) => x.id === g.clipId);
      if (!c) continue;
      const want = WP.goalPlayers(g);
      if (want.length && !(c.players || []).length) c.players = want;
      if (!c.note || /^Goal( for| against)?$/.test(c.note)) c.note = WP.goalLabel(g);
    }
    save();
    toast('Game sheet added (' + sheetLine(facts) + ')' + (r.filled ? '. Filled in ' + r.filled + ' detail' + (r.filled === 1 ? '' : 's') + ' your marks were missing.' : '.'), { ms: 7000 });
    return true;
  }

  /** A game here for this sheet already? Same league game, or same date. */
  function existingFor(facts, sched) {
    if (sched) { const g = S.games.find((x) => x.league && x.league.id === sched.id); if (g) return g; }
    return S.games.find((x) => facts.date && x.date === facts.date) || null;
  }

  /**
   * Import a sheet from the Games screen (o.sched: the league game it's for). Attaches it to the game already here
   * for that day, or (after asking) makes a summary-only game marked "No video available".
   */
  async function importSheet(o) {
    const opt = o || {};
    const file = opt.file || await pickPdf();
    if (!file) return;
    let facts;
    try { facts = await readSheet(file); } catch (e) { toast('Couldn’t read the game sheet: ' + e.message, { err: true, ms: 9000 }); return; }
    if (!facts) return;
    const sched = opt.sched || ((App.League.schedule() || []).find((x) => x.date === facts.date) || null);
    const have = existingFor(facts, sched);
    if (have) {
      const yes = await App.ask({ title: 'Add this game sheet to ' + WP.gameTitle(have) + '?', message: sheetLine(facts) + '. Your marks stay as they are; the sheet fills in what they’re missing and differences are shown in the summary.', ok: 'Add game sheet', danger: false });
      if (yes && await attachSheet(have, facts)) location.hash = 'sum/' + have.id;
      return;
    }
    const yes = await App.ask({ title: 'Create a summary-only game?', message: sheetLine(facts) + '. There’s no game for this date yet. It will be marked “No video available”, and its summary comes from the game sheet. You can mark more later in Game details.', ok: 'Create game', danger: false });
    if (!yes) return;
    const fields = sched ? WP.scheduleFields(sched) : {};
    const game = WP.newSheetGame(facts, Object.assign({}, fields, { league: sched ? WP.leagueLink(sched) : null, result: '' }));
    game.result = (facts.score.for > facts.score.against ? 'W ' : facts.score.for < facts.score.against ? 'L ' : 'T ') + facts.score.for + '–' + facts.score.against;
    S.games.push(game);
    save();
    toast('Created ' + WP.gameTitle(game) + ' from the game sheet (no video)');
    location.hash = 'sum/' + game.id;
  }

  // ---- New game screen: an optional game sheet goes with the video files ----
  async function draftSheet(file) {
    try {
      const facts = await readSheet(file);
      App.session.draftSheet = facts;
    } catch (e) { App.session.draftSheet = null; toast('Couldn’t read the game sheet: ' + e.message, { err: true, ms: 9000 }); }
    renderDraftSheet();
  }
  function renderDraftSheet() {
    const f = App.session.draftSheet;
    $('g-sheet-status').replaceChildren(f ? el('span', { class: 'row', style: 'gap:8px' }, el('span', { class: 'pill good' }, '✓ Game sheet'), el('span', { class: 'small' }, sheetLine(f)),
      el('button', { type: 'button', class: 'btn small', onclick: () => { App.session.draftSheet = null; renderDraftSheet(); } }, 'Remove'))
      : el('span', { class: 'small muted' }, 'Optional: the official game sheet PDF from GameSheet. Its scorers, assists and penalties fill in your summary.'));
  }
  $('g-sheet-pick').addEventListener('click', async () => { const f = await pickPdf(); if (f) draftSheet(f); });

  Object.assign(App, { readSheet, attachSheet, importSheet, pickPdf, renderDraftSheet, sheetLine });
}).catch((e) => setTimeout(() => { throw e; }));
