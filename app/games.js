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
    session.draftLineup = null;
    for (const id of ['g-date', 'g-opp', 'g-rink', 'g-result', 'g-type', 'g-ha']) $(id).value = '';
    renderParts();
    renderDraftLineup();
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
        date: $('g-date').value, opponent: $('g-opp').value, rink: $('g-rink').value, result: $('g-result').value, gameType: $('g-type').value, homeAway: $('g-ha').value
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

  function renderGames() {
    renderDraftLineup();
    renderWho();
    App.renderGameLists();
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
            onclick: async () => {
              if (!(await askYes('Delete ' + WP.gameTitle(g) + '?', 'Its ' + g.clips.length + ' clips are removed from this computer. The video files and anything already in Drive are not touched.', 'Delete game'))) return;
              S.games = S.games.filter((x) => x.id !== g.id);
              save(); idb.del(g.id); session.files.delete(g.id);
              if (App.player && App.player.gameId === g.id) { App.player.destroy(); App.player = null; App.G = null; }
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
      replaceState(state); save(); renderGames();
      toast('Imported ' + count + (count === 1 ? ' game' : ' games'));
    } catch (err) { toast(err.message, { err: true }); }
  });
  Object.assign(App, {
    renderDraftLineup,
    renderGames
  });
}).catch((e) => setTimeout(() => { throw e; }));
