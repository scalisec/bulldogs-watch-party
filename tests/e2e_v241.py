"""Browser test for v2.4.1: the Google sign-in is kept when the app is closed, and after the hour runs out one tap
reconnects (no account chooser, no typing): going to Review, tapping a Drive clip, or tapping the header.
Runs against the simulated Google sign-in, Picker and Drive in e2e_drive.py.
usage: python3 tests/e2e_v241.py <screenshot-dir>"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v241'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, new_file, grant, root_items = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['new_file'], g['grant'], g['root_items']
CLIP = open(sorted(glob.glob(os.path.join(HERE, 'fixtures', 'media', '*.mp4')))[0], 'rb').read()
PHONE = {'viewport': {'width': 412, 'height': 915}, 'is_mobile': True, 'has_touch': True,
         'user_agent': 'Mozilla/5.0 (Linux; Android 14; SM-S921W) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'}
# Google sign-in that records what the app asked for (quiet = no account chooser)
GIS = """
window.__gis = JSON.parse(localStorage.getItem('__gis') || '[]');
window.google = window.google || {};
google.accounts = { oauth2: {
  initTokenClient(o) { return { requestAccessToken(req) {
    window.__gis.push(req || {}); localStorage.setItem('__gis', JSON.stringify(window.__gis));
    setTimeout(() => o.callback({ access_token: 'tok:' + (window.__fakeUser || 'a@team.com'), expires_in: 3600 }), 10); } }; },
  revoke(t, cb) { cb && cb(); }
} };"""

def live(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
def gis(page): return page.evaluate("JSON.parse(localStorage.getItem('__gis') || '[]')")
def expire(page): page.evaluate("(() => { const k = 'bwp-google-token'; const t = JSON.parse(localStorage.getItem(k)); t.exp = Date.now() - 1000; localStorage.setItem(k, JSON.stringify(t)); })()")
def badge(page): return page.text_content('#sync-badge')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctxA = b.new_context(viewport={'width': 1280, 'height': 1000})
    A, errA = setup(ctxA, 'a@team.com')
    team(A, 'coaches'); A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'b@team.com'); A.click('button:has-text("Add coach")')
    settings(A); A.click('button:has-text("Sign in with Google")'); A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy && !window.__bwp.lib.busy", timeout=10000)
    A.wait_for_function("(window.__bwp.state.sync.sharedWith || []).includes('b@team.com')", timeout=5000)
    vid = new_file('a@team.com', 'Goal.mp4', 'video/mp4', [live('Team clips')[0]['id']], CLIP)
    lf = live('Watch Party clip library.json')[0]
    lib = json.loads(lf['content'])
    lib['entries']['clip_1'] = {'id': 'clip_1', 'gameId': 'game_1', 'game': {'date': '2026-10-25', 'opponent': 'Hawks', 'rink': '', 'type': 'league', 'homeAway': 'home', 'result': '', 'title': 'Oct 25 vs Hawks'},
        'categoryId': 'goal', 'alsoCats': [], 'category': 'Goal', 'color': '#16A34A', 'events': [], 'players': [7], 'positions': [], 'flag': 'do', 'note': '',
        'zone': '', 'situation': 'even', 'penalties': [], 'starred': False, 'tags': [], 'private': False, 'start': 10, 'end': 18, 'period': 1, 'periodTime': 10,
        'score': {'for': 0, 'against': 0}, 'state': 'tied', 'features': {}, 'drive': [{'folder': 'team', 'fileId': vid['id'], 'name': vid['name']}], 'by': 'Coach A', 'owner': 'a@team.com'}
    lf['content'] = json.dumps(lib); lf['version'] += 1

    # ---- the phone connects once (account chooser the first time)
    ctxB = b.new_context(**PHONE)
    B, errB = setup(ctxB, 'b@team.com')
    ctxB.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GIS))
    B.goto(APP + '#review'); B.wait_for_selector('#rv-connect button')
    B.evaluate('(d) => { window.__fakePickDocs = d; }', root_items())
    B.click('#rv-connect button:has-text("Connect this device")')
    B.wait_for_function("window.__bwp.state.lib.teamSync && Object.keys(window.__bwp.state.lib.team.entries).length === 1 && !window.__bwp.lib.busy", timeout=10000)
    grant('b@team.com', vid['id'])
    check(gis(B)[0].get('prompt') is None, 'first sign-in on the phone shows Google’s account chooser as usual')

    # ---- close the app and open it again (within the hour): still signed in
    B.close()
    B = ctxB.new_page(); B.on('pageerror', lambda e: errB.append(str(e)))
    B.goto(APP + '#review'); B.wait_for_function('window.__bwp')
    B.wait_for_timeout(1500)
    check(B.evaluate('WPDrive.hasToken()'), 'reopened within the hour: still signed in')
    check('Team data synced' in badge(B) and not B.is_visible('#rv-connect .connect'), 'no sign-in prompt, header shows synced')
    check(len(gis(B)) == 1, 'Google wasn’t asked again')

    # ---- the hour runs out; reopen the app: one tap reconnects
    expire(B); B.goto(APP + '#games'); B.reload(); B.wait_for_function('window.__bwp'); B.wait_for_timeout(500)
    check(not B.evaluate('WPDrive.hasToken()') and len(gis(B)) == 1, 'after the hour: signed out, and nothing opens on its own (no tap yet)')
    check(badge(B) == 'Tap to reconnect to Google', 'header: ' + badge(B))
    B.click('nav a[data-nav="review"]')
    B.wait_for_function('WPDrive.hasToken()', timeout=5000)
    last = gis(B)[-1]
    check(last.get('prompt') == '' and last.get('login_hint') == 'b@team.com', 'tapping Review reconnects quietly (no account chooser): %s' % last)
    B.wait_for_function("!window.__bwp.lib.busy && !window.__bwp.team.busy", timeout=8000)
    check('Team data synced' in badge(B), 'and catches up: ' + badge(B))
    B.screenshot(path=SHOTS + '/v241-reconnected.png')

    # tapping a Drive clip after the hour: reconnects, then plays
    expire(B); B.reload(); B.wait_for_function('window.__bwp'); B.wait_for_selector('.rvcard')
    n = len(gis(B))
    check(len(gis(B)) == n and 'one tap reconnects' in B.text_content('#rv-connect') and B.is_visible('#rv-connect button:has-text("Reconnect")'), 'Review opened without a tap: says one tap reconnects')
    B.screenshot(path=SHOTS + '/v241-paused.png')
    B.click('.rvcard')
    B.wait_for_selector('#rv-stage video', timeout=8000)
    check(len(gis(B)) == n + 1 and gis(B)[-1].get('prompt') == '', 'tapping a Drive clip reconnects quietly and plays it')
    B.click('#rv-close')

    # the header link reconnects too
    expire(B); B.goto(APP + '#games'); B.reload(); B.wait_for_function('window.__bwp'); B.wait_for_timeout(300)
    B.click('#sync-badge')
    B.wait_for_function('WPDrive.hasToken()', timeout=5000)
    check(gis(B)[-1].get('prompt') == '' and '#games' in B.url, 'tapping “Tap to reconnect to Google” reconnects in place')

    # Google turns the pass down early (401): signed out, but the next reconnect is still quick
    B.evaluate("localStorage.setItem('bwp-google-token', JSON.stringify({ token: 'expired-early', exp: Date.now() + 3e6 }))"); B.reload(); B.wait_for_function('window.__bwp')
    B.evaluate("WPDrive.getMeta('x').catch(() => 0)"); B.wait_for_timeout(300)
    check(not B.evaluate('WPDrive.hasToken()') and B.evaluate('WPDrive.remembered()'), 'a refused pass is dropped; reconnecting stays one tap')

    # Stop syncing on this device: forgets the sign-in completely
    B.goto(APP + '#settings'); B.wait_for_selector('#view-settings:not(.hidden)'); B.wait_for_function('WPDrive.hasToken()', timeout=5000)
    B.click('button:has-text("Stop syncing on this device")'); B.wait_for_selector('#dlg-ask[open]'); B.click('#ask-ok'); B.wait_for_timeout(200)
    check(B.evaluate("!WPDrive.hasToken() && !WPDrive.remembered() && !localStorage.getItem('bwp-google-token')"), 'Stop syncing forgets the Google sign-in on this device')
    check(not errA and not errB, 'no page errors: ' + '; '.join((errA + errB)[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
