/* Bulldogs Watch Party — Settings screen: categories, roster, coach name, about. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, el, renderWho, save, toast
  } = App;

  // =====================================================================
  // SETTINGS
  // =====================================================================
  function renderSettings() {
    renderWho();
    App.renderTeamSettings();
    $('app-version').textContent = 'v' + WP.APP_VERSION;
    $('app-released').textContent = 'Released ' + WP.formatDate(WP.APP_RELEASED);
    $('app-schema').textContent = String(WP.SCHEMA_VERSION);
    WPStore.usage().then((u) => {
      if (!u) return;
      $('app-storage').textContent = 'Storage on this device: ' + (u.used / 1e6).toFixed(1) + ' MB used' +
        (u.persisted === true ? ' \u00b7 kept permanently' : u.persisted === false ? ' \u00b7 Chrome may clear it if the disk gets full \u2014 keep backups or Drive copies' : '');
    });
    $('s-coach').value = S.settings.coachName;
    const keyed = WP.keyedCategories(S.settings.categories);
    const keyOf = (id) => (keyed.find((k) => k.id === id) || {}).key;
    const cats = S.settings.categories;
    $('cat-rows').replaceChildren(...cats.map((c, i) => {
      const inUse = WP.categoryInUse(S.games, c.id);
      const upd = (patch) => {
        try { S.settings.categories = WP.updateCategory(S.settings.categories, c.id, patch); App.teamChanged(); }
        catch (e) { toast(e.message, { err: true }); }
        renderSettings();
      };
      return el('tr', {},
        el('td', { class: 'muted' }, keyOf(c.id) || '–'),
        el('td', {}, el('input', { type: 'color', value: c.color, 'aria-label': 'Colour for ' + c.name, onchange: (e) => upd({ color: e.target.value }) })),
        el('td', {}, el('input', { type: 'text', value: c.name, 'aria-label': 'Name', style: 'width:100%;min-width:160px', onchange: (e) => upd({ name: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.before), 'aria-label': 'Seconds before for ' + c.name, onchange: (e) => upd({ before: e.target.value }) })),
        el('td', {}, el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(c.after), 'aria-label': 'Seconds after for ' + c.name, onchange: (e) => upd({ after: e.target.value }) })),
        el('td', {}, el('input', { type: 'checkbox', checked: !c.hidden, 'aria-label': 'Show ' + c.name, style: 'width:20px;height:20px', onchange: (e) => upd({ hidden: !e.target.checked }) })),
        el('td', { style: 'white-space:nowrap' },
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' up', disabled: i === 0, onclick: () => { S.settings.categories = WP.moveCategory(cats, c.id, -1); App.teamChanged(); renderSettings(); } }, '↑'),
          ' ',
          el('button', { type: 'button', class: 'btn small', 'aria-label': 'Move ' + c.name + ' down', disabled: i === cats.length - 1, onclick: () => { S.settings.categories = WP.moveCategory(cats, c.id, 1); App.teamChanged(); renderSettings(); } }, '↓'),
          ' ',
          el('button', {
            type: 'button', class: 'btn small danger', disabled: inUse, title: inUse ? 'Has clips — hide it instead' : null, 'aria-label': 'Delete ' + c.name,
            onclick: () => { try { S.settings.categories = WP.removeCategory(cats, c.id, S.games); App.teamChanged(); renderSettings(); } catch (e) { toast(e.message, { err: true }); } }
          }, 'Delete')
        )
      );
    }));
    $('roster').replaceChildren(...(S.settings.roster.length ? S.settings.roster.map((p) => el('button', {
      type: 'button', class: 'chip', 'aria-label': 'Remove #' + p.number + (p.name ? ' ' + p.name : ''),
      onclick: () => { S.settings.roster = WP.removePlayer(S.settings.roster, p.number); App.teamChanged(); renderSettings(); }
    }, '#' + p.number + (p.name ? ' ' + p.name : '') + ' ✕')) : [el('span', { class: 'small muted' }, 'No players yet.')]));
  }

  $('s-coach').addEventListener('change', (e) => { S.settings.coachName = e.target.value.trim().slice(0, 40); save(); renderWho(); });
  $('cat-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.categories = WP.addCategory(S.settings.categories, $('cat-new').value, '#475569');
      $('cat-new').value = '';
      App.teamChanged(); renderSettings();
    } catch (err) { toast(err.message, { err: true }); }
  });
  $('roster-add').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      S.settings.roster = WP.addPlayer(S.settings.roster, $('r-num').value, $('r-name').value);
      $('r-num').value = ''; $('r-name').value = '';
      App.teamChanged(); renderSettings(); $('r-num').focus();
    } catch (err) { toast(err.message, { err: true }); }
  });
  Object.assign(App, {
    renderSettings
  });
}).catch((e) => setTimeout(() => { throw e; }));
