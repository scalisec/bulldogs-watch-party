"""Browser test for v2.4.0: connecting another device (a phone) to see the team's clips. Review shows where this device
stands and one "Connect this device" button; Google failures are explained in plain words. Runs against the simulated
Google sign-in, Picker and Drive in e2e_drive.py.
usage: python3 tests/e2e_v24.py <screenshot-dir>"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v24'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, new_file, grant, root_items = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['new_file'], g['grant'], g['root_items']
CLIP = open(sorted(glob.glob(os.path.join(HERE, 'fixtures', 'media', '*.mp4')))[0], 'rb').read()
PHONE = {'viewport': {'width': 412, 'height': 915}, 'is_mobile': True, 'has_touch': True,
         'user_agent': 'Mozilla/5.0 (Linux; Android 14; SM-S921W) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'}

def live(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
def panel(page): return page.text_content('#rv-connect') or ''
def review(page):
    page.goto(APP + '#review'); page.wait_for_selector('#view-review:not(.hidden)'); page.wait_for_timeout(150)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    # ---- the head coach (computer) sets up the team and has a clip saved to Drive
    ctxA = b.new_context(viewport={'width': 1280, 'height': 1000})
    A, errA = setup(ctxA, 'a@team.com')
    team(A, 'coaches'); A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'b@team.com'); A.click('button:has-text("Add coach")')
    team(A, 'roster'); A.fill('#r-num', '7'); A.fill('#r-name', 'Sam'); A.click('#roster-add button[type=submit]')
    settings(A)
    check('not connected' in A.text_content('#sync-badge'), 'computer before setup: header says “This device: not connected”')
    A.click('button:has-text("Sign in with Google")')
    A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy && !window.__bwp.lib.busy", timeout=10000)
    A.wait_for_function("window.__bwp.state.sync.sharedWith && window.__bwp.state.sync.sharedWith.includes('b@team.com')", timeout=5000)
    check('connected as a@team.com' in A.text_content('#device-status'), 'Settings leads with this device’s status: ' + A.text_content('#device-status'))
    clipfolder = live('Team clips')[0]
    vid = new_file('a@team.com', 'Goal - #7 Sam.mp4', 'video/mp4', [clipfolder['id']], CLIP)
    lf = live('Watch Party clip library.json')[0]
    lib = json.loads(lf['content'])
    lib['entries']['clip_1'] = {'id': 'clip_1', 'gameId': 'game_1', 'game': {'date': '2026-10-25', 'opponent': 'Hawks', 'rink': 'Sports Park', 'type': 'league', 'homeAway': 'home', 'result': '', 'title': 'Oct 25 vs Hawks'},
        'categoryId': 'goal', 'alsoCats': [], 'category': 'Goal', 'color': '#16A34A', 'events': [], 'players': [7], 'positions': [], 'flag': 'do', 'note': 'Nice finish',
        'zone': '', 'situation': 'even', 'penalties': [], 'starred': False, 'tags': [], 'private': False, 'start': 10, 'end': 18, 'period': 1, 'periodTime': 10,
        'score': {'for': 0, 'against': 0}, 'state': 'tied', 'features': {}, 'drive': [{'folder': 'team', 'fileId': vid['id'], 'name': vid['name']}], 'by': 'Coach A', 'owner': 'a@team.com'}
    lf['content'] = json.dumps(lib); lf['version'] += 1

    # ---- coach B's phone: never connected
    ctxB = b.new_context(**PHONE)
    B, errB = setup(ctxB, 'b@team.com')
    review(B)
    check('This device: not connected' in B.text_content('#sync-badge'), 'phone header says “This device: not connected”')
    check(B.is_visible('#rv-connect-panel') and B.is_visible('#rv-connect button:has-text("Connect this device")'), 'Review shows a “Connect this device” button')
    check('select everything inside it' in panel(B), 'and explains the one-time picker step')
    check('Connect this device (above)' in B.text_content('#rv-results'), 'the empty list points at the button, not at Settings')
    check(B.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'phone: nothing runs off the side of the screen')
    B.screenshot(path=SHOTS + '/v24-phone-not-connected.png')

    # the picker closes with nothing selected: say what to do (and what an API-key error means)
    B.evaluate('window.__fakePickDocs = []')
    B.click('#rv-connect button:has-text("Connect this device")')
    B.wait_for_selector('#rv-connect .cnote', timeout=8000)
    note = B.text_content('#rv-connect .cnote')
    check('Bulldogs Watch Party' in note and 'Shared with me' in note and 'API developer key' in note and 'scalisec.github.io/*' in note, 'picker closed: plain help, including the API key fix: ' + note[:90])
    check(B.evaluate('!window.__bwp.state.sync'), 'and nothing is half-connected')

    # connect for real: one tap signs in, the picker opens, everything inside the folder is selected
    B.evaluate('(d) => { window.__fakePickDocs = d; }', root_items())
    B.click('#rv-connect button:has-text("Connect this device")')
    B.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && Object.keys(window.__bwp.state.lib.team.entries).length === 1 && !window.__bwp.lib.busy && !window.__bwp.team.busy", timeout=10000)
    B.wait_for_timeout(300)
    check(B.text_content('#rv-lib-status') == 'This device: connected as b@team.com · 1 team clip', 'status line: ' + B.text_content('#rv-lib-status'))
    check(not B.is_visible('#rv-connect-panel'), 'connected: the panel goes away')
    check(B.locator('.rvcard').count() == 1 and 'Oct 25 vs Hawks' in B.text_content('.rvcard'), 'the coach’s Drive clip is listed on the phone')
    check('Team data synced' in B.text_content('#sync-badge'), 'header shows team data synced')
    B.screenshot(path=SHOTS + '/v24-phone-connected.png')
    grant('b@team.com', vid['id'])  # picking the team folder gives the app its clips (the fake Picker only grants what's picked)
    B.click('.rvcard')
    B.wait_for_selector('#rv-stage video', timeout=8000)
    check(B.evaluate("document.querySelector('#rv-stage video').src.startsWith('blob:')"), 'tapping it plays the clip from Drive')
    B.click('#rv-close')

    # an hour later: signed out. The list stays; a button signs back in, and the clip plays
    B.evaluate('WPDrive.signOut(); App.renderReview()')
    check('signed out of Google (b@team.com)' in panel(B) and B.is_visible('#rv-connect button:has-text("Sign in with Google")'), 'signed out: says so, with a Sign in button')
    check(B.locator('.rvcard').count() == 1, 'the clip list is still there while signed out')
    B.click('.rvcard')
    B.wait_for_selector('#rv-stage button:has-text("Sign in with Google")')
    check('saved in Google Drive. Sign in to play it' in B.text_content('#rv-stage'), 'playing a Drive clip signed out: explains and offers sign-in')
    B.click('#rv-stage button:has-text("Sign in with Google")')
    B.wait_for_selector('#rv-stage video', timeout=8000)
    check(True, 'after signing in, the clip plays')
    B.click('#rv-close')
    B.screenshot(path=SHOTS + '/v24-phone-played.png')

    # plain-language errors
    r = B.evaluate("WPDrive.getMeta('missing').then(() => null, (e) => ({ m: e.message, raw: e.raw, code: e.code }))")
    check(r and r['code'] == 404 and 'can’t find that file' in r['m'] and r['raw'].startswith('File not found'), 'Drive “not found” is explained, Google’s words kept for the log: %s' % r)
    B.evaluate("WPDrive.signOut(); google.accounts.oauth2.initTokenClient = (o) => ({ requestAccessToken() { setTimeout(() => o.error_callback({ type: 'popup_failed_to_open', message: 'Failed to open popup window' }), 10); } }); App.renderReview()")
    B.click('#rv-connect button:has-text("Sign in with Google")')
    B.wait_for_selector('#rv-connect .cnote', timeout=8000)
    check('blocked Google’s sign-in window' in B.text_content('#rv-connect .cnote') and 'Pop-ups' in B.text_content('#rv-connect .cnote'), 'blocked sign-in window: tells the coach to allow pop-ups')

    # ---- a second device on the same Google account connects on its own: no picker
    ctxC = b.new_context(**PHONE)
    C, errC = setup(ctxC, 'b@team.com')
    review(C)
    C.click('#rv-connect button:has-text("Connect this device")')
    C.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && Object.keys(window.__bwp.state.lib.team.entries).length === 1 && !window.__bwp.lib.busy", timeout=10000)
    check(C.evaluate('!window.__pickCount'), 'same account on another device: connects without the file picker')
    check(not errA and not errB and not errC, 'no page errors: ' + '; '.join((errA + errB + errC)[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
