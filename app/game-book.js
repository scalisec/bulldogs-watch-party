/* Bulldogs Watch Party — the team's Game Book (2.8): the admin's device creates it once in the team folder, with the
   roster, so Family Watch Party can show the Bulldogs games' stats. From Phase 4 the coaches' marks go into it too.
   The Game Book code itself is vendor/game-book/<version>/core, loaded as a module in index.html (window.GB). */
App.ready.then(() => {
  'use strict';
  const { S, save, toast } = App;

  function core() {
    if (window.GB) return Promise.resolve(window.GB);
    return new Promise((res) => window.addEventListener('gb-ready', () => res(window.GB), { once: true }));
  }

  /** "2026-27" from the team's season, or from today's date (seasons run August to July). */
  function seasonLabel(season, now) {
    const m = /(\d{4})\s*[-–\/]\s*(\d{2,4})/.exec(season || '');
    if (m) return m[1] + '-' + m[2].slice(-2);
    const d = now || new Date();
    const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return y + '-' + String((y + 1) % 100).padStart(2, '0');
  }

  function bookRoster(roster) {
    return (roster || []).map((p) => ({ number: p.number, name: p.name, pos: p.primary || '' }));
  }

  let busy = null;
  /** Only the admin's device creates it; coaches get it when they join (they pick everything in the team folder). */
  function ensureGameBook() {
    if (!busy) busy = make().finally(() => { busy = null; });
    return busy;
  }
  async function make() {
    if (!S.sync || !S.sync.owner || !S.sync.appFolderId || S.sync.gameBook || !WPDrive.hasToken()) return;
    const GB = await core();
    const book = GB.newBook({ team: S.settings.team.name, season: seasonLabel(S.settings.team.season), roster: bookRoster(S.settings.roster) });
    const name = GB.bookFileName(book);
    const found = await WPDrive.findByName(name, null, S.sync.appFolderId);
    const f = found.length ? found[0] : await WPDrive.createFile(name, S.sync.appFolderId, GB.bookFileText(book, { by: S.sync.account || '' }), 'application/json');
    S.sync.gameBook = { fileId: f.id, name };
    save();
    if (!found.length) toast('Game Book created in the team folder (' + name + '). Family Watch Party can now show the team’s stats.');
  }

  Object.assign(App, { ensureGameBook, gameBookSeason: seasonLabel });
}).catch((e) => setTimeout(() => { throw e; }));
