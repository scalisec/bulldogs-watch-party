"""Browser test for v1.6: the game status panel under the video (period and score, strength, who's in the box
with End penalty, quick buttons), and forgotten penalties staying listed past their estimated end.
usage: python3 tests/e2e_v16.py <screenshot-dir> <media-dir>"""
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

def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(500)
def txt(page, sel): return page.text_content(sel)
def sb(page): return page.evaluate("(() => { const q = (s) => { const e = document.querySelector('#sb ' + s); return e ? e.textContent : ''; }; return { us: q('.sb-us .sb-n'), them: q('.sb-them .sb-n'), per: q('.sb-per'), str: q('.sb-str'), hidden: document.getElementById('sb').classList.contains('hidden') }; })()")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#new'); page.wait_for_function('window.__bwp')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Raiders'); page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    check(page.is_visible('#gstatus') and sb(page)['hidden'], 'event buttons show; no scoreboard before anything is marked')
    seek(page, 2); page.keyboard.press('p')
    seek(page, 5); page.click('#b-goal-for'); page.wait_for_selector('#dlg-goal[open]'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    s = sb(page); check(page.is_visible('#sb') and s['us'] == '1' and s['them'] == '0' and s['per'] == '1st' and 'Raiders' in txt(page, '#sb'), 'scoreboard on the video: 1st, 1–0 vs Raiders (Goal for button works): %s' % s)

    # their penalty via the panel's button: power play 5-on-4, listed with time left
    seek(page, 8); page.click('#b-penalty'); page.wait_for_selector('#dlg-penalty[open]')
    page.click('#pen-team button[data-team="them"]'); page.select_option('#pen-type', 'tripping'); page.click('#pen-ok')
    seek(page, 10)
    check(sb(page)['str'] == 'Power play 5 on 4', 'scoreboard shows Power play 5 on 4')
    check(page.locator('#gs-box li').count() == 1 and 'left (est.)' in txt(page, '#gs-box'), 'the penalty is listed with estimated time left')
    # ours too: 4-on-4
    page.keyboard.press('x'); page.wait_for_selector('#dlg-penalty[open]')
    page.click('#pen-team button[data-team="us"]'); page.click('#pen-ok')
    seek(page, 12)
    check(sb(page)['str'] == 'Even 4 on 4' and page.locator('#gs-box li').count() == 2, 'both in the box: Even 4-on-4')
    page.screenshot(path=SHOTS + '/v16-status.png')

    # End penalty from the panel
    seek(page, 20)
    page.click('#gs-box li.them button:has-text("End penalty")')
    pens = page.evaluate('window.__bwp.state.games[0].marks.penalties')
    check([x['end'] for x in pens if x['team'] == 'them'] == [20], 'End penalty marks the end at the current time')
    check(sb(page)['str'] == 'Penalty kill 4 on 5' and page.locator('#gs-box li').count() == 1, 'now we are short: Penalty kill 4-on-5')

    # a forgotten penalty stays listed past its estimated end (fake a long game by moving the call back)
    page.evaluate("""(() => { const g = window.__bwp.state.games[0]; g.marks.penalties = g.marks.penalties.map(p => p.team === 'us' ? Object.assign({}, p, { t: -400 }) : p); })()""")
    page.evaluate("App.renderTagView && App.renderTagView()")
    seek(page, 25); page.evaluate("window.__bwp.player.seek(26)"); page.wait_for_timeout(600)
    check('past its estimated end' in txt(page, '#gs-box') and page.locator('#gs-box li.over').count() == 1, 'a penalty past its estimated end stays listed, marked')
    page.click('#gs-box li button:has-text("End penalty")')
    check(page.locator('#gs-box li').count() == 0 and page.evaluate('document.getElementById("gs-box").hidden'), 'after ending it, the box list is empty')

    # Tag button opens the custom tag popup
    page.click('#b-qtag'); page.wait_for_selector('#dlg-qtag[open]'); page.keyboard.press('Escape')
    check(True, 'Tag button opens the custom tag popup')
    page.set_viewport_size({'width': 412, 'height': 900}); page.wait_for_timeout(300)
    check(page.evaluate('document.documentElement.scrollWidth') <= 412, 'phone: the panel fits')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
