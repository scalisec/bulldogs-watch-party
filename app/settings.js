/* Watch Party — Settings screen: your name, Google sign-in and team data, shortcuts, about.
   renderSettings() also redraws the Team page, so anything that changes team data can call it. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, el, renderWho, save, toast
  } = App;

  // ---- Install the app (home screen / desktop app) ----
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let showHow = false;

  function howTo() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) return 'On iPhone or iPad: open this page in Safari, tap the Share button, then Add to Home Screen.';
    if (/SamsungBrowser/.test(ua)) return 'In Samsung Internet: tap the menu (☰), then Add page to › Home screen.';
    if (/Android/.test(ua)) return 'In Chrome: tap the menu (⋮), then Add to home screen (or Install app), then Install.';
    if (/Edg\//.test(ua)) return 'In Edge: open the menu (…), then Apps › Install this site as an app.';
    if (/Firefox\//.test(ua)) return 'Firefox can’t install web apps on a computer. Open Watch Party in Chrome or Edge to install it.';
    return 'In Chrome: click the install icon at the right end of the address bar, or open the menu (⋮) › Cast, save and share › Install page as app.';
  }

  function renderInstall() {
    const box = $('install-body');
    if (installed()) {
      box.replaceChildren(el('span', { class: 'ok' }, '✓ Watch Party is installed on this device.'),
        el('span', { class: 'small muted' }, 'It opens in its own window from your home screen or app list. Your games and clips are the same as in the browser.'));
      return;
    }
    box.replaceChildren(
      el('span', { class: 'small muted' }, 'Add Watch Party to your home screen or desktop. It opens in its own window like a regular app, with the same games, clips and team data.'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', id: 's-install', onclick: async () => {
        const p = window.__installPrompt;
        if (!p) { showHow = true; renderInstall(); return; }
        p.prompt();
        const r = await p.userChoice.catch(() => null);
        window.__installPrompt = null;
        if (r && r.outcome === 'accepted') toast('Watch Party installed');
        renderInstall();
      } }, 'Install app')),
      showHow ? el('span', { class: 'small', id: 's-install-how' }, howTo()) : '');
  }
  document.addEventListener('wp-installable', () => { if (!$('view-settings').classList.contains('hidden')) renderInstall(); });

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
    renderInstall();
    if (document.activeElement !== $('s-coach')) $('s-coach').value = S.settings.coachName;
    App.renderTeam();
  }

  $('s-coach').addEventListener('change', (e) => { S.settings.coachName = e.target.value.trim().slice(0, 40); save(); renderWho(); });
  $('s-keys').addEventListener('click', () => App.openKeys());

  Object.assign(App, {
    renderSettings
  });
}).catch((e) => setTimeout(() => { throw e; }));
