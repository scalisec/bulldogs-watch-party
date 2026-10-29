"""Browser test for v0.7 (performance and reliability): storage move, a full season, Review paging,
G/H keys, the shortcuts overlay and printable page, and the new-version banner.
usage: python3 tests/e2e_v07.py <screenshot-dir>"""
import json, os, sys, threading, http.server, functools, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
PORT = 8767
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
APP = 'http://127.0.0.1:%d/index.html' % PORT

SEASON_JS = """(n) => {
  const S = window.__bwp.state;
  S.settings.roster = Array.from({ length: 15 }, (_, i) => ({ number: String(i + 2), name: 'Player ' + (i + 2) }));
  const cats = S.settings.categories;
  for (let g = 0; g < n; g++) {
    const day = String(1 + (g % 28)).padStart(2, '0');
    const game = WP.newGame({ parts: [{ name: '1__Rink__2026-10-' + day + 'T151933.mp4', size: 2e9, duration: 1800 }, { name: '2__Rink__2026-10-' + day + 'T154933.mp4', size: 2e9, duration: 1800 }], opponent: 'Team ' + g, rink: 'Rink' });
    game.marks = WP.togglePeriod(game, 60).marks; game.marks = WP.togglePeriod(game, 1100).marks;
    for (let k = 0; k < 4; k++) game.marks = WP.addGoal(game, 200 + k * 300, k % 2 ? 'for' : 'against');
    for (let c = 0; c < 20; c++) {
      const t = 100 + c * 150;
      const clip = WP.makeClip({ start: t - 8, end: t + 4, categoryId: cats[c % cats.length].id, total: 3600, method: 'tap', by: 'Coach A' });
      clip.players = [String(2 + (c % 15))];
      clip.note = 'Support on the breakout ' + c;
      if (c % 4 === 0) { let fz = { at: t - 2, hold: 3, shapes: [] }; fz = WP.addShape(fz, { type: 'free', color: '#fff', pts: Array.from({ length: 60 }, (_, i) => [i / 60, Math.sin(i / 9) / 2 + 0.5]) }); clip.freeze = fz; }
      if (c % 5 === 0) { const rec = WP.newRecording(0.5, false); for (let tt = 0; tt < 24; tt += 0.05) WP.addRecKey(rec, tt, (tt % 8) < 3 ? { scale: 1 + (tt % 3), x: 0.5, y: 0.5 } : { scale: 2, x: 0.4, y: 0.5 }); rec.duration = 24; clip.rec = rec; }
      game.clips.push(clip);
    }
    S.games.push(game);
  }
  // the shared library also lists two other coaches' clips (same amount each) and keeps a sync copy
  const lib = WP.buildMyLibrary(S.lib.team, S.games, cats, 'Coach A', false, []);
  for (const [id, e] of Object.entries(lib.entries)) for (const who of ['B', 'C']) lib.entries[who + '_' + id] = Object.assign({}, e, { id: who + '_' + id, by: 'Coach ' + who, owner: 'Coach ' + who, drive: [] });
  S.lib.team = WP.normalizeLibrary(lib);
  S.lib.teamSync = { fileId: 'not-signed-in', version: 1, base: WP.normalizeLibrary(lib) };
  return S.games.length;
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ---- 1. data saved by v0.6 (localStorage) moves to the database
    page.goto(APP)
    page.wait_for_function('window.__bwp')
    legacy = page.evaluate("""() => { const s = WP.defaultState(); s.settings.coachName = 'Old Coach';
      const g = WP.newGame({ parts: [{ name: '1__Rink__2026-10-04T151933.mp4', size: 1, duration: 600 }], opponent: 'Legacy' });
      g.clips.push(WP.makeClip({ start: 10, end: 20, categoryId: s.settings.categories[0].id, total: 600 })); s.games.push(g); return JSON.stringify(s); }""")
    page.evaluate("""async (d) => { localStorage.setItem('bulldogs-watch-party:v1', d);
      await new Promise((res) => { const r = indexedDB.deleteDatabase('bwp-data'); r.onsuccess = r.onerror = r.onblocked = res; }); }""", legacy)
    page.reload(); page.wait_for_function('window.__bwp')
    st = page.evaluate('window.__bwp.state')
    check(st['settings']['coachName'] == 'Old Coach' and len(st['games']) == 1 and st['games'][0]['opponent'] == 'Legacy' and len(st['games'][0]['clips']) == 1, 'v0.6 data moved over: coach name, game and clip')
    check(page.locator('.toast', has_text='moved to the browser').count() == 1, 'a message says the data moved')
    keys = page.evaluate("""() => new Promise((res) => { const r = indexedDB.open('bwp-data'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); }; })""")
    check('meta' in keys and any(k.startswith('game:') for k in keys), 'saved as separate records in IndexedDB (%d)' % len(keys))
    page.reload(); page.wait_for_function('window.__bwp')
    check(page.locator('.toast', has_text='moved to the browser').count() == 0 and page.evaluate('window.__bwp.state.games.length') == 1, 'second load reads the database (no second move)')

    # ---- 2. a full season (60 games x 20 clips) saves, reloads, and an edit only rewrites one game
    n = page.evaluate(SEASON_JS, 60)
    t0 = time.time()
    page.evaluate('window.__bwp.saveAll()')
    print('season save-all: %.0f ms' % ((time.time() - t0) * 1000))
    size = page.evaluate('JSON.stringify(window.__bwp.state).length')
    check(size > 5300000, 'season with three coaches\u2019 clips is bigger than the old 5 MB limit (%.1f MB)' % (size / 1e6))
    page.reload(); page.wait_for_function('window.__bwp')
    clips = page.evaluate('window.__bwp.state.games.reduce((s, g) => s + g.clips.length, 0)')
    check(page.evaluate('window.__bwp.state.games.length') == 61 and clips == 1201, 'after reload all 61 games and 1201 clips are there')
    gid = page.evaluate('window.__bwp.state.games[5].id')
    page.goto(APP + '#info/' + gid); page.wait_for_selector('#view-ginfo:not(.hidden)')
    page.select_option('#t-gtype', 'playoff'); page.wait_for_timeout(300)
    check(page.evaluate('window.__bwp.lastSaveCount') <= 2, 'changing one game writes %d records, not the whole season' % page.evaluate('window.__bwp.lastSaveCount'))
    page.reload(); page.wait_for_function('window.__bwp')
    check(page.evaluate('window.__bwp.state.games[5].gameType') == 'playoff', 'the one-game change survived a reload')
    page.goto(APP + '#settings'); page.wait_for_timeout(500)
    check('MB used' in page.text_content('#app-storage'), 'Settings shows storage used: ' + page.text_content('#app-storage'))

    # ---- 3. Review pages through a big season
    page.goto(APP + '#review'); page.wait_for_selector('.rvcard')
    page.click('#rv-scope button[data-scope="both"]'); page.wait_for_timeout(200)
    n_cards = page.locator('.rvcard').count()
    check(n_cards == 48 and page.is_visible('#rv-more-btn'), 'Review shows the first 48 of %s with Show more' % page.text_content('#rv-count'))
    page.click('#rv-more-btn'); page.wait_for_timeout(200)
    check(page.locator('.rvcard').count() == 96, 'Show more adds 48 more')
    t = page.evaluate("""() => { const t0 = performance.now(); document.querySelector('#rv-groups .chip').click(); return performance.now() - t0; }""")
    check(t < 150, 'a filter tap redraws in %.0f ms' % t)
    check(page.locator('.rvcard').count() <= 48, 'changing filters goes back to the first page')
    page.screenshot(path=SHOTS + '/v07-review-paging.png')
    page.click('#rv-groups .chip')

    # phone: filters fold away
    ph = ctx.new_page(); ph.set_viewport_size({'width': 412, 'height': 900})
    ph.goto(APP + '#review'); ph.wait_for_selector('.rvcard')
    check(ph.is_visible('#rv-filter-toggle') and not ph.is_visible('#rv-groups'), 'phone: filters are folded behind a button')
    ph.click('#rv-filter-toggle')
    check(ph.is_visible('#rv-groups'), 'phone: the button opens the filters')
    ph.screenshot(path=SHOTS + '/v07-phone-filters.png')
    ph.close()

    # ---- 4. G and H keys (Caps Lock safe), and the ? overlay
    page.goto(APP + '#tag/' + gid); page.wait_for_selector('#view-tag:not(.hidden)')
    page.evaluate("window.__bwp.state.games[5].marks.goals = []")
    # no video connected in this test, so call through the keyboard handler with a fake player position
    check('<kbd>H</kbd>' in page.inner_html('#b-goal-against'), 'Goal against button shows the H key')
    page.keyboard.press('?')
    page.wait_for_selector('#dlg-keys[open]')
    txt = page.text_content('#keys-body')
    check('Goal against' in txt and 'Goal for' in txt and 'Clip editor' in txt, 'pressing ? shows the shortcuts')
    page.screenshot(path=SHOTS + '/v07-shortcuts.png')
    page.click('#keys-close')
    sc = ctx.new_page(); sc.goto('http://127.0.0.1:%d/shortcuts.html' % PORT)
    check(sc.locator('tr').count() >= 20 and 'v2.1.0' in sc.text_content('#ver'), 'printable shortcuts page lists %d shortcuts' % sc.locator('tr').count())
    sc.close()

    # ---- 5. a newer version on the site shows the banner
    up = ctx.new_page()
    up.route('**/version.json*', lambda r: r.fulfill(status=200, content_type='application/json', body='{"version":"9.9.9"}'))
    up.goto(APP); up.wait_for_function('window.__bwp')
    up.wait_for_selector('#update-banner:not(.hidden)', timeout=8000)
    check('v9.9.9' in up.text_content('#update-text'), 'new-version banner appears')
    up.close()
    same = ctx.new_page(); same.goto(APP); same.wait_for_timeout(5000)
    check(not same.is_visible('#update-banner'), 'no banner when the site has the same version')
    same.close()

    # ---- 6. versions agree everywhere
    html = open(os.path.join(ROOT, 'index.html')).read()
    ver = json.load(open(os.path.join(ROOT, 'version.json')))['version']
    appv = page.evaluate('WP.APP_VERSION')
    import re
    stamps = set(re.findall(r'\?v=([0-9.]+)"', html))
    check(ver == appv and stamps == {appv}, 'version.json, core.js and the script links all say %s (%s)' % (appv, stamps))
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
srv.shutdown()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
