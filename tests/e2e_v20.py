"""Browser test for v2.0: Games home and a separate New game screen; a game's three tabs (Watch and tag with the
scoreboard, Summary, Game details); the Summaries tab and Season stats.
usage: python3 tests/e2e_v20.py <screenshot-dir> <media-dir>"""
import os, sys
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

def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(400)
def game(page): return page.evaluate('window.__bwp.state.games[0]')
def view(page, v): page.wait_for_selector('#view-%s:not(.hidden)' % v)

def goal(page, key, scorer=None, assists=()):
    page.keyboard.press(key); page.wait_for_selector('#dlg-goal[open]')
    if scorer: page.click('#gl-scorer .chip:has-text("#%s")' % scorer)
    for a in assists: page.click('#gl-assists .chip:has-text("#%s")' % a)
    page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-goal").open')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#team/roster'); page.wait_for_function('window.__bwp')
    page.wait_for_selector('section[data-tsec="roster"]:not(.hidden)')
    for n, f, l in [('7', 'Sam', 'Smith'), ('12', 'Leo', 'Lane'), ('4', 'Maya', 'Moss'), ('30', 'Max', 'Goal')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l); page.click('#roster-add button[type=submit]')
    page.evaluate("""async () => { const s = window.__bwp.state; s.settings.roster = s.settings.roster.map(p => p.number === '30' ? Object.assign({}, p, { primary: 'G' }) : p); s.settings.team.name = 'Bulldogs U10 Blue'; await window.__bwp.saveAll(); }""")

    # ---- Games home: no form on it; + New game opens its own screen
    page.goto(APP + '#games'); view(page, 'games')
    check(not page.is_visible('#g-start') and page.is_visible('#new-game-btn') and 'No games yet' in page.text_content('#games'), 'Games home: list only, with + New game')
    check([a.text_content() for a in page.locator('nav.nav a').all()] == ['Games', 'Summaries', 'Review', 'Team', 'Settings'], 'menu: Games, Summaries, Review, Team, Settings')
    page.click('#new-game-btn'); view(page, 'new')
    check(page.locator('[data-nav="games"][aria-current="page"]').count() == 1 and page.is_visible('.steps'), 'New game is its own screen (under Games) with the steps')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Burlington Raiders'); page.fill('#g-date', '2026-10-18'); page.select_option('#g-type', 'league'); page.select_option('#g-ha', 'away')
    page.screenshot(path=SHOTS + '/v20-new-game.png', full_page=True)
    page.click('#g-start'); view(page, 'tag')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    # ---- game header with tabs; one row of event buttons; scoreboard
    check(page.is_visible('#game-head') and page.get_attribute('#gt-tag', 'aria-current') == 'page', 'game header with Watch and tag / Summary / Game details')
    check(page.locator('#view-tag button:has-text("Goal for")').count() == 1 and not page.is_visible('#marks-list') and not page.is_visible('#t-gtype'), 'Watch and tag: one Goal for button; marks, type and lineup moved to Game details')
    seek(page, 2); page.keyboard.press('p')
    seek(page, 10); goal(page, 'g', '7', ['12', '4'])
    seek(page, 20); page.keyboard.press('x'); page.wait_for_selector('#dlg-penalty[open]')
    page.click('#pen-team button[data-team="them"]'); page.select_option('#pen-type', 'tripping'); page.click('#pen-ok')
    seek(page, 25); goal(page, 'g', '12', ['7'])
    seek(page, 30); page.keyboard.press('p')
    seek(page, 33); page.keyboard.press('p')
    seek(page, 36); page.keyboard.press('x'); page.wait_for_selector('#dlg-penalty[open]')
    page.click('#pen-team button[data-team="us"]')
    page.click('#pen-ok')
    seek(page, 40); goal(page, 'h')
    seek(page, 41)
    sbt = page.text_content('#sb')
    check('Bulldogs' in sbt and 'Raiders' in sbt and page.text_content('#sb .sb-per') == '2nd' and page.text_content('#sb .sb-us .sb-n') == '2' and page.text_content('#sb .sb-them .sb-n') == '1', 'scoreboard: Bulldogs 2, 2nd, 1 Raiders: ' + sbt)
    check(not any(ch.isdigit() and ':' in sbt for ch in sbt) and ':' not in sbt, 'scoreboard shows no clock')
    page.screenshot(path=SHOTS + '/v20-watch-and-tag.png')

    # ---- Game details tab
    page.click('#gt-info'); view(page, 'ginfo')
    check(page.input_value('#gi-opp') == 'Burlington Raiders' and page.input_value('#t-gtype') == 'league' and 'Goal #7' in page.text_content('#marks-list'), 'Game details: date/opponent/type and the marks list')
    page.fill('#gi-result', 'W 3–1'); page.press('#gi-result', 'Tab'); page.wait_for_timeout(200)
    check(game(page)['result'] == 'W 3–1', 'final score saved from Game details')
    page.screenshot(path=SHOTS + '/v20-details.png', full_page=True)

    # ---- Summary tab
    page.click('#gt-sum'); view(page, 'gsum')
    check(page.locator('#gs-goals tbody tr').count() == 3, 'summary lists 3 goals')
    rows = page.eval_on_selector_all('#gs-goals tbody tr', 'r => r.map(x => x.textContent)')
    check('1st' in rows[0] and '#7 S. Smith' in rows[0] and '#12 L. Lane, #4 M. Moss' in rows[0], 'goal 1: 1st, #7 S. Smith (#12, #4): ' + rows[0])
    check('PP' in rows[1] and '2nd' not in rows[1], 'goal 2 is a power-play goal in the 1st: ' + rows[1])
    check('2nd' in rows[2] and 'Raiders' in rows[2], 'their goal in the 2nd: ' + rows[2])
    check('Your marked goals add up to 2–1, but the final score is 3–1' in page.text_content('#gsum'), 'marks that disagree with the final score are flagged')
    check(page.locator('#gs-pens tbody tr').count() == 2 and 'Power-play goal' in page.text_content('#gs-pens'), 'penalties with their result (power-play goal)')
    check('#7 S. Smith' in page.text_content('#gsum') and '1 G · 1 A' in page.text_content('#gsum'), 'points this game')
    # fix the scorer of goal 2: #4 instead of #12; the goal clip follows
    page.click('#gs-goals tbody tr:nth-child(2) button:has-text("Edit")'); page.wait_for_selector('#dlg-goal[open]')
    check(page.text_content('#gl-h') == 'Edit goal' and not page.is_visible('#gl-cat'), 'Edit opens the goal popup in edit mode')
    page.click('#gl-scorer .chip:has-text("#4")'); page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-goal").open')
    g = game(page)
    g2 = sorted(g['marks']['goals'], key=lambda x: x['t'])[1]
    clip = [c for c in g['clips'] if c['id'] == g2.get('clipId')][0]
    check(g2['scorer'] == '4' and sorted(clip['players']) == ['4', '7'] and clip['note'].startswith('Goal #4'), 'edited goal: scorer #4; its clip players and note follow')
    check('#4 M. Moss' in page.text_content('#gs-goals tbody tr:nth-child(2)'), 'summary shows the corrected scorer')
    page.fill('#gsn-well', 'Breakouts on the strong side'); page.fill('#gsn-work', 'Backchecking'); page.wait_for_timeout(700)
    check(game(page).get('summaryNotes') == {'wentWell': 'Breakouts on the strong side', 'workOn': 'Backchecking'}, 'coach’s notes saved')
    check('Export all goal clips (3)' in page.text_content('#gs-export-goals'), 'Export all goal clips button counts the goal clips')
    page.screenshot(path=SHOTS + '/v20-summary.png', full_page=True)
    # ▶ on a goal opens Watch and tag at that moment
    page.click('#gs-goals tbody tr:nth-child(1) button[aria-label^="Watch at"]'); view(page, 'tag')
    page.wait_for_timeout(600)
    check(abs(page.evaluate('window.__bwp.player.time()') - 4) < 1.5, 'goal ▶ opens Watch and tag a few seconds before the goal')

    # ---- Summaries tab and season stats
    page.goto(APP + '#summaries'); view(page, 'sums')
    check(page.locator('[data-nav="summaries"][aria-current="page"]').count() == 1, 'Summaries is in the menu')
    check(page.locator('#sum-cards .sumcard').count() == 1 and 'Goals: #7 (#12, #4) · #4 (#7)' in page.text_content('#sum-cards'), 'game card lists our scorers')
    check('1–0–0' in page.text_content('#sums .tiles'), 'record tile counts the win (league): ' + page.text_content('#sums .tiles'))
    page.screenshot(path=SHOTS + '/v20-summaries.png', full_page=True)
    page.click('a:has-text("Season stats")'); view(page, 'stats')
    rows = page.eval_on_selector_all('#stats-skaters tbody tr', 'r => r.map(x => [...x.children].map(c => c.textContent))')
    seven = [r for r in rows if r[0].startswith('#7')][0]
    check(seven[1:6] == ['1', '1', '1', '2', '0'], 'season stats #7: GP 1, G 1, A 1, PTS 2, PIM 0: %s' % seven)
    check(page.locator('#stats-goalies tbody tr').count() == 1 and '#30' in page.text_content('#stats-goalies'), 'goalie table with #30')
    page.screenshot(path=SHOTS + '/v20-stats.png', full_page=True)
    page.click('#stats-skaters tbody tr:has-text("#7") button'); view(page, 'review')
    check('#7' in page.text_content('#rv-active'), 'a player’s clips open in Review, filtered to them')

    # ---- Games home row and phone widths
    page.goto(APP + '#games'); view(page, 'games')
    check('W 2–1' in page.text_content('#games') or 'Goals don’t match' in page.text_content('#games'), 'games list shows the result and summary state')
    page.screenshot(path=SHOTS + '/v20-games.png', full_page=True)
    page.set_viewport_size({'width': 390, 'height': 900})
    for h in ['#games', '#summaries', '#stats', '#sum/' + game(page)['id']]:
        page.goto(APP + h); page.wait_for_timeout(400)
        w = page.evaluate('document.documentElement.scrollWidth')
        check(w <= 390, 'phone: %s fits (%d)' % (h, w))
    page.screenshot(path=SHOTS + '/v20-phone-summary.png', full_page=True)
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
