"""Browser test for v1.0: roster with names and positions, the Team page and its Admin section, game lineups
(away players, a position for one game, guests, copying the last game), clip players from the lineup,
the Review position filter, and the Watch Party by Bench Boss Labs branding.
usage: python3 tests/e2e_v10.py <screenshot-dir> <media-dir>"""
import json, os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
APP = 'file://' + ROOT + '/index.html'
P1 = MEDIA + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = MEDIA + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def team(page, sec):
    page.goto(APP + '#team/' + sec); page.wait_for_selector('section[data-tsec="%s"]:not(.hidden)' % sec)

def new_game(page, opp, date):
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', opp); page.fill('#g-date', date)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP); page.wait_for_function('window.__bwp')

    # ---- branding
    check(page.text_content('.brand-name') == 'Watch Party' and 'Bench Boss Labs' in page.text_content('.brand-sub'), 'header: Watch Party by Bench Boss Labs')
    check(page.get_attribute('.brand img', 'src') == 'icons/icon.svg' and 'Bench Boss Labs' in page.title(), 'header icon and page title')
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check(bg == 'rgb(11, 27, 49)', 'dark navy background (%s)' % bg)
    man = json.load(open(os.path.join(ROOT, 'manifest.webmanifest')))
    check(man['name'] == 'Watch Party by Bench Boss Labs' and man['background_color'] == '#0B1B31', 'install manifest uses the new name and colours')
    check(all(os.path.exists(os.path.join(ROOT, i['src'])) for i in man['icons']), 'manifest icons exist')

    # ---- roster with names and positions on the Team page
    team(page, 'roster')
    check(not page.is_visible('#tn-admin'), 'Admin section is hidden when this account doesn’t own the team folder')
    for n, f, l, pri, sec in [('7', 'Sam', 'Smith', 'C', 'RW'), ('12', 'Leo', 'Lane', 'D', ''), ('4', 'Maya', 'Moss', 'D', ''), ('31', 'Ava', 'Ash', 'G', '')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l)
        page.select_option('#r-pri', pri); page.select_option('#r-sec', sec)
        page.click('#roster-add button[type=submit]')
    r = page.evaluate('window.__bwp.state.settings.roster')
    check([(x['number'], x['name'], x['primary'], x['secondary']) for x in r] == [('4', 'M. Moss', 'D', ''), ('7', 'S. Smith', 'C', 'RW'), ('12', 'L. Lane', 'D', ''), ('31', 'A. Ash', 'G', '')],
          'roster saved with first initial + last name and positions')
    page.click('button[aria-label="Edit #12 L. Lane"]')
    page.click('button[aria-label="Secondary: Left wing"]')
    page.fill('input[aria-label="First name for #12"]', 'Leon'); page.press('input[aria-label="First name for #12"]', 'Tab')
    leo = [x for x in page.evaluate('window.__bwp.state.settings.roster') if x['number'] == '12'][0]
    check(leo['secondary'] == 'LW' and leo['first'] == 'Leon', 'editing a player: secondary position and first name change')
    page.click('button:has-text("Done")')
    page.click('#r-filter button:has-text("Defense")')
    check(page.locator('#roster tr').count() == 2, 'roster filter: Defense shows 2 players')
    page.click('#r-filter button:has-text("All")')
    page.screenshot(path=SHOTS + '/v10-roster.png', full_page=True)

    # ---- lineup on the New game form: Maya away, Leo plays LW, a guest
    new_game(page, 'Rangers', '2026-10-18')
    check(page.locator('#g-lineup .lurow').count() == 4, 'New game form lists the roster as the lineup')
    page.click('button[aria-label^="#4 M. Moss is playing"]')
    page.select_option('select[aria-label="Position for #12 this game"]', 'LW')
    page.click('#g-lineup button:has-text("+ Guest player")')
    page.fill('#gl-gnum', '22'); page.fill('#gl-gname', 'Guest'); page.select_option('#gl-gpos', 'D')
    page.click('#g-lineup button:has-text("Add guest")')
    check('Playing LW this game (usually D)' in page.text_content('#g-lineup'), 'lineup notes a position change for this game')
    page.screenshot(path=SHOTS + '/v10-new-game-lineup.png', full_page=True)
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    g = page.evaluate('window.__bwp.state.games[0]')
    check(g['lineup']['away'] == ['4'] and g['lineup']['pos'] == {'12': 'LW'} and g['lineup']['guests'][0]['number'] == '22', 'game saved with its lineup')
    check('4 playing' in page.text_content('#t-lineup-sum') and '1 away' in page.text_content('#t-lineup-sum'), 'game screen shows the lineup summary')

    # ---- clip players come from the lineup: away player left out, guest included
    page.evaluate('window.__bwp.player.seek(30)'); page.wait_for_timeout(400)
    page.keyboard.press('1'); page.wait_for_timeout(300)
    page.locator('#clips .clip').first.locator('text=Edit').click()
    page.wait_for_selector('#view-edit:not(.hidden)'); page.wait_for_timeout(500)
    chips = page.eval_on_selector_all('#e-chips .chip', 'e => e.map(x => x.textContent)')
    check(chips == ['#7', '#12', '#31', '#22'], 'clip editor player list = who played (no #4, guest #22): %s' % chips)
    page.click('#e-chips .chip:has-text("#12")'); page.click('#e-chips .chip:has-text("#22")'); page.wait_for_timeout(200)

    # ---- game screen: mark Maya back in, then a second game copies the lineup
    page.click('#e-back'); page.wait_for_selector('#view-tag:not(.hidden)')
    page.click('#t-lineup-card summary')
    page.click('#t-lineup button[aria-label^="#4 M. Moss is away"]')
    check(page.evaluate('window.__bwp.state.games[0].lineup.away') == [], 'game screen: marking a player back in saves')
    page.click('#t-lineup button[aria-label^="#4 M. Moss is playing"]')
    new_game(page, 'Kings', '2026-10-25')
    page.click('#g-lineup button:has-text("Copy last game’s lineup")')
    check('4 playing' in page.text_content('#g-lineup') and 'Guest' in page.text_content('#g-lineup'), 'Copy last game’s lineup brings the away player, position and guest')
    page.click('#g-clear')

    # ---- Review: filter by position (Leo played LW = forward; guest D)
    page.goto(APP + '#review'); page.wait_for_selector('#view-review:not(.hidden)')
    e = list(page.evaluate('window.__bwp.lib') and page.evaluate("(() => { const s = window.__bwp.state; return Object.values(WP.buildMyLibrary(s.lib.team, s.games, s.settings.categories, '', false, [], s.settings.roster).entries); })()"))[0]
    check(e['positions'] == ['F', 'D'], 'library entry carries the position groups of its players: %s' % e['positions'])
    page.click('#rv-groups .chip:has-text("Goalies")')
    check('0 clips' in page.text_content('#rv-count'), 'Review: Goalies filter hides the clip')
    page.click('#rv-groups .chip:has-text("Goalies")'); page.click('#rv-groups .chip:has-text("Forwards")')
    check('1 clip' in page.text_content('#rv-count'), 'Review: Forwards filter finds the clip')

    # ---- admin section appears for the owner of the team folder
    page.evaluate("""async () => { const s = window.__bwp.state; s.sync = { fileId: 'x', folderId: 'root1', appFolderId: 'root1', owner: true, account: 'benchbosslabs@gmail.com', sharedWith: [], base: null, version: 1, dirty: false };
      s.settings.coaches = [{ name: 'Admin', email: 'benchbosslabs@gmail.com' }, { name: 'Cristian', email: 'coach@example.com' }];
      s.lib.team.folders = { root: 'root1', team: 'f1', coaches: 'f2' }; await window.__bwp.saveAll(); }""")
    page.reload(); page.wait_for_function('window.__bwp')
    team(page, 'admin')
    txt = page.text_content('#admin-body')
    check(page.is_visible('#tn-admin') and 'Coach access' in txt and 'Not shared yet' in txt and 'Family – #7 S. Smith' in txt, 'owner sees Team › Admin: coach access and clip folders')
    check(page.is_visible('#admin-body button:has-text("Share with 1 new coach")'), 'admin can share with the coach who isn’t shared yet')
    page.screenshot(path=SHOTS + '/v10-admin.png', full_page=True)

    # ---- phone width: team sections wrap, no sideways scroll
    page.set_viewport_size({'width': 412, 'height': 900})
    team(page, 'roster')
    w = page.evaluate('document.documentElement.scrollWidth')
    check(w <= 412, 'phone: Team page fits the width (%d)' % w)
    page.screenshot(path=SHOTS + '/v10-phone-team.png')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
