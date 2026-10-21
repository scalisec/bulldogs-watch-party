/* Bulldogs Watch Party — Clip editor: record a breakdown (zoom moves, live drawing, voice-over). */
App.ready.then(() => {
  'use strict';
  const {
    $, askYes, clone, commit, edBusy, edClip, edRecording, el, exitDraw, idb, recT, renderEditor,
    showStage, startPreview, stopPreview, toast
  } = App;

  // ---- record a breakdown (milestone 2b) ----
  function renderRecPanel() {
    if (!App.E) return;
    const d = App.E.d;
    const box = $('e-rec');
    $('e-rec-sum').textContent = WP.hasRec(d) ? WP.recSummary(d.rec) : '';
    if (App.E.mode === 'record' || App.E.mode === 'countdown') {
      const tool = (id, label) => el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(App.E.recDraw && App.E.tool === id), onclick: () => { App.E.tool = id; App.E.recDraw = true; renderRecPanel(); } }, label);
      const sw = (name, hex) => el('button', { type: 'button', class: 'swatch', 'aria-label': name, 'aria-pressed': String(App.E.color === hex), style: 'background:' + hex, onclick: () => { App.E.color = hex; App.E.recDraw = true; renderRecPanel(); } });
      box.replaceChildren(
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small tool', 'aria-pressed': String(!App.E.recDraw), onclick: () => { App.E.recDraw = false; renderRecPanel(); } }, 'Move / zoom'),
          tool('arrow', 'Arrow'), tool('circle', 'Circle'), tool('free', 'Freehand'),
          sw('Yellow', WP.COLORS.yellow), sw('White', WP.COLORS.white), sw('Red', WP.COLORS.red),
          el('button', { type: 'button', class: 'btn small', onclick: () => App.E.rec && WP.addRecClear(App.E.rec, recT()) }, 'Clear drawings'),
          el('button', { type: 'button', class: 'btn small danger', id: 'e-rec-stop', onclick: () => stopRecording() }, '\u25A0 Stop')),
        el('span', { class: 'small muted' }, 'Scroll to zoom, drag to move. Press D to switch between moving and drawing, C to clear drawings, Esc to stop. Drawings fade after 3 s.' + (App.E.rec ? ' ' + (App.E.rec.shapes.length) + ' drawings so far.' : ''))
      );
      return;
    }
    const voiceCb = el('input', { type: 'checkbox', id: 'e-rec-voice', style: 'width:20px;height:20px;flex:none' });
    const halfCb = el('input', { type: 'checkbox', id: 'e-rec-half', style: 'width:20px;height:20px;flex:none' });
    voiceCb.checked = App.E.recOpts ? App.E.recOpts.voice : true;
    halfCb.checked = App.E.recOpts ? App.E.recOpts.half : true;
    const opts = el('div', { class: 'row', style: 'gap:16px' },
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px' }, voiceCb, 'Voice-over (uses the microphone)'),
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px' }, halfCb, 'Record at half speed'));
    const startBtn = el('button', { type: 'button', class: 'btn primary', id: 'e-rec-start', disabled: edBusy() || App.E.mode === 'preview', onclick: () => startRecording({ voice: voiceCb.checked, half: halfCb.checked }) },
      WP.hasRec(d) ? '\u25CF Record again' : '\u25CF Record breakdown');
    const rule = el('span', { class: 'small muted' }, 'The clip plays from its start while you zoom, drag and draw' + ' \u2014 and talk, with voice-over on. With voice, the finished video plays at the speed you recorded so your words stay in sync; without voice it plays at normal speed.');
    if (WP.hasRec(d)) {
      box.replaceChildren(
        el('span', { class: 'small' }, 'The export uses this recording. Slow-motion sections, freeze and the fixed zoom aren\u2019t used while it exists.'),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn small', onclick: () => startPreview() }, '\u25B6 Play recording'),
          el('button', { type: 'button', class: 'btn small danger', onclick: async () => { if (!(await askYes('Delete this recording?', 'The zoom moves, drawings and voice-over you recorded are removed. Your freeze and slow-motion settings come back.', 'Delete recording'))) return; idb.del('voice:' + d.id); commit({ rec: null }); } }, 'Delete recording')),
        opts, startBtn);
    } else box.replaceChildren(rule, opts, startBtn);
  }

  async function startRecording(opts) {
    if (!App.E || edBusy() || edRecording()) return;
    stopPreview();
    exitDraw(true);
    App.E.recOpts = opts;
    const d = App.E.d;
    let stream = null;
    if (opts.voice) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('This browser can\u2019t record sound. Use Chrome or Edge.', { err: true }); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
      catch (e) { toast('Microphone not available: ' + (e.name === 'NotAllowedError' ? 'permission was refused' : e.message), { err: true }); return; }
    }
    App.E.mode = 'countdown';
    App.E.recStarted = false;
    App.E.rec = WP.newRecording(opts.half ? 0.5 : 1, opts.voice);
    App.E.recDraw = false;
    App.E.recStream = stream;
    App.E.d.zoom = null;
    renderEditor();
    showStage();
    App.E.player.pause();
    App.E.player.setRate(App.E.rec.rate);
    await App.E.player.seek(d.start);
    const cd = $('e-count');
    cd.classList.remove('hidden');
    for (const n of ['3', '2', '1']) {
      if (!App.E || App.E.mode !== 'countdown') { cd.classList.add('hidden'); return; }
      cd.textContent = n;
      await new Promise((r) => setTimeout(r, 700));
    }
    cd.classList.add('hidden');
    if (!App.E || App.E.mode !== 'countdown') return;
    App.E.recChunks = [];
    if (stream) {
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      App.E.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      App.E.recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) App.E.recChunks.push(ev.data); };
      App.E.recorder.start(250);
    }
    WP.addRecKey(App.E.rec, 0, null, true);
    App.E.mode = 'record';
    renderEditor();
    App.E.player.resume();
    setTimeout(() => { if (App.E) App.E.recStarted = true; }, 400);
  }

  async function stopRecording() {
    if (!App.E || !edRecording() || App.E.stopping) return;
    if (App.E.mode === 'countdown') {
      App.E.mode = 'idle';
      if (App.E.recStream) App.E.recStream.getTracks().forEach((t) => t.stop());
      App.E.recStream = null;
      App.E.rec = null;
      App.E.player.setRate(1);
      App.E.d = clone(edClip());
      renderEditor();
      return;
    }
    App.E.stopping = true;
    const rec = App.E.rec;
    const atEnd = App.E.player.time() >= App.E.d.end - 0.1;
    rec.duration = atEnd ? Math.round(((App.E.d.end - App.E.d.start) / rec.rate) * 100) / 100 : Math.round(recT() * 100) / 100;
    WP.addRecKey(rec, rec.duration, App.E.d.zoom, true);
    App.E.player.pause();
    let blob = null;
    if (App.E.recorder) {
      const r = App.E.recorder;
      await new Promise((res) => { r.onstop = res; try { r.stop(); } catch (e) { res(); } });
      blob = new Blob(App.E.recChunks, { type: r.mimeType || 'audio/webm' });
      App.E.recorder = null;
    }
    if (App.E.recStream) { App.E.recStream.getTracks().forEach((t) => t.stop()); App.E.recStream = null; }
    App.E.mode = 'idle';
    App.E.stopping = false;
    App.E.player.setRate(1);
    const clipId = App.E.d.id;
    App.E.rec = null;
    if (rec.duration < 1) { toast('Recording too short \u2014 nothing saved', { err: true }); renderEditor(); return; }
    if (rec.voice) {
      if (!blob || !blob.size) { toast('No sound was recorded \u2014 check the microphone', { err: true }); renderEditor(); return; }
      await idb.put('voice:' + clipId, blob);
    }
    commit({ rec });
    toast(WP.recSummary(rec) + '. Press Play recording to watch it.', { ms: 6000 });
    App.E.player.seek(App.E.d.start);
  }
  Object.assign(App, {
    renderRecPanel, stopRecording
  });
}).catch((e) => setTimeout(() => { throw e; }));
