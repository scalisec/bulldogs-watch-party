"""Browser test for v1.8: goal popup (scorer and assists / their numbers and our players on the ice) that makes a
tagged goal clip; zooming while a clip plays on the game screen sets that clip's view (and its export).
(Per-game Drive folders are covered in e2e_library.py.)
usage: python3 tests/e2e_v18.py <screenshot-dir> <media-dir>"""
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
    for n, f, l in [('7', 'Sam', 'Smith'), ('12', 'Leo', 'Lane'), ('4', 'Maya', 'Moss'), ('3', 'Ava', 'Ash')]:
        page.fill('#r-num', n); page.fill('#r-name', f); page.fill('#r-last', l); page.click('#roster-add button[type=submit]')
    page.goto(APP + '#new'); page.wait_for_selector('#view-new:not(.hidden)')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.fill('#g-opp', 'Raiders'); page.fill('#g-date', '2026-10-18'); page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    # ---- G while playing: scorer #7, assists #12 and #4
    seek(page, 20)
    page.evaluate('window.__bwp.player.play()'); page.wait_for_timeout(300)
    page.keyboard.press('g'); page.wait_for_selector('#dlg-goal[open]')
    check(not page.evaluate('window.__bwp.player.isPlaying()'), 'G pauses and opens the goal popup')
    check(page.is_visible('#gl-scorer') and not page.is_visible('#gl-oscorer'), 'goal for: asks for our scorer and assists')
    page.click('#gl-scorer .chip:has-text("#7")')
    page.click('#gl-assists .chip:has-text("#12")'); page.click('#gl-assists .chip:has-text("#4")')
    check(page.locator('#gl-assists .chip:has-text("#7")').count() == 0, 'the scorer isn’t offered as an assist')
    page.screenshot(path=SHOTS + '/v18-goal-for.png')
    page.keyboard.press('Enter')
    page.wait_for_function('!document.getElementById("dlg-goal").open')
    g = game(page)
    goal = g['marks']['goals'][0]
    check(goal['scorer'] == '7' and goal['assists'] == ['12', '4'], 'goal saved with scorer #7, assists #12 #4')
    clip = [c for c in g['clips'] if c['method'] == 'goal'][0]
    t = goal['t']
    check(abs(clip['start'] - max(0, t - 10)) < 0.11 and abs(clip['end'] - (t + 5)) < 0.11, 'goal clip runs 10 s before to 5 s after (%.1f–%.1f, goal at %.1f)' % (clip['start'], clip['end'], t))
    check(sorted(clip['players']) == ['12', '4', '7'] and 'Goal #7 (A: #12, #4)' in clip['note'], 'the clip is tagged with #7, #12, #4 and a note: ' + clip['note'])
    cats = page.evaluate('window.__bwp.state.settings.categories')
    check([c['name'] for c in cats if c['id'] == clip['categoryId']] == ['Shots & scoring chances'], 'goal clip goes in the scoring category')
    check('Goal #7 (A: #12, #4)' in page.text_content('#marks-list'), 'marks list shows the scorer')
    page.wait_for_timeout(300)
    check(page.evaluate('window.__bwp.player.isPlaying()'), 'the video carries on after saving')
    page.evaluate('window.__bwp.player.pause()')

    # ---- H: their #19, our #3 and #4 on the ice
    seek(page, 50)
    page.keyboard.press('h'); page.wait_for_selector('#dlg-goal[open]')
    check(page.is_visible('#gl-oscorer') and not page.is_visible('#gl-scorer'), 'goal against: asks for their numbers and our players on the ice')
    page.fill('#gl-oscorer', '19'); page.fill('#gl-oa1', '8')
    page.click('#gl-onice .chip:has-text("#3")'); page.click('#gl-onice .chip:has-text("#4")')
    page.click('#gl-ok')
    g = game(page)
    ga = g['marks']['goals'][1]
    check(ga['oppScorer'] == '19' and ga['oppAssists'] == ['8'] and ga['onIce'] == ['3', '4'], 'goal against saved with #19, assist #8, on ice #3 #4')
    gclips = [c for c in g['clips'] if c['method'] == 'goal']
    check(len(gclips) == 2 and sorted(gclips[1]['players']) == ['3', '4'], 'its clip is tagged with our players on the ice')
    check(page.text_content('#sb .sb-us .sb-n') == '1' and page.text_content('#sb .sb-them .sb-n') == '1', 'scoreboard updates to 1–1')

    # ---- Cancel: no goal, no clip
    page.keyboard.press('g'); page.wait_for_selector('#dlg-goal[open]'); page.keyboard.press('Escape')
    page.wait_for_function('!document.getElementById("dlg-goal").open')
    check(len(game(page)['marks']['goals']) == 2 and len(game(page)['clips']) == 2, 'Esc cancels: no goal, no clip')

    # ---- zoom while a clip plays sets its view
    first = page.locator('#clips .clip').first
    first.locator('button:has-text("Play clip")').click(); page.wait_for_timeout(500)
    page.click('#z-in'); page.click('#z-in'); page.wait_for_timeout(200)
    box = page.locator('#vframe').bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2 - 120, box['y'] + box['height'] / 2 - 40, steps=5); page.mouse.up()
    page.wait_for_timeout(700)
    z = page.evaluate('window.__bwp.state.games[0].clips.find(c => c.id === %r).zoom' % page.get_attribute('#clips .clip >> nth=0', 'data-clip'))
    live = page.evaluate('App.zoom')
    check(z is not None and abs(z['scale'] - live['scale']) < 0.01 and abs(z['x'] - live['x']) < 0.01 and abs(z['y'] - live['y']) < 0.01 and abs(live['x'] - 0.5) > 0.02, 'the clip’s saved view matches the screen (zoom %.2f, centre %.2f,%.2f)' % (live['scale'], live['x'], live['y']))
    check('View saved to this clip' in page.text_content('#ov-tag'), 'a note says the view was saved to the clip')
    # zooming when no clip is playing doesn't change clips
    page.evaluate('window.__bwp.player.pause()'); page.evaluate('App.playingClipId = null')
    before = page.evaluate('JSON.stringify(window.__bwp.state.games[0].clips.map(c => c.zoom))')
    page.click('#z-fit'); page.wait_for_timeout(600)
    check(page.evaluate('JSON.stringify(window.__bwp.state.games[0].clips.map(c => c.zoom))') == before, 'zooming outside a playing clip leaves clips alone')
    page.screenshot(path=SHOTS + '/v18-goals.png')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
