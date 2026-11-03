"""Browser test for v2.6: shots (S ours, D theirs: on goal, missed, blocked, who shot) and goalie changes; shots on the
scoreboard, the game summary (by period, shooters, goalies with SA / SV%) and Season stats (SOG, S%, goalie SV%).
usage: python3 tests/e2e_v26.py <screenshot-dir> <media-dir>"""
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

def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(350)
def marks(page): return page.evaluate('window.__bwp.state.games[0].marks')
def view(page, v): page.wait_for_selector('#view-%s:not(.hidden)' % v)

def shot(page, key, shooter=None, res=None, theirs=None):
    page.keyboard.press(key); page.wait_for_selector('#dlg-shot[open]')
    if shooter: page.click('#sh-players .chip:has-text("#%s ")' % shooter)
    if res: page.keyboard.press(res)
    if theirs: page.fill('#sh-num', theirs)
    page.keyboard.press('Enter'); page.wait_for_function('!document.getElementById("dlg-shot").open')

def goal(page, key, scorer=None):
    page.keyboard.press(key); page.wait_for_selector('#dlg-goal[open]')
    if scorer: page.click('#gl-scorer .chip:has-text("#%s ")' % scorer)
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
    for n, f, l in [('7', 'Sam', 'Smith'), ('12', 'Leo', 'Lane'), ('30', 'Max', 'Goal'), ('31', 'Ava', 'Net')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l); page.click('#roster-add button[type=submit]')
    page.evaluate("""async () => { const s = window.__bwp.state; s.settings.roster = s.settings.roster.map(p => ['30', '31'].includes(p.number) ? Object.assign({}, p, { primary: 'G' }) : p); s.settings.team.name = 'Bulldogs U10 Blue'; await window.__bwp.saveAll(); }""")
    page.goto(APP + '#new'); view(page, 'new')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Cambridge Hawks'); page.fill('#g-date', '2026-10-24'); page.select_option('#g-type', 'league')
    page.click('#g-start'); view(page, 'tag')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    check(page.is_visible('#b-shot-for') and page.is_visible('#b-shot-against') and page.text_content('#b-goalie') == 'Goalie #30', 'events bar: Shot (S), Shot against (D), and Goalie #30 (the lineup’s first goalie)')
    seek(page, 1); page.keyboard.press('p')
    seek(page, 5); shot(page, 's', shooter='7')
    m = marks(page)
    check(len(m['shots']) == 1 and m['shots'][0]['side'] == 'for' and m['shots'][0]['result'] == 'on' and m['shots'][0]['shooter'] == '7', 'S: on goal by #7 (On goal is the default)')
    check('Shots 1–0' in page.text_content('#sb'), 'the scoreboard shows shots on goal: ' + page.text_content('#sb'))
    seek(page, 8); shot(page, 's', shooter='12', res='2')
    seek(page, 10); shot(page, 'S', shooter='7', res='3')
    m = marks(page)
    check([x['result'] for x in m['shots']] == ['on', 'missed', 'blocked'], 'keys 2 and 3 in the popup pick Missed and Blocked (Caps Lock S works too)')
    page.keyboard.press('d'); page.wait_for_selector('#dlg-shot[open]')
    check('Shot against' in page.text_content('#sh-h') and '#30 in net' in page.text_content('#sh-at') and page.is_visible('#sh-num') and not page.is_visible('#sh-players'), 'D: Shot against, says who’s in net, their shooter # optional')
    page.keyboard.press('Escape'); page.wait_for_function('!document.getElementById("dlg-shot").open')
    seek(page, 12); shot(page, 'd', theirs='9')
    seek(page, 14); shot(page, 'd')

    # goalie change partway through
    seek(page, 30); page.click('#b-goalie'); page.wait_for_selector('#dlg-goalie[open]')
    check(page.get_attribute('#gk-players .chip:has-text("#31")', 'aria-pressed') == 'true', 'Goalie change: the other goalie (#31) is picked already')
    page.screenshot(path=SHOTS + '/v26-goalie.png')
    page.click('#gk-ok'); page.wait_for_function('!document.getElementById("dlg-goalie").open')
    page.wait_for_timeout(500)
    check(page.text_content('#b-goalie') == 'Goalie #31', 'after the change the button shows Goalie #31')
    seek(page, 20); page.wait_for_timeout(500)
    check(page.text_content('#b-goalie') == 'Goalie #30', 'going back before the change shows #30 again')
    seek(page, 35); shot(page, 'd')
    seek(page, 40); goal(page, 'h')
    seek(page, 45); goal(page, 'g', scorer='7')
    seek(page, 60); page.keyboard.press('p')
    page.wait_for_timeout(300)
    check('Shots 2–4' in page.text_content('#sb'), 'scoreboard after the goals (they count as shots on goal): ' + page.text_content('#sb'))
    ml = page.text_content('#marks-list')
    check('Shot #12 · missed' in ml and 'Shot against #9 · on goal' in ml and 'Goalie #31 in' in ml, 'Game details lists the shots and the goalie change')
    page.screenshot(path=SHOTS + '/v26-tag.png')

    # a clip over a shot gets its events
    cl = page.evaluate("WP.clipAuto(window.__bwp.state.games[0], { start: 11, end: 13 }).events")
    check(cl == ['shot_against', 'save'], 'a clip over a saved shot is tagged Shot against + Save: %s' % cl)

    # summary
    page.click('#gt-sum'); view(page, 'gsum')
    t = page.text_content('#gs-shots-table')
    check('Bulldogs' in t and page.locator('#gs-shots-table tbody tr').first.locator('td').nth(-3).text_content() == '2', 'summary: our shots on goal = 2 (1 saved + 1 goal; missed and blocked aren’t on goal)')
    rows = [[c.text_content() for c in r.locator('td').all()] for r in page.locator('#gs-shooters tbody tr').all()]
    check(rows[0][:3] == ['#7 S. Smith', '2', '1'] and rows[0][4] == '1' and rows[0][5] == '50.0%', 'shooters: #7 2 SOG, 1 G, 1 blocked, 50%%: %s' % rows)
    gk = [[c.text_content() for c in r.locator('td').all()] for r in page.locator('#gs-goalies tbody tr').all()]
    check(gk[0][0].startswith('#30') and gk[0][2:6] == ['2', '0', '2', '100.0%'] and gk[1][0].startswith('#31') and gk[1][2:6] == ['2', '1', '1', '50.0%'], 'goalies: #30 2 SA 0 GA, #31 2 SA 1 GA: %s' % gk)
    check('0:30' in gk[0][1] and '0:30' in gk[1][1], 'and when each was in net')
    check(gk[0][6] == '' and gk[1][6] == 'T', 'a tie: #31 (in net at the end) gets it')
    page.locator('#gs-shots').screenshot(path=SHOTS + '/v26-summary-shots.png')

    # season stats
    page.goto(APP + '#stats'); view(page, 'stats')
    heads = [h.text_content() for h in page.locator('#stats-skaters thead th').all()]
    check('SOG' in heads and 'S%' in heads, 'Season stats: SOG and S% columns')
    r7 = [c.text_content() for c in page.locator('#stats-skaters tbody tr', has_text='#7').locator('td').all()]
    check(r7[heads.index('SOG')] == '2' and r7[heads.index('S%')] == '50.0%', '#7: 2 SOG, 50.0%%: %s' % r7)
    gh = [h.text_content() for h in page.locator('#stats-goalies thead th').all()]
    g31 = [c.text_content() for c in page.locator('#stats-goalies tbody tr', has_text='#31').locator('td').all()]
    check(g31[gh.index('SA')] == '2' and g31[gh.index('SV%')] == '.500' and g31[gh.index('GP')] == '1', 'goalie #31: 1 GP, 2 SA, .500: %s' % g31)
    check('Shots on goal for / against' in page.text_content('#stats') and '2 / 4' in page.text_content('#stats'), 'tile: shots on goal for / against 2 / 4')
    page.screenshot(path=SHOTS + '/v26-stats.png', full_page=True)
    page.keyboard.press('?'); page.wait_for_selector('#dlg-keys[open]')
    check('Shot for' in page.text_content('#keys-body') and 'Shot against' in page.text_content('#keys-body'), 'shortcuts list S and D')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
