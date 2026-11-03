/* Bulldogs Watch Party — Clip editor: export to MP4 and save to this computer or Drive folders. */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, S, catById, commit, edBusy, edRecording, edSeek, el, exitDraw, idb, recT, renderEditor,
    renderRecPanel, save, session, setEdZoom, startPreview, stopPreview, stopRecording, toast, undoShape
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

  async function exportCurrent(opts) {
    const batch = !!(opts && opts.batch === true);
    if (!App.E || edBusy() || edRecording()) return false;
    stopPreview();
    exitDraw(true);
    const d = App.E.d;
    const cat = WP.clipCategoryLabel(d, S.settings.categories);
    const name = WP.exportFileName(d, cat, App.G);
    let queueOnly = false; // offline: make the MP4 now, upload it to Drive later
    if (wantsDrive(d) && (S.sync || d.private)) {
      if (isOffline()) queueOnly = true;
      else {
        try { await ensureDriveSession(true); } catch (e) {
          if (netErr(e)) queueOnly = true;
          else { toast('Sign in to Google to save to Drive: ' + e.message, { err: true, ms: 8000 }); return false; }
        }
      }
    }
    const dests = chosenDests(d);
    if (!destPick.local && !dests.length) { toast('Choose where to save the MP4 (this computer or a Drive folder)', { err: true }); return false; }
    let handle = null;
    let ok = false;
    if (destPick.local && window.showSaveFilePicker && !navigator.webdriver && !batch) {
      try {
        handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      } catch (e) {
        if (e.name === 'AbortError') return false;
        handle = null;
      }
    }
    App.E.ctrl = new AbortController();
    App.E.mode = 'export';
    const t0 = performance.now();
    if (App.diag) App.diag.log('export-start', { len: Math.round(d.end - d.start) });
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
      // the game's own sound, read from the LiveBarn files for just this clip (normal-speed parts only)
      const plan = WP.buildPlan(d);
      let rink = null;
      if (rinkOn()) {
        try { rink = await WPAudio.rinkTrack(plan, App.TL, session.files.get(App.G.id) || []); } catch (e) { rink = null; }
        if (!rink) toast('This video’s sound couldn’t be read, so the clip is exported without rink sound.', { ms: 6000 });
      }
      const res = await WPRender.exportClip({
        player: App.E.player, video: $('e-video'), plan, W: App.E.W, H: App.E.H, rink,
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
      if (dests.length && queueOnly) await queueUpload(App.G, d, res.blob, name, dests, 'offline');
      else if (dests.length) await sendToDrive(d, res.blob, name, dests);
      window.__bwp.lastExport = { dests, name: finalName, size: res.blob.size, codec: res.codec, h264: res.h264, audio: res.audio, frames: res.frames, duration: res.duration, blob: res.blob };
      App.E.mode = 'idle';
      commit({ exported: { at: Date.now(), name: finalName, size: res.blob.size, codec: res.codec } });
      ok = true;
      if (App.diag) App.diag.log('export-done', { ms: Math.round(performance.now() - t0), MB: Math.round(res.blob.size / 1e5) / 10, codec: res.codec });
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
    return ok;
  }
  $('e-export').addEventListener('click', () => exportCurrent());

  /** Export every goal clip of a game in turn (from its summary), using the last "Save to" choices. */
  async function exportGoalClips(game) {
    const ids = WP.gameMarks(game).goals.map((g) => g.clipId).filter((id) => id && game.clips.some((c) => c.id === id));
    if (!ids.length) { toast('This game has no goal clips'); return; }
    if (!session.files.get(game.id)) { toast('Connect this game’s video files first (open Watch and tag).', { err: true }); App.watchAt(game.id, 0); return; }
    if (!destPick.local && !destPick.team && !destPick.coaches && !destPick.players && !destPick.private) { toast('Export one clip first to choose where clips are saved', { err: true }); return; }
    let done = 0;
    for (let i = 0; i < ids.length; i++) {
      location.hash = 'edit/' + game.id + '/' + ids[i];
      const t0 = Date.now();
      while (!(App.E && App.E.clipId === ids[i]) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100));
      if (!(App.E && App.E.clipId === ids[i])) break;
      toast('Exporting goal clip ' + (i + 1) + ' of ' + ids.length + '…', { ms: 3000 });
      if (await exportCurrent({ batch: true })) done += 1; else break;
    }
    location.hash = 'sum/' + game.id;
    toast('Exported ' + done + ' of ' + ids.length + ' goal clips', { ms: 6000, err: done < ids.length });
  }
  App.exportGoalClips = exportGoalClips;
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
  // Include rink sound (on unless turned off; remembered on this device)
  const RINK_KEY = 'bwp-rink-sound';
  const rinkOn = () => { try { return localStorage.getItem(RINK_KEY) !== 'off'; } catch (e) { return true; } };
  $('e-rink').checked = rinkOn();
  $('e-rink').addEventListener('change', (e) => { try { localStorage.setItem(RINK_KEY, e.target.checked ? 'on' : 'off'); } catch (err) { /* private window */ } });
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
      const i = el('input', { type: 'checkbox', style: 'width:18px;height:18px;flex:none', disabled: !!disabled, onchange: (e) => { destPick[key] = e.target.checked; saveDestPick(); renderDests(); } });
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
    else if (isOffline() && wantsDrive(d)) rows.push(el('span', { class: 'small', style: 'color:var(--work)', id: 'e-offline-note' }, 'Offline: the MP4 is made now and kept on this device; it uploads to Drive when you\u2019re back online (you\u2019ll be asked first).'));
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
    const label = WP.destLabel(dest, S.settings.roster);
    let id = (S.lib.team.folders || {})[dest];
    if (S.sync && S.sync.owner && (!id || !(await App.hasFolderAccess(id)))) {
      // never created, or deleted in Drive: ask before creating it (and any others that are missing)
      App.folderAccessReset();
      await App.ensureTeamFolders({ interactive: true, force: true });
      id = (S.lib.team.folders || {})[dest];
      if (id && !(await App.hasFolderAccess(id))) id = null;
      if (!id) throw new Error('the ' + label + ' folder isn\u2019t in Google Drive. Create it from Team \u203a Drive and access.');
    }
    if (!id) throw new Error('the ' + label + ' folder isn\u2019t set up yet. The admin account creates it the next time it opens the app.');
    if (S.sync && !S.sync.owner && !(await App.hasFolderAccess(id))) {
      const e = new Error('this account isn\u2019t connected to the ' + label + ' folder yet');
      e.needsConnect = true;
      throw e;
    }
    return id;
  }

  /**
   * Each game gets its own folder inside a destination (e.g. Team clips › "2026-10-18 vs Raiders").
   * Remembered on the game; on another device the same account finds it by name; otherwise it's made.
   */
  async function gameFolder(parentId, game) {
    const g = game || App.G;
    const name = WP.gameFolderName(g);
    g.driveFolders = g.driveFolders || {};
    const known = g.driveFolders[parentId];
    if (known && known.name === name) return known.id;
    let id = null;
    try { const found = await WPDrive.findByName(name, WPDrive.FOLDER, parentId); id = found.length ? found[0].id : null; } catch (e) { id = null; }
    if (!id) id = (await WPDrive.createFolder(name, parentId)).id;
    g.driveFolders[parentId] = { id, name };
    save();
    return id;
  }

  /** Upload once, then let Google copy it into the other folders (no second upload).
      On failure the error carries .partial = { list, done } so finished folders aren't forgotten. */
  async function uploadToDrive(d, blob, name, dests, onStep, game) {
    const G = game || App.G;
    const cat = WP.clipCategoryLabel(d, S.settings.categories);
    const auto = WP.clipAuto(G, d);
    const desc = [cat ? cat.name : 'Clip', WP.gameTitle(G), auto.period ? WP.periodName(auto.period) : ''].filter(Boolean).join(' · ') + ' — ' + S.settings.team.name + ' · Watch Party';
    let list = (d.drive || []).slice();
    const done = [];
    let firstId = null;
    try {
      for (const dest of dests) {
        if (onStep) onStep(dest, null);
        const folderId = await gameFolder(await ensureDestFolder(dest), G);
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
      if (netErr(err)) { await queueUpload(App.G, d, blob, name, left, 'lost'); return false; }
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

  // =====================================================================
  // UPLOAD LATER (v2.7): clips exported with no internet wait on this device, and the app asks before uploading
  // =====================================================================
  // The MP4s are kept in this browser's storage (IndexedDB 'upq:<clip id>') with a list in 'upq-list', and deleted
  // once uploaded. Nothing is rendered again.
  const UPQ = { items: [], busy: false, asked: false, loaded: false };
  const isOffline = () => navigator.onLine === false;
  const netErr = (e) => !!e && (e.code === 0 || /reach Google|internet connection|no connection/i.test(String(e.raw || e.message || '')));

  function waitingHere() { const ids = new Set(S.games.map((g) => g.id)); return UPQ.items.filter((x) => ids.has(x.gameId)); }
  function uploadWaiting() { return waitingHere().length; }
  function isWaiting(clipId) { return UPQ.items.some((x) => x.clipId === clipId); }

  function queueChanged() {
    if (App.renderSyncBadge) App.renderSyncBadge();
    if (App.renderTeamCard && App.LIB) App.renderTeamCard(); // (not before the clip library module has loaded)
    if (!$('view-review').classList.contains('hidden') && App.renderReview) App.renderReview();
    if (App.E) renderEditor();
  }
  async function saveQueue() { await idb.put('upq-list', UPQ.items); queueChanged(); }
  async function loadQueue() {
    const list = await idb.get('upq-list');
    UPQ.items = Array.isArray(list) ? list : [];
    UPQ.loaded = true;
    queueChanged();
  }

  /** Keep a finished MP4 to upload to these Drive folders later. why: 'offline' (exported offline) or 'lost' (connection dropped mid-upload). */
  async function queueUpload(game, d, blob, name, dests, why) {
    await idb.put('upq:' + d.id, blob);
    UPQ.items = UPQ.items.filter((x) => x.clipId !== d.id).concat([{ clipId: d.id, gameId: game.id, name, dests: dests.slice(), size: blob.size, at: Date.now() }]);
    await saveQueue();
    const where = dests.map((x) => WP.destLabel(x, S.settings.roster)).join(', ');
    toast((why === 'lost' ? 'The connection dropped. ' : 'Offline: ') + 'the clip is saved on this device and waiting to upload to ' + where + '. You\u2019ll be asked when you\u2019re back online.', { ms: 9000 });
  }

  function setClipDrive(game, clipId, list) {
    game.clips = game.clips.map((c) => (c.id === clipId ? Object.assign({}, c, { drive: list }) : c));
    if (App.E && App.E.clipId === clipId) App.E.d.drive = list;
    save();
    if (App.libChanged) App.libChanged();
  }
  async function dropQueued(clipId) {
    UPQ.items = UPQ.items.filter((x) => x.clipId !== clipId);
    await idb.del('upq:' + clipId);
  }

  /** Upload everything waiting (for this team). Must start from a tap: it may need Google's sign-in window. */
  async function uploadQueued() {
    const list = waitingHere();
    if (!list.length || UPQ.busy) return;
    if (isOffline()) { toast('Still offline. The clips upload once there\u2019s internet.', { err: true }); return; }
    try { await ensureDriveSession(true); } catch (e) { toast('Couldn\u2019t sign in to Google: ' + e.message, { err: true, ms: 8000 }); return; }
    UPQ.busy = true;
    queueChanged();
    let done = 0;
    let lastErr = null;
    try {
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const game = S.games.find((g) => g.id === it.gameId);
        const clip = game && game.clips.find((c) => c.id === it.clipId);
        const blob = await idb.get('upq:' + it.clipId);
        if (!game || !clip || !blob) { await dropQueued(it.clipId); continue; } // the clip or game was deleted
        toast('Uploading clip ' + (i + 1) + ' of ' + list.length + '\u2026', { ms: 4000 });
        try {
          const up = await uploadToDrive(clip, blob, it.name, it.dests, null, game);
          setClipDrive(game, clip.id, up.list);
          await dropQueued(it.clipId);
          done += 1;
        } catch (err) {
          lastErr = err;
          if (err.partial && err.partial.done.length) {
            setClipDrive(game, clip.id, err.partial.list);
            it.dests = it.dests.filter((x) => !err.partial.done.includes(x));
          }
          if (netErr(err) || err.code === 401) break; // try the rest next time
        }
      }
    } finally {
      UPQ.busy = false;
      await saveQueue();
    }
    const left = waitingHere().length;
    if (!left) toast('Uploaded ' + done + (done === 1 ? ' clip' : ' clips') + ' to Google Drive', { ms: 7000 });
    else toast('Uploaded ' + done + ' of ' + (done + left) + '. ' + left + ' still waiting' + (lastErr ? ': ' + lastErr.message : '') + '.', { err: true, ms: 10000 });
  }

  /** Back online (or opening the app online) with clips waiting: ask before uploading them. */
  async function askToUpload(force) {
    const n = uploadWaiting();
    if (!n || UPQ.busy || isOffline() || (UPQ.asked && !force) || document.querySelector('dialog[open]') || (App.E && edBusy())) return;
    UPQ.asked = true;
    const mb = Math.round(waitingHere().reduce((s, x) => s + (x.size || 0), 0) / 1e6);
    if (await App.askYes('Upload ' + n + (n === 1 ? ' clip' : ' clips') + ' to Google Drive?', 'You exported ' + (n === 1 ? 'it' : 'them') + ' while offline (about ' + mb + ' MB). ' + (n === 1 ? 'It goes' : 'They go') + ' to the Drive folders you chose, and the copy kept on this device is then deleted.', 'Upload now', false)) uploadQueued();
  }
  window.addEventListener('online', () => { queueChanged(); setTimeout(() => askToUpload(false), 1500); });
  window.addEventListener('offline', queueChanged);
  loadQueue().then(() => setTimeout(() => askToUpload(false), 2500));

  function wantsDrive(d) { return d.private ? destPick.private : (destPick.team || destPick.coaches || (destPick.players && d.players.length > 0)); }
  Object.assign(App, {
    editorKey, renderDests, uploadQueued, uploadWaiting, isWaiting, askToUpload, isOffline
  });
}).catch((e) => setTimeout(() => { throw e; }));
