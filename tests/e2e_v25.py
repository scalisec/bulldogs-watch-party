"""Browser test for v2.5.0: the join link. A coach copies it from Team › Coaches (it's also in Google's share email);
opening it on a phone shows "Join <team>", and Google's picker opens right inside the team folder.
Runs against the simulated Google sign-in, Picker and Drive in e2e_drive.py.
usage: python3 tests/e2e_v25.py <screenshot-dir>"""
import json, os, sys
from urllib.parse import unquote
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v25'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, calls, root_items, GAPI = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['calls'], g['root_items'], g['GAPI']
PHONE = {'viewport': {'width': 412, 'height': 915}, 'is_mobile': True, 'has_touch': True,
         'user_agent': 'Mozilla/5.0 (Linux; Android 14; SM-S921W) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'}
# the Picker, also noting which folder it opened in
GAPI2 = GAPI.replace("DocsView: function () { ['setMimeTypes', 'setQuery', 'setIncludeFolders', 'setSelectFolderEnabled', 'setParent', 'setOwnedByMe'].forEach((m) => { this[m] = () => this; }); },",
                     "DocsView: function () { ['setMimeTypes', 'setQuery', 'setIncludeFolders', 'setSelectFolderEnabled', 'setOwnedByMe'].forEach((m) => { this[m] = () => this; }); this.setParent = (id) => { window.__pickParent = id; return this; }; },")
assert GAPI2 != GAPI

def live(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
shares = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA = b.new_context(viewport={'width': 1280, 'height': 1000}, permissions=['clipboard-read', 'clipboard-write'])
    A, errA = setup(ctxA, 'a@team.com')
    A.on('request', lambda r: shares.append(r.url) if '/permissions' in r.url else None)
    team(A, 'coaches'); A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'b@team.com'); A.click('button:has-text("Add coach")')
    check(A.text_content('#coach-invite').strip() == '', 'before team data exists: no join link yet')
    settings(A); A.click('button:has-text("Sign in with Google")'); A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy && !window.__bwp.lib.busy", timeout=10000)
    A.wait_for_function("(window.__bwp.state.sync.sharedWith || []).includes('b@team.com')", timeout=5000)
    root = live('Bulldogs Watch Party')[0]
    team(A, 'coaches')
    url = A.input_value('#invite-url')
    check(url.endswith('#join/%s/Bulldogs%%20U10%%20Blue' % root['id']) or ('#join/' + root['id'] + '/') in url, 'Team › Coaches shows the join link: ' + url)
    A.click('#invite-card button:has-text("Copy link")')
    check(A.evaluate('navigator.clipboard.readText()') == url, 'Copy link copies it')
    A.screenshot(path=SHOTS + '/v25-coaches.png', full_page=True)
    team(A, 'admin')
    check(A.is_visible('#invite-card-admin') and A.input_value('#invite-url-admin') == url, 'and Drive and access shows it too')
    msg = unquote(next(u for u in shares if 'emailMessage=' in u).split('emailMessage=')[1].split('&')[0])
    check(('#join/' + root['id']) in msg and 'tap Join' in msg, 'Google’s share email includes the join link: ' + msg[:120])

    # ---- the coach opens the link on a phone
    ctxB = b.new_context(**PHONE)
    B, errB = setup(ctxB, 'b@team.com')
    ctxB.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GAPI2))
    link = APP + url[url.index('#'):]
    B.goto(link); B.wait_for_selector('#rv-connect-panel', timeout=8000)
    check(B.url.endswith('#review'), 'the link opens Review')
    t = B.text_content('#rv-connect-panel')
    check('invited to join Bulldogs U10 Blue' in t and 'right inside the team’s folder' in t, 'Review: “You’re invited to join Bulldogs U10 Blue”')
    check(B.is_visible('#rv-connect button:has-text("Join Bulldogs U10 Blue")'), 'with a Join button')
    B.screenshot(path=SHOTS + '/v25-phone-join.png')
    B.reload(); B.wait_for_selector('#rv-connect button:has-text("Join Bulldogs U10 Blue")')
    check(True, 'the invitation is kept after a reload (sign-in can take a while)')
    B.evaluate('(d) => { window.__fakePickDocs = d; }', root_items())
    B.click('#rv-connect button:has-text("Join Bulldogs U10 Blue")')
    B.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.lib.busy && !window.__bwp.team.busy", timeout=10000)
    check(B.evaluate('window.__pickParent') == root['id'], 'Google’s picker opened right inside the team folder (no browsing)')
    check(B.evaluate("!localStorage.getItem('bwp-join')") and 'connected as b@team.com' in B.text_content('#rv-lib-status'), 'connected; the invitation is used up')

    # opening the link again on a connected device
    B.goto(link); B.wait_for_timeout(500)
    check('already connected to Bulldogs U10 Blue' in B.text_content('#toasts'), 'opening it again: “already connected”')
    B.goto(APP + '#join/b!d'); B.wait_for_timeout(300)
    check('isn’t complete' in B.text_content('#toasts'), 'a broken link says so')
    check(not errA and not errB, 'no page errors: ' + '; '.join((errA + errB)[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
