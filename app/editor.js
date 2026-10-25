/* Bulldogs Watch Party — Clip editor: trim, freeze and draw, slow motion, zoom, preview and clip details. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, askYes, autoLine, catById, createPlayer, el, idb, openGame, rangeText, removeClip, save,
    session, toast, zoomLabel
  } = App;

  // =====================================================================
  // CLIP EDITOR (milestone 2a)
  // =====================================================================
  App.E = null; // { clipId, d, player, raf, mode, tool, color, ctrl, drawDraft, holdActive, W, H, wa, wb, outT }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function edClip() { return App.E && App.G ? App.G.clips.find((c) => c.id === App.E.clipId) : null; }
  function edCtx() { return $('e-canvas').getContext('2d'); }
  function edBusy() { return App.E && (App.E.mode === 'export'); }
  function edRecording() { return App.E && (App.E.mode === 'record' || App.E.mode === 'countdown'); }

  function openEditor(gameId, clipId) {
    const game = S.games.find((g) => g.id === gameId);
    if (!game) { location.hash = 'games'; return false; }
    if (!App.G || App.G.id !== gameId) { if (!openGame(gameId)) return false; }
    const clip = App.G.clips.find((c) => c.id === clipId);
    if (!clip) { toast('That clip no longer exists', { err: true }); location.hash = 'tag/' + gameId; return false; }
    const files = session.files.get(gameId);
    if (!files) { toast('Reconnect the video files first'); location.hash = 'tag/' + gameId; return false; }
    if (App.player) App.player.pause();
    if (App.E && App.E.clipId === clipId && App.E.player) { renderEditor(); return true; }
    closeEditor();
    App.E = { clipId, d: clone(clip), mode: 'idle', tool: 'arrow', color: WP.COLORS.yellow, W: 1280, H: 568, outT: 0 };
    setWindow();
    App.E.player = createPlayer($('e-video'), files, App.TL, App.G.id, () => {});
    App.E.player.seek(clip.start).then(() => { if (App.E && App.E.clipId === clipId) renderEditor(); });
    renderEditor();
    const loop = () => { if (!App.E) return; if (stageNeedsDraw()) drawStage(); App.E.raf = requestAnimationFrame(loop); };
    App.E.raf = requestAnimationFrame(loop);
    return true;
  }

  /** Skip redrawing the editor picture when nothing changed (saves battery while paused). */
  function stageNeedsDraw() {
    if (App.E.mode !== 'idle' && App.E.mode !== 'draw') return true; // preview, record, countdown, export
    if (App.E.player.isPlaying()) return true;
    const v = $('e-video');
    const dd = App.E.drawDraft;
    const last = dd && dd.pts[dd.pts.length - 1];
    const key = [v.currentTime, v.readyState, v.videoWidth, App.E.mode, App.E.d, App.E.d.zoom, dd, dd && dd.pts.length, last && last[0], last && last[1], App.E.W, App.E.H, App.E.holdActive, document.visibilityState];
    if (App.E.lastKey && WP.sameSig(App.E.lastKey, key)) return false;
    App.E.lastKey = key;
    return true;
  }

  function closeEditor() {
    if (!App.E) return;
    if (App.E.ctrl) App.E.ctrl.abort();
    if (App.E.recStream) App.E.recStream.getTracks().forEach((tr) => tr.stop());
    if (App.E.recorder && App.E.recorder.state !== 'inactive') { try { App.E.recorder.stop(); } catch (e) { /* ignore */ } }
    cancelAnimationFrame(App.E.raf);
    if (App.E.player) App.E.player.destroy();
    App.E = null;
  }

  function setWindow() {
    const d = App.E.d;
    App.E.wa = Math.max(0, d.start - 10);
    App.E.wb = Math.min(App.TL.total, d.end + 10);
  }

  $('e-video').addEventListener('loadedmetadata', () => {
    if (!App.E) return;
    const v = $('e-video');
    const size = WP.exportSize(v.videoWidth, v.videoHeight, 1280);
    if (size.width !== App.E.W || size.height !== App.E.H) {
      App.E.W = size.width; App.E.H = size.height;
      $('e-canvas').width = App.E.W; $('e-canvas').height = App.E.H;
    }
  });

  function commit(patch, quiet) {
    const clip = edClip();
    if (!clip) return false;
    try {
      const next = WP.updateClip(clip, patch, App.TL.total);
      App.G.clips = App.G.clips.map((x) => (x.id === clip.id ? next : x));
      App.E.d = clone(next);
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

  function recT() { return App.E && App.E.rec ? Math.max(0, (App.E.player.time() - App.E.d.start) / App.E.rec.rate) : 0; }

  function drawStage() {
    const d = App.E.d;
    const v = $('e-video');
    const t = App.E.player.time();
    const paused = !App.E.player.isPlaying();
    const cat = catById(d.categoryId);
    const title = d.titleBar !== false ? WP.titleLines(d, cat, App.G) : null;
    if (App.E.mode === 'record' && App.E.rec) {
      const rt = recT();
      WP.addRecKey(App.E.rec, rt, d.zoom);
      WPRender.renderFrame(edCtx(), v, { zoom: d.zoom, W: App.E.W, H: App.E.H, shapes: WP.recShapesAt(App.E.rec, WP.recOut(App.E.rec, rt)), draft: App.E.drawDraft || null, title });
      $('e-ov').replaceChildren(el('span', { class: 'recdot' }), 'REC ' + WP.formatTime(rt, true) + (App.E.rec.rate === 0.5 ? ' \u00b7 half speed' : '') + (App.E.rec.voice ? ' \u00b7 mic on' : ''));
      if (t >= d.end - 0.03 || (App.E.recStarted && paused)) App.stopRecording();
      const head0 = $('e-trim-head');
      if (head0) head0.style.left = trimPct(t) + '%';
      return;
    }
    if (WP.hasRec(d) && App.E.mode !== 'countdown') {
      const outT = App.E.mode === 'preview' ? App.E.outT : Math.max(0, (t - d.start) / WP.recExportRate(d.rec));
      WPRender.renderFrame(edCtx(), v, { zoom: WP.recZoomAt(d.rec, outT), W: App.E.W, H: App.E.H, shapes: WP.recShapesAt(d.rec, outT), title });
    } else {
      const atFreeze = d.freeze && Math.abs(t - d.freeze.at) < 0.06 && paused && App.E.mode !== 'preview';
      const showShapes = d.freeze && (App.E.mode === 'draw' || App.E.holdActive || atFreeze);
      WPRender.renderFrame(edCtx(), v, {
        zoom: d.zoom, W: App.E.W, H: App.E.H,
        shapes: showShapes ? d.freeze.shapes : null,
        draft: App.E.drawDraft || null,
        title
      });
    }
    const inClip = Math.max(0, t - d.start);
    $('e-ov').textContent = App.E.mode === 'preview'
      ? 'Finished clip ' + WP.formatTime(App.E.outT, true) + ' / ' + WP.formatTime(WP.planDuration(WP.buildPlan(d)), true)
      : 'Clip ' + WP.formatTime(Math.min(inClip, d.end - d.start), true) + ' · game ' + WP.formatTime(t, true);
    $('e-clock').textContent = 'Playhead ' + WP.formatTime(t, true);
    const head = $('e-trim-head');
    if (head) head.style.left = trimPct(t) + '%';
  }

  function trimPct(t) { return App.E.wb > App.E.wa ? ((t - App.E.wa) / (App.E.wb - App.E.wa)) * 100 : 0; }

  function renderEditor() {
    if (!App.E) return;
    const d = App.E.d;
    const cat = catById(d.categoryId);
    $('e-title').textContent = (cat ? cat.name : 'Clip') + ' · ' + rangeText(d);
    $('e-back').setAttribute('href', '#tag/' + App.G.id);
    const order = WP.sortClips(App.G.clips);
    const i = order.findIndex((c) => c.id === d.id);
    $('e-prev').disabled = i <= 0;
    $('e-next').disabled = i < 0 || i >= order.length - 1;
    $('e-prev').onclick = () => { if (i > 0) location.hash = 'edit/' + App.G.id + '/' + order[i - 1].id; };
    $('e-next').onclick = () => { if (i < order.length - 1) location.hash = 'edit/' + App.G.id + '/' + order[i + 1].id; };
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
    $('e-wa').textContent = WP.formatTime(App.E.wa);
    $('e-wb').textContent = WP.formatTime(App.E.wb);
    $('e-start').value = WP.formatTime(d.start, true);
    $('e-end').value = WP.formatTime(d.end, true);
    const plan = WP.buildPlan(d);
    $('e-len').textContent = 'Clip ' + Math.round((d.end - d.start) * 10) / 10 + ' s → finished video ' + Math.round(WP.planDuration(plan) * 10) / 10 + ' s';
    renderFreezePanel();
    renderSpeedPanel();
    App.renderRecPanel();
    $('e-edits').classList.toggle('dim', WP.hasRec(d) || App.E.mode === 'record' || App.E.mode === 'countdown');
    $('stage').classList.toggle('recording', App.E.mode === 'record');
    // details
    $('e-cat').replaceChildren(...S.settings.categories.map((x) => el('option', { value: x.id }, x.name + (x.hidden ? ' (hidden)' : ''))));
    $('e-cat').value = d.categoryId;
    // players who played in this game (from its lineup), plus anyone already tagged
    const lineupRows = WP.gameLineup(App.G, S.settings.roster).filter((r) => !r.away || d.players.includes(r.number));
    $('e-chips').replaceChildren(...lineupRows.map((p) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(d.players.includes(p.number)), title: [p.name, p.pos ? WP.positionLabel(p.pos) : '', p.guest ? 'guest' : ''].filter(Boolean).join(' \u00b7 ') || null,
      onclick: () => {
        const has = d.players.includes(p.number);
        commit({ players: has ? d.players.filter((n) => n !== p.number) : d.players.concat([p.number]) });
      }
    }, '#' + p.number)));
    $('e-chips').hidden = !lineupRows.length;
    if (document.activeElement !== $('e-players')) $('e-players').value = d.players.join(', ');
    for (const b of $('e-flag').children) b.setAttribute('aria-pressed', String(b.dataset.flag === d.flag));
    if (document.activeElement !== $('e-note')) $('e-note').value = d.note;
    $('e-zoom-text').textContent = d.zoom ? zoomLabel(d.zoom) : 'Whole rink';
    $('ez-level').textContent = (d.zoom ? Math.round(d.zoom.scale * 10) / 10 : 1) + '×';
    $('stage').classList.toggle('zoomed', !!d.zoom && App.E.mode !== 'draw');
    $('stage').classList.toggle('draw', App.E.mode === 'draw');
    $('e-title-on').checked = d.titleBar !== false;
    renderEditorTags();
    $('e-export-note').textContent = d.exported
      ? 'Last exported ' + new Date(d.exported.at).toLocaleString() + ' as “' + d.exported.name + '”'
      : 'Makes a ' + App.E.W + '×' + App.E.H + ' MP4. Choose above where it\u2019s saved.';
    $('e-ov-mode').classList.toggle('hidden', App.E.mode !== 'draw');
    $('e-ov-mode').textContent = 'Drawing — drag on the picture';
    $('e-play-label').textContent = App.E.mode === 'preview' ? '⏸ Stop preview' : '▶ Preview finished clip';
    const busy = edBusy() || App.E.mode === 'record' || App.E.mode === 'countdown';
    for (const id of ['e-export', 'e-play', 'e-delete']) $(id).disabled = busy;
    if (busy) { $('e-prev').disabled = true; $('e-next').disabled = true; }
  }

  function renderFreezePanel() {
    const d = App.E.d;
    const box = $('e-freeze');
    const t = App.E.player ? App.E.player.time() : d.start;
    if (!d.freeze) {
      const inside = t >= d.start - 0.01 && t <= d.end + 0.01;
      box.replaceChildren(
        el('span', { class: 'small muted' }, 'Pause on the moment you want to explain, then freeze it. The video holds that frame with your drawings, then plays on.'),
        el('button', { type: 'button', class: 'btn outline', id: 'e-freeze-here', disabled: !inside, onclick: () => {
          App.E.player.pause();
          const at = App.E.player.time();
          if (commit({ freeze: WP.setFreeze(App.E.d, at, WP.DEFAULT_HOLD) })) enterDraw();
        } }, 'Freeze here and draw'),
        inside ? '' : el('span', { class: 'small', style: 'color:var(--work)' }, 'Move the playhead inside the clip first.')
      );
      return;
    }
    const f = d.freeze;
    const tool = (id, label) => el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(App.E.tool === id && App.E.mode === 'draw'), onclick: () => { App.E.tool = id; enterDraw(); } }, label);
    const sw = (name, hex) => el('button', { type: 'button', class: 'swatch', 'aria-label': name, 'aria-pressed': String(App.E.color === hex), style: 'background:' + hex, onclick: () => { App.E.color = hex; if (App.E.mode !== 'draw') enterDraw(); else renderEditor(); } });
    const holdSel = el('select', { 'aria-label': 'Hold length', style: 'min-height:36px', onchange: (e) => commit({ freeze: WP.setFreeze(App.E.d, f.at, Number(e.target.value)) }) },
      ...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => el('option', { value: String(n) }, n + ' s')));
    holdSel.value = String(f.hold);
    box.replaceChildren(
      el('div', { class: 'row' }, el('span', {}, 'Frozen at ' + WP.formatTime(f.at, true) + ' for'), holdSel),
      el('div', { class: 'row' }, tool('arrow', 'Arrow'), tool('circle', 'Circle'), tool('free', 'Freehand')),
      el('div', { class: 'row' }, sw('Yellow', WP.COLORS.yellow), sw('White', WP.COLORS.white), sw('Red', WP.COLORS.red),
        el('button', { type: 'button', class: 'btn small', disabled: !f.shapes.length, onclick: undoShape }, 'Undo'),
        el('button', { type: 'button', class: 'btn small', disabled: !f.shapes.length, onclick: () => commit({ freeze: Object.assign({}, f, { shapes: [] }) }) }, 'Clear')),
      el('span', { class: 'small muted' }, f.shapes.length + (f.shapes.length === 1 ? ' drawing' : ' drawings') + (App.E.mode === 'draw' ? ' · drag on the picture to draw' : '')),
      el('div', { class: 'row' },
        App.E.mode === 'draw'
          ? el('button', { type: 'button', class: 'btn small primary', onclick: exitDraw }, 'Done drawing')
          : el('button', { type: 'button', class: 'btn small', onclick: enterDraw }, 'Go to freeze and draw'),
        el('button', { type: 'button', class: 'btn small', onclick: () => {
          const at = App.E.player.time();
          if (commit({ freeze: WP.setFreeze(App.E.d, at, f.hold) })) enterDraw();
        } }, 'Move freeze to playhead'),
        el('button', { type: 'button', class: 'btn small danger', onclick: () => { exitDraw(true); commit({ freeze: null }); } }, 'Remove freeze'))
    );
  }

  function undoShape() {
    const f = App.E.d.freeze;
    if (!f || !f.shapes.length) return;
    commit({ freeze: Object.assign({}, f, { shapes: f.shapes.slice(0, -1) }) });
  }

  function enterDraw() {
    if (!App.E.d.freeze || edBusy()) return;
    stopPreview();
    App.E.player.pause();
    App.E.player.seek(App.E.d.freeze.at);
    App.E.mode = 'draw';
    renderEditor();
    showStage();
  }

  function showStage() {
    const r = $('stage').getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) $('stage').scrollIntoView({ block: 'start' });
  }

  function exitDraw(quiet) {
    if (App.E.mode !== 'draw') return;
    App.E.mode = 'idle';
    App.E.drawDraft = null;
    if (!quiet) renderEditor();
  }

  function renderSpeedPanel() {
    const d = App.E.d;
    const list = d.speeds || [];
    const rows = list.map((x) => {
      const rate = el('select', { 'aria-label': 'Speed', style: 'min-height:36px', onchange: (e) => commit({ speeds: WP.updateSpeed(App.E.d, x.id, { rate: Number(e.target.value) }) }) },
        el('option', { value: '0.25' }, '0.25× slow'), el('option', { value: '0.5' }, '0.5× slow'), el('option', { value: '1.5' }, '1.5× fast'), el('option', { value: '2' }, '2× fast'));
      rate.value = String(x.rate);
      const timeIn = (key) => el('input', { type: 'text', class: 'time', value: WP.formatTime(x[key], true), 'aria-label': key === 'start' ? 'Speed section start' : 'Speed section end', style: 'width:84px',
        onchange: (e) => {
          const v = WP.parseTime(e.target.value);
          if (!Number.isFinite(v)) { toast('Use m:ss, e.g. 4:09.5', { err: true }); renderEditor(); return; }
          try { commit({ speeds: WP.updateSpeed(App.E.d, x.id, { [key]: v }) }); } catch (err) { toast(err.message, { err: true }); renderEditor(); }
        } });
      const now = (key, label) => el('button', { type: 'button', class: 'btn small', onclick: () => {
        try { commit({ speeds: WP.updateSpeed(App.E.d, x.id, { [key]: App.E.player.time() }) }); } catch (err) { toast(err.message, { err: true }); }
      } }, label);
      return el('div', { class: 'spdrow' }, rate, el('span', { class: 'small muted' }, 'from'), timeIn('start'), now('start', 'Start = playhead'),
        el('span', { class: 'small muted' }, 'to'), timeIn('end'), now('end', 'End = playhead'),
        el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove speed section', onclick: () => commit({ speeds: WP.removeSpeed(App.E.d, x.id) }) }, 'Remove'));
    });
    $('e-speeds').replaceChildren(...[
      list.length ? null : el('span', { class: 'small muted' }, 'Slow down (or speed up) part of the clip. Move the playhead to where it should start, then add a section.'),
      ...rows,
      el('button', { type: 'button', class: 'btn outline small', disabled: list.length >= WP.MAX_SPEEDS, style: 'align-self:flex-start', onclick: () => {
        try { commit({ speeds: WP.addSpeed(App.E.d, App.E.player.time(), 0.5) }); } catch (err) { toast(err.message, { err: true }); }
      } }, list.length >= WP.MAX_SPEEDS ? 'Up to 3 sections' : 'Add slow-motion section at playhead')
    ].filter(Boolean));
  }

  // ---- preview (same timing as the export) ----
  async function startPreview() {
    if (!App.E || edBusy() || edRecording()) return;
    exitDraw(true);
    App.E.ctrl = new AbortController();
    App.E.mode = 'preview';
    App.E.outT = 0;
    renderEditor();
    let audio = null;
    if (WP.hasRec(App.E.d) && App.E.d.rec.voice) {
      const blob = await idb.get('voice:' + App.E.d.id);
      if (blob) { audio = new Audio(URL.createObjectURL(blob)); audio.preload = 'auto'; }
      else toast('The voice-over for this clip isn\u2019t on this computer.', { err: true });
    }
    try {
      await WPRender.runPlan(App.E.player, $('e-video'), WP.buildPlan(App.E.d), {
        mode: 'preview', signal: App.E.ctrl.signal,
        onFrame: (s, outT) => { if (App.E) App.E.outT = outT; },
        onTick: (outT) => { if (App.E) App.E.outT = outT; },
        onSegment: (seg) => {
          if (App.E) App.E.holdActive = seg.kind === 'hold';
          if (audio && seg.outStart === 0) { audio.currentTime = 0; audio.play().catch(() => {}); }
        }
      });
    } catch (e) { if (e.name !== 'AbortError') toast(e.message, { err: true }); }
    if (audio) { audio.pause(); URL.revokeObjectURL(audio.src); }
    if (!App.E) return;
    App.E.holdActive = false;
    if (App.E.mode === 'preview') App.E.mode = 'idle';
    App.E.ctrl = null;
    renderEditor();
  }

  function stopPreview() {
    if (App.E && App.E.mode === 'preview' && App.E.ctrl) App.E.ctrl.abort();
  }

  $('e-play').addEventListener('click', () => { if (App.E.mode === 'preview') stopPreview(); else startPreview(); });
  const edSeek = (t) => { if (!App.E || edBusy()) return; stopPreview(); exitDraw(); App.E.player.pause(); App.E.player.seek(Math.max(0, Math.min(App.TL.total, t))); setTimeout(() => App.E && renderFreezePanel(), 120); };
  $('e-back1').addEventListener('click', () => edSeek(App.E.player.time() - 1));
  $('e-fwd1').addEventListener('click', () => edSeek(App.E.player.time() + 1));
  $('e-frame-b').addEventListener('click', () => edSeek(App.E.player.time() - 1 / 30));
  $('e-frame-f').addEventListener('click', () => edSeek(App.E.player.time() + 1 / 30));

  // ---- trim bar ----
  (function () {
    const tr = $('e-trim');
    let drag = null;
    const tAt = (e) => {
      const r = tr.getBoundingClientRect();
      return Math.round((App.E.wa + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (App.E.wb - App.E.wa)) * 10) / 10;
    };
    tr.addEventListener('pointerdown', (e) => {
      if (!App.E || edBusy() || edRecording()) return;
      const h = e.target.closest('.handle');
      tr.setPointerCapture(e.pointerId);
      stopPreview(); exitDraw();
      if (h) { drag = { which: h.dataset.h, el: h }; return; }
      drag = { which: 'seek' };
      edSeek(tAt(e));
    });
    tr.addEventListener('pointermove', (e) => {
      if (!drag || !App.E) return;
      const t = tAt(e);
      if (drag.which === 'seek') { App.E.player.seek(t); return; }
      const d = App.E.d;
      const v = drag.which === 'start' ? Math.min(t, d.end - WP.MIN_CLIP) : Math.max(t, d.start + WP.MIN_CLIP);
      drag.value = v;
      drag.el.style.left = trimPct(v) + '%';
      const range = tr.querySelector('.range');
      const a = drag.which === 'start' ? v : d.start;
      const b = drag.which === 'end' ? v : d.end;
      range.style.left = trimPct(a) + '%';
      range.style.width = (trimPct(b) - trimPct(a)) + '%';
      App.E.player.seek(v);
    });
    const end = async () => {
      if (!drag || !App.E) { drag = null; return; }
      const dd = drag;
      drag = null;
      if (dd.which === 'start' || dd.which === 'end') {
        if (dd.value != null && (await okToRetrim()) && App.E) commit({ [dd.which]: dd.value });
        if (!App.E) return;
        setWindow();
        renderEditor();
      } else renderFreezePanel();
    };
    tr.addEventListener('pointerup', end);
    tr.addEventListener('pointercancel', end);
  })();

  const okToRetrim = async () => !WP.hasRec(App.E.d) || askYes('Change the trim?', 'Changing the trim deletes the recorded breakdown.', 'Change trim');
  const setTrim = async (key, v) => {
    if (!Number.isFinite(v)) { toast('Use m:ss, e.g. 4:09.5', { err: true }); renderEditor(); return; }
    if (v !== App.E.d[key] && !(await okToRetrim())) { renderEditor(); return; }
    if (commit({ [key]: v })) { setWindow(); renderEditor(); }
  };
  $('e-start').addEventListener('change', (e) => setTrim('start', WP.parseTime(e.target.value)));
  $('e-end').addEventListener('change', (e) => setTrim('end', WP.parseTime(e.target.value)));
  $('e-start-now').addEventListener('click', () => setTrim('start', Math.round(App.E.player.time() * 10) / 10));
  $('e-end-now').addEventListener('click', () => setTrim('end', Math.round(App.E.player.time() * 10) / 10));

  // ---- stage: draw or zoom ----
  (function () {
    const cv = $('e-canvas');
    const frac = (e) => { const r = cv.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, r }; };
    let act = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!App.E || edBusy() || e.button !== 0) return;
      const { fx, fy, r } = frac(e);
      cv.setPointerCapture(e.pointerId);
      if (App.E.mode === 'countdown') return;
      if (App.E.mode === 'draw' || (App.E.mode === 'record' && App.E.recDraw)) {
        const p = WP.viewToFrame(App.E.d.zoom, fx, fy);
        App.E.drawDraft = { type: App.E.tool, color: App.E.color, pts: [[p.x, p.y], [p.x, p.y]] };
        act = { kind: 'draw', x: e.clientX, y: e.clientY };
      } else if (App.E.d.zoom) {
        act = { kind: 'pan', x: e.clientX, y: e.clientY, z: App.E.d.zoom, r };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!act || !App.E) return;
      const { fx, fy } = frac(e);
      if (act.kind === 'draw') {
        const p = WP.viewToFrame(App.E.d.zoom, fx, fy);
        const pt = [Math.max(0, Math.min(1, p.x)), Math.max(0, Math.min(1, p.y))];
        if (App.E.drawDraft.type === 'free') App.E.drawDraft.pts.push(pt); else App.E.drawDraft.pts[1] = pt;
      } else if (act.kind === 'pan') {
        App.E.d.zoom = WP.panZoom(act.z, (e.clientX - act.x) / act.r.width, (e.clientY - act.y) / act.r.height);
      }
    });
    const end = (e) => {
      if (!act || !App.E) { act = null; return; }
      const a = act;
      act = null;
      if (a.kind === 'draw') {
        const moved = Math.hypot(e.clientX - a.x, e.clientY - a.y) > 6;
        const shape = App.E.drawDraft;
        App.E.drawDraft = null;
        if (moved && shape) {
          try {
            if (App.E.mode === 'record') { WP.addRecShape(App.E.rec, recT(), shape); App.renderRecPanel(); }
            else commit({ freeze: WP.addShape(App.E.d.freeze, shape) });
          } catch (err) { toast(err.message, { err: true }); }
        }
      } else if (a.kind === 'pan' && App.E.mode !== 'record') commit({ zoom: App.E.d.zoom }, true);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      if (!App.E || edBusy() || App.E.mode === 'draw' || App.E.mode === 'countdown') return;
      if (WP.hasRec(App.E.d) && App.E.mode !== 'record') return;
      e.preventDefault();
      const { fx, fy } = frac(e);
      const z = WP.zoomAt(App.E.d.zoom || WP.FIT, e.deltaY < 0 ? 1.15 : 1 / 1.15, fx, fy);
      App.E.d.zoom = WP.isZoomed(z) ? z : null;
      clearTimeout(cv.t);
      if (App.E.mode !== 'record') cv.t = setTimeout(() => commit({ zoom: App.E.d.zoom }), 250);
      $('ez-level').textContent = (App.E.d.zoom ? Math.round(App.E.d.zoom.scale * 10) / 10 : 1) + '×';
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      if (!App.E || edBusy() || App.E.mode === 'draw' || App.E.mode === 'countdown') return;
      const { fx, fy } = frac(e);
      setEdZoom(App.E.d.zoom ? null : WP.zoomAt(WP.FIT, 2.5, fx, fy));
    });
  })();
  function setEdZoom(z) {
    const v = z && WP.isZoomed(z) ? z : null;
    if (App.E.mode === 'record') { App.E.d.zoom = v; $('ez-level').textContent = (v ? Math.round(v.scale * 10) / 10 : 1) + '\u00d7'; }
    else if (WP.hasRec(App.E.d)) toast('This clip uses its recorded zoom moves. Delete the recording to set a fixed zoom.');
    else commit({ zoom: v });
  }
  $('ez-in').addEventListener('click', () => setEdZoom(WP.zoomAt(App.E.d.zoom || WP.FIT, 1.25)));
  $('ez-out').addEventListener('click', () => setEdZoom(WP.zoomAt(App.E.d.zoom || WP.FIT, 1 / 1.25)));
  $('ez-fit').addEventListener('click', () => setEdZoom(null));

  // ---- details ----
  $('e-cat').addEventListener('change', (e) => commit({ categoryId: e.target.value }));
  $('e-players').addEventListener('change', (e) => commit({ players: e.target.value.split(/[ ,]+/) }));
  $('e-note').addEventListener('change', (e) => commit({ note: e.target.value }));
  for (const b of $('e-flag').children) b.addEventListener('click', () => commit({ flag: b.dataset.flag }));
  $('e-title-on').addEventListener('change', (e) => commit({ titleBar: e.target.checked }));
  $('e-delete').addEventListener('click', async () => {
    if (!(await askYes('Delete this clip?', 'You can undo this for a few seconds afterwards.', 'Delete clip'))) return;
    const id = App.E.clipId;
    const gid = App.G.id;
    closeEditor();
    location.hash = 'tag/' + gid;
    setTimeout(() => removeClip(id), 0);
  });

  // ---- editor: tags ----
  function renderEditorTags() {
    if (!App.E || !App.G) return;
    const d = App.E.d;
    const auto = WP.clipAuto(App.G, d);
    const shown = WP.clipEvents(App.G, d);
    $('e-events').replaceChildren(...WP.EVENTS.map((ev) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(shown.includes(ev.id)),
      title: auto.events.includes(ev.id) ? 'From your goal marks' : null,
      onclick: () => commit(WP.toggleEvent(App.G, App.E.d, ev.id))
    }, auto.events.includes(ev.id) ? el('span', { class: 'autodot' }) : '', ev.label)));
    $('e-zone').value = d.zone || '';
    $('e-sit').value = d.situation || 'even';
    $('e-tags').replaceChildren(...(d.tags || []).map((t) => el('button', { type: 'button', class: 'chip', 'aria-label': 'Remove tag ' + t, onclick: () => commit({ tags: d.tags.filter((x) => x !== t) }) }, t + ' ✕')));
    $('dl-tags').replaceChildren(...allTags().map((t) => el('option', { value: t })));
    $('e-star').setAttribute('aria-pressed', String(!!d.starred));
    $('e-star').textContent = d.starred ? '★ Starred' : '☆ Star';
    $('e-private').checked = !!d.private;
    const al = autoLine(App.G, d);
    $('e-auto').textContent = al ? 'Automatic: ' + al + '. From your period and goal marks.' : 'Mark periods and goals on the game screen and the period and score fill in here.';
    App.renderDests();
  }

  function allTags() {
    const set = new Set();
    for (const g of S.games) for (const c of g.clips) for (const t of c.tags || []) set.add(t);
    for (const k of ['team', 'priv']) for (const e of Object.values(S.lib[k].entries)) for (const t of e.tags || []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  $('e-zone').addEventListener('change', (e) => commit({ zone: e.target.value }));
  $('e-sit').addEventListener('change', (e) => commit({ situation: e.target.value }));
  $('e-star').addEventListener('click', () => commit({ starred: !App.E.d.starred }));
  $('e-private').addEventListener('change', (e) => {
    const goingPrivate = e.target.checked;
    if (goingPrivate && (App.E.d.drive || []).some((x) => x.folder !== 'private')) toast('This clip is already in team Drive folders. Making it private removes it from the team library; delete the team copies in Drive if you don’t want them there.', { ms: 9000 });
    commit({ private: goingPrivate });
  });
  $('e-tag-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('e-tag-new').value.trim();
    if (!v) return;
    $('e-tag-new').value = '';
    commit({ tags: (App.E.d.tags || []).concat([v]) });
  });
  Object.assign(App, {
    allTags, clone, closeEditor, commit, edBusy, edClip, edRecording, edSeek, exitDraw, openEditor,
    recT, renderEditor, setEdZoom, showStage, startPreview, stopPreview, undoShape
  });
}).catch((e) => setTimeout(() => { throw e; }));
