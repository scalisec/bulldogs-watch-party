/* Watch Party — several teams on one device (v1.2). Each team has its own games, clips, roster, categories,
   league team and Google Drive folder, kept in its own browser database. The header's team button switches
   between them; "Add a team" starts a new one (optionally with this team's clip categories). */
App.ready.then(() => {
  'use strict';
  const {
    $, DB, S, askYes, el, toast, teamProfile
  } = App;

  const teamLabel = (t) => t.name || (t.id === teamProfile.id ? S.settings.team.name : '') || 'Unnamed team';

  /** Reload the app on another team. Saves first. */
  async function switchTo(id, hash) {
    await DB.flush();
    WPStore.teams.setCurrent(id);
    history.replaceState(null, '', location.pathname + location.search + (hash || '#games'));
    location.reload();
  }

  async function addTeam(name, copyCats) {
    const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!n) throw new Error('Give the team a name');
    if (WPStore.teams.list().some((t) => teamLabel(t).toLowerCase() === n.toLowerCase())) throw new Error('There’s already a team called ' + n + ' on this device');
    const t = WPStore.teams.add(n);
    const db = WPStore.createDb({ name: t.db });
    const { state } = await db.load();
    state.settings.team = { name: n, season: S.settings.team.season || '' };
    // the league team, when the name clearly says which one (e.g. "Burlington Barracudas U13 B")
    const guess = App.League && App.League.state.teams ? WP.guessLeagueTeam(App.League.state.teams, n) : null;
    state.settings.league = WP.normalizeLeague(guess && guess.sure ? guess.team : { teamId: '' });
    t.leagueGuess = guess && guess.sure ? guess.team : null;
    state.settings.coachName = S.settings.coachName;
    if (copyCats) state.settings.categories = JSON.parse(JSON.stringify(S.settings.categories));
    await db.writeAll();
    return t;
  }

  async function removeTeam(t) {
    if (!(await askYes('Remove ' + teamLabel(t) + ' from this device?', 'Its games, clips, roster and settings are deleted from this browser. Anything already in Google Drive (team data, clip library, videos) is not touched, so you can open it again later.', 'Remove team'))) return;
    await WPStore.deleteDb(t.db);
    WPStore.teams.remove(t.id);
    toast(teamLabel(t) + ' removed from this device');
    renderTeams();
  }

  function renderTeams() {
    const list = WPStore.teams.list();
    $('teams-list').replaceChildren(...list.map((t) => {
      const cur = t.id === teamProfile.id;
      return el('li', { class: 'teamrow' + (cur ? ' cur' : '') },
        el('span', { class: 'grow stack', style: 'gap:0' }, el('strong', {}, teamLabel(t)), cur ? el('span', { class: 'small muted' }, 'Open now') : ''),
        cur ? el('span', { class: 'pill do' }, '✓ Current')
          : el('button', { type: 'button', class: 'btn small primary', 'aria-label': 'Switch to ' + teamLabel(t), onclick: () => switchTo(t.id) }, 'Switch'),
        !cur && t.id !== 'main' ? el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove ' + teamLabel(t), onclick: () => removeTeam(t) }, 'Remove') : '');
    }));
    $('teams-copy-label').textContent = 'Copy the clip categories from ' + (S.settings.team.name || 'this team') + ' (' + S.settings.categories.length + ')';
    $('team-switch').title = list.length > 1 ? 'Switch team' : 'Teams';
  }

  function openTeams() {
    renderTeams();
    $('dlg-teams').showModal();
  }

  $('team-switch').addEventListener('click', openTeams);
  $('teams-close').addEventListener('click', () => $('dlg-teams').close());
  $('teams-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const t = await addTeam($('teams-name').value, $('teams-copy').checked);
      $('teams-name').value = '';
      toast('Added ' + t.name + (t.leagueGuess ? ', with the ' + t.leagueGuess.name + ' schedule (' + t.leagueGuess.division + ')' : '') + '. Opening it…');
      await switchTo(t.id, '#team/info');
    } catch (err) { toast(err.message, { err: true }); }
  });

  /**
   * askChoice(title, message, [{ value, label, note }]) -> Promise<value | null>
   * A small dialog with one button per option (used when a Google account can see several teams' data).
   */
  function askChoice(title, message, options) {
    return new Promise((resolve) => {
      const d = $('dlg-choose');
      let done = false;
      const finish = (v) => { if (done) return; done = true; d.close(); resolve(v); };
      $('choose-h').textContent = title;
      $('choose-msg').textContent = message || '';
      $('choose-list').replaceChildren(...options.map((o) => el('button', { type: 'button', class: 'btn choice', onclick: () => finish(o.value) },
        el('strong', {}, o.label), o.note ? el('span', { class: 'small muted' }, o.note) : '')));
      $('choose-cancel').onclick = () => finish(null);
      d.addEventListener('close', () => finish(null), { once: true });
      d.showModal();
    });
  }

  $('team-pill').textContent = [S.settings.team.name, S.settings.team.season].filter(Boolean).join(' · ');
  App.teamsRefresh = () => { if (S.settings.team.name) WPStore.teams.rename(teamProfile.id, S.settings.team.name); };
  Object.assign(App, { askChoice, openTeams, switchTeam: switchTo, addTeam });
}).catch((e) => setTimeout(() => { throw e; }));
