"""Browser test for v2.1: official game sheets (GameSheet PDF) read on this computer with the bundled pdf.js.
A summary-only game (no video) made from a sheet; a sheet added on the New game screen; marks filled in from the
sheet, a differing scorer (Keep mine / Use game sheet), goals and penalties only on the sheet, season stats.
The test sheet (tests/fixtures/gamesheet/u10-sheet-test.pdf) has the real layout with no player names.
usage: python3 tests/e2e_v21.py <screenshot-dir> <media-dir>"""
import os, sys
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
APP = 'file://' + ROOT + '/index.html'
SHEET = os.path.join(ROOT, 'tests', 'fixtures', 'gamesheet', 'u10-sheet-test.pdf')
P1 = MEDIA + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = MEDIA + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    if not cond: fails.append(msg)

def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(400)
def view(page, v): page.wait_for_selector('#view-%s:not(.hidden)' % v)
def games(page): return page.evaluate('window.__bwp.state.games')
def shot(page, name):
    page.evaluate("document.getElementById('toasts').replaceChildren()")
    page.screenshot(path=SHOTS + '/' + name, full_page=True)
def pick_sheet(page, button):
    with page.expect_file_chooser() as fc:
        page.click(button)
    fc.value.set_files(SHEET)

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
    for n, f, l in [('2', 'Cal', 'Keen'), ('23', 'Nate', 'Mercer'), ('16', 'Luc', 'Sca'), ('97', 'Bro', 'Sro'), ('3', 'Ava', 'Ash')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l); page.click('#roster-add button[type=submit]')
    page.evaluate("""async () => { const s = window.__bwp.state; s.settings.team.name = 'Bulldogs U10 Blue'; await window.__bwp.saveAll(); }""")

    # ---- 1. a game with no video, from the sheet alone
    page.goto(APP + '#games'); view(page, 'games')
    pick_sheet(page, '#g-import-sheet')
    page.wait_for_selector('#dlg-ask[open]', timeout=20000)
    check('summary-only' in page.text_content('#ask-h') and 'No video available' in page.text_content('#dlg-ask') and 'Burlington Bulldogs Blue 11–2 Cambridge Hawks' in page.text_content('#dlg-ask'),
          'reading the PDF on this computer, then asking before making a summary-only game: ' + page.text_content('#dlg-ask').strip()[:160])
    page.click('#ask-ok'); view(page, 'gsum')
    g = games(page)[0]
    check(g['noVideo'] and g['opponent'] == 'Cambridge Hawks' and g['date'] == '2026-10-24' and g['homeAway'] == 'away' and g['sheet']['number'] == 'U10BE38', 'summary-only game: Oct 24 at Cambridge Hawks, game U10BE38, no video')
    check('KEVIN' not in str(g), 'no player names kept from the sheet')
    check(page.text_content('#gsum .bigscore').count('11') == 1 and 'Win' in page.text_content('#gsum .bigscore'), 'score 11–2, a win')
    check(page.locator('#gs-goals tbody tr').count() == 13 and page.locator('#gs-goals tbody tr.fromsheet').count() == 13, '13 goals, all from the game sheet')
    first = page.text_content('#gs-goals tbody tr:nth-child(1)')
    check('Hawks' in first and '06:17 left' in first and '#66' not in first, 'their first goal comes first (06:17 left in the 1st): ' + first)
    check('#23 N. Mercer' in page.text_content('#gs-goals tbody tr:nth-child(2)') and '#2 C. Keen' in page.text_content('#gs-goals tbody tr:nth-child(2)'), 'our scorer and assist shown with roster names')
    check(page.locator('#gs-pens tbody tr').count() == 9 and 'Hooking' in page.text_content('#gs-pens') and 'Body checking' in page.text_content('#gs-pens'), '9 penalties with their infractions')
    check(not page.is_visible('#gt-tag') and page.is_visible('#gt-sum'), 'no Watch and tag tab for a game with no video')
    shot(page, 'v21-sheet-only.png')
    page.goto(APP + '#stats'); view(page, 'stats')
    rows = page.eval_on_selector_all('#stats-skaters tbody tr', 'r => r.map(x => [...x.children].map(c => c.textContent))')
    two = [r for r in rows if r[0].startswith('#2 ')][0]
    check(two[1:5] == ['1', '5', '2', '7'], 'season stats from the sheet: #2 has 5 G, 2 A: %s' % two)
    page.goto(APP + '#games'); view(page, 'games')
    check('No video' in page.text_content('#games') and 'From the game sheet' in page.text_content('#games'), 'games list: No video, From the game sheet')
    page.click('#games a:has-text("Open")'); view(page, 'gsum')
    check(True, 'Open goes to the summary')

    # ---- adding video later to the summary-only game: the same game gets the video (no second game)
    page.goto(APP + '#new'); view(page, 'new')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Cambridge Hawks'); page.fill('#g-date', '2026-10-24')
    page.click('#g-start'); view(page, 'tag')
    gl = games(page)
    check(len(gl) == 1 and not gl[0].get('noVideo') and len(gl[0]['parts']) == 2 and gl[0]['sheet']['number'] == 'U10BE38', 'video added later goes to the summary-only game (one game, keeps its sheet)')

    # ---- 2. a game with video: the sheet on the New game screen, then marks filled in from it
    page.evaluate("async () => { window.__bwp.state.games = []; await window.__bwp.saveAll(); }")
    page.goto(APP + '#new'); view(page, 'new')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Cambridge Hawks'); page.fill('#g-date', '2026-10-24')
    pick_sheet(page, '#g-sheet-pick')
    page.wait_for_function("document.getElementById('g-sheet-status').textContent.includes('Game sheet')", timeout=20000)
    check('U10BE38' in page.text_content('#g-sheet-status'), 'New game: the sheet shows as added: ' + page.text_content('#g-sheet-status'))
    shot(page, 'v21-new-game.png')
    page.click('#g-start'); view(page, 'tag')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    check(games(page)[0]['sheet']['score'] == {'for': 11, 'against': 2}, 'the game has its sheet')
    seek(page, 1); page.keyboard.press('p')
    seek(page, 5); page.keyboard.press('h'); page.wait_for_selector('#dlg-goal[open]'); page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-goal").open')
    seek(page, 10); page.keyboard.press('g'); page.wait_for_selector('#dlg-goal[open]'); page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-goal").open')
    seek(page, 15); page.keyboard.press('g'); page.wait_for_selector('#dlg-goal[open]'); page.click('#gl-scorer .chip:has-text("#3")'); page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-goal").open')
    page.click('#gt-sum'); view(page, 'gsum')
    gs = sorted(games(page)[0]['marks']['goals'], key=lambda x: x['t'])
    check(gs[0].get('oppScorer') == '23' and gs[0].get('oppAssists') == ['2'] and gs[1]['scorer'] == '23' and gs[1]['assists'] == ['2'], 'marked goals without scorers filled from the sheet (their #23 from #2; our #23 from #2): %s' % [(x.get('scorer'), x.get('assists'), x.get('oppScorer'), x.get('oppAssists')) for x in gs])
    clip = [c for c in games(page)[0]['clips'] if c['id'] == gs[1].get('clipId')][0]
    check(sorted(clip['players']) == ['2', '23'] and clip['note'].startswith('Goal #23'), 'the goal clip follows: ' + clip['note'])
    check(gs[2]['scorer'] == '3', 'the coach’s own scorer (#3) is kept')
    row3 = page.locator('#gs-goals tbody tr').nth(2)
    check('Differs' in row3.text_content() and 'Game sheet: #2' in row3.text_content(), 'the differing goal is flagged with the sheet’s scorer: ' + row3.text_content())
    check(page.locator('#gs-goals tbody tr.fromsheet').count() == 10, 'the other 10 goals come from the sheet')
    shot(page, 'v21-summary-marks.png')
    row3.locator('button:has-text("Use game sheet")').click(); page.wait_for_timeout(300)
    gs = sorted(games(page)[0]['marks']['goals'], key=lambda x: x['t'])
    check(gs[2]['scorer'] == '2', 'Use game sheet: scorer now #2')
    check('Matches game sheet' in page.locator('#gs-goals tbody tr').nth(2).text_content(), 'and it matches the sheet now')
    page.click('#gs-sheet button:has-text("Remove")'); page.wait_for_selector('#dlg-ask[open]'); page.click('#ask-ok'); page.wait_for_timeout(300)
    check('sheet' not in games(page)[0] and page.locator('#gs-goals tbody tr').count() == 3, 'Remove: back to the 3 marked goals (filled details stay)')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
