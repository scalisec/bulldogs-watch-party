/* Bulldogs Watch Party — Shared team data in Google Drive: sign-in, create/open, sync, share with coaches. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, askYes, el, renderClips, renderEditor, renderSettings, renderTags, renderWho, save, toast
  } = App;

  // =====================================================================
  // SHARED TEAM DATA IN GOOGLE DRIVE (milestone 3a)
  // =====================================================================
  const Team = { busy: false, again: false, lastErr: null, account: null };
  let pushTimer = 0;

  function teamChanged() {
    if (S.sync) S.sync.dirty = true;
    save();
    renderSyncBadge();
    clearTimeout(pushTimer);
    if (S.sync && WPDrive.hasToken()) pushTimer = setTimeout(() => syncNow(false), 1200);
  }

  function renderSyncBadge() {
    const b = $('sync-badge');
    if (!b) return;
    if (!S.sync) { b.textContent = ''; b.className = 'syncbadge'; return; }
    if (Team.busy) { b.textContent = 'Syncing team data…'; b.className = 'syncbadge'; return; }
    if (!WPDrive.hasToken() && WPDrive.configured() && WPDrive.webOrigin()) { b.textContent = 'Signed out of Google \u2014 tap to sign in'; b.className = 'syncbadge warn clickable'; return; }
    if (Team.lastErr) { b.textContent = 'Team data: sync problem'; b.className = 'syncbadge warn'; return; }
    if (S.sync.dirty) { b.textContent = 'Team data: not synced yet'; b.className = 'syncbadge warn'; return; }
    b.textContent = 'Team data synced';
    b.className = 'syncbadge ok';
  }

  async function ensureSignedIn() {
    if (WPDrive.hasToken()) return;
    await WPDrive.signIn(S.sync && S.sync.account);
  }

  async function syncNow(interactive) {
    if (!S.sync || !S.sync.fileId) return;
    if (!WPDrive.hasToken()) {
      if (!interactive) { renderSyncBadge(); renderTeamCard(); return; }
      try { await ensureSignedIn(); } catch (e) { toast(e.message, { err: true }); return; }
    }
    if (Team.busy) { Team.again = true; return; }
    Team.busy = true;
    renderSyncBadge(); renderTeamCard();
    try {
      const dirty = !!S.sync.dirty;
      const res = await WPDrive.syncJson(S.sync, {
        label: 'The team data',
        parse: WP.parseTeamFile,
        mine: () => WP.teamSnapshot(S.settings),
        merge: (x) => WP.syncStep(Object.assign(x, { dirty })),
        apply: (data) => { S.settings = WP.applyTeamData(S.settings, data); },
        text: () => WP.teamFileText(S.settings, S.sync.account),
        normalize: WP.normalizeTeamData
      });
      const m = res.meta.lastModifyingUser;
      Object.assign(S.sync, { dirty: false, lastBy: res.pushed ? 'you' : m ? (m.displayName || m.emailAddress) : '' });
      Team.lastErr = null;
      save();
      if (res.conflicts.length) {
        toast('Another coach changed the same thing at the same time (' + res.conflicts.join(', ') + '). Their version was kept — check it and redo your change if needed.', { err: true, ms: 12000 });
      }
    } catch (e) {
      Team.lastErr = e.message;
      if (interactive || e.code !== 0) toast('Team data: ' + e.message, { err: true, ms: 7000 });
    } finally {
      Team.busy = false;
      renderSyncBadge();
      refreshAfterSync();
      if (Team.again) { Team.again = false; syncNow(false); }
    }
  }

  function refreshAfterSync() {
    if (!$('view-settings').classList.contains('hidden') || !$('view-team').classList.contains('hidden')) renderSettings();
    else if (!$('view-tag').classList.contains('hidden') && App.G) { renderTags(); renderClips(); App.renderTagLineup(); }
    else if (!$('view-games').classList.contains('hidden')) { renderGameLists(); App.renderDraftLineup(); }
    if (App.E) renderEditor();
  }

  async function connectGoogle() {
    try {
      await WPDrive.signIn(S.sync && S.sync.account);
      const who = await WPDrive.whoAmI();
      Team.account = who.email;
      if (!S.settings.coachName && who.name) { S.settings.coachName = who.name.slice(0, 40); save(); renderWho(); }
      if (S.sync && S.sync.fileId) {
        if (S.sync.account && S.sync.account !== who.email) toast('Signed in as ' + who.email + ' (this device was set up with ' + S.sync.account + ')');
        S.sync.account = who.email;
        await syncNow(true);
      } else renderTeamCard();
      App.libSyncAll(true);
    } catch (e) { toast(e.message, { err: true }); renderTeamCard(); }
  }

  async function createTeamData() {
    try {
      await ensureSignedIn();
      const who = Team.account ? { email: Team.account } : await WPDrive.whoAmI();
      Team.account = who.email;
      Team.busy = true; renderTeamCard();
      if (!S.settings.coaches.some((c) => c.email === who.email)) S.settings.coaches = WP.addCoach(S.settings.coaches, S.settings.coachName || 'Head coach', who.email);
      // everything sits side by side in one folder, so coaches connect it all in one pick
      const root = await WPDrive.createFolder(App.driveNames().root);
      const file = await WPDrive.createFile('Watch Party team data.json', root.id, WP.teamFileText(S.settings, who.email));
      S.sync = { fileId: file.id, folderId: root.id, appFolderId: root.id, version: file.version, base: WP.normalizeTeamData(WP.teamSnapshot(S.settings)), dirty: false, account: who.email, owner: true, lastSyncAt: Date.now(), lastBy: 'you', sharedWith: [] };
      Team.lastErr = null;
      save();
      await App.ensureTeamFolders();
      await App.ensureTeamLibrary(); // before sharing, so a coach who joins right away gets the clip library too
      Team.busy = false;
      toast('Team data and team folders created in your Google Drive (' + App.driveNames().root + ')');
      await App.libSyncAll(true);
      if (S.settings.coaches.length > 1) await shareWithCoaches();
    } catch (e) { toast('Couldn’t create team data: ' + e.message, { err: true, ms: 8000 }); }
    finally { Team.busy = false; renderTeamCard(); renderSyncBadge(); }
  }

  /** A coach (not the admin) gives this app access to the team folders: pick everything in the team folder. */
  async function connectTeamFolders() {
    try {
      await ensureSignedIn();
      const picked = await WPDrive.pickFile({ multi: true, folders: true, parentId: S.sync && S.sync.folderId, title: 'Select everything in the team\u2019s Watch Party folder, then click Select' });
      if (!picked || !picked.length) return;
      App.folderAccessReset();
      const st = await App.folderStatus();
      toast(st.ok === st.total ? 'All ' + st.total + ' team folders connected' : st.ok + ' of ' + st.total + ' team folders connected. Pick the rest the same way.', { err: st.ok !== st.total, ms: 7000 });
    } catch (e) { toast('Couldn\u2019t connect the team folders: ' + e.message, { err: true }); }
    renderTeamCard();
  }

  async function shareWithCoaches() {
    if (!S.sync || !S.sync.owner) { toast('Only the coach who created the team data can share it from the app. They can also share the folder in Google Drive.'); return; }
    try { await ensureSignedIn(); } catch (e) { toast(e.message, { err: true }); return; }
    const todo = S.settings.coaches.filter((c) => c.email !== S.sync.account && !(S.sync.sharedWith || []).includes(c.email));
    if (!todo.length) { toast('Everyone on the coach list already has access'); return; }
    const done = [];
    const failed = [];
    for (const c of todo) {
      try {
        await WPDrive.share(S.sync.folderId, c.email, 'You’ve been added to the ' + S.settings.team.name + ' coaching staff in Watch Party by Bench Boss Labs. Open the app, go to Settings, sign in with Google and choose “Open shared team data”.');
        done.push(c.email);
      } catch (e) { failed.push(c.email + ' (' + e.message + ')'); }
    }
    S.sync.sharedWith = (S.sync.sharedWith || []).concat(done);
    save();
    renderTeamCard();
    if (done.length) toast('Shared with ' + done.join(', ') + '. They’ll get an email from Google.', { ms: 7000 });
    if (failed.length) toast('Couldn’t share with ' + failed.join('; '), { err: true, ms: 9000 });
  }

  /**
   * This Google account can see more than one team's data (e.g. a coach of two teams): use the one for this team.
   * Same team name → that one; only one → that one; otherwise ask. Returns the file's metadata or null (cancelled).
   */
  async function chooseTeamFile(found) {
    if (found.length === 1) return found[0];
    const named = [];
    for (const f of found) {
      let name = '';
      try { name = WP.parseTeamFile(await WPDrive.readText(f.id)).team.name; } catch (e) { name = ''; }
      named.push({ f, name });
    }
    const want = String(S.settings.team.name || '').toLowerCase();
    const same = named.filter((x) => x.name.toLowerCase() === want);
    if (same.length === 1) return same[0].f;
    const pick = await App.askChoice('Which team’s data is this?', 'This Google account can see Watch Party data for more than one team. Pick the one for this team (' + S.settings.team.name + ').',
      named.map((x, i) => ({ value: String(i), label: x.name || 'Unnamed team', note: x.f.createdTime ? 'Created ' + new Date(x.f.createdTime).toLocaleDateString() : '' })));
    return pick == null ? null : named[Number(pick)].f;
  }

  async function openSharedTeamData() {
    try {
      await ensureSignedIn();
      const who = Team.account ? { email: Team.account } : await WPDrive.whoAmI();
      Team.account = who.email;
      let id = null;
      let libId = null;
      // this Google account already connected (e.g. on another device): the app can see the files without picking
      const found = await WPDrive.findByName('Watch Party team data.json');
      const mine = found.length ? await chooseTeamFile(found) : null;
      if (found.length && !mine) return;
      if (mine) {
        id = mine.id;
        const lf = await WPDrive.findByName('Watch Party clip library.json', null, (mine.parents || [])[0]);
        libId = lf.length ? lf[0].id : null;
      } else {
        // a coach joining: open the shared team folder in Google's picker and select everything in it.
        // Picking is how Google lets this app use files and folders another account created.
        const picked = await WPDrive.pickFile({ multi: true, folders: true, title: 'Open the team\u2019s Watch Party folder (shared with you), select everything inside it, then click Select' });
        if (!picked || !picked.length) return;
        const t = picked.find((x) => /team data/i.test(x.name || ''));
        if (!t) throw new Error('\u201cWatch Party team data\u201d wasn\u2019t selected. Open the team\u2019s Watch Party folder and select everything inside it.');
        const l = picked.find((x) => /clip library/i.test(x.name || ''));
        id = t.id;
        libId = l ? l.id : null;
      }
      Team.busy = true; renderTeamCard();
      const meta = await WPDrive.getMeta(id);
      const data = WP.parseTeamFile(await WPDrive.readText(id));
      S.settings = WP.applyTeamData(S.settings, data);
      const owner = (meta.owners || []).some((o) => String(o.emailAddress || '').toLowerCase() === who.email);
      const rootId = (meta.parents || [])[0] || null;
      if (libId) S.lib.teamSync = { fileId: libId, version: null, base: null };
      S.sync = { fileId: id, folderId: rootId, appFolderId: rootId, version: meta.version, base: data, dirty: false, account: who.email, owner, lastSyncAt: Date.now(), lastBy: meta.lastModifyingUser ? (meta.lastModifyingUser.displayName || meta.lastModifyingUser.emailAddress) : '' };
      Team.lastErr = null;
      App.folderAccessReset();
      save();
      toast(owner ? 'Found your team data in Google Drive' : 'Connected to the team\u2019s Drive folder: roster, categories' + (libId ? ', clip library' : '') + ' and clip folders');
      App.libSyncAll(true);
    } catch (e) { toast('Couldn’t open team data: ' + e.message, { err: true, ms: 8000 }); }
    finally { Team.busy = false; renderTeamCard(); renderSyncBadge(); refreshAfterSync(); }
  }

  async function openSharedLibrary() {
    try {
      await ensureSignedIn();
      const picked = await WPDrive.pickFile({ query: 'Watch Party clip library', title: 'Pick \u201cWatch Party clip library\u201d in the team\u2019s Watch Party folder' });
      if (!picked) return;
      S.lib.teamSync = { fileId: picked, version: null, base: null };
      save();
      await App.libSyncAll(true);
      toast('Connected to the team clip library');
    } catch (e) { toast('Couldn\u2019t open the clip library: ' + e.message, { err: true }); }
    renderTeamCard();
  }

  async function disconnectTeam() {
    if (!(await askYes('Stop syncing on this device?', 'The roster and categories stay here; nothing is deleted from Google Drive.', 'Stop syncing'))) return;
    S.sync = null;
    S.lib.teamSync = null;
    S.lib.privSync = null;
    Team.lastErr = null;
    WPDrive.signOut();
    save();
    renderTeamCard();
    renderSyncBadge();
  }

  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(ms).toLocaleDateString();
  }

  function renderTeamCard() {
    const box = $('team-sync');
    if (!box) return;
    const btn = (label, fn, cls) => el('button', { type: 'button', class: 'btn small' + (cls ? ' ' + cls : ''), disabled: Team.busy, onclick: fn }, label);
    const lines = [];
    const actions = [];
    if (!WPDrive.configured()) {
      lines.push(el('span', { class: 'small muted' }, 'Google sign-in isn’t set up yet. Until it is, the roster and categories are kept on this device only.'));
    } else if (!WPDrive.webOrigin()) {
      lines.push(el('span', { class: 'small muted' }, 'Google sign-in only works on the web version: '), el('a', { href: 'https://scalisec.github.io/bulldogs-watch-party/', target: '_blank', rel: 'noopener' }, 'scalisec.github.io/bulldogs-watch-party'));
    } else if (!S.sync) {
      if (!WPDrive.hasToken()) {
        lines.push(el('span', { class: 'small muted' }, 'Sign in with Google to share the roster, categories, coaches, opponents and rinks with the other coaches.'));
        actions.push(btn('Sign in with Google', connectGoogle, 'primary'));
      } else {
        lines.push(el('span', { class: 'small' }, 'Signed in' + (Team.account ? ' as ' + Team.account : '') + '. Set up the team data:'));
        actions.push(btn('Create team data in my Drive', createTeamData, 'primary'));
        actions.push(btn('Open shared team data', openSharedTeamData));
        lines.push(el('span', { class: 'small muted' }, 'Head coach: create it once — it goes in a “' + App.driveNames().root + '” folder in your Drive and is shared with the coaches listed below. Other coaches: open the one that was shared with you.'));
      }
    } else {
      const st = Team.busy ? 'Syncing…' : Team.lastErr ? 'Problem: ' + Team.lastErr : S.sync.dirty ? 'Changes on this device not synced yet' : 'In sync';
      lines.push(el('div', { class: 'row', style: 'gap:8px' }, el('strong', {}, st),
        el('span', { class: 'small muted' }, (S.sync.lastSyncAt ? 'Last synced ' + ago(S.sync.lastSyncAt) : '') + (S.sync.lastBy ? ' · last change by ' + S.sync.lastBy : '') + ' · ' + S.sync.account + (S.sync.owner ? ' (owner)' : ''))));
      if (!WPDrive.hasToken()) actions.push(btn('Sign in to sync', connectGoogle, 'primary'));
      else actions.push(btn('Sync now', () => syncNow(true), 'primary'));
      lines.push(el('span', { class: 'small muted' }, S.lib.teamSync ? 'Clip library: ' + (App.LIB.err ? 'problem — ' + App.LIB.err : 'connected' + (S.lib.teamSync.lastSyncAt ? ', synced ' + ago(S.lib.teamSync.lastSyncAt) : '')) + ' · ' + Object.keys(S.lib.team.entries).length + ' team clips' : S.sync.owner ? 'Clip library: created on next sync' : 'Clip library: not opened yet on this device'));
      if (!S.lib.teamSync && !S.sync.owner) actions.push(btn('Open shared clip library', openSharedLibrary));
      if (S.sync.owner) {
        actions.push(btn('Share with coaches', shareWithCoaches));
        lines.push(el('span', { class: 'small' }, 'Admin tools: ', el('a', { href: '#team/admin' }, 'Team \u203a Drive and access'), '.'));
        lines.push(el('span', { class: 'small muted' }, 'This account owns the team\u2019s Drive folder: it creates the Team, Coaches only and family folders, and shares the folder with the coaches on the list.'));
      } else if (WPDrive.hasToken()) {
        const st = el('span', { class: 'small muted', id: 'team-folders' }, 'Team folders: checking\u2026');
        lines.push(st);
        App.folderStatus().then((x) => {
          st.textContent = x.total ? 'Team folders: ' + x.ok + ' of ' + x.total + ' connected on this account' + (x.ok < x.total ? ' \u2014 use \u201cConnect team folders\u201d to save clips into the rest.' : '.') : 'Team folders: not set up yet (the admin account creates them).';
        }).catch(() => { st.textContent = ''; });
        actions.push(btn('Connect team folders', connectTeamFolders));
      }
      actions.push(btn('Stop syncing on this device', disconnectTeam, 'danger'));
    }
    box.replaceChildren(...lines, actions.length ? el('div', { class: 'row' }, ...actions) : '');
  }

  function renderTeamSettings() {
    const t = S.settings.team;
    if (document.activeElement !== $('t-name')) $('t-name').value = t.name;
    if (document.activeElement !== $('t-season')) $('t-season').value = t.season;
    $('coaches').replaceChildren(...(S.settings.coaches.length ? S.settings.coaches.map((c) => el('div', { class: 'row', style: 'gap:8px' },
      el('span', { style: 'font-weight:600' }, c.name || '(no name)'), el('span', { class: 'small muted' }, c.email),
      S.sync && S.sync.sharedWith && S.sync.sharedWith.includes(c.email) ? el('span', { class: 'pill do' }, 'Shared') : '',
      S.sync && c.email === S.sync.account ? el('span', { class: 'pill zoompill' }, 'You') : '',
      el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + c.email, onclick: () => { S.settings.coaches = WP.removeCoach(S.settings.coaches, c.email); teamChanged(); renderSettings(); } }, 'Remove')))
      : [el('span', { class: 'small muted' }, 'No coaches yet.')]));
    const chips = (list, key, label) => list.length ? list.map((v) => el('button', { type: 'button', class: 'chip', 'aria-label': 'Remove ' + v, onclick: () => { S.settings[key] = WP.removeListItem(S.settings[key], v); teamChanged(); renderSettings(); } }, v + ' ✕')) : [el('span', { class: 'small muted' }, 'No ' + label + ' yet.')];
    $('opponents').replaceChildren(...chips(S.settings.opponents, 'opponents', 'opponents'));
    $('rinks').replaceChildren(...chips(S.settings.rinks, 'rinks', 'rinks'));
    renderTeamCard();
  }

  function renderGameLists() {
    const lg = App.League ? App.League.lists() : { opponents: [], rinks: [] };
    const merge = (a, b) => [...new Map([...a, ...b].map((v) => [v.toLowerCase(), v])).values()].sort((x, y) => x.localeCompare(y));
    $('dl-opp').replaceChildren(...merge(S.settings.opponents, lg.opponents).map((v) => el('option', { value: v })));
    $('dl-rink').replaceChildren(...merge(S.settings.rinks, lg.rinks).map((v) => el('option', { value: v })));
  }

  $('t-name').addEventListener('change', (e) => { S.settings.team = Object.assign({}, S.settings.team, { name: e.target.value.trim().slice(0, 60) || WP.DEFAULT_TEAM.name }); teamChanged(); renderSettings(); });
  $('t-season').addEventListener('change', (e) => { S.settings.team = Object.assign({}, S.settings.team, { season: e.target.value.trim().slice(0, 30) }); teamChanged(); renderSettings(); });
  $('coach-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.coaches = WP.addCoach(S.settings.coaches, $('c-name').value, $('c-email').value);
      $('c-name').value = ''; $('c-email').value = '';
      teamChanged(); renderSettings();
      if (S.sync && S.sync.owner) toast('Added. Click “Share with coaches” to give them access, and add their email as a test user in Google Cloud.', { ms: 8000 });
    } catch (err) { toast(err.message, { err: true }); }
  });
  for (const [form, input, key] of [['opp-add', 'o-new', 'opponents'], ['rink-add', 'k-new', 'rinks']]) {
    $(form).addEventListener('submit', (e) => {
      e.preventDefault();
      try { S.settings[key] = WP.addListItem(S.settings[key], $(input).value); $(input).value = ''; teamChanged(); renderSettings(); }
      catch (err) { toast(err.message, { err: true }); }
    });
  }
  window.addEventListener('focus', () => {
    if (S.sync && WPDrive.hasToken() && !Team.busy && (!S.sync.lastSyncAt || Date.now() - S.sync.lastSyncAt > 60000)) syncNow(false);
    libSyncIfStale(60000);
    renderSyncBadge();
  });
  $('sync-badge').addEventListener('click', () => { if (S.sync && !WPDrive.hasToken()) connectGoogle(); });
  setInterval(renderSyncBadge, 30000); // notice when the hour-long Google sign-in runs out

  /** Pull other coaches' new clips if the library hasn't synced for a while. */
  function libSyncIfStale(ms) {
    if (!WPDrive.hasToken() || App.LIB.busy) return;
    const last = Math.min((S.lib.teamSync && S.lib.teamSync.lastSyncAt) || 0, (S.lib.privSync && S.lib.privSync.lastSyncAt) || 0);
    if (Date.now() - last > ms) App.libSyncAll(false);
  }
  Object.assign(App, {
    Team, connectTeamFolders, shareWithCoaches, libSyncIfStale, renderGameLists, renderSyncBadge, renderTeamCard, renderTeamSettings,
    syncNow, teamChanged
  });
}).catch((e) => setTimeout(() => { throw e; }));
