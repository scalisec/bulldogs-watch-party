"""Browser test for v1.2: several teams on one device, against the simulated Google sign-in, Picker and Drive.
Team switcher, Add a team (copies clip categories), each team's own games / roster / league / Drive folder,
a second device finding the right team's data, the "which team?" choice, and removing a team.
usage: python3 tests/e2e_v12.py <screenshot-dir>"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v12'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, wait_synced = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['wait_synced']
CUDAS = 'Burlington Barracudas U13 B'

def by_name(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
def state(page, expr): return page.evaluate('window.__bwp.state.' + expr)
def reloaded(page): page.wait_for_load_state('load'); page.wait_for_function('window.__bwp')

def add_team(page, name, copy=True):
    page.click('#team-switch'); page.wait_for_selector('#dlg-teams[open]')
    page.fill('#teams-name', name)
    if not copy: page.uncheck('#teams-copy')
    with page.expect_navigation():
        page.click('#teams-add button[type=submit]')
    reloaded(page)

def switch_to(page, name):
    page.click('#team-switch'); page.wait_for_selector('#dlg-teams[open]')
    with page.expect_navigation():
        page.click('button[aria-label="Switch to %s"]' % name)
    reloaded(page)

def create_team_data(page):
    settings(page)
    if page.is_visible('button:has-text("Sign in with Google")'): page.click('button:has-text("Sign in with Google")')
    page.click('button:has-text("Create team data in my Drive")')
    page.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy", timeout=10000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    A, errA = setup(ctx, 'a@team.com')

    # ---- the first team (Bulldogs): a player, an extra category, a game-free start, team data in Drive
    A.goto(APP + '#settings'); A.wait_for_function('window.__bwp')
    A.fill('#s-coach', 'Cristian'); A.press('#s-coach', 'Tab')
    team(A, 'roster'); A.fill('#r-num', '7'); A.fill('#r-name', 'Sam'); A.fill('#r-last', 'Smith'); A.click('#roster-add button[type=submit]')
    A.evaluate("""async () => { const s = window.__bwp.state; s.settings.categories = s.settings.categories.concat([{ id: 'c-pk', name: 'Penalty kill', color: '#a855f7', before: 5, after: 5, hidden: false }]);
      s.games.push({ id: 'game-b1', date: '2026-10-18', time: '15:15', opponent: 'Burlington Raiders', rink: 'Mountainside', result: 'W 2–1', gameType: 'league', homeAway: 'home', marks: { periods: [], goals: [] }, league: null, parts: [{ name: 'x.mp4', size: 1, duration: 60 }], clips: [], createdAt: 1 });
      await window.__bwp.saveAll(); }""")
    create_team_data(A)
    check(len(by_name('Bulldogs Watch Party')) == 1, 'first team keeps its “Bulldogs Watch Party” Drive folder')
    cats = len(state(A, 'settings.categories'))
    check(A.text_content('#team-pill').startswith('Bulldogs U10 Blue'), 'header shows the current team')

    # ---- add the Barracudas, copying the categories
    A.click('#team-switch'); A.wait_for_selector('#dlg-teams[open]')
    check(A.locator('#teams-list li').count() == 1 and 'Penalty kill' not in A.text_content('#teams-copy-label') and '(%d)' % cats in A.text_content('#teams-copy-label'), 'Teams dialog lists one team and offers to copy its %d categories' % cats)
    A.screenshot(path=SHOTS + '/v12-teams-dialog.png')
    A.click('#teams-close')
    add_team(A, CUDAS)
    check(A.url.endswith('#team/info') and A.text_content('#team-pill') == CUDAS, 'new team opens on its Team page, header shows ' + CUDAS)
    check(state(A, 'settings.roster') == [] and state(A, 'games') == [] and state(A, 'sync') is None, 'new team starts with no roster, no games and no Drive link')
    check(len(state(A, 'settings.categories')) == cats and any(c['name'] == 'Penalty kill' for c in state(A, 'settings.categories')), 'clip categories copied from the first team')
    check(state(A, 'settings.league.teamId') == '' and state(A, 'settings.coachName') == 'Cristian', 'new team: no league team yet (offline here); your name carried over')
    A.wait_for_selector('#lg-team')
    check(A.input_value('#lg-team') == '', 'league picker starts on “Don’t use the league schedule”')
    team(A, 'roster'); A.fill('#r-num', '11'); A.fill('#r-name', 'Ava'); A.fill('#r-last', 'Scali'); A.click('#roster-add button[type=submit]')
    A.goto(APP + '#games'); A.wait_for_selector('#view-games:not(.hidden)')
    check('No games yet' in A.text_content('#games'), 'Games list is the new team’s own (empty)')
    check('Pick your league team' in A.text_content('#g-league'), 'New game form points to the Team page for a league team')

    # ---- its own Drive folder and private folder
    create_team_data(A)
    root = by_name(CUDAS + ' – Watch Party')
    tf = by_name('Watch Party team data.json')
    check(len(root) == 1 and len(tf) == 2 and len({f['parents'][0] for f in tf}) == 2, 'second team gets its own “%s – Watch Party” folder and team data file' % CUDAS)
    check(len([f for f in by_name('Watch Party clip library.json') if f['parents'] == [root[0]['id']]]) == 1, 'second team’s clip library is in its own folder')
    check(state(A, 'lib.teamSync.fileId') in [f['id'] for f in by_name('Watch Party clip library.json') if f['parents'] == [root[0]['id']]], 'second team syncs its own clip library')
    A.evaluate('App.ensurePrivateLibrary()'); A.wait_for_function('window.__bwp.state.lib.privSync && !window.__bwp.lib.busy')
    check(len(by_name('My Watch Party clips (private) – ' + CUDAS)) == 1 and len(by_name('My private clip library – %s.json' % CUDAS)) == 1, 'second team’s private clips get their own folder')
    A.screenshot(path=SHOTS + '/v12-cudas-settings.png', full_page=True)

    # ---- back to the Bulldogs: everything still there
    switch_to(A, 'Bulldogs U10 Blue')
    check(A.text_content('#team-pill').startswith('Bulldogs U10 Blue') and [x['number'] for x in state(A, 'settings.roster')] == ['7'], 'switching back: Bulldogs roster intact')
    check(len(state(A, 'games')) == 1 and state(A, 'sync.fileId') == [f for f in tf if f['parents'] == [by_name('Bulldogs Watch Party')[0]['id']]][0]['id'], 'switching back: Bulldogs games and Drive link intact')
    A.evaluate('App.ensurePrivateLibrary()'); A.wait_for_function('window.__bwp.state.lib.privSync && !window.__bwp.lib.busy')
    check(len(by_name('My Watch Party clips (private)')) == 1 and len(by_name('My private clip library.json')) == 1, 'first team keeps the original private folder name')
    A.click('#team-switch'); A.wait_for_selector('#dlg-teams[open]')
    check(A.locator('#teams-list li').count() == 2 and A.is_visible('button[aria-label="Switch to %s"]' % CUDAS) and not A.is_visible('button[aria-label="Remove Bulldogs U10 Blue"]'), 'Teams dialog: both teams, current one marked, first team can’t be removed')
    A.screenshot(path=SHOTS + '/v12-teams-two.png')
    A.click('#teams-close')

    # ---- a second device for the same Google account (e.g. the phone)
    ctx2 = b.new_context(viewport={'width': 412, 'height': 900})
    P, errP = setup(ctx2, 'a@team.com')
    P.goto(APP + '#settings'); P.wait_for_function('window.__bwp')
    add_team(P, CUDAS)
    settings(P); P.click('button:has-text("Sign in with Google")'); P.click('button:has-text("Open shared team data")')
    P.wait_for_function("window.__bwp.state.sync && !window.__bwp.team.busy", timeout=10000)
    cudas_file = [f for f in tf if f['parents'] == [root[0]['id']]][0]['id']
    check([x['number'] for x in state(P, 'settings.roster')] == ['11'] and state(P, 'sync.fileId') == cudas_file, 'phone: opening shared data on the Barracudas finds the Barracudas file (same name), not the Bulldogs one')
    # a team whose name matches neither: asks which
    add_team(P, 'Spare team', copy=False)
    settings(P); P.click('button:has-text("Open shared team data")')
    P.wait_for_selector('#dlg-choose[open]', timeout=10000)
    names = P.eval_on_selector_all('#choose-list button strong', 'e => e.map(x => x.textContent)')
    check(sorted(names) == sorted(['Bulldogs U10 Blue', CUDAS]), 'when the name doesn’t match, the app asks which team’s data to use: %s' % names)
    P.screenshot(path=SHOTS + '/v12-choose.png')
    P.click('#choose-list button:has-text("Bulldogs U10 Blue")')
    P.wait_for_function("window.__bwp.state.sync && !window.__bwp.team.busy", timeout=10000)
    check([x['number'] for x in state(P, 'settings.roster')] == ['7'] and P.text_content('#team-pill').startswith('Bulldogs U10 Blue'), 'choosing loads that team’s data (and its name)')
    switch_to(P, CUDAS)
    P.click('#team-switch'); P.wait_for_selector('#dlg-teams[open]')
    P.click('button[aria-label="Remove Bulldogs U10 Blue"]'); P.wait_for_selector('#dlg-ask[open]'); P.click('#ask-ok')
    P.wait_for_function("document.querySelectorAll('#teams-list li').length === 2")
    dbs = P.evaluate("indexedDB.databases().then(d => d.map(x => x.name))")
    check(len([d for d in dbs if d.startswith('bwp-data')]) == 2, 'removing a team deletes its data from this browser: %s' % dbs)
    w = P.evaluate('document.documentElement.scrollWidth')
    check(w <= 412, 'phone: Teams dialog fits (%d)' % w)
    P.screenshot(path=SHOTS + '/v12-phone-teams.png')

    # ---- two tabs on different teams don't overwrite each other
    T2 = ctx.new_page(); T2.goto(APP + '#games'); T2.wait_for_function('window.__bwp')
    check(T2.text_content('#team-pill').startswith('Bulldogs U10 Blue'), 'a new tab opens the last team used')
    check(not errA and not errP, 'no page errors: ' + '; '.join((errA + errP)[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
