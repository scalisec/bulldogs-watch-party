"""Browser test for v1.4: penalties. X opens the penalty popup (who, type, length); X again marks a player back.
Power play / penalty kill on the timeline and on clips, Penalty for/against events, the player on the clip,
and Review's Penalty filter.
usage: python3 tests/e2e_v14.py <screenshot-dir> <media-dir>"""
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

def marks(page): return page.evaluate('window.__bwp.state.games[0].marks')
def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(350)

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
    for n, f, l in [('7', 'Sam', 'Smith'), ('12', 'Leo', 'Lane')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l); page.click('#roster-add button[type=submit]')
    page.goto(APP + '#games'); page.wait_for_selector('#view-games:not(.hidden)')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Raiders'); page.fill('#g-date', '2026-10-18')
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    # a clip before the penalty is called, around 0:10
    seek(page, 10); page.keyboard.press('1'); page.wait_for_timeout(300)

    # ---- X: our #7, hooking, minor
    seek(page, 12)
    page.keyboard.press('x')
    page.wait_for_selector('#dlg-penalty[open]')
    check(page.text_content('#pen-at').startswith('At 0:12'), 'X opens the penalty popup at the current time')
    page.keyboard.press('2')  # number keys must not tag a clip while the popup is open
    check(len(page.evaluate('window.__bwp.state.games[0].clips')) == 1, 'keys typed in the popup don’t tag clips')
    page.click('#pen-players .chip:has-text("#7")')
    page.select_option('#pen-type', 'hooking')
    page.screenshot(path=SHOTS + '/v14-penalty-popup.png')
    page.click('#pen-ok')
    pens = marks(page)['penalties']
    check(len(pens) == 1 and pens[0]['team'] == 'us' and pens[0]['player'] == '7' and pens[0]['type'] == 'hooking' and pens[0]['minutes'] == 2 and pens[0]['t'] == 12, 'penalty saved: us, #7, hooking, 2 min at 0:12')
    clip = page.evaluate('window.__bwp.state.games[0].clips[0]')
    check('7' in clip['players'], 'the clip that includes the call gets #7')
    check(page.locator('#tl .sband.pk').count() == 1, 'timeline shows the penalty kill')
    check('#7 · Hooking · 2 min' in page.text_content('#marks-list'), 'marks list shows the penalty')

    # a new clip during the penalty: penalty kill, Penalty against event
    seek(page, 20); page.keyboard.press('2'); page.wait_for_timeout(300)
    entry = page.evaluate("(() => { const s = window.__bwp.state; const g = s.games[0]; const c = g.clips[g.clips.length - 1]; return WP.libraryEntry(g, c, s.settings.categories, '', s.settings.roster); })()")
    check(entry['situation'] == 'pk', 'a clip during the penalty is on the penalty kill')
    first = page.evaluate("(() => { const s = window.__bwp.state; const g = s.games[0]; const c = g.clips[0]; return WP.libraryEntry(g, c, s.settings.categories, '', s.settings.roster); })()")
    check('penalty_against' in first['events'] and first['penalties'] == ['hooking'], 'the clip with the call has Penalty against and the penalty type')

    # ---- X again: #7 back
    seek(page, 40)
    page.keyboard.press('X'); page.wait_for_selector('#dlg-penalty[open]')
    check('In the box now' in page.text_content('#pen-open'), 'second X lists who’s in the box')
    page.click('#pen-open button:has-text("Back now")')
    check(marks(page)['penalties'][0]['end'] == 40 and not page.is_visible('#dlg-penalty'), 'Back now marks the end at 0:40')
    seek(page, 50); page.keyboard.press('3'); page.wait_for_timeout(300)
    last = page.evaluate("(() => { const s = window.__bwp.state; const g = s.games[0]; const c = g.clips[g.clips.length - 1]; return WP.libraryEntry(g, c, s.settings.categories, '', s.settings.roster); })()")
    check(last['situation'] == 'even', 'after the player is back: even strength')

    # ---- their penalty: power play
    seek(page, 55); page.keyboard.press('x'); page.wait_for_selector('#dlg-penalty[open]')
    page.click('#pen-team button[data-team="them"]')
    page.fill('#pen-num', '19'); page.select_option('#pen-type', 'slashing')
    page.click('#pen-len button:has-text("Double minor")')
    page.click('#pen-ok')
    p2 = marks(page)['penalties'][1]
    check(p2['team'] == 'them' and p2['player'] == '19' and p2['minutes'] == 4, 'their penalty: #19, slashing, double minor')
    check(page.locator('#tl .sband.pp').count() == 1, 'timeline shows the power play')
    page.screenshot(path=SHOTS + '/v14-game-penalties.png')

    # ---- editor shows the automatic situation; changing it overrides
    page.locator('#clips .clip').filter(has_text='0:1').first.locator('text=Edit').click()
    page.wait_for_selector('#view-edit:not(.hidden)'); page.wait_for_timeout(300)
    check(page.input_value('#e-sit') in ('pk', 'even'), 'editor shows a situation from the penalty marks')

    # ---- Review: Penalty filter
    page.goto(APP + '#review'); page.wait_for_selector('#view-review:not(.hidden)')
    check(page.locator('#rv-groups .chip:has-text("Hooking")').count() == 1, 'Review has a Penalty filter with the types used')
    page.click('#rv-groups .chip:has-text("Hooking")')
    check('2 clips' in page.text_content('#rv-count'), 'Review: Hooking finds the two clips that include the call')
    page.click('#rv-groups .chip:has-text("Hooking")')
    page.click('#rv-groups .chip:has-text("Penalty kill")')
    check('1 clip' in page.text_content('#rv-count') or '2 clips' in page.text_content('#rv-count'), 'Review: Penalty kill finds the clips during the penalty: ' + page.text_content('#rv-count'))
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
