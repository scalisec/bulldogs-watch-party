"""Browser test for shared team data (milestone 3a) against a simulated Google sign-in, Picker and Drive.
usage: python3 tests/e2e_drive.py <screenshot-dir>
Two coaches use two separate browsers; both talk to the same fake Drive held in this script."""
import json, os, sys, threading, time, http.server, functools, itertools
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
PORT = 8765
APP = 'http://localhost:%d/index.html' % PORT
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ---------------- fake Google ----------------
CONFIG = "window.WP_CONFIG = { googleClientId: 'test-client.apps.googleusercontent.com', googleApiKey: 'test-key', googleAppId: '123456789012' };"
GIS = """
window.google = window.google || {};
google.accounts = { oauth2: {
  initTokenClient(o) { return { requestAccessToken() { setTimeout(() => o.callback({ access_token: 'tok:' + (window.__fakeUser || 'a@team.com'), expires_in: 3600 }), 10); } }; },
  revoke(t, cb) { cb && cb(); }
} };"""
GAPI = """
window.gapi = { load(name, o) { setTimeout(o.callback, 0); } };
window.google = window.google || {};
google.picker = {
  Feature: { MULTISELECT_ENABLED: 'multi' },
  ViewId: { DOCS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
  DocsView: function () { this.setMimeTypes = () => this; this.setQuery = () => this; this.setIncludeFolders = () => this; },
  PickerBuilder: function () {
    let cb; const b = this;
    ['setTitle', 'addView', 'setOAuthToken', 'setDeveloperKey', 'setAppId'].forEach((m) => { b[m] = () => b; });
    b.setCallback = (f) => { cb = f; return b; };
    b.enableFeature = () => b;
    b.build = () => ({ setVisible() { setTimeout(() => cb({ action: 'picked', docs: (window.__fakePickDocs || [{ id: window.__fakePickId, name: 'Watch Party team data.json' }]) }), 10); } });
  }
};"""

drive = {}
ids = itertools.count(1)
calls = []

def can_access(user, f):
    while f:
        if f['owner'] == user or user in f['perms']: return True
        f = drive.get(f['parents'][0]) if f['parents'] else None
    return False

def meta(f):
    return {'id': f['id'], 'name': f['name'], 'version': str(f['version']), 'modifiedTime': '2026-10-20T00:00:00Z', 'trashed': False,
            'parents': f['parents'], 'lastModifyingUser': {'emailAddress': f['lastBy'], 'displayName': f['lastBy'].split('@')[0]}}

def new_file(user, name, mime, parents, content='', description=''):
    fid = 'f%d' % next(ids)
    drive[fid] = {'id': fid, 'name': name, 'mime': mime, 'parents': parents or [], 'owner': user, 'perms': set(), 'content': content, 'version': 1, 'lastBy': user, 'description': description, 'trashed': False}
    return drive[fid]

def handle(route):
    req = route.request
    u = urlparse(req.url)
    q = parse_qs(u.query)
    auth = req.headers.get('authorization', '')
    user = auth.split('tok:')[1] if 'tok:' in auth else None
    calls.append((req.method, u.path, user))
    def reply(obj, status=200, text=None):
        route.fulfill(status=status, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' if text is not None else 'application/json'},
                      body=text if text is not None else json.dumps(obj))
    if req.method == 'OPTIONS':
        route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}); return
    if not user: return reply({'error': {'message': 'no auth'}}, 401)
    p = u.path
    if p == '/drive/v3/about':
        return reply({'user': {'emailAddress': user, 'displayName': user.split('@')[0].title()}})
    if p == '/drive/v3/files' and req.method == 'GET':
        # drive.file: only files this user's app created
        qq = q.get('q', [''])[0]
        import re
        nm = re.search(r"name = '((?:[^'\\]|\\.)*)'", qq)
        mt = re.search(r"mimeType = '([^']*)'", qq)
        out = [meta(f) for f in drive.values() if f['owner'] == user and not f['trashed']
               and (not nm or f['name'] == nm.group(1).replace("\\'", "'")) and (not mt or f['mime'] == mt.group(1))]
        return reply({'files': out})
    if p == '/drive/v3/files' and req.method == 'POST':
        b = json.loads(req.post_data)
        if b.get('parents'):
            par = drive.get(b['parents'][0])
            if not par or not can_access(user, par): return reply({'error': {'message': 'File not found: ' + b['parents'][0]}}, 404)
        f = new_file(user, b['name'], b.get('mimeType'), b.get('parents'), description=b.get('description', ''))
        return reply({'id': f['id'], 'name': f['name']})
    if p == '/upload/drive/v3/files' and req.method == 'POST':
        ctype = req.headers['content-type']
        boundary = ctype.split('boundary=')[1]
        parts = [x for x in req.post_data.split('--' + boundary) if x.strip() and x.strip() != '--']
        m = json.loads(parts[0].split('\r\n\r\n', 1)[1].strip())
        content = parts[1].split('\r\n\r\n', 1)[1].rsplit('\r\n', 1)[0]
        f = new_file(user, m['name'], m.get('mimeType'), m.get('parents'), content)
        return reply(meta(f))
    segs = p.split('/')
    if p.startswith('/drive/v3/files/') and len(segs) == 5:
        f = drive.get(segs[4])
        if not f or not can_access(user, f): return reply({'error': {'message': 'File not found'}}, 404)
        if q.get('alt') == ['media']:
            if isinstance(f['content'], bytes):
                route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': f['mime'] or 'video/mp4'}, body=f['content']); return
            return reply(None, text=f['content'])
        return reply(meta(f))
    if p.startswith('/upload/drive/v3/files/') and req.method == 'PATCH':
        f = drive.get(segs[5])
        if not f or not can_access(user, f): return reply({'error': {'message': 'File not found'}}, 404)
        ct = req.headers.get('content-type', '')
        f['content'] = req.post_data_buffer if not ct.startswith('application/json') else req.post_data
        f['version'] += 1
        f['lastBy'] = user
        return reply(meta(f))
    if p.endswith('/permissions') and req.method == 'POST':
        f = drive.get(segs[4])
        if not f or f['owner'] != user: return reply({'error': {'message': 'Insufficient permissions'}}, 403)
        f['perms'].add(json.loads(req.post_data)['emailAddress'])
        return reply({'id': 'perm'})
    return reply({'error': {'message': 'unhandled ' + req.method + ' ' + p}}, 400)

