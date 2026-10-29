"""Browser test for the clip library (milestone 3b) against a simulated Google sign-in, Picker and Drive.
usage: python3 tests/e2e_library.py <screenshot-dir> <media-dir>
Coach A (owner), A's phone (same Google account) and coach B share one fake Drive."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'lib'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails = g['APP'], g['drive'], g['setup'], g['check'], g['fails']
P1 = MEDIA + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = MEDIA + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'

def by_name(name):
    return [f for f in drive.values() if f['name'] == name and not f['trashed']]

def in_game_folder(f, parent_id):
    """v1.8: clips go in a per-game folder ("<date> vs <opponent>") inside the destination folder."""
    if not f['parents']: return False
    gf = drive.get(f['parents'][0])
    return bool(gf) and gf['parents'] == [parent_id] and gf['name'].startswith('2026-') and ' vs ' in gf['name']

def lib_json():
    f = by_name('Watch Party clip library.json')
    return json.loads(f[0]['content']) if f else None

def priv_json():
    f = by_name('My private clip library.json')
    return json.loads(f[0]['content']) if f else None

def idle(page, timeout=15000):
    page.wait_for_function("!window.__bwp.lib.busy && !window.__bwp.team.busy", timeout=timeout)

def seek(page, t):
    page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(350)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctxA = b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    A, errA = setup(ctxA, 'a@team.com')

    # ---- A: roster, coach B, sign in, create team data -> clip library + private library appear
    A.goto(APP + '#settings')
    A.fill('#s-coach', 'Cristian'); A.press('#s-coach', 'Tab')
    g['team'](A, 'roster')
    for n, nm in [('7', 'Sam'), ('12', 'Leo')]:
        A.fill('#r-num', n); A.fill('#r-name', nm); A.click('button:has-text("Add player")')
    g['team'](A, 'coaches')
    A.fill('#c-name', 'Coach B'); A.fill('#c-email', 'b@team.com'); A.click('button:has-text("Add coach")')
    g['settings'](A)
    A.click('button:has-text("Sign in with Google")')
    A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.lib.teamSync && window.__bwp.state.lib.privSync", timeout=15000)
    idle(A)
    root = by_name('Bulldogs Watch Party')[0]
    check(len(by_name('Watch Party clip library.json')) == 1 and by_name('Watch Party clip library.json')[0]['parents'] == [root['id']], 'A: clip library file created in the team folder')
    check(all(len(by_name(n)) == 1 and by_name(n)[0]['parents'] == [root['id']] for n in ['Team clips', 'Coaches only', 'Family \u2013 #7 Sam', 'Family \u2013 #12 Leo']),
          'A (admin): Team, Coaches only and both family folders created up front, side by side')
    pf = by_name('My Watch Party clips (private)')
    check(len(pf) == 1 and not pf[0]['parents'] and not pf[0]['perms'], 'A: private folder created at the top of A’s Drive, shared with nobody')
    check(len(by_name('My private clip library.json')) == 1, 'A: private library file created')

    # ---- A: new game with type and home/away
    A.goto(APP + '#games')
    A.set_input_files('#file-input', [P1, P2])
    A.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    A.fill('#g-opp', 'Rangers'); A.select_option('#g-type', 'league'); A.select_option('#g-ha', 'home')
    A.click('#g-start')
    A.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    gm = A.evaluate('window.__bwp.state.games[0]')
    check(gm['gameType'] == 'league' and gm['homeAway'] == 'home', 'game type and home/away saved')

    # ---- periods and goals
    seek(A, 2); A.keyboard.press('p')
    # G / H open the goal popup (v1.8); Enter saves the goal. Its automatic goal clip is removed here so the
    # clip counts below stay as they were (tests/e2e_v18.py covers goal clips).
    seek(A, 20); A.keyboard.press('g'); A.wait_for_selector('#dlg-goal[open]'); A.keyboard.press('Enter'); A.wait_for_function('!document.getElementById("dlg-goal").open')
    seek(A, 35); A.keyboard.press('h'); A.wait_for_selector('#dlg-goal[open]'); A.keyboard.press('Enter'); A.wait_for_function('!document.getElementById("dlg-goal").open')
    A.evaluate("(() => { const g = window.__bwp.state.games[0]; g.clips = g.clips.filter(c => c.method !== 'goal'); })()"); A.evaluate('App.renderTagView && 0')
    seek(A, 38); A.keyboard.press('p')
    seek(A, 41); A.keyboard.press('p')
    marks = A.evaluate('window.__bwp.state.games[0].marks')
    check([(x['n'], x['start'], x['end']) for x in marks['periods']] == [(1, 2, 38), (2, 41, None)], 'P marks period 1 start/end and period 2 start')
    check([(x['side'], x['t']) for x in marks['goals']] == [('for', 20), ('against', 35)], 'G and H mark goals for and against')
    check('P2 start' not in A.text_content('#b-period') and 'end' in A.text_content('#b-period'), 'period button now offers the end of P2')
    check(A.locator('#tl .gmk').count() == 2, 'goals show on the timeline')
    A.screenshot(path=SHOTS + '/L1-marks.png')

    # ---- tag a clip around the goal: automatic goal event, period, score
    seek(A, 22); A.keyboard.press('1')
    A.wait_for_timeout(200)
    clip = A.evaluate('window.__bwp.state.games[0].clips[0]')
    card = A.text_content('#clips')
    check('Goal for' in card and 'P1' in card and 'tied 0–0' in card, 'clip card shows auto Goal for, P1 and tied 0–0')

    # ---- editor tags
    A.click('#clips .clip >> nth=0 >> text=Edit')
    A.wait_for_selector('#view-edit:not(.hidden)')
    A.wait_for_function("window.__bwp.editor && Math.abs(window.__bwp.editor.player.time() - 14) < 0.3", timeout=6000)
    check(A.get_attribute('#e-events button:has-text("Goal for")', 'aria-pressed') == 'true', 'editor: Goal for is on (automatic)')
    A.click('#e-events button:has-text("Takeaway")')
    A.click('#e-chips button:has-text("#7")')
    A.select_option('#e-zone', 'off')
    A.click('#e-star')
    A.fill('#e-tag-new', 'Silver Stick'); A.click('#e-tag-add button')
    A.fill('#e-note', 'Quick up the wall'); A.press('#e-note', 'Tab')
    A.wait_for_timeout(200)
    d = A.evaluate('window.__bwp.editor.d')
    check(d['events'] == ['takeaway'] and d['zone'] == 'off' and d['starred'] and d['tags'] == ['Silver Stick'] and d['players'] == ['7'], 'editor: takeaway, zone, star, tag and player saved')
    check('Automatic: P1' in A.text_content('#e-auto'), 'editor shows the automatic period and score')
    A.screenshot(path=SHOTS + '/L2-editor-tags.png', full_page=True)

    # ---- export to Drive: Team + #7 family, not this computer
    A.uncheck('#e-dests label:has-text("This computer") input')
    A.check('#e-dests label:has-text("Team (players") input')
    A.check('#e-dests label:has-text("family folder") input')
    A.click('#e-export')
    A.wait_for_function("window.__bwp.editor.mode === 'idle' && (window.__bwp.editor.d.drive || []).length === 2", timeout=60000)
    tc = by_name('Team clips'); fam = by_name('Family \u2013 #7 Sam')
    check(len(tc) == 1 and len(fam) == 1 and fam[0]['parents'] == tc[0]['parents'], 'Drive: still one Team clips and one Family \u2013 #7 Sam folder')
    vids = [f for f in drive.values() if (f['name'] or '').endswith('.mp4')]
    check(sorted(in_game_folder(v, tc[0]['id']) or in_game_folder(v, fam[0]['id']) for v in vids) == [True, True] and any(in_game_folder(v, tc[0]['id']) for v in vids) and any(in_game_folder(v, fam[0]['id']) for v in vids),
          'Drive: the clip is in a game folder inside Team clips and inside the family folder')
    check(len(vids) == 2 and all(isinstance(v['content'], bytes) and len(v['content']) > 100000 for v in vids), 'two MP4 copies uploaded (%s bytes)' % [len(v['content']) for v in vids])
    check(all('Breakouts' in v['description'] and 'P1' in v['description'] and 'wall' not in v['description'] for v in vids), 'Drive description is neutral: category, game, period (no note)')
    check(A.locator('.toast', has_text='Saved to Drive').count() == 1, 'toast confirms Drive save')
    check(sum(1 for v in vids if v.get('copiedFrom')) == 1, 'second folder got a Google-side copy, not a second upload')

    # ---- a private clip: only in the private library and private folder
    A.click('#e-back'); A.wait_for_selector('#view-tag:not(.hidden)')
    seek(A, 55); A.keyboard.press('2'); A.wait_for_timeout(200)
    A.locator('#clips .clip', has_text='Passing').locator('text=Edit').click()
    A.wait_for_selector('#view-edit:not(.hidden)')
    A.wait_for_timeout(600)
    check(A.is_checked('#e-dests label:has-text("Team (players") input') and not A.is_checked('#e-dests label:has-text("This computer") input'), 'save choices are remembered for the next clip')
    A.check('#e-private')
    A.wait_for_timeout(150)
    check(A.is_visible('#e-dests label:has-text("private Drive folder")') and not A.is_visible('#e-dests label:has-text("Team (players")'), 'private clip offers only the private Drive folder')
    A.check('#e-dests label:has-text("private Drive folder") input')
    # the first upload fails: the finished video is kept and "Retry upload" sends it without exporting again
    failed_once = {'n': 0}
    def flaky(route):
        if route.request.method == 'PATCH' and route.request.headers.get('content-type', '').startswith('video') and failed_once['n'] == 0:
            failed_once['n'] += 1
            route.fulfill(status=503, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}, body=json.dumps({'error': {'message': 'Backend Error'}}))
        else:
            route.fallback()
    A.route('https://www.googleapis.com/upload/drive/v3/files/*', flaky)
    A.click('#e-export')
    A.wait_for_selector('#e-retry-upload', timeout=60000)
    check(A.locator('.toast', has_text='Retry upload').count() >= 1 and len([f for f in drive.values() if (f['name'] or '').endswith('.mp4') and (f['parents'] == [pf[0]['id']] or in_game_folder(f, pf[0]['id']))]) == 0, 'failed upload: video kept, Retry offered, no empty file left in Drive')
    A.unroute('https://www.googleapis.com/upload/drive/v3/files/*', flaky)
    frames_before = A.evaluate('window.__bwp.lastExport && window.__bwp.lastExport.frames')
    A.click('#e-retry-upload')
    A.wait_for_function("window.__bwp.editor.mode === 'idle' && (window.__bwp.editor.d.drive || []).length === 1", timeout=60000)
    check(not A.is_visible('#e-retry-upload'), 'retry uploaded the kept video (no new export)')
    pv = [f for f in drive.values() if (f['name'] or '').endswith('.mp4') and in_game_folder(f, pf[0]['id'])]
    check(len(pv) == 1, 'private clip uploaded to the game folder inside the private folder')
    A.click('#e-back'); A.wait_for_selector('#view-tag:not(.hidden)')
    A.wait_for_timeout(3200); idle(A)
    L = lib_json(); PL = priv_json()
    team_ids = list(L['entries'].keys()); priv_ids = list(PL['entries'].keys())
    check(len(team_ids) == 1 and len(priv_ids) == 1 and team_ids[0] != priv_ids[0], 'team library has the team clip, private library has the private clip')
    e = L['entries'][team_ids[0]]
    check(e['events'] == ['goal_for', 'takeaway'] and e['period'] == 1 and e['state'] == 'tied' and e['game']['type'] == 'league' and len(e['drive']) == 2,
          'library entry: events, period, score, game type and Drive files')
    check('folders' in L and 'team' in L['folders'] and 'player:7' in L['folders'], 'library remembers the team folder IDs for other coaches')

    # ---- Review: scope, filters, saved view, playlist
    A.click('a[data-nav="review"]')
    A.wait_for_selector('#view-review:not(.hidden)')
    check(A.get_attribute('#rv-scope [data-scope="team"]', 'aria-pressed') == 'true', 'Review opens on Team')
    check('1 clip' in A.text_content('#rv-count'), 'Team shows 1 clip')
    A.click('#rv-scope [data-scope="private"]')
    check('1 clip' in A.text_content('#rv-count') and 'Private' in A.text_content('#rv-results'), 'Private shows the private clip with a lock')
    A.click('#rv-scope [data-scope="both"]')
    check('2 clips' in A.text_content('#rv-count'), 'Both shows 2 clips')
    A.click('#rv-scope [data-scope="team"]')
    A.click('#rv-groups button:has-text("Goal against")')
    check('0 clips' in A.text_content('#rv-count'), 'filter Goal against: no clips')
    A.click('#rv-active button[aria-label="Remove filter Event: Goal against"]')
    A.click('#rv-groups button:has-text("Breakouts")'); A.click('#rv-groups button:has-text("Goal for")')
    check('1 clip' in A.text_content('#rv-count') and A.text_content('#rv-title') == 'Breakouts · Goal for', 'Breakouts + Goal for finds the clip; title describes the filters')
    A.fill('#rv-q', 'wall'); A.wait_for_timeout(300)
    check('1 clip' in A.text_content('#rv-count'), 'search finds the note text')
    A.fill('#rv-q', 'zzz'); A.wait_for_timeout(300)
    check('0 clips' in A.text_content('#rv-count'), 'search with no match finds nothing')
    A.fill('#rv-q', ''); A.wait_for_timeout(300)
    A.click('#rv-save')
    A.wait_for_selector('#dlg-ask[open]')
    A.fill('#ask-input', 'Goals off breakouts'); A.click('#ask-ok')
    check('Goals off breakouts' in A.text_content('#rv-views'), 'saved view appears in the list')
    A.click('#rv-play')
    A.wait_for_function("document.querySelector('#rv-stage video') && document.querySelector('#rv-stage video').src.startsWith('blob:')", timeout=10000)
    check(True, 'Play all plays the clip from Drive')
    A.wait_for_timeout(800)
    A.screenshot(path=SHOTS + '/L3-review.png', full_page=False)
    A.click('#rv-close')
    A.wait_for_timeout(3200); idle(A)
    check(any(v['name'] == 'Goals off breakouts' for v in lib_json()['views']), 'saved view is shared through the library file')

    # ---- coach B: open team data + library together, see A's clip, edit its note
    ctxB = b.new_context(viewport={'width': 1440, 'height': 1000})
    B, errB = setup(ctxB, 'b@team.com')
    B.goto(APP + '#settings')
    B.click('button:has-text("Sign in with Google")')
    B.evaluate('(d) => { window.__fakePickDocs = d; }', g['root_items']())
    B.click('button:has-text("Open shared team data")')
    B.wait_for_function("window.__bwp.state.lib.teamSync && Object.keys(window.__bwp.state.lib.team.entries).length === 1", timeout=15000)
    idle(B)
    check(not any(f['name'] == 'Watch Party clip library.json' and f['owner'] == 'b@team.com' for f in drive.values()), 'B uses A’s library (no second copy)')
    check(len(by_name('My private clip library.json')) == 2, 'B gets its own private library too')
    B.goto(APP + '#review')
    B.wait_for_selector('#view-review:not(.hidden)')
    check('1 clip' in B.text_content('#rv-count') and 'Goals off breakouts' in B.text_content('#rv-views'), 'B sees A’s clip and the shared saved view')
    check('In Drive' in B.text_content('#rv-results'), 'B sees the clip is in Drive')
    B.click('#rv-results .rvcard >> nth=0')
    B.wait_for_selector('#rv-tags input[aria-label="Note"]')
    B.fill('#rv-tags input[aria-label="Note"]', 'Quick up the wall, then drive the net'); B.press('#rv-tags input[aria-label="Note"]', 'Tab')
    B.wait_for_timeout(3200); idle(B)
    check(list(lib_json()['entries'].values())[0]['note'] == 'Quick up the wall, then drive the net', 'B’s tag edit reaches the library file')
    # ---- B saves its own clip into the admin's Team folder (the coach path)
    B.goto(APP + '#games')
    B.set_input_files('#file-input', [P1, P2])
    B.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    B.fill('#g-opp', 'Kings'); B.click('#g-start')
    B.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    B.evaluate('window.__bwp.player.seek(30)'); B.wait_for_timeout(400)
    B.keyboard.press('1'); B.wait_for_timeout(300)
    B.locator('#clips .clip').first.locator('text=Edit').click()
    B.wait_for_selector('#view-edit:not(.hidden)'); B.wait_for_timeout(600)
    B.uncheck('#e-dests label:has-text("This computer") input')
    B.check('#e-dests label:has-text("Team (players") input')
    B.click('#e-export')
    B.wait_for_function("window.__bwp.editor && window.__bwp.editor.mode === 'idle' && (window.__bwp.editor.d.drive || []).length === 1", timeout=60000)
    bv = [f for f in drive.values() if (f['name'] or '').endswith('.mp4') and f['owner'] == 'b@team.com']
    check(len(bv) == 1 and in_game_folder(bv[0], tc[0]['id']), 'B (coach): saved a clip into a game folder in the admin\u2019s Team clips folder')
    B.goto(APP + '#settings')

    # A syncs and gets the note in its own clip
    A.goto(APP + '#settings'); A.click('button:has-text("Sync now")')
    A.wait_for_timeout(3200); idle(A)
    note = [c for c in A.evaluate('window.__bwp.state.games[0].clips') if not c['private']][0]['note']
    check(note == 'Quick up the wall, then drive the net', 'A’s own clip picks up B’s edit: ' + note)

    # ---- A's phone: same Google account finds team data, library and private clips without picking
    ctxP = b.new_context(viewport={'width': 412, 'height': 900})
    Ph, errP = setup(ctxP, 'a@team.com')
    Ph.goto(APP + '#settings')
    Ph.click('button:has-text("Sign in with Google")')
    Ph.click('button:has-text("Open shared team data")')
    Ph.wait_for_function("window.__bwp.state.lib.privSync && window.__bwp.state.lib.teamSync && Object.keys(window.__bwp.state.lib.priv.entries).length === 1", timeout=15000)
    idle(Ph)
    check(Ph.evaluate('window.__bwp.state.sync.owner') is True, 'phone: recognised as the owner of the team folder (no file picking)')
    Ph.goto(APP + '#review')
    Ph.click('#rv-scope [data-scope="private"]')
    check('1 clip' in Ph.text_content('#rv-count'), 'phone: private clip shows in Review')
    Ph.click('#rv-results .rvcard >> nth=0')
    Ph.wait_for_function("document.querySelector('#rv-stage video') && document.querySelector('#rv-stage video').src.startsWith('blob:')", timeout=10000)
    check(True, 'phone: private clip plays from the private Drive folder')
    Ph.screenshot(path=SHOTS + '/L4-phone-private.png', full_page=False)
    check(Ph.evaluate("document.documentElement.scrollWidth") <= 412, 'phone: no sideways scrolling on Review')

    # ---- delete the team clip on A: it leaves the library
    A.goto(APP + '#tag/' + A.evaluate('window.__bwp.state.games[0].id'))
    A.wait_for_timeout(500)
    A.locator('#clips .clip', has_text='Breakouts').locator('text=Edit').click()
    A.wait_for_selector('#view-edit:not(.hidden)')
    gone_id = A.evaluate('window.__bwp.editor.clipId')
    A.click('#e-delete')
    A.wait_for_selector('#dlg-ask[open]'); A.click('#ask-ok')
    A.wait_for_timeout(3400); idle(A)
    left = lib_json()['entries']
    check(gone_id not in left and len(left) == 1 and list(left.values())[0]['by'] == 'B', 'deleting a clip removes it from the team library (B\u2019s clip stays)')

    check(not errA and not errB and not errP, 'no page errors: ' + '; '.join((errA + errB + errP)[:3]))
    b.close()

g['srv'].shutdown()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
