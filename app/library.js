/* Bulldogs Watch Party — Clip library in Drive: the shared team library and the private library, kept in sync. */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, S, renderTeamCard, sameJ, save, saveQuiet, toast
  } = App;

  // =====================================================================
  // CLIP LIBRARY IN DRIVE (team: _App; private: the coach's own folder)
  // =====================================================================
  const LIB = { busy: false, again: false, err: null };
  const TEAM_LIB_NAME = 'Watch Party clip library.json';
  let libTimer = 0;

  function libChanged() {
    clearTimeout(libTimer);
    if (!WPDrive.hasToken() || (!S.lib.teamSync && !S.lib.privSync)) return;
    libTimer = setTimeout(() => libSyncAll(false), 2500);
  }

  function myLibrary(kind) {
    return WP.buildMyLibrary(S.lib[kind], S.games, S.settings.categories, S.settings.coachName, kind === 'priv', S.lib.deleted, S.settings.roster);
  }

  /** Admin account only: create the Team, Coaches only and one family folder per player, side by side in the team folder. */
  async function ensureTeamFolders() {
    if (!S.sync || !S.sync.owner || !S.sync.folderId) return 0;
    const folders = S.lib.team.folders || (S.lib.team.folders = {});
    let made = 0;
    for (const key of WP.teamFolderKeys(S.settings.roster)) {
      if (folders[key]) continue;
      folders[key] = (await WPDrive.createFolder(WP.folderName(key, S.settings.roster), S.sync.folderId)).id;
      made += 1;
    }
    if (folders.root !== S.sync.folderId) { folders.root = S.sync.folderId; made += 1; }
    if (made) { DB.touch('lib:team'); save(); }
    return made;
  }

  // which team folders this Google account's app can save into (coaches connect them by picking)
  const folderAccess = new Map(); // folderId -> Promise<boolean>
  function folderAccessReset() { folderAccess.clear(); }
  function hasFolderAccess(id) {
    if (!folderAccess.has(id)) {
      folderAccess.set(id, WPDrive.getMeta(id).then((m) => !m.trashed, (e) => {
        folderAccess.delete(id);
        if (e.code === 404 || e.code === 403) return false;
        throw e;
      }));
    }
    return folderAccess.get(id);
  }
  async function folderStatus() {
    const folders = S.lib.team.folders || {};
    const ids = WP.teamFolderKeys(S.settings.roster).map((k) => folders[k]).filter(Boolean);
    let ok = 0;
    for (const id of ids) if (await hasFolderAccess(id)) ok += 1;
    return { ok, total: ids.length };
  }

  async function ensureTeamLibrary() {
    if (S.lib.teamSync || !S.sync) return;
    const found = await WPDrive.findByName(TEAM_LIB_NAME, null, S.sync.appFolderId);
    if (found.length) {
      S.lib.teamSync = { fileId: found[0].id, version: null, base: null };
    } else if (S.sync.owner) {
      const lib = myLibrary('team');
      lib.folders = Object.assign({}, lib.folders, { root: S.sync.folderId });
      const f = await WPDrive.createFile(TEAM_LIB_NAME, S.sync.appFolderId, WP.libraryFileText(lib, 'team', S.sync.account));
      S.lib.team = WP.normalizeLibrary(lib);
      S.lib.teamSync = { fileId: f.id, version: f.version, base: WP.normalizeLibrary(lib) };
    }
    save();
  }

  // one at a time: two callers at once (a sync and an export) must not each create a private folder
  let privP = null;
  function ensurePrivateLibrary() {
    if (!privP) privP = makePrivateLibrary().finally(() => { privP = null; });
    return privP;
  }

  async function makePrivateLibrary() {
    if (S.lib.privSync) return;
    const { privFolder: PRIV_FOLDER_NAME, privLib: PRIV_LIB_NAME } = App.driveNames();
    const found = await WPDrive.findByName(PRIV_LIB_NAME);
    if (found.length) {
      S.lib.privSync = { fileId: found[0].id, folderId: (found[0].parents || [])[0] || null, version: null, base: null };
    } else {
      const folders = await WPDrive.findByName(PRIV_FOLDER_NAME, WPDrive.FOLDER);
      const folderId = folders.length ? folders[0].id : (await WPDrive.createFolder(PRIV_FOLDER_NAME)).id;
      const lib = myLibrary('priv');
      const f = await WPDrive.createFile(PRIV_LIB_NAME, folderId, WP.libraryFileText(lib, 'private', ''));
      S.lib.priv = WP.normalizeLibrary(lib);
      S.lib.privSync = { fileId: f.id, folderId, version: f.version, base: WP.normalizeLibrary(lib) };
    }
    save();
  }

  /** Other coaches' tag edits (made in Review) to my clips come back into my clips. */
  function pullTagEdits(kind, base, theirs) {
    if (!base) return;
    for (const g of S.games) {
      let changed = false;
      const next = g.clips.map((c) => {
        if (!!c.private !== (kind === 'priv')) return c;
        const te = theirs.entries[c.id];
        const be = base.entries[c.id];
        const out = te && be && !sameJ(te, be) ? WP.applyEntryTags(c, te, be) : c;
        if (out !== c) changed = true;
        return out;
      });
      if (changed) g.clips = next;
    }
  }

  async function libSync(kind) {
    const cfg = kind === 'team' ? S.lib.teamSync : S.lib.privSync;
    if (!cfg || !cfg.fileId) return;
    const fileKind = kind === 'team' ? 'team' : 'private';
    const step = await WPDrive.syncJson(cfg, {
      label: 'The clip library',
      parse: (text) => WP.parseLibraryFile(text, fileKind),
      onTheirs: (theirs) => pullTagEdits(kind, cfg.base, theirs),
      mine: () => myLibrary(kind),
      merge: (x) => WP.syncLibraryStep(Object.assign(x, { dirty: true })),
      apply: (data) => { S.lib[kind] = WP.normalizeLibrary(data); },
      text: () => WP.libraryFileText(S.lib[kind], fileKind, S.sync && S.sync.account),
      normalize: WP.normalizeLibrary
    });
    if (step.conflicts.length) toast('Clip library: another coach changed the same thing at the same time (' + step.conflicts.slice(0, 3).join(', ') + '). Their version was kept.', { err: true, ms: 10000 });
  }

  async function libSyncAll(interactive) {
    if (!WPDrive.hasToken()) return;
    if (LIB.busy) { LIB.again = true; return; }
    LIB.busy = true;
    try {
      await ensureTeamFolders();
      await ensureTeamLibrary();
      await ensurePrivateLibrary();
      if (S.lib.teamSync) await libSync('team');
      await libSync('priv');
      const keep = new Set([...Object.keys(S.lib.team.entries), ...Object.keys(S.lib.priv.entries)]);
      S.lib.deleted = S.lib.deleted.filter((id) => keep.has(id));
      LIB.err = null;
      saveQuiet();
    } catch (e) {
      LIB.err = e.message;
      if (interactive || e.code !== 0) toast('Clip library: ' + e.message, { err: true, ms: 7000 });
    } finally {
      LIB.busy = false;
      if (!$('view-review').classList.contains('hidden')) App.renderReview();
      if (!$('view-settings').classList.contains('hidden')) renderTeamCard();
      if (!$('view-team').classList.contains('hidden')) App.renderTeam();
      if (LIB.again) { LIB.again = false; libSyncAll(false); }
    }
  }
  Object.assign(App, {
    LIB, ensurePrivateLibrary, ensureTeamFolders, ensureTeamLibrary, folderAccessReset, folderStatus, hasFolderAccess,
    libChanged, libSyncAll, myLibrary
  });
}).catch((e) => setTimeout(() => { throw e; }));