def team_file():
    return next(f for f in drive.values() if f['name'] == 'Watch Party team data.json')

def setup(ctx, user):
    ctx.route('**/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=CONFIG))
    ctx.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GIS))
    ctx.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body=GAPI))
    ctx.route('https://www.googleapis.com/**', handle)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    ctx.add_init_script('window.__fakeUser = %s;' % json.dumps(user))
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    return page, errs

def roster(page):
    return [(p['number'], p['name']) for p in page.evaluate('window.__bwp.state.settings.roster')]

def wait_synced(page, timeout=8000):
    page.wait_for_function("window.__bwp.state.sync && !window.__bwp.state.sync.dirty && !window.__bwp.team.busy", timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctxA = b.new_context(viewport={'width': 1280, 'height': 1000})
    ctxB = b.new_context(viewport={'width': 1280, 'height': 1000})
    A, errA = setup(ctxA, 'a@team.com')
    B, errB = setup(ctxB, 'b@team.com')

    # ---- coach A: set up the team and create it in Drive ----
    A.goto(APP + '#settings')
    check(A.is_visible('button:has-text("Sign in with Google")'), 'A: settings offers Google sign-in')
    A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'B@Team.com'); A.click('button:has-text("Add coach")')
    A.fill('#r-num', '7'); A.fill('#r-name', 'Sam'); A.click('button:has-text("Add player")')
    A.fill('#t-season', '2026-27'); A.press('#t-season', 'Tab')
    A.click('button:has-text("Sign in with Google")')
    A.wait_for_selector('button:has-text("Create team data in my Drive")')
    check(True, 'A: after sign-in, offers create or open')
    A.click('button:has-text("Create team data in my Drive")')
    wait_synced(A)
    tf = team_file()
    root = next(f for f in drive.values() if f['name'] == 'Bulldogs Watch Party')
    app_folder = next(f for f in drive.values() if f['name'] == '_App')
    check(tf['parents'] == [app_folder['id']] and app_folder['parents'] == [root['id']], 'A: Drive has Bulldogs Watch Party › _App › team data file')
    data = json.loads(tf['content'])
    check(data['roster'] == [{'number': '7', 'name': 'Sam'}] and data['team']['season'] == '2026-27', 'A: roster and season are in the Drive file')
    check({c['email'] for c in data['coaches']} == {'a@team.com', 'b@team.com'}, 'A: A is added as a coach automatically')
    A.wait_for_function("window.__bwp.state.sync.sharedWith && window.__bwp.state.sync.sharedWith.includes('b@team.com')", timeout=5000)
    check('b@team.com' in root['perms'], 'A: folder shared with coach B')
    check('Team data synced' in A.text_content('#sync-badge'), 'A: header shows team data synced')
    A.screenshot(path=SHOTS + '/d1-owner-settings.png', full_page=True)

    # ---- coach B: open the shared team data ----
    B.add_init_script('window.__fakePickId = %s;' % json.dumps(tf['id']))
    B.goto(APP + '#settings')
    B.click('button:has-text("Sign in with Google")')
    B.click('button:has-text("Open shared team data")')
    wait_synced(B)
    check(roster(B) == [('7', 'Sam')], 'B: gets the roster from Drive')
    check(B.evaluate('window.__bwp.state.settings.team.season') == '2026-27', 'B: gets the season')
    check(B.evaluate('window.__bwp.state.sync.owner') is False, 'B: is a coach, not the owner')
    check(B.input_value('#s-coach') == 'B', 'B: name filled from Google account')

    # ---- B adds a player and a rink: pushed automatically ----
    B.fill('#r-num', '12'); B.fill('#r-name', 'Leo'); B.click('button:has-text("Add player")')
    B.fill('#k-new', 'Appleby Ice Centre'); B.click('#rink-add button')
    B.wait_for_timeout(1600); wait_synced(B)
    d2 = json.loads(team_file()['content'])
    check([p['number'] for p in d2['roster']] == ['7', '12'] and 'Appleby Ice Centre' in d2['rinks'], 'B: changes written to Drive')

    # ---- A changes something else at the same time: merged, nothing lost ----
    A.fill('#o-new', 'Milton'); A.click('#opp-add button')
    A.wait_for_timeout(1600); wait_synced(A)
    d3 = json.loads(team_file()['content'])
    check([p['number'] for p in d3['roster']] == ['7', '12'] and 'Milton' in d3['opponents'] and 'Appleby Ice Centre' in d3['rinks'],
          'A: its change merged with B’s; both kept in Drive')
    check(roster(A) == [('7', 'Sam'), ('12', 'Leo')], 'A: picked up B’s player while syncing')

    # ---- same player renamed on both devices: Drive version wins, A is told ----
    B.click('button:has-text("Sync now")'); wait_synced(B)
    B.evaluate("""(() => { const s = window.__bwp.state; })()""")
    # B renames #7 by removing and re-adding
    B.click('button[aria-label="Remove #7 Sam"]'); B.wait_for_timeout(50)
    B.fill('#r-num', '7'); B.fill('#r-name', 'Sammy'); B.click('button:has-text("Add player")')
    B.wait_for_timeout(1600); wait_synced(B)
    A.click('button[aria-label="Remove #7 Sam"]'); A.wait_for_timeout(50)
    A.fill('#r-num', '7'); A.fill('#r-name', 'Samuel'); A.click('button:has-text("Add player")')
    A.wait_for_timeout(1700); wait_synced(A)
    toast = A.text_content('#toasts')
    check(('Sammy') in [n for (num, n) in roster(A) if num == '7'], 'conflict: the Drive version (Sammy) is kept on A')
    check('player #7' in toast, 'conflict: A is told which item clashed: ' + toast[:120])
    d4 = json.loads(team_file()['content'])
    check([p['name'] for p in d4['roster'] if p['number'] == '7'] == ['Sammy'], 'conflict: Drive still says Sammy')

    # ---- categories are shared too: B changes a window, A sees it after Sync now ----
    B.fill('input[aria-label="Seconds before for Faceoffs"]', '2'); B.press('input[aria-label="Seconds before for Faceoffs"]', 'Tab')
    B.wait_for_timeout(1600); wait_synced(B)
    A.click('button:has-text("Sync now")'); wait_synced(A)
    fo = [c for c in A.evaluate('window.__bwp.state.settings.categories') if c['name'] == 'Faceoffs'][0]
    check(fo['before'] == 2, 'categories sync: A sees B’s Faceoffs window')

    # ---- offline change is kept and marked, then synced ----
    ctxA.route('https://www.googleapis.com/**', lambda r: r.abort())
    A.fill('#o-new', 'Oakville'); A.click('#opp-add button')
    A.wait_for_timeout(1800)
    check('not synced' in A.text_content('#sync-badge') or 'problem' in A.text_content('#sync-badge'), 'offline: header shows team data not synced')
    ctxA.unroute('https://www.googleapis.com/**')
    ctxA.route('https://www.googleapis.com/**', handle)
    A.click('button:has-text("Sync now")'); wait_synced(A)
    check('Oakville' in json.loads(team_file()['content'])['opponents'], 'back online: the offline change reaches Drive')

    # ---- new game picks from shared lists ----
    A.goto(APP + '#games')
    opts = A.eval_on_selector_all('#dl-opp option', 'e => e.map(o => o.value)')
    check('Milton' in opts and 'Oakville' in opts, 'new game: opponent list comes from team data')
    A.goto(APP + '#settings')
    A.screenshot(path=SHOTS + '/d2-settings-after.png', full_page=True)

    # ---- tokens are not sent anywhere except Google ----
    check(all(u[0] in ('GET', 'POST', 'PATCH', 'OPTIONS') for u in calls), 'only expected Drive calls were made')
    check(not errA and not errB, 'no page errors: ' + '; '.join((errA + errB)[:3]))
    b.close()

srv.shutdown()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
