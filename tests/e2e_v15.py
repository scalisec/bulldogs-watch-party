"""Browser test for v1.5: T opens a small popup to type a custom tag; it makes a new clip at that moment.
Suggestions from tags used before, the category (last used), start/end marks, Esc, and the video resuming.
usage: python3 tests/e2e_v15.py <screenshot-dir> <media-dir>"""
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

def clips(page): return page.evaluate('window.__bwp.state.games[0].clips')
def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(350)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#games'); page.wait_for_function('window.__bwp')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Raiders'); page.fill('#g-date', '2026-10-18')
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    cats = page.evaluate('window.__bwp.state.settings.categories.filter(c => !c.hidden).map(c => [c.id, c.name])')

    # an earlier clip with a tag (so it's suggested), category 2
    seek(page, 10); page.keyboard.press('2'); page.wait_for_timeout(300)
    page.evaluate("(() => { const g = window.__bwp.state.games[0]; g.clips[0].tags = ['Silver Stick']; })()")

    # ---- T while playing: popup, typed tag, category defaults to the last one used
    seek(page, 30)
    page.evaluate('window.__bwp.player.play()'); page.wait_for_timeout(300)
    page.keyboard.press('t')
    page.wait_for_selector('#dlg-qtag[open]')
    check(not page.evaluate('window.__bwp.player.isPlaying()'), 'T pauses the video and opens the tag popup')
    check(page.evaluate("document.activeElement.id") == 'qt-tag', 'the tag box has the cursor, ready to type')
    check('Silver Stick' in page.eval_on_selector_all('#dl-qtags option', 'e => e.map(x => x.value)'), 'tags used before are suggested as you type')
    check(page.input_value('#qt-cat') == cats[1][0], 'category starts on the last one used (%s)' % cats[1][1])
    t0 = page.evaluate('window.__bwp.player.time()')
    page.keyboard.type('Great backcheck, 3')
    check(len(clips(page)) == 1, 'typing numbers in the popup doesn’t tag clips')
    page.screenshot(path=SHOTS + '/v15-quick-tag.png')
    page.keyboard.press('Enter')
    page.wait_for_function('!document.getElementById("dlg-qtag").open')
    c = clips(page)[-1]
    check(len(clips(page)) == 2 and c['tags'] == ['Great backcheck', '3'] and c['categoryId'] == cats[1][0], 'Enter makes a new clip with the tags and category: %s' % c['tags'])
    check(c['start'] < t0 < c['end'], 'the clip is around the moment T was pressed')
    page.wait_for_timeout(300)
    check(page.evaluate('window.__bwp.player.isPlaying()'), 'the video carries on after')
    check('Great backcheck' in page.text_content('#clips'), 'the clip list shows the tag')

    # ---- Esc cancels; empty tag is refused
    page.evaluate('window.__bwp.player.pause()')
    page.keyboard.press('T'); page.wait_for_selector('#dlg-qtag[open]')
    page.keyboard.press('Enter')
    check(page.is_visible('#dlg-qtag') and len(clips(page)) == 2, 'an empty tag isn’t saved')
    page.keyboard.press('Escape')
    page.wait_for_function('!document.getElementById("dlg-qtag").open')
    check(len(clips(page)) == 2, 'Esc closes without a clip')

    # ---- with start/end marks: the clip uses them
    seek(page, 40); page.keyboard.press('i'); seek(page, 48); page.keyboard.press('o')
    page.keyboard.press('t'); page.wait_for_selector('#dlg-qtag[open]')
    check('your start/end marks' in page.text_content('#qt-at'), 'with I/O marks, the popup says it’ll use them')
    page.select_option('#qt-cat', cats[0][0])
    page.fill('#qt-tag', 'Odd-man rush'); page.keyboard.press('Enter')
    page.wait_for_function('!document.getElementById("dlg-qtag").open')
    c = clips(page)[-1]
    check(c['start'] == 40 and c['end'] == 48 and c['categoryId'] == cats[0][0] and c['tags'] == ['Odd-man rush'], 'clip uses the I/O marks and the chosen category')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
