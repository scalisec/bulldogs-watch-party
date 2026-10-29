"""Browser test for v2.0.2: team folders deleted in Google Drive (or never made) are found, and the app asks before
creating them. First-time setup creates them without asking (the coach started it). If the team data file is moved,
its new folder becomes the team folder. Runs against the simulated Google sign-in, Picker and Drive.
usage: python3 tests/e2e_v202.py <screenshot-dir>"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v202'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, new_file, grant = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['new_file'], g['grant']

def live(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
def folders(page): return page.evaluate('window.__bwp.state.lib.team.folders')
def lib_idle(page): page.wait_for_function('!window.__bwp.lib.busy', timeout=10000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 1000})
    A, errA = setup(ctx, 'a@team.com')
    A.goto(APP + '#team/roster'); A.wait_for_function('window.__bwp')
    for n, f, l in [('7', 'Sam', 'Smith'), ('11', 'Ava', 'Scali')]:
        A.fill('#r-num', n); A.fill('#r-name', f); A.fill('#r-last', l); A.click('#roster-add button[type=submit]')

    # ---- first-time setup: folders are created without a prompt (the coach pressed the button)
    settings(A)
    A.click('button:has-text("Sign in with Google")')
    A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy", timeout=10000)
    lib_idle(A)
    check(not A.is_visible('#dlg-ask[open]') and len(live('Family – #7 S. Smith')) == 1 and len(live('Team clips')) == 1, 'setup creates the team folders without asking')

    # ---- in Drive: #7's folder goes to the trash, #11's is deleted for good, the team data file moves to a new folder
    f7 = live('Family – #7 S. Smith')[0]; f7['trashed'] = True
    f11 = live('Family – #11 A. Scali')[0]; del drive[f11['id']]
    newhome = new_file('a@team.com', 'Bulldogs Watch Party (moved)', 'application/vnd.google-apps.folder', [])
    grant('a@team.com', newhome['id'])
    g['team_file']()['parents'] = [newhome['id']]

    # ---- the next sync finds them and asks
    A.reload(); A.wait_for_function('window.__bwp')
    A.wait_for_selector('#dlg-ask[open]', timeout=10000)
    h = A.text_content('#ask-h'); msg = A.text_content('#ask-msg') if A.locator('#ask-msg').count() else A.text_content('#dlg-ask')
    check('Create 2 team folders' in h, 'asks before creating: ' + h)
    check('#7 S. Smith (deleted in Drive)' in msg and '#11 A. Scali (deleted in Drive)' in msg and 'Bulldogs Watch Party' in msg, 'lists the deleted folders and where they’ll go: ' + msg)
    check(A.text_content('#ask-ok') == 'Create folders', 'button says Create folders')
    A.screenshot(path=SHOTS + '/v202-ask.png')
    A.click('#ask-cancel'); lib_idle(A)
    check(len(live('Family – #7 S. Smith')) == 0 and len(live('Family – #11 A. Scali')) == 0, '“Not now” creates nothing')
    A.evaluate('App.libSyncAll(false)'); A.wait_for_timeout(800); lib_idle(A)
    check(not A.is_visible('#dlg-ask[open]'), 'after “Not now”, a later sync doesn’t ask again')
    check(A.evaluate('window.__bwp.state.sync.folderId') == newhome['id'], 'the moved team data file’s folder becomes the team folder')

    # ---- Team › Drive and access › Check for missing folders → ask → create
    team(A, 'admin')
    A.click('button:has-text("Check for missing folders")')
    A.wait_for_selector('#dlg-ask[open]', timeout=10000)
    A.click('#ask-ok')
    A.wait_for_function("document.querySelector('.toast') && [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Created 2 team folders'))", timeout=10000)
    n7 = live('Family – #7 S. Smith'); n11 = live('Family – #11 A. Scali')
    check(len(n7) == 1 and len(n11) == 1 and n7[0]['parents'] == [newhome['id']] and n11[0]['parents'] == [newhome['id']], 'both folders re-created inside the team folder')
    fo = folders(A)
    check(fo['player:7'] == n7[0]['id'] and fo['player:11'] == n11[0]['id'] and fo['root'] == newhome['id'], 'the clip library points at the new folders')
    A.click('button:has-text("Check for missing folders")')
    A.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('All 4 team folders are in Google Drive'))", timeout=10000)
    check(not A.is_visible('#dlg-ask[open]'), 'nothing missing: no prompt, just “All 4 team folders are in Google Drive”')
    A.screenshot(path=SHOTS + '/v202-admin.png', full_page=True)

    # ---- a new player: asks before making their folder
    team(A, 'roster'); A.fill('#r-num', '30'); A.fill('#r-name', 'Max'); A.fill('#r-last', 'Goal'); A.click('#roster-add button[type=submit]')
    A.evaluate('App.libSyncAll(true); 0')
    A.wait_for_selector('#dlg-ask[open]', timeout=10000)
    check('Family – #30 M. Goal' in A.text_content('#dlg-ask') and 'deleted' not in A.text_content('#dlg-ask'), 'a new player’s folder is offered (not called deleted): ' + A.text_content('#dlg-ask'))
    A.click('#ask-ok'); lib_idle(A); A.wait_for_timeout(300)
    check(len(live('Family – #30 M. Goal')) == 1, 'created after saying yes')
    check(not errA, 'no page errors: ' + '; '.join(errA[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
