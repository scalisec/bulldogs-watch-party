"""Browser test for v1.1: the league schedule from Alliance Tracker's published data (served from tests/fixtures/alliance).
League team on the Team page, the schedule picker on the New game form, auto-match from LiveBarn file names,
logos and LiveBarn / GameSheet links, linking an existing game, and the offline copy.
usage: python3 tests/e2e_v11.py <screenshot-dir> <media-dir>"""
import json, os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures', 'alliance')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
APP = 'file://' + ROOT + '/index.html'
BASE = 'https://scalisec.github.io/alliance-tracker/'
P1 = MEDIA + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = MEDIA + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'
fails = []
online = {'on': True, 'hits': 0}

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def serve(route):
    if not online['on']: return route.abort()
    path = route.request.url[len(BASE):].split('?')[0]
    f = os.path.join(FIX, path)
    if not os.path.isfile(f): return route.fulfill(status=404, body='missing', headers={'Access-Control-Allow-Origin': '*'})
    online['hits'] += 1
    ctype = 'application/json' if f.endswith('.json') else 'image/png'
    route.fulfill(status=200, body=open(f, 'rb').read(), headers={'Content-Type': ctype, 'Access-Control-Allow-Origin': '*'})

def val(page, sel): return page.input_value(sel)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route(BASE + '**', serve)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP); page.wait_for_function('window.__bwp')

    # ---- Team › Team and league: Bulldogs Blue by default
    page.goto(APP + '#team/info'); page.wait_for_selector('section[data-tsec="info"]:not(.hidden)')
    page.wait_for_function("document.querySelectorAll('#lg-team option').length > 10", timeout=10000)
    check(val(page, '#lg-team') == '2712:burlington-bulldogs-blue', 'league team defaults to Burlington Bulldogs Blue')
    check(page.locator('#league-setting img.lglogo').count() == 1, 'team logo shows next to the league team')
    check(page.locator('#lg-team optgroup[label="U10 BB"]').count() == 1, 'league teams are grouped by division')
    page.screenshot(path=SHOTS + '/v11-team-league.png', full_page=True)

    # ---- New game: dropping the LiveBarn files picks the Oct 18 game
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    page.wait_for_selector('#gs-list', timeout=10000)
    check(page.locator('#gs-list button.lgpick').count() >= 1, 'New game form lists the team’s schedule')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.wait_for_selector('#gs-chosen')
    chosen = page.text_content('#gs-chosen')
    check('Burlington Raiders' in chosen and 'Matched to your LiveBarn files' in chosen, 'LiveBarn files matched to Oct 18 vs Burlington Raiders')
    got = {k: val(page, '#' + k) for k in ['g-date', 'g-time', 'g-opp', 'g-rink', 'g-result', 'g-type', 'g-ha']}
    check(got == {'g-date': '2026-10-18', 'g-time': '15:15', 'g-opp': 'Burlington Raiders', 'g-rink': 'Mountainside', 'g-result': 'W 2–1', 'g-type': 'league', 'g-ha': 'home'},
          'game details filled in from the schedule: %s' % got)
    page.screenshot(path=SHOTS + '/v11-new-game-matched.png', full_page=True)

    # pick another game, then back; fields follow
    page.click('#gs-chosen button:has-text("Change")')
    page.click('#gs-list button[aria-label*="Kitchener Jr Rangers"]')
    check(val(page, '#g-opp') == 'Kitchener Jr Rangers' and val(page, '#g-date') == '2026-10-11' and val(page, '#g-result') == 'W 3–0', 'picking another game replaces the details')
    check('Matched' not in page.text_content('#gs-chosen'), 'a game picked by hand isn’t labelled as matched')
    page.click('#gs-chosen button:has-text("Change")')
    up = page.locator('#g-league button:has-text("upcoming games")')
    if up.count():
        before = page.locator('#gs-list button.lgpick').count()
        up.click()
        check(page.locator('#gs-list button.lgpick').count() > before, 'Show upcoming games adds future games')
        check('Upcoming' in page.text_content('#gs-list'), 'upcoming games are labelled')
    page.click('#gs-list button[aria-label*="Oct 18"][aria-label*="Burlington Raiders"]')
    page.fill('#g-result', 'W 2–1 (great game)')
    opts = page.eval_on_selector_all('#dl-opp option', 'e => e.map(x => x.value)')
    check('Waterloo Wolves' in opts and 'Burlington Bulldogs Blue' not in opts, 'opponent type-ahead lists the division’s teams (not us)')
    rinks = page.eval_on_selector_all('#dl-rink option', 'e => e.map(x => x.value)')
    check('Appleby (3)' in rinks and 'Mountainside' in rinks, 'rink type-ahead lists the schedule’s rinks')

    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    g = page.evaluate('window.__bwp.state.games[0]')
    check(g['league'] and g['league']['code'] == 'U10BE84' and g['time'] == '15:15' and g['result'] == 'W 2–1 (great game)', 'game saved with its league link and the edited result')
    check(page.locator('#t-logo img.lglogo').count() == 1, 'game screen shows the opponent logo')
    lb = page.get_attribute('#t-league a:has-text("LiveBarn")', 'href') or ''
    gs = page.get_attribute('#t-league a:has-text("GameSheet")', 'href') or ''
    check(lb.startswith('https://join.livebarn.com/') and gs == 'https://gamesheetstats.com/seasons/15449/games/3080422', 'Open in LiveBarn and GameSheet links')
    check('3:15 PM' in page.text_content('#t-sub'), 'game screen shows the start time')
    page.screenshot(path=SHOTS + '/v11-game-screen.png')

    # ---- an existing game that isn't linked: Link to league schedule
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    check(page.locator('#games .gamerow img.lglogo').count() == 1, 'Games list shows the opponent logo')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.wait_for_selector('#gs-chosen')
    page.click('#gs-chosen button:has-text("Not a league game")')
    check(page.locator('#gs-chosen').count() == 0 and val(page, '#g-opp') == 'Burlington Raiders', '“Not a league game” unlinks but keeps the details')
    page.fill('#g-opp', 'Raiders'); page.fill('#g-result', 'W 9–9')
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    gid = page.evaluate("window.__bwp.state.games.find(x => !x.league).id")
    check(page.is_visible('#t-league button:has-text("Link to league schedule")'), 'unlinked game offers Link to league schedule')
    page.click('#t-league button:has-text("Link to league schedule")')
    page.wait_for_selector('#dlg-league[open] #dls-list')
    check(page.locator('#dls-list button.lgpick.sel').count() == 1, 'the dialog highlights the game the files belong to')
    page.screenshot(path=SHOTS + '/v11-link-dialog.png')
    page.click('#dls-list button.lgpick.sel')
    g2 = page.evaluate("window.__bwp.state.games.find(x => x.id === '%s')" % gid)
    check(g2['league']['id'] and g2['opponent'] == 'Burlington Raiders' and g2['result'] == 'W 9–9', 'linking fills details and keeps the result already entered')

    # ---- offline: the saved copy is used
    online['on'] = False
    page.reload(); page.wait_for_function('window.__bwp')
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    page.wait_for_selector('#gs-list')
    page.click('#g-league button:has-text("Refresh")')
    page.wait_for_function("document.getElementById('g-league').textContent.includes('Couldn’t reach')", timeout=10000)
    check(page.locator('#gs-list button.lgpick').count() >= 1, 'offline: the saved schedule still shows')
    online['on'] = True

    # ---- change the league team (shared team data)
    page.goto(APP + '#team/info'); page.wait_for_selector('#lg-team')
    page.select_option('#lg-team', '2712:burlington-raiders')
    lg = page.evaluate('window.__bwp.state.settings.league')
    check(lg['teamId'] == '2712:burlington-raiders' and lg['divisionId'] == 2712, 'league team can be changed')
    page.goto(APP + '#games'); page.wait_for_selector('#gs-list')
    check('vs Burlington Bulldogs Blue' in page.text_content('#gs-list') or 'at Burlington Bulldogs Blue' in page.text_content('#gs-list'), 'schedule follows the new league team')
    page.goto(APP + '#team/info'); page.wait_for_selector('#lg-team')
    page.select_option('#lg-team', '')
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    check('Pick your league team' in page.text_content('#g-league'), 'with no league team, the form points to the Team page')
    page.goto(APP + '#team/info'); page.wait_for_selector('#lg-team')
    page.select_option('#lg-team', '2712:burlington-bulldogs-blue')

    # ---- phone width
    page.set_viewport_size({'width': 412, 'height': 900})
    page.goto(APP + '#games'); page.wait_for_selector('#gs-list')
    w = page.evaluate('document.documentElement.scrollWidth')
    check(w <= 412, 'phone: New game form with the schedule fits (%d)' % w)
    page.screenshot(path=SHOTS + '/v11-phone.png', full_page=True)
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
