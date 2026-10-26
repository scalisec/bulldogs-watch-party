/* Watch Party — Team page: roster (positions), coaches, clip categories, opponents and rinks, team name,
   and the Admin section (Drive and access), shown only to the account that owns the team's Drive folder. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, askYes, el, toast
  } = App;

  const T = { sec: 'roster', edit: null, filter: 'all' };
  const SECTIONS = ['roster', 'coaches', 'categories', 'lists', 'info', 'admin'];
  const changed = () => { App.teamChanged(); App.renderSettings(); };
  const isOwner = () => !!(S.sync && S.sync.owner);

  function renderTeam(sec) {
    if (sec && SECTIONS.includes(sec)) T.sec = sec;
    if (T.sec === 'admin' && !isOwner()) T.sec = 'roster';
    for (const a of document.querySelectorAll('.teamnav a[data-tsec]')) {
      if (a.dataset.tsec === T.sec) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    for (const s of document.querySelectorAll('.teammain > section[data-tsec]')) s.classList.toggle('hidden', s.dataset.tsec !== T.sec);
    $('tn-admin').classList.toggle('hidden', !isOwner());
    $('tn-admin-label').classList.toggle('hidden', !isOwner());
    $('tn-roster').textContent = String(S.settings.roster.length);
    $('tn-coaches').textContent = String(S.settings.coaches.length);
    $('tn-cats').textContent = String(S.settings.categories.length);
    $('team-pill').textContent = [S.settings.team.name, S.settings.team.season].filter(Boolean).join(' · ');
    if (App.teamsRefresh) App.teamsRefresh();
    renderRoster();
    renderCats();
    if (T.sec === 'admin') renderAdmin();
    if (T.sec === 'info') App.renderLeagueSetting();
  }

  // ---------------- roster ----------------
  function clipCount(number) {
    let n = 0;
    for (const g of S.games) for (const c of g.clips) if ((c.players || []).includes(number)) n += 1;
    return n;
  }

  function posTag(code, secondary) {
    if (!code) return el('span', { class: 'muted' }, '—');
    return el('span', { class: secondary ? 'pos sec' : 'pos', title: WP.positionLabel(code) }, secondary ? code : code + ' · ' + WP.positionLabel(code));
  }

  function posButtons(label, current, withNone, onPick) {
    const btns = [];
    if (withNone) btns.push(el('button', { type: 'button', class: 'posbtn', 'aria-pressed': String(!current), onclick: () => onPick('') }, 'None'));
    for (const [code, name] of WP.POSITIONS) btns.push(el('button', { type: 'button', class: 'posbtn', title: name, 'aria-label': label + ': ' + name, 'aria-pressed': String(current === code), onclick: () => onPick(code) }, code));
    return el('div', { class: 'posgroup', role: 'group', 'aria-label': label }, el('span', { class: 'small muted', style: 'width:76px' }, label), ...btns);
  }

  function renderRoster() {
    const r = S.settings.roster;
    const groups = { F: 0, D: 0, G: 0 };
    for (const p of r) { const g = WP.positionGroup(p.primary); if (g) groups[g] += 1; }
    $('roster-sub').textContent = r.length + (r.length === 1 ? ' player' : ' players') + ' · positions fill each game’s lineup and let Review filter by forwards, defense or goalies';
    const fb = (id, label) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(T.filter === id), onclick: () => { T.filter = id; renderRoster(); } }, label);
    $('r-filter').replaceChildren(fb('all', 'All ' + r.length), fb('F', 'Forwards ' + groups.F), fb('D', 'Defense ' + groups.D), fb('G', 'Goalies ' + groups.G));
    const shown = r.filter((p) => T.filter === 'all' || WP.positionGroup(p.primary) === T.filter);
    const rows = shown.map((p) => {
      const who = '#' + p.number + (p.name ? ' ' + p.name : '');
      if (T.edit === p.number) {
        const upd = (patch) => { try { S.settings.roster = WP.updatePlayer(S.settings.roster, p.number, patch); changed(); } catch (e) { toast(e.message, { err: true }); } };
        return el('tr', { class: 'editing' },
          el('td', {}, el('span', { class: 'jersey' }, p.number)),
          el('td', {}, el('div', { class: 'stack', style: 'gap:6px' },
            el('label', { class: 'field' }, 'First name', el('input', { type: 'text', value: p.first, 'aria-label': 'First name for #' + p.number, onchange: (e) => upd({ first: e.target.value }) })),
            el('label', { class: 'field' }, 'Last name', el('input', { type: 'text', value: p.last, 'aria-label': 'Last name for #' + p.number, onchange: (e) => upd({ last: e.target.value }) })))),
          el('td', { colspan: '2' }, el('div', { class: 'stack', style: 'gap:8px' },
            posButtons('Primary', p.primary, false, (c) => upd({ primary: c })),
            posButtons('Secondary', p.secondary, true, (c) => upd({ secondary: c })))),
          el('td', { class: 'muted' }, String(clipCount(p.number))),
          el('td', { class: 'actions' }, el('div', { class: 'stack', style: 'gap:6px;align-items:flex-end' },
            el('button', { type: 'button', class: 'btn small primary', onclick: () => { T.edit = null; renderRoster(); } }, 'Done'),
            el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + who, onclick: () => removePlayer(p, who) }, 'Remove'))));
      }
      return el('tr', {},
        el('td', {}, el('span', { class: 'jersey' }, p.number)),
        el('td', { style: 'font-weight:600' }, p.name || el('span', { class: 'muted' }, 'No name')),
        el('td', {}, posTag(p.primary)),
        el('td', {}, posTag(p.secondary, true)),
        el('td', { class: 'muted' }, String(clipCount(p.number))),
        el('td', { class: 'actions' }, el('button', { type: 'button', class: 'btn small', 'aria-label': 'Edit ' + who, onclick: () => { T.edit = p.number; renderRoster(); } }, 'Edit')));
    });
    $('roster').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colspan: '6', class: 'muted', style: 'padding:16px' }, r.length ? 'No players in this group.' : 'No players yet. Add the first one below.'))]));
    const opts = (sel, none) => { if (!sel.options.length) sel.replaceChildren(el('option', { value: '' }, none), ...WP.POSITIONS.map(([c, n]) => el('option', { value: c }, c + ' · ' + n))); };
    opts($('r-pri'), 'Not set'); opts($('r-sec'), 'None');
  }

  async function removePlayer(p, who) {
    if (!(await askYes('Remove ' + who + ' from the roster?', 'Clips keep the jersey number. Their family folder in Drive stays; the admin can delete it there.', 'Remove player'))) return;
    S.settings.roster = WP.removePlayer(S.settings.roster, p.number);
    T.edit = null;
    changed();
  }

  $('roster-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.roster = WP.addPlayer(S.settings.roster, { number: $('r-num').value, first: $('r-name').value, last: $('r-last').value, primary: $('r-pri').value, secondary: $('r-sec').value });
      for (const id of ['r-num', 'r-name', 'r-last', 'r-pri', 'r-sec']) $(id).value = '';
      changed(); $('r-num').focus();
    } catch (err) { toast(err.message, { err: true }); }
  });

  // ---------------- categories ----------------
  function renderCats() {
    const keyed = WP.keyedCategories(S.settings.categories);
    const keyOf = (id) => (keyed.find((k) => k.id === id) || {}).key;
    const cats = S.settings.categories;
    $('cat-rows').replaceChildren(...cats.map((c, i) => {
      const inUse = WP.categoryInUse(S.games, c.id);
      const upd = (patch) => {
        try { S.settings.categories = WP.updateCategory(S.settings.categories, c.id, patch); App.teamChanged(); }
        catch (e) { toast(e.message, { err: true }); }
        App.renderSettings();
      };
      const move = (d) => { S.settings.categories = WP.moveCategory(cats, c.id, d); changed(); };
      return el('tr', {},
        el('td', { class: 'muted' }, keyOf(c.id) || '–'),
        el('td', {}, el('input', { type: 'color', value: c.color, 'aria-label': 'Colour for ' + c.name, onchange: (e) => upd({ color: e.target.value }) })),
        el('td', {}, el('input', { type: 'text', value: c.name, 'aria-label': 'Name', style: 'width:100%;min-width:160px', onchange: (e) => upd({ name: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.before), 'aria-label': 'Seconds before for ' + c.name, onchange: (e) => upd({ before: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.after), 'aria-label': 'Seconds after for ' + c.name, onchange: (e) => upd({ after: e.target.value }) })),
        el('td', {}, el('input', { type: 'checkbox', checked: !c.hidden, 'aria-label': 'Show ' + c.name, style: 'width:20px;height:20px', onchange: (e) => upd({ hidden: !e.target.checked }) })),
        el('td', { style: 'white-space:nowrap' },
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' up', disabled: i === 0, onclick: () => move(-1) }, '↑'), ' ',
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' down', disabled: i === cats.length - 1, onclick: () => move(1) }, '↓'), ' ',
          el('button', {
            type: 'button', class: 'btn small danger', disabled: inUse, title: inUse ? 'Has clips — hide it instead' : null, 'aria-label': 'Delete ' + c.name,
            onclick: () => { try { S.settings.categories = WP.removeCategory(cats, c.id, S.games); changed(); } catch (e) { toast(e.message, { err: true }); } }
          }, 'Delete')));
    }));
  }

  $('cat-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.categories = WP.addCategory(S.settings.categories, $('cat-new').value, '#475569');
      $('cat-new').value = '';
      changed();
    } catch (err) { toast(err.message, { err: true }); }
  });

  // ---------------- admin: Drive and access (owner of the team folder only) ----------------
  const driveFolderUrl = (id) => 'https://drive.google.com/drive/folders/' + encodeURIComponent(id);

  function renderAdmin() {
    const box = $('admin-body');
    if (!S.sync) {
      box.replaceChildren(el('div', { class: 'card' }, 'Set up team data first: ', el('a', { href: '#settings' }, 'Settings › Google sign-in and team data'), '.'));
      return;
    }
    const others = S.settings.coaches.filter((c) => c.email !== S.sync.account);
    const shared = S.sync.sharedWith || [];
    const notShared = others.filter((c) => !shared.includes(c.email));
    const folders = S.lib.team.folders || {};
    const keys = WP.teamFolderKeys(S.settings.roster);
    const counts = {};
    for (const e of Object.values(S.lib.team.entries)) for (const d of e.drive || []) counts[d.folder] = (counts[d.folder] || 0) + 1;
    const stat = (label, big, small, cls) => el('div', { class: 'card stack stat', style: 'gap:4px' }, el('span', { class: 'small muted' }, label), el('strong', { class: 'statbig' }, big), small ? el('span', { class: 'small ' + (cls || 'muted') }, small) : '');
    const btn = (label, fn, cls, dis) => el('button', { type: 'button', class: 'btn small ' + (cls || ''), disabled: !!dis, onclick: fn }, label);
    box.replaceChildren(
      el('div', { class: 'grid3' },
        stat('Team folder', App.driveNames().root, 'Owned by ' + S.sync.account, 'ok'),
        stat('Coaches with access', (others.length - notShared.length) + ' of ' + others.length, notShared.length ? notShared.length + ' not shared yet' : 'Everyone on the list', notShared.length ? 'warn' : 'ok'),
        stat('Clip folders', String(keys.filter((k) => folders[k]).length), 'Team, Coaches only and ' + S.settings.roster.length + ' family folders')),
      el('div', { class: 'row' },
        S.sync.folderId ? el('a', { class: 'btn small outline', href: driveFolderUrl(S.sync.folderId), target: '_blank', rel: 'noopener' }, 'Open team folder in Google Drive') : ''),
      el('div', { class: 'card flush stack', style: 'gap:0' },
        el('div', { class: 'row spread cardhead' }, el('h2', {}, 'Coach access'),
          btn(notShared.length ? 'Share with ' + notShared.length + ' new coach' + (notShared.length === 1 ? '' : 'es') : 'Everyone has access', () => App.shareWithCoaches(), 'primary', !notShared.length)),
        el('div', { class: 'tablewrap' }, el('table', { class: 'plain' },
          el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Coach'), el('th', { scope: 'col' }, 'Google account'), el('th', { scope: 'col' }, 'Team folder'))),
          el('tbody', {}, ...S.settings.coaches.map((c) => el('tr', {},
            el('td', { style: 'font-weight:600' }, c.name || '(no name)'),
            el('td', {}, c.email),
            el('td', { class: c.email === S.sync.account ? 'muted' : shared.includes(c.email) ? 'ok' : 'warn' }, c.email === S.sync.account ? 'Owner (this account)' : shared.includes(c.email) ? 'Shared' : 'Not shared yet')))))),
        el('span', { class: 'small muted cardfoot' }, 'New coaches must also be added as test users in Google Cloud (Google Auth Platform › Audience). Each coach then connects the team folders once from Settings.')),
      el('div', { class: 'card flush stack', style: 'gap:0' },
        el('div', { class: 'stack cardhead', style: 'gap:2px' }, el('h2', {}, 'Clip folders'),
          el('span', { class: 'small muted' }, 'Created automatically from the roster. In Google Drive, share Team clips with all families and each family folder with that family only.')),
        el('div', { class: 'tablewrap' }, el('table', { class: 'plain' },
          el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Folder'), el('th', { scope: 'col' }, 'Clips'), el('th', { scope: 'col' }, el('span', { class: 'sr' }, 'Open')))),
          el('tbody', {}, ...keys.map((k) => el('tr', {},
            el('td', { style: 'font-weight:600' }, WP.folderName(k, S.settings.roster)),
            el('td', {}, String(counts[k] || 0)),
            el('td', { class: 'actions' }, folders[k] ? el('a', { href: driveFolderUrl(folders[k]), target: '_blank', rel: 'noopener' }, 'Open in Drive') : el('span', { class: 'small muted' }, 'Created on next sync'))))))))
    );
  }

  Object.assign(App, {
    renderTeam
  });
}).catch((e) => setTimeout(() => { throw e; }));
