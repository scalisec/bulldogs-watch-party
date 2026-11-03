"""Browser test for v2.4.2: on a phone, tapping a clip in Review scrolls to the video and loads it without playing;
Play all still plays; clips not in Drive say so. Runs against the simulated Google Drive in e2e_drive.py.
usage: python3 tests/e2e_v242.py <screenshot-dir>"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v242'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings, new_file, grant, root_items = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings'], g['new_file'], g['grant'], g['root_items']
CLIP = open(sorted(glob.glob(os.path.join(HERE, 'fixtures', 'media', '*.mp4')))[0], 'rb').read()
PHONE = {'viewport': {'width': 412, 'height': 915}, 'is_mobile': True, 'has_touch': True,
         'user_agent': 'Mozilla/5.0 (Linux; Android 14; SM-S921W) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'}

def live(name): return [f for f in drive.values() if f['name'] == name and not f['trashed']]
def entry(i, fid):
    return {'id': 'clip_%d' % i, 'gameId': 'game_1', 'game': {'date': '2026-10-%02d' % (10 + i), 'opponent': 'Hawks', 'rink': '', 'type': 'league', 'homeAway': 'home', 'result': '', 'title': 'Game %d vs Hawks' % i},
        'categoryId': 'goal', 'alsoCats': [], 'category': 'Goal', 'color': '#16A34A', 'events': [], 'players': [7], 'positions': [], 'flag': 'do', 'note': 'Clip %d' % i,
        'zone': '', 'situation': 'even', 'penalties': [], 'starred': False, 'tags': [], 'private': False, 'start': 10, 'end': 18, 'period': 1, 'periodTime': 10,
        'score': {'for': 0, 'against': 0}, 'state': 'tied', 'features': {}, 'drive': [{'folder': 'team', 'fileId': fid, 'name': 'c.mp4'}] if fid else [], 'by': 'Coach A', 'owner': 'Coach A'}
def playing(page): return page.evaluate("(() => { const v = document.querySelector('#rv-stage video'); return !!v && !v.paused; })()")

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctxA = b.new_context(viewport={'width': 1280, 'height': 1000})
    A, errA = setup(ctxA, 'a@team.com')
    team(A, 'coaches'); A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'b@team.com'); A.click('button:has-text("Add coach")')
    settings(A); A.click('button:has-text("Sign in with Google")'); A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.sync && window.__bwp.state.lib.teamSync && !window.__bwp.team.busy && !window.__bwp.lib.busy", timeout=10000)
    A.wait_for_function("(window.__bwp.state.sync.sharedWith || []).includes('b@team.com')", timeout=5000)
    vids = [new_file('a@team.com', 'c%d.mp4' % i, 'video/mp4', [live('Team clips')[0]['id']], CLIP) for i in range(6)]
    lf = live('Watch Party clip library.json')[0]
    lib = json.loads(lf['content'])
    for i in range(6): lib['entries']['clip_%d' % i] = entry(i, vids[i]['id'])
    lib['entries']['clip_6'] = entry(6, None)  # tagged on the coach's computer, never exported
    lf['content'] = json.dumps(lib); lf['version'] += 1

    ctxB = b.new_context(**PHONE)
    B, errB = setup(ctxB, 'b@team.com')
    B.goto(APP + '#review'); B.wait_for_selector('#rv-connect button')
    B.evaluate('(d) => { window.__fakePickDocs = d; }', root_items())
    B.click('#rv-connect button:has-text("Connect this device")')
    B.wait_for_function("Object.keys(window.__bwp.state.lib.team.entries).length === 7 && !window.__bwp.lib.busy", timeout=10000)
    for v in vids: grant('b@team.com', v['id'])
    B.wait_for_timeout(300)

    # tap a clip far down the list: the screen scrolls up to the video, which is loaded but not playing
    card = B.locator('.rvcard', has_text='Clip 4')
    card.scroll_into_view_if_needed(); card.click()
    B.wait_for_selector('#rv-stage video', timeout=8000)
    B.wait_for_timeout(900)  # smooth scroll
    top = B.evaluate("document.getElementById('rv-stage').getBoundingClientRect().top")
    check(0 <= top < 400, 'tapping a clip scrolls to the video (top at %dpx)' % top)
    # (the test browser can't decode the AAC test clip, so check what the app asked for rather than the picture)
    check(B.evaluate("(() => { const v = document.querySelector('#rv-stage video'); return v.src.startsWith('blob:') && v.controls && !v.autoplay; })()") and not playing(B), 'the clip is loaded with its play controls, but doesn’t start on its own')
    B.screenshot(path=SHOTS + '/v242-tapped.png')

    # Next loads the next clip without starting it
    first = B.evaluate("document.querySelector('#rv-stage video').src")
    B.click('#rv-next'); B.wait_for_function("(f) => { const v = document.querySelector('#rv-stage video'); return v && v.src !== f; }", arg=first, timeout=8000)
    check(B.evaluate("!document.querySelector('#rv-stage video').autoplay") and not playing(B), 'Next loads the next clip, not playing')

    # the clip that isn't in Drive says so, plainly
    nd = B.locator('.rvcard', has_text='Clip 6')
    check('Not in Drive yet' in nd.text_content(), 'a clip not exported says “Not in Drive yet” on its card')
    nd.scroll_into_view_if_needed(); nd.click(); B.wait_for_timeout(400)
    check('Export it to Drive on that computer' in B.text_content('#rv-stage'), 'and tapping it explains how to get it here')

    # Play all still plays straight away
    B.click('#rv-close'); B.evaluate('window.scrollTo(0, 0)')
    B.click('#rv-play'); B.wait_for_selector('#rv-stage video', timeout=8000)
    B.wait_for_function("(() => { const v = document.querySelector('#rv-stage video'); return v && v.src.startsWith('blob:'); })()", timeout=8000)
    check(B.evaluate("document.querySelector('#rv-stage video').autoplay"), 'Play all starts playing (autoplay on)')
    check(not errA and not errB, 'no page errors: ' + '; '.join((errA + errB)[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
