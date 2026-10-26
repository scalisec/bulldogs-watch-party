/* Bulldogs Watch Party — Clip editor: export to MP4 and save to this computer or Drive folders. */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, S, catById, commit, edBusy, edRecording, edSeek, el, exitDraw, idb, recT, renderEditor,
    renderRecPanel, save, setEdZoom, startPreview, stopPreview, stopRecording, toast, undoShape
  } = App;

  // ---- export ----
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportCurrent() {
    if (!App.E || edBusy() || edRecording()) return;
    stopPreview();
    exitDraw(true);
    const d = App.E.d;
    const cat = catById(d.categoryId);
    const name = WP.exportFileName(d, cat, App.G);
    if (wantsDrive(d) && (S.sync || d.private)) {
      try { await ensureDriveSession(true); } catch (e) { toast('Sign in to Google to save to Drive: ' + e.message, { err: true, ms: 8000 }); return; }
    }
    const dests = chosenDests(d);
    if (!destPick.local && !dests.length) { toast('Choose where to save the MP4 (this computer or a Drive folder)', { err: true }); return; }
    let handle = null;
    if (destPick.local && window.showSaveFilePicker && !navigator.webdriver) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (e) {
        if (e.name === 'AbortError') return;
        handle = null;
      }
    }
    App.E.ctrl = new AbortController();
    App.E.mode = 'export';
    $('e-exporting').classList.remove('hidden');
    renderEditor();
    const setPct = (p) => { $('e-pct').textContent = Math.round(p * 100) + '%'; $('e-bar').style.width = (p * 100) + '%'; };
    setPct(0);
    try {
      const rec = WP.hasRec(d) ? d.rec : null;
      let voiceBlob = null;
      if (rec && rec.voice) {
        voiceBlob = await idb.get('voice:' + d.id);
        if (!voiceBlob) throw new Error('the voice-over for this clip isn\u2019t on this computer. Record it again.');
      }
      const res = await WPRender.exportClip({
        player: App.E.player, video: $('e-video'), plan: WP.buildPlan(d), W: App.E.W, H: App.E.H,
        zoom: d.zoom, shapes: d.freeze ? d.freeze.shapes : [], title: d.titleBar !== false ? WP.titleLines(d, cat, App.G) : null,
        frameAt: rec ? (outT) => ({ zoom: WP.recZoomAt(rec, outT), shapes: WP.recShapesAt(rec, outT) }) : null,
        voiceBlob,
        signal: App.E.ctrl.signal, onProgress: setPct
      });
      const finalName = handle ? handle.name : name;
      if (handle) {
        const w = await handle.createWritable();
        await w.write(res.blob);
        await w.close();
      } else if (destPick.local) downloadBlob(name, res.blob);
      if (dests.length) await sendToDrive(d, res.blob, name, dests);
      window.__bwp.lastExport = { dests, name: finalName, size: res.blob.size, codec: res.codec, h264: res.h264, audio: res.audio, frames: res.frames, duration: res.duration, blob: res.blob };
      App.E.mode = 'idle';
      commit({ exported: { at: Date.now(), name: finalName, size: res.blob.size, codec: res.codec } });
      const mb = (res.blob.size / 1e6).toFixed(1);
      if (destPick.local) toast('Saved “' + finalName + '” (' + mb + ' MB)' + (res.h264 ? '' : ' — this browser made VP9 video, which may not play on iPhones. Use Chrome or Edge on Windows for H.264.'), { ms: 8000 });
    } catch (e) {
      if (e.name === 'AbortError') toast('Export cancelled');
      else toast('Export failed: ' + e.message, { err: true, ms: 8000 });
    } finally {
      if (App.E) {
        App.E.mode = 'idle';
        App.E.ctrl = null;
        $('e-exporting').classList.add('hidden');
        renderEditor();
        App.E.player.seek(App.E.d.start);
      }
    }
  }
  $('e-export').addEventListener('click', exportCurrent);
  $('e-cancel').addEventListener('click', () => App.E && App.E.ctrl && App.E.ctrl.abort());

  function editorKey(e) {
    if (!App.E || edBusy()) return;
    if (edRecording()) {
      const tg = (e.target.tagName || '').toLowerCase();
      if (tg === 'input' || tg === 'select' || tg === 'textarea') return;
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); stopRecording(); }
      else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); App.E.recDraw = !App.E.recDraw; renderRecPanel(); }
      else if ((e.key === 'c' || e.key === 'C') && App.E.rec) { e.preventDefault(); WP.addRecClear(App.E.rec, recT()); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setEdZoom(WP.zoomAt(App.E.d.zoom || WP.FIT, 1.25)); }
      else if (e.key === '-') { e.preventDefault(); setEdZoom(WP.zoomAt(App.E.d.zoom || WP.FIT, 1 / 1.25)); }
      else if (e.key === '0') { e.preventDefault(); setEdZoom(null); }
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && App.E.mode === 'draw') { e.preventDefault(); undoShape(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (App.E.mode === 'preview') stopPreview(); else startPreview(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); edSeek(App.E.player.time() - 1); }
    else if (k === 'ArrowRight') { e.preventDefault(); edSeek(App.E.player.time() + 1); }
    else if (k === ',') { e.preventDefault(); edSeek(App.E.player.time() - 1 / 30); }
    else if (k === '.') { e.preventDefault(); edSeek(App.E.player.time() + 1 / 30); }
    else if (k === 'Escape') { exitDraw(); }
  }

  // ---- editor: where the export goes ----
  // where exports go: remembered on this device
  const DEST_KEY = App.teamKey('bwp-dest-pick');
  const destPick = Object.assign({ local: true, team: false, coaches: false, players: false, private: false }, (() => { try { return JSON.parse(localStorage.getItem(DEST_KEY) || '{}'); } catch (e) { return {}; } })());
  function saveDestPick() { try { localStorage.setItem(DEST_KEY, JSON.stringify(destPick)); } catch (e) { /* ignore */ } }

  function driveReady(priv) {
    if (!WPDrive.configured() || !WPDrive.webOrigin()) return 'Saving to Google Drive works on the web version once you sign in (Settings).';
    if (!WPDrive.hasToken() && !S.sync && !S.lib.privSync) return 'Sign in with Google in Settings to also save clips to Drive.';
    if (!priv && !S.sync) return 'Set up team data in Settings to save to the team’s Drive folders.';
    return null;
  }

  function renderDests() {
    if (!App.E) return;
    const d = App.E.d;
    const box = $('e-dests');
    const cb = (key, text, disabled) => {
      const i = el('input', { type: 'checkbox', style: 'width:18px;height:18px;flex:none', disabled: !!disabled, onchange: (e) => { destPick[key] = e.target.checked; saveDestPick(); } });
      i.checked = !!destPick[key] && !disabled;
      return el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px' }, i, text);
    };
    const why = driveReady(d.private);
    const rows = [el('span', { style: 'font-weight:600;font-size:13px' }, 'Save the MP4 to'), cb('local', 'This computer')];
    if (d.private) rows.push(cb('private', '🔒 My private Drive folder', !!why));
    else {
      rows.push(cb('team', 'Drive: Team (players and families)', !!why));
      rows.push(cb('coaches', 'Drive: Coaches only', !!why));
      const fam = d.players.length ? 'Drive: family folder of ' + d.players.map((p) => '#' + p).join(', ') : 'Drive: family folders (tag players first)';
      rows.push(cb('players', fam, !!why || !d.players.length));
    }
    if (why) rows.push(el('span', { class: 'small muted' }, why));
    else if (!WPDrive.hasToken() && wantsDrive(d)) rows.push(el('span', { class: 'small muted' }, 'Your Google sign-in has run out \u2014 you\u2019ll be asked to sign in again when you export.'));
    if ((d.drive || []).length) rows.push(el('span', { class: 'small muted' }, 'In Drive: ' + d.drive.map((x) => WP.destLabel(x.folder, S.settings.roster)).join(', ')));
    const failed = failedUploads.get(d.id);
    if (failed) rows.push(el('div', { class: 'row', style: 'gap:8px' }, el('span', { class: 'small', style: 'color:var(--work)' }, 'Upload to ' + failed.dests.map((x) => WP.destLabel(x, S.settings.roster)).join(', ') + ' didn\u2019t finish.'),
      el('button', { type: 'button', class: 'btn small primary', id: 'e-retry-upload', disabled: edBusy(), onclick: () => retryUpload(d.id) }, 'Retry upload')));
    box.replaceChildren(...rows);
  }

  function chosenDests(d) {
    if (driveReady(d.private)) return [];
    if (d.private) return destPick.private ? ['private'] : [];
    const out = [];
    if (destPick.team) out.push('team');
    if (destPick.coaches) out.push('coaches');
    if (destPick.players) for (const p of d.players) out.push('player:' + p);
    return out;
  }

  async function ensureDestFolder(dest) {
    if (dest === 'private') { await App.ensurePrivateLibrary(); return S.lib.privSync.folderId; }
    // the admin account creates every team folder up front; coaches save into them once connected
    if (!(S.lib.team.folders || {})[dest] && S.sync && S.sync.owner) await App.ensureTeamFolders();
    const id = (S.lib.team.folders || {})[dest];
    const label = WP.destLabel(dest, S.settings.roster);
    if (!id) throw new Error('the ' + label + ' folder isn\u2019t set up yet. The admin account creates it the next time it opens the app.');
    if (S.sync && !S.sync.owner && !(await App.hasFolderAccess(id))) {
      const e = new Error('this account isn\u2019t connected to the ' + label + ' folder yet');
      e.needsConnect = true;
      throw e;
    }
    return id;
  }

  /** Upload once, then let Google copy it into the other folders (no second upload).
      On failure the error carries .partial = { list, done } so finished folders aren't forgotten. */
  async function uploadToDrive(d, blob, name, dests, onStep) {
    const cat = catById(d.categoryId);
    const auto = WP.clipAuto(App.G, d);
    const desc = [cat ? cat.name : 'Clip', WP.gameTitle(App.G), auto.period ? WP.periodName(auto.period) : ''].filter(Boolean).join(' · ') + ' — ' + S.settings.team.name + ' · Watch Party';
    let list = (d.drive || []).slice();
    const done = [];
    let firstId = null;
    try {
      for (const dest of dests) {
        if (onStep) onStep(dest, null);
        const folderId = await ensureDestFolder(dest);
        let f = null;
        if (firstId) { try { f = await WPDrive.copyFile(firstId, name, folderId, desc); } catch (e) { if (e.code === 401 || e.code === 0) throw e; f = null; } }
        if (!f) f = await WPDrive.uploadBlob(name, folderId, blob, desc, (p) => onStep && onStep(dest, p));
        if (!firstId) firstId = f.id;
        list = list.filter((x) => x.folder !== dest).concat([{ folder: dest, fileId: f.id, name: f.name || name, at: Date.now() }]);
        done.push(dest);
      }
    } catch (e) {
      e.partial = { list, done };
      throw e;
    }
    return { list, done };
  }

  // finished videos whose Drive upload failed, kept (this session) so they can be retried without exporting again
  const failedUploads = new Map(); // clipId -> { blob, name, dests }

  async function retryUpload(clipId) {
    const f = failedUploads.get(clipId);
    if (!f || !App.E || App.E.clipId !== clipId || edBusy()) return;
    try { await ensureDriveSession(true); } catch (e) { toast(e.message, { err: true }); return; }
    App.E.mode = 'export';
    renderEditor();
    $('e-exporting').classList.remove('hidden');
    try { await sendToDrive(App.E.d, f.blob, f.name, f.dests); } finally {
      if (App.E) { App.E.mode = 'idle'; $('e-exporting').classList.add('hidden'); renderEditor(); }
    }
  }

  async function sendToDrive(d, blob, name, dests) {
    const setUp = (dest, p) => {
      $('e-pct').textContent = 'uploading to ' + WP.destLabel(dest, S.settings.roster) + (p != null ? ' ' + Math.round(p * 100) + '%' : '') + '\u2026';
      if (p != null) $('e-bar').style.width = (p * 100) + '%';
    };
    try {
      const up = await uploadToDrive(d, blob, name, dests, setUp);
      failedUploads.delete(d.id);
      commit({ drive: up.list }, true);
      toast('Saved to Drive: ' + up.done.map((x) => WP.destLabel(x, S.settings.roster)).join(', '), { ms: 7000 });
      return true;
    } catch (err) {
      const left = err.partial ? dests.filter((x) => !err.partial.done.includes(x)) : dests;
      if (err.partial && err.partial.done.length) commit({ drive: err.partial.list }, true);
      failedUploads.set(d.id, { blob, name, dests: left });
      if (err.needsConnect || (err.code === 404 && S.sync && !S.sync.owner)) {
        App.folderAccessReset();
        toast('Not saved to Drive: ' + err.message + '. Connect the team folders, then use \u201cRetry upload\u201d.', { err: true, ms: 15000, action: { label: 'Connect team folders', fn: () => App.connectTeamFolders() } });
      } else toast('Drive upload failed: ' + err.message + '. The video is kept \u2014 use \u201cRetry upload\u201d.', { err: true, ms: 12000 });
      return false;
    }
  }

  /** Make sure the Google sign-in is good for the next few minutes. Call it straight from a click. */
  async function ensureDriveSession(needed) {
    if (!needed || !WPDrive.configured() || !WPDrive.webOrigin()) return;
    if (WPDrive.expiresIn() > 600) return;
    const hint = (S.sync && S.sync.account) || App.Team.account || undefined;
    await WPDrive.signIn(hint, WPDrive.expiresIn() > 0 || !!hint);
    App.renderSyncBadge();
  }

  function wantsDrive(d) { return d.private ? destPick.private : (destPick.team || destPick.coaches || (destPick.players && d.players.length > 0)); }
  Object.assign(App, {
    editorKey, renderDests
  });
}).catch((e) => setTimeout(() => { throw e; }));
