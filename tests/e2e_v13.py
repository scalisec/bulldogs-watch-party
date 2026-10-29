"""Browser test for v1.3: several categories on one clip (e.g. a breakout with a nice pass).
Clip editor category chips, the main category, the game screen's clip list and filter, Review's filter and chips.
usage: python3 tests/e2e_v13.py <screenshot-dir> <media-dir>"""
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

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP); page.wait_for_function('window.__bwp')
    cats = page.evaluate('window.__bwp.state.settings.categories.map(c => [c.id, c.name])')
    (c1, n1), (c2, n2), (c3, n3) = cats[0], cats[1], cats[2]

    # a game and one clip tagged with key 1
    page.goto(APP + '#new'); page.wait_for_selector('#view-new:not(.hidden)')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Raiders'); page.fill('#g-date', '2026-10-18')
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    page.evaluate('window.__bwp.player.seek(30)'); page.wait_for_timeout(400)
    page.keyboard.press('1'); page.wait_for_timeout(300)
    page.locator('#clips .clip').first.locator('text=Edit').click()
    page.wait_for_selector('#view-edit:not(.hidden)'); page.wait_for_timeout(400)

    # ---- editor: category chips instead of a dropdown
    check(page.locator('#e-cat button.catchip').count() >= 3 and page.locator('#e-cat select').count() == 0, 'clip editor shows category chips, not a dropdown')
    check(page.get_attribute('#e-cat button[data-cat="%s"]' % c1, 'aria-pressed') == 'true', 'the tagged category is selected')
    page.click('#e-cat button[data-cat="%s"]' % c2)
    clip = page.evaluate('window.__bwp.state.games[0].clips[0]')
    check(clip['categoryId'] == c1 and clip['alsoCats'] == [c2], 'tapping a second category adds it (main stays %s)' % n1)
    check(page.text_content('#e-title').startswith(n1 + ' + ' + n2), 'editor title shows both: %s' % page.text_content('#e-title'))
    check('main' in page.text_content('#e-cat button[data-cat="%s"]' % c1), 'the first category is marked main')
    page.screenshot(path=SHOTS + '/v13-editor-cats.png')
    page.click('#e-cat button[data-cat="%s"]' % c1)
    clip = page.evaluate('window.__bwp.state.games[0].clips[0]')
    check(clip['categoryId'] == c2 and clip['alsoCats'] == [], 'removing the main category makes the other one main')
    page.click('#e-cat button[data-cat="%s"]' % c2)
    page.wait_for_selector('.toast.err:has-text("at least one category")')
    check(page.evaluate('window.__bwp.state.games[0].clips[0].categoryId') == c2, 'the last category can’t be removed')
    page.click('#e-cat button[data-cat="%s"]' % c1)

    # ---- game screen: the clip is listed under both categories
    page.click('#e-back'); page.wait_for_selector('#view-tag:not(.hidden)')
    check((n2 + ' + ' + n1) in page.text_content('#clips'), 'clip list shows both category names')
    opts = page.eval_on_selector_all('#clip-filter option', 'e => e.map(x => x.textContent)')
    check(any(o.startswith(n1) for o in opts) and any(o.startswith(n2) for o in opts), 'clip filter counts the clip in both categories: %s' % opts)
    page.select_option('#clip-filter', c1)
    check(page.locator('#clips .clip').count() == 1, 'filtering by the extra category finds the clip')

    # ---- Review: filter by either category, add a third from the card
    page.goto(APP + '#review'); page.wait_for_selector('#view-review:not(.hidden)')
    page.click('#rv-groups .chip:has-text("%s")' % n1)
    check('1 clip' in page.text_content('#rv-count'), 'Review: filtering by %s finds it' % n1)
    page.click('#rv-groups .chip:has-text("%s")' % n1); page.click('#rv-groups .chip:has-text("%s")' % n3)
    check('0 clips' in page.text_content('#rv-count'), 'Review: a category it isn’t in hides it')
    page.click('#rv-groups .chip:has-text("%s")' % n3)
    page.locator('.rvcard').first.click()
    page.wait_for_selector('#rv-cats', timeout=8000)
    page.click('#rv-cats button[data-cat="%s"]' % c3)
    clip = page.evaluate('window.__bwp.state.games[0].clips[0]')
    check([clip['categoryId']] + clip['alsoCats'] == [c2, c1, c3], 'Review: tapping a category on a clip adds it to the clip')
    page.screenshot(path=SHOTS + '/v13-review-cats.png')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
