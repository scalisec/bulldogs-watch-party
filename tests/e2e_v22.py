"""Browser test for v2.2: the performance log. Causes the kinds of freeze it should catch and checks they're recorded,
explained in Settings › Troubleshooting, kept across a reload, and saved by Download log.
usage: python3 tests/e2e_v22.py <screenshot-dir> <media-dir>"""
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

def types(page): return [e['type'] for e in page.evaluate('App.diag.events()')]
def last(page, t): return [e for e in page.evaluate('App.diag.events()') if e['type'] == t][-1:]

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#new'); page.wait_for_function('window.App && App.diag')
    check(types(page)[0] == 'start' and 'gpu' in page.evaluate('App.diag.events()[0].env'), 'log starts with the computer’s details (browser, graphics)')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    page.evaluate('window.__bwp.player.play()'); page.wait_for_timeout(1200)

    # 1. the app itself busy for 2 s (script blocking)
    page.evaluate('(() => { const t = performance.now(); while (performance.now() - t < 2000) {} })()')
    page.wait_for_timeout(1500)
    t = types(page)
    check('busy' in t or 'long-frame' in t or 'long-task' in t, 'app busy for 2 s is recorded: %s' % sorted(set(t)))
    check('freeze' in t, 'and the screen stopping for 2 s is recorded as a freeze')
    check('video-stuck' not in t, 'the app being busy isn’t mistaken for the video getting stuck')
    f = last(page, 'freeze')[0]
    check(f['ms'] >= 1500 and f['view'] == 'tag' and f['playing'] is True and 'x' in f.get('res', ''), 'the freeze notes the screen, that the video was playing, and its size: %s' % f)

    # 2. the video picture stops while the app keeps running (hidden video = no new frames shown)
    # (the test browser keeps reporting frames for a hidden video, so stop its frame notifications the way a stuck decoder does)
    page.wait_for_timeout(2000)  # past the 3 s after the busy moment, when the video isn't blamed
    page.evaluate("document.getElementById('video').requestVideoFrameCallback = () => 0")
    page.wait_for_function("App.diag.events().some(e => e.type === 'video-stuck')", timeout=8000)
    vs = last(page, 'video-stuck')
    check(len(vs) == 1 and vs[0]['ms'] >= 1200, 'video picture stuck while playing is recorded: %s' % vs)

    # 3. F8 marks the moment
    page.keyboard.press('F8'); page.wait_for_timeout(200)
    check('marked' in types(page), 'F8 marks a freeze')

    # Settings › Troubleshooting explains it
    page.goto(APP + '#settings'); page.wait_for_selector('#view-settings:not(.hidden)')
    page.wait_for_selector('#diag-recent')
    body = page.text_content('#diag-body')
    check('Video picture stuck' in body and 'You pressed F8' in body and 'Screen stopped' in body, 'Troubleshooting lists the recent freezes')
    check('video picture stopped while the app kept running' in body and 'graphics acceleration' in body, 'and says what the video freezes point to and what to try')
    check('1 time the app’s own work took over a second' in body, 'the busy freeze is counted as the app’s own work: ' + body)
    page.locator('#diag-card').screenshot(path=SHOTS + '/v22-troubleshooting.png')
    with page.expect_download() as dl:
        page.click('#diag-body button:has-text("Download log")')
    data = json.load(open(dl.value.path()))
    check(data['kind'] == 'performance-log' and data['env']['gpu'] and any(e['type'] == 'video-stuck' for e in data['session']['events']), 'Download log saves the events and the computer’s details')
    check('Sam' not in json.dumps(data) and 'roster' not in json.dumps(data), 'the log has no player details')

    # kept across a reload (a freeze often ends with a reload)
    page.reload(); page.wait_for_function('window.App && App.diag')
    page.goto(APP + '#settings'); page.wait_for_selector('#diag-body .diagnote')
    check('video picture stopped' in page.text_content('#diag-body'), 'after a reload, the last session’s freezes still count')
    page.click('#diag-body button:has-text("Clear log")')
    check('No freezes recorded yet' in page.text_content('#diag-body'), 'Clear log empties it')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
