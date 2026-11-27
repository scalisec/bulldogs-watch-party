"""Browser test for 2.8.1: the Games list on a phone (each game is a card) and on a PC (the Game column has room).
League data from tests/fixtures/alliance. usage: python3 tests/e2e_phone_games.py [screenshot-dir]"""
import os, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'alliance')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
APP = 'file://' + ROOT + '/index.html'
BASE = 'https://bench-boss-labs.github.io/alliance-tracker/'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def serve(route):
    f = os.path.join(FIX, route.request.url[len(BASE):].split('?')[0])
    if not os.path.isfile(f): return route.fulfill(status=404, body='missing', headers={'Access-Control-Allow-Origin': '*'})
    route.fulfill(status=200, body=open(f, 'rb').read(), headers={'Content-Type': 'application/json' if f.endswith('.json') else 'image/png', 'Access-Control-Allow-Origin': '*'})

GEOM = """(() => { const rows = [...document.querySelectorAll('#g-played tr.schedrow')];
  const wrap = document.querySelector('#g-played').closest('.tablewrap');
  const clash = rows.some((r) => { const a = r.children[1].getBoundingClientRect(), b = r.children[2].getBoundingClientRect(), c = r.children[3].getBoundingClientRect();
    const hit = (p, q) => p.width && q.width && p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1;
    return hit(a, b) || hit(a, c) || hit(b, c); });
  return { rows: rows.length, scroll: wrap.scrollWidth - wrap.clientWidth, game: rows.length ? rows[0].children[1].getBoundingClientRect().width : 0, clash }; })()"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route(BASE + '**', serve)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#games'); page.wait_for_function('window.__bwp')
    page.wait_for_selector('#g-played tr.schedrow', timeout=15000)
    g = page.evaluate(GEOM)
    page.screenshot(path=SHOTS + '/phone-games.png', full_page=True)
    check(g['rows'] > 3, 'phone: the season’s played games are listed (%d)' % g['rows'])
    check(g['scroll'] <= 1, 'phone: no sideways scrolling in the games list (%dpx)' % g['scroll'])
    check(g['game'] > 200 and not g['clash'], 'phone: the game name has room (%dpx) and nothing overlaps' % g['game'])
    for w in (820, 1280):
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(200)
        g = page.evaluate(GEOM)
        check(g['game'] > 150 and not g['clash'], '%dpx wide: the Game column has room (%dpx) and nothing overlaps' % (w, g['game']))
    page.screenshot(path=SHOTS + '/pc-games.png')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()

print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
