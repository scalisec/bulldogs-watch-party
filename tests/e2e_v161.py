"""Browser test for v1.6.1: finding a club team's schedule (e.g. the Barracudas, OWHA).
A team named "Burlington Barracudas U13 B" gets its league team picked when it's added; an existing team gets a
"Use its schedule" suggestion on the New game form and the Team page; the picker has a Find box and lists club
teams first; an old saved team list (from before club teams) is ignored.
usage: python3 tests/e2e_v161.py <screenshot-dir>"""
import json, os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'alliance')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
APP = 'file://' + ROOT + '/index.html'
BASE = 'https://scalisec.github.io/alliance-tracker/'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def serve(route):
    f = os.path.join(FIX, route.request.url[len(BASE):].split('?')[0])
    if not os.path.isfile(f): return route.fulfill(status=404, body='missing', headers={'Access-Control-Allow-Origin': '*'})
    route.fulfill(status=200, body=open(f, 'rb').read(), headers={'Content-Type': 'application/json' if f.endswith('.json') else 'image/png', 'Access-Control-Allow-Origin': '*'})

def reloaded(page): page.wait_for_load_state('load'); page.wait_for_function('window.__bwp')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route(BASE + '**', serve)
    # an old saved team list without club teams (as an older version would have saved it, fresh)
    old = json.load(open(os.path.join(FIX, 'data', 'teams.json')))
    ctx.add_init_script("try { localStorage.setItem('bwp-league-teams', JSON.stringify({ at: Date.now(), data: %s })); } catch (e) {}" % json.dumps(old))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#games'); page.wait_for_function('window.__bwp')
    page.wait_for_function("window.App && App.League && App.League.state.teams && App.League.state.teams.some(t => t.divisionId === 'bghc-2066')", timeout=10000)
    check(True, 'the old saved team list is ignored; club teams load')

    # ---- an existing team without a league team: suggestion on the New game form
    page.click('#team-switch'); page.fill('#teams-name', 'Barracudas practice'); page.uncheck('#teams-copy')
    with page.expect_navigation(): page.click('#teams-add button[type=submit]')
    reloaded(page)
    page.goto(APP + '#team/info'); page.wait_for_selector('#lg-team')
    check(page.locator('#lg-suggest-team').count() == 0, 'no suggestion when the name doesn’t contain a league team’s full name')
    # rename to something that matches: suggestion appears
    page.fill('#t-name', 'Burlington Barracudas'); page.press('#t-name', 'Tab'); page.wait_for_timeout(300)
    page.goto(APP + '#games'); page.wait_for_selector('#gs-suggest', timeout=8000)
    check('Burlington Barracudas' in page.text_content('#gs-suggest') and 'U13 B (OWHA)' in page.text_content('#gs-suggest'), 'New game form suggests Burlington Barracudas · U13 B (OWHA)')
    page.screenshot(path=SHOTS + '/v161-suggest.png')
    page.click('#gs-suggest button:has-text("Use its schedule")')
    page.wait_for_selector('#gs-list', timeout=8000)
    check(page.evaluate('window.__bwp.state.settings.league.teamId') == 'bghc-2066:burlington-barracudas', 'Use its schedule sets the league team')
    check('North Halton Twisters' in page.text_content('#gs-list'), 'her games show on the New game form')

    # ---- picker: club teams first, Find box
    page.goto(APP + '#team/info'); page.wait_for_selector('#lg-team')
    groups = page.eval_on_selector_all('#lg-team optgroup', 'e => e.map(g => g.label)')
    check(groups[0].startswith('OWHA'), 'club teams are listed first: %s' % groups[:3])
    page.fill('#lg-search', 'raiders')
    opts = page.eval_on_selector_all('#lg-team option', 'e => e.map(o => o.textContent)')
    check(all('Raiders' in o for o in opts[1:]) and len(opts) > 1, 'Find narrows the list: %s' % opts[:4])
    check(page.evaluate('document.activeElement.id') == 'lg-search', 'typing keeps the cursor in the Find box')
    page.screenshot(path=SHOTS + '/v161-find.png')

    # ---- a new team named like the league team: picked automatically
    page.click('#team-switch'); page.fill('#teams-name', 'Burlington Barracudas U13 B')
    with page.expect_navigation(): page.click('#teams-add button[type=submit]')
    reloaded(page)
    check(page.evaluate('window.__bwp.state.settings.league.teamId') == 'bghc-2066:burlington-barracudas', 'adding "Burlington Barracudas U13 B" picks its league team automatically')
    page.goto(APP + '#games'); page.wait_for_selector('#gs-list', timeout=8000)
    check('Flamborough Falcons' in page.text_content('#gs-list') or 'North Halton' in page.text_content('#gs-list'), 'and its schedule shows straight away')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
