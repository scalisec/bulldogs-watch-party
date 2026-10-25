/* Watch Party — Settings screen: your name, Google sign-in and team data, shortcuts, about.
   renderSettings() also redraws the Team page, so anything that changes team data can call it. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, renderWho, save
  } = App;

  function renderSettings() {
    renderWho();
    App.renderTeamSettings();
    $('app-version').textContent = 'v' + WP.APP_VERSION;
    $('app-released').textContent = 'Released ' + WP.formatDate(WP.APP_RELEASED);
    $('app-schema').textContent = String(WP.SCHEMA_VERSION);
    WPStore.usage().then((u) => {
      if (!u) return;
      $('app-storage').textContent = 'Storage on this device: ' + (u.used / 1e6).toFixed(1) + ' MB used' +
        (u.persisted === true ? ' · kept permanently' : u.persisted === false ? ' · Chrome may clear it if the disk gets full — keep backups or Drive copies' : '');
    });
    if (document.activeElement !== $('s-coach')) $('s-coach').value = S.settings.coachName;
    App.renderTeam();
  }

  $('s-coach').addEventListener('change', (e) => { S.settings.coachName = e.target.value.trim().slice(0, 40); save(); renderWho(); });
  $('s-keys').addEventListener('click', () => App.openKeys());

  Object.assign(App, {
    renderSettings
  });
}).catch((e) => setTimeout(() => { throw e; }));
