import sys, time, json
from playwright.sync_api import sync_playwright

import os
# usage: python3 tests/e2e.py <screenshot-dir> <media-dir>
# media-dir holds two short LiveBarn-named parts (.webm) like the ones described in README.md
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'file://' + ROOT + '/index.html'
M = sys.argv[2].rstrip('/') + '/'
P1 = M + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = M + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'
SHOTS = sys.argv[1]
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.goto(APP)
    print('h264 support:', page.evaluate("document.createElement('video').canPlayType('video/mp4; codecs=\"avc1.640033\"')"))
    check(page.is_visible('#view-games'), 'games view shows first')

    # add parts out of order
    page.set_input_files('#file-input', [P2, P1])
    page.wait_for_function("document.querySelectorAll('#parts .partrow').length === 2 && !document.getElementById('g-start').disabled", timeout=20000)
    names = page.eval_on_selector_all('#parts .partrow .name', 'els => els.map(e => e.textContent)')
    check(names[0].startswith('1__') and names[1].startswith('2__'), 'parts sorted into play order')
    check(page.input_value('#g-date') == '2026-10-18', 'date guessed from file name')
    check(page.input_value('#g-rink') == 'Mountainside Arena Rink', 'rink guessed from file name')
    page.fill('#g-opp', 'Rangers')
    page.screenshot(path=SHOTS + '/1-import.png')
    page.click('#g-start')
    page.wait_for_selector('#view-tag:not(.hidden)')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)
    check('Oct 18, 2026 vs Rangers' in page.text_content('#t-title'), 'title shows date and opponent')
    check(page.eval_on_selector_all('#tags .tagbtn', 'e => e.length') == 9, '9 category buttons')

    # play a bit
    page.click('#b-play')
    page.wait_for_timeout(1500)
    t = page.evaluate('window.__bwp.player.time()')
    check(t > 0.5, 'video plays (t=%.2f)' % t)
    page.click('#b-play')  # pause

    # seek to 20s, tap key 1
    page.evaluate('window.__bwp.player.seek(20)')
    page.wait_for_timeout(500)
    page.keyboard.press('1')
    page.wait_for_timeout(200)
    clips = page.evaluate('window.__bwp.state.games[0].clips')
    check(len(clips) == 1 and clips[0]['start'] == 12 and clips[0]['end'] == 24 and clips[0]['method'] == 'tap', 'key 1 makes 12-24 Breakouts clip: ' + json.dumps([(c['start'], c['end']) for c in clips]))

    # cross part boundary
    page.evaluate('window.__bwp.player.seek(45)')
    page.wait_for_function("document.getElementById('ov-time').textContent.startsWith('Part 2')", timeout=5000)
    check(True, 'seek to 45s shows Part 2')
    vt = page.evaluate("document.getElementById('video').currentTime")
    check(abs(vt - 5) < 0.3, 'part 2 local time ~5s (%.2f)' % vt)

    # playback rolls over from part 1 to part 2
    page.evaluate('window.__bwp.player.seek(38.5)')
    page.wait_for_timeout(300)
    page.click('#b-play')
    page.wait_for_timeout(3500)
    t2 = page.evaluate('window.__bwp.player.time()')
    check(t2 > 40.5, 'playback continues into part 2 (t=%.2f)' % t2)
    page.click('#b-play')

    # I / O marks then category 3
    page.evaluate('window.__bwp.player.seek(50)'); page.wait_for_timeout(300)
    page.keyboard.press('i')
    page.evaluate('window.__bwp.player.seek(57.5)'); page.wait_for_timeout(300)
    page.keyboard.press('o')
    check('pick a category' in page.text_content('#marks-banner'), 'banner asks for a category')
    page.screenshot(path=SHOTS + '/2-marks.png')
    page.keyboard.press('3')
    page.wait_for_timeout(200)
    clips = page.evaluate('window.__bwp.state.games[0].clips')
    mk = [c for c in clips if c['method'] == 'marks']
    check(len(mk) == 1 and mk[0]['start'] == 50 and mk[0]['end'] == 57.5 and mk[0]['categoryId'] == 'cat_3', 'I/O + 3 makes exact Forecheck clip')
    check(page.is_hidden('#marks-banner'), 'banner clears')

    # manual clip dialog
    page.click('#b-manual')
    page.fill('#dm-start', '1:01')
    page.fill('#dm-end', '0:59')
    page.click('#dm-ok')
    check('at least' in page.text_content('#dm-err'), 'manual dialog rejects end before start')
    page.fill('#dm-end', '1:08')
    page.select_option('#dm-cat', 'cat_6')
    page.click('#dm-ok')
    page.wait_for_timeout(200)
    clips = page.evaluate('window.__bwp.state.games[0].clips')
    man = [c for c in clips if c['method'] == 'manual']
    check(len(man) == 1 and man[0]['start'] == 61 and man[0]['end'] == 68, 'manual clip 1:01-1:08 created')
    check(page.eval_on_selector_all('#tl .mk', 'e => e.length') == 3, '3 markers on the timeline')

    # edit a clip's details in the clip editor
    page.click('#clips .clip >> nth=0 >> text=Edit')
    page.wait_for_selector('#view-edit:not(.hidden)')
    page.wait_for_function("window.__bwp.editor && Math.abs(window.__bwp.editor.player.time() - 12) < 0.2", timeout=5000)
    check('Breakouts' in page.text_content('#e-title'), 'editor opens on the clip')
    page.fill('#e-players', '#7, 12'); page.press('#e-players', 'Tab')
    page.click('#e-flag [data-flag="work"]')
    page.fill('#e-note', 'Stay wide on the wall'); page.press('#e-note', 'Tab')
    page.wait_for_timeout(200)
    c0 = sorted(page.evaluate('window.__bwp.state.games[0].clips'), key=lambda c: c['start'])[0]
    check(c0['players'] == ['7', '12'] and c0['flag'] == 'work' and c0['note'] == 'Stay wide on the wall', 'clip details save automatically')
    page.click('#e-back')
    page.wait_for_selector('#view-tag:not(.hidden)')
    check('Stay wide on the wall' in page.text_content('#clips'), 'back in the game, the clip list shows the edits')

    # play clip range stops at end
    page.click('#clips .clip >> nth=0 >> text=Play clip')
    page.wait_for_timeout(500)
    page.evaluate('window.__bwp.player.seek(22)')
    page.wait_for_timeout(3200)
    tt = page.evaluate('window.__bwp.player.time()')
    playing = page.evaluate('window.__bwp.player.isPlaying()')
    check(not playing and 23.5 <= tt <= 24.6, 'play clip stops at clip end (t=%.2f)' % tt)
    page.screenshot(path=SHOTS + '/3-tag.png')

    # undo via toast after a tap
    n_before = len(page.evaluate('window.__bwp.state.games[0].clips'))
    page.keyboard.press('2')
    page.wait_for_timeout(150)
    check(1 <= page.locator('.toast').count() <= 3, 'pop-ups stack (at most 3)')
    page.locator('.toast', has_text='Undo').last.locator('text=Undo').click()
    after = page.evaluate('window.__bwp.state.games[0].clips')
    check(len(after) == n_before and not any(c['categoryId'] == 'cat_2' for c in after), 'undo removes the tapped clip, not an older one')

    # zoom
    box = page.locator('#vframe').bounding_box()
    check(abs(box['width'] / box['height'] - 1020 / 452) < 0.05, 'video frame matches the wide LiveBarn shape (%.2f)' % (box['width'] / box['height']))
    page.mouse.move(box['x'] + box['width'] * 0.8, box['y'] + box['height'] * 0.5)
    for _ in range(5):
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(50)
    tf = page.evaluate("document.getElementById('video').style.transform")
    check(tf.startswith('scale(2.0'), 'scroll wheel zooms in (%s)' % tf)
    check(page.is_visible('#ov-zoom'), 'zoom hint shows')
    # drag to pan
    before = tf
    page.mouse.move(box['x'] + 300, box['y'] + 200)
    page.mouse.down(); page.mouse.move(box['x'] + 500, box['y'] + 250, steps=5); page.mouse.up()
    check(page.evaluate("document.getElementById('video').style.transform") != before, 'dragging moves the zoomed view')
    page.screenshot(path=SHOTS + '/3b-zoomed.png')
    page.keyboard.press('0')
    check(page.evaluate("document.getElementById('video').style.transform") == '', 'key 0 fits the whole rink')
    page.keyboard.press('+'); page.keyboard.press('+')
    page.evaluate('window.__bwp.player.seek(66)'); page.wait_for_timeout(300)
    page.keyboard.press('1')
    page.wait_for_timeout(150)
    zc = [c for c in page.evaluate('window.__bwp.state.games[0].clips') if c['start'] == 58]
    check(len(zc) == 1 and zc[0]['zoom'] and abs(zc[0]['zoom']['scale'] - 1.56) < 0.01, 'clip tagged while zoomed keeps the zoom')
    check('Zoom 1.6' in page.text_content('#clips'), 'clip card shows its zoom')
    page.keyboard.press('0')
    zcard = page.locator('#clips .clip', has_text='Zoom 1.6')
    zcard.locator('text=Play clip').click()
    page.wait_for_timeout(200)
    check(page.evaluate("document.getElementById('video').style.transform").startswith('scale(1.56'), 'playing a zoomed clip applies its zoom')
    zcard.locator('text=Edit').click()
    page.wait_for_selector('#view-edit:not(.hidden)')
    check(page.text_content('#e-zoom-text') == 'Zoom 1.6\u00d7', 'editor shows the clip zoom')
    page.click('#ez-fit')
    page.wait_for_timeout(150)
    zc = [c for c in page.evaluate('window.__bwp.state.games[0].clips') if c['start'] == 58]
    check(zc[0]['zoom'] is None, 'zoom can be cleared from a clip')
    page.click('#e-back')
    page.wait_for_selector('#view-tag:not(.hidden)')

    # ===== milestone 2a: clip editor, freeze-and-draw, speed, preview, export =====
    page.locator('#clips .clip', has_text='Stay wide on the wall').locator('text=Edit').click()
    page.wait_for_selector('#view-edit:not(.hidden)')
    page.wait_for_function("window.__bwp.editor && Math.abs(window.__bwp.editor.player.time() - 12) < 0.2", timeout=5000)
    # trim by typing
    page.fill('#e-start', '0:13'); page.press('#e-start', 'Tab')
    page.wait_for_timeout(150)
    ed = page.evaluate('window.__bwp.editor.d')
    check(ed['start'] == 13 and ed['end'] == 24, 'trim by typing a start time')
    # drag the end handle left
    page.wait_for_timeout(300)
    page.wait_for_selector('#e-trim .handle[data-h="end"]', state='visible')
    hb = page.locator('#e-trim .handle[data-h="end"]').bounding_box()
    tb = page.locator('#e-trim').bounding_box()
    page.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2)
    page.mouse.down(); page.mouse.move(hb['x'] + hb['width'] / 2 - tb['width'] * 0.03, hb['y'] + hb['height'] / 2, steps=4); page.mouse.up()
    page.wait_for_timeout(200)
    ed = page.evaluate('window.__bwp.editor.d')
    check(22 < ed['end'] < 24, 'drag the end handle to trim (end=%.1f)' % ed['end'])
    page.fill('#e-end', '0:23'); page.press('#e-end', 'Tab')
    # slow-motion section at 15s
    page.evaluate('window.__bwp.editor.player.seek(15)'); page.wait_for_timeout(300)
    page.click('text=Add slow-motion section at playhead')
    page.wait_for_timeout(150)
    ed = page.evaluate('window.__bwp.editor.d')
    check(len(ed['speeds']) == 1 and ed['speeds'][0]['start'] == 15 and ed['speeds'][0]['end'] == 18 and ed['speeds'][0]['rate'] == 0.5, 'slow-motion section added 0:15-0:18 at 0.5x')
    check(page.locator('#e-trim .spd').count() == 1, 'speed band shows on the trim bar')
    page.select_option('#e-speeds select', '0.25')
    page.wait_for_timeout(100)
    check(page.evaluate('window.__bwp.editor.d.speeds[0].rate') == 0.25, 'speed changed to 0.25x')
    page.select_option('#e-speeds select', '0.5')
    # freeze and draw at 20s
    page.evaluate('window.__bwp.editor.player.seek(20)'); page.wait_for_timeout(300)
    page.keyboard.press('ArrowRight'); page.keyboard.press('ArrowLeft'); page.wait_for_timeout(400)
    page.click('#e-freeze-here')
    page.wait_for_timeout(300)
    ed = page.evaluate('window.__bwp.editor')
    check(ed['mode'] == 'draw' and abs(ed['d']['freeze']['at'] - 20) < 0.15, 'freeze at 0:20 and drawing mode on')
    cb = page.locator('#e-canvas').bounding_box()
    page.mouse.move(cb['x'] + cb['width'] * 0.3, cb['y'] + cb['height'] * 0.6)
    page.mouse.down(); page.mouse.move(cb['x'] + cb['width'] * 0.55, cb['y'] + cb['height'] * 0.4, steps=6); page.mouse.up()
    page.click('#e-freeze >> text=Circle')
    page.mouse.move(cb['x'] + cb['width'] * 0.6, cb['y'] + cb['height'] * 0.3)
    page.mouse.down(); page.mouse.move(cb['x'] + cb['width'] * 0.7, cb['y'] + cb['height'] * 0.5, steps=6); page.mouse.up()
    page.click('#e-freeze >> text=Freehand')
    page.mouse.move(cb['x'] + cb['width'] * 0.1, cb['y'] + cb['height'] * 0.2)
    page.mouse.down()
    for i in range(10):
        page.mouse.move(cb['x'] + cb['width'] * (0.1 + i * 0.02), cb['y'] + cb['height'] * (0.2 + (i % 2) * 0.05))
    page.mouse.up()
    page.wait_for_timeout(150)
    shapes = page.evaluate('window.__bwp.editor.d.freeze.shapes')
    check([x['type'] for x in shapes] == ['arrow', 'circle', 'free'], 'drew an arrow, a circle and a freehand line')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(100)
    check(len(page.evaluate('window.__bwp.editor.d.freeze.shapes')) == 2, 'Ctrl+Z undoes the last drawing')
    yellow = page.evaluate('''(() => { const c = document.getElementById('e-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i+1] > 180 && d[i+2] < 90) n++; return n; })()''')
    check(yellow > 500, 'drawings are painted on the preview (%d yellow px)' % yellow)
    page.screenshot(path=SHOTS + '/7-editor-draw.png')
    page.click('#e-freeze >> text=Done drawing')
    page.check('#e-title-on')
    # finished length: 13-15 (2) + 15-18 @0.5 (6) + 18-20 (2) + hold 3 + 20-23 (3) = 16
    check('finished video 16 s' in page.text_content('#e-len'), 'finished length accounts for slow motion and freeze: ' + page.text_content('#e-len'))
    # preview runs and ends
    page.click('#e-play')
    page.wait_for_timeout(500)
    check(page.evaluate('window.__bwp.editor.mode') == 'preview', 'preview starts')
    page.wait_for_timeout(9500)
    page.wait_for_function("window.__bwp.editor.mode === 'idle'", timeout=15000)
    check(True, 'preview plays through and stops')
    # export
    with page.expect_download(timeout=60000) as dl:
        page.click('#e-export')
        page.wait_for_timeout(400)
        check(page.is_visible('#e-exporting'), 'export progress shows')
    out = dl.value
    mp4 = SHOTS + '/export-test.mp4'
    out.save_as(mp4)
    le = page.evaluate('({name: window.__bwp.lastExport.name, size: window.__bwp.lastExport.size, codec: window.__bwp.lastExport.codec, frames: window.__bwp.lastExport.frames, duration: window.__bwp.lastExport.duration})')
    print('export:', le)
    check(le['name'] == '2026-10-18 Breakouts 0m13s #7 #12.mp4', 'export file name: ' + le['name'])
    check(le['frames'] > 250, 'export encoded enough frames (%d)' % le['frames'])
    check(page.evaluate("window.__bwp.state.games[0].clips.some(c => c.exported && c.exported.name.endsWith('.mp4'))"), 'clip remembers it was exported')
    page.screenshot(path=SHOTS + '/8-editor-after-export.png')

    # ===== milestone 2b: record a breakdown (voice + half speed) =====
    check(page.is_checked('#e-rec-voice') and page.is_checked('#e-rec-half'), 'voice-over and half speed are on by default')
    page.click('#e-rec-start')
    page.wait_for_selector('#e-count:not(.hidden)')
    check(True, 'countdown shows')
    page.wait_for_function("window.__bwp.editor.mode === 'record'", timeout=6000)
    check(page.is_visible('#e-rec-stop'), 'recording controls show')
    page.wait_for_timeout(1500)
    cb = page.locator('#e-canvas').bounding_box()
    page.mouse.move(cb['x'] + cb['width'] * 0.6, cb['y'] + cb['height'] * 0.4)
    for _ in range(6):
        page.mouse.wheel(0, -120); page.wait_for_timeout(60)
    page.wait_for_timeout(1500)
    page.keyboard.press('d')
    page.mouse.move(cb['x'] + cb['width'] * 0.3, cb['y'] + cb['height'] * 0.5)
    page.mouse.down(); page.mouse.move(cb['x'] + cb['width'] * 0.6, cb['y'] + cb['height'] * 0.3, steps=6); page.mouse.up()
    page.wait_for_timeout(200)
    page.screenshot(path=SHOTS + '/9-recording.png')
    page.keyboard.press('d')
    page.wait_for_timeout(2000)
    page.mouse.move(cb['x'] + cb['width'] * 0.5, cb['y'] + cb['height'] * 0.5)
    for _ in range(6):
        page.mouse.wheel(0, 120); page.wait_for_timeout(60)
    # half speed: 10 s of game takes ~20 s to record; it stops itself at the clip end
    page.wait_for_function("window.__bwp.editor.mode === 'idle' && !!window.__bwp.editor.d.rec", timeout=40000)
    rec = page.evaluate('window.__bwp.editor.d.rec')
    print('rec:', {k: (v if not isinstance(v, list) else len(v)) for k, v in rec.items()})
    check(rec['rate'] == 0.5 and rec['voice'] and 19 <= rec['duration'] <= 21, 'recording saved: half speed, voice, ~20 s (%.1f)' % rec['duration'])
    check(len(rec['zoomKeys']) >= 5 and max(k[1] for k in rec['zoomKeys']) > 1.8, 'zoom moves were recorded (%d keys)' % len(rec['zoomKeys']))
    check(len(rec['shapes']) == 1, 'live drawing was recorded')
    check('finished video 20 s' in page.text_content('#e-len'), 'with voice, the finished video keeps the half-speed length: ' + page.text_content('#e-len'))
    check('dim' in page.get_attribute('#e-edits', 'class'), 'freeze and speed panels are set aside while a recording exists')
    page.click('text=Play recording')
    page.wait_for_timeout(600)
    check(page.evaluate('window.__bwp.editor.mode') == 'preview', 'play recording starts')
    page.keyboard.press(' ')
    page.wait_for_timeout(300)
    with page.expect_download(timeout=90000) as dl:
        page.click('#e-export')
    mp4v = SHOTS + '/export-voice.mp4'
    dl.value.save_as(mp4v)
    le = page.evaluate('({codec: window.__bwp.lastExport.codec, audio: window.__bwp.lastExport.audio, duration: window.__bwp.lastExport.duration, frames: window.__bwp.lastExport.frames})')
    print('voice export:', le)
    check(le['audio'] in ('mp4a.40.2', 'opus') and abs(le['duration'] - 20) < 1.2, 'export has a voice track and runs ~20 s')

    # ===== no voice, half speed, stopped early =====
    page.uncheck('#e-rec-voice')
    page.click('#e-rec-start')
    page.wait_for_function("window.__bwp.editor.mode === 'record'", timeout=6000)
    page.wait_for_timeout(4200)
    page.keyboard.press('Escape')
    page.wait_for_function("window.__bwp.editor.mode === 'idle'", timeout=8000)
    rec2 = page.evaluate('window.__bwp.editor.d.rec')
    check(not rec2['voice'] and 3.5 <= rec2['duration'] <= 5.5, 'Esc stops early; no-voice recording saved (%.1f s)' % rec2['duration'])
    with page.expect_download(timeout=60000) as dl:
        page.click('#e-export')
    mp4n = SHOTS + '/export-novoice.mp4'
    dl.value.save_as(mp4n)
    le2 = page.evaluate('({audio: window.__bwp.lastExport.audio, duration: window.__bwp.lastExport.duration})')
    print('no-voice export:', le2)
    check(le2['audio'] is None and abs(le2['duration'] - rec2['duration'] / 2) < 0.3, 'without voice the half-speed recording exports at normal speed (%.2f s)' % le2['duration'])
    page.click('text=Delete recording')
    page.wait_for_selector('#dlg-ask[open]')
    check('Delete this recording' in page.text_content('#ask-h'), 'the app asks in its own dialog before deleting a recording')
    page.click('#ask-ok')
    page.wait_for_timeout(200)
    check(page.evaluate('window.__bwp.editor.d.rec') is None and 'finished video 16 s' in page.text_content('#e-len'), 'deleting the recording brings back slow motion and freeze')
    page.click('#e-back')
    page.wait_for_selector('#view-tag:not(.hidden)')
    page.evaluate("(async () => { const s = window.__bwp.state; s.games[0].clips = s.games[0].clips.filter(c => c.start !== 58); await window.__bwp.saveAll(); })()")
    page.reload()
    page.wait_for_selector('#relink:not(.hidden)')
    page.set_input_files('#relink-input', [P1, P2])
    page.wait_for_selector('#relink.hidden', state='attached')

    # settings: per-category window, then tap uses it
    page.goto(APP + '#settings')
    page.fill('#s-coach', 'Cristian'); page.press('#s-coach', 'Tab')
    page.goto(APP + '#team/categories'); page.wait_for_selector('section[data-tsec="categories"]:not(.hidden)')
    page.fill('input[aria-label="Seconds before for Faceoffs"]', '2'); page.press('input[aria-label="Seconds before for Faceoffs"]', 'Tab')
    page.fill('input[aria-label="Seconds after for Faceoffs"]', '6'); page.press('input[aria-label="Seconds after for Faceoffs"]', 'Tab')
    page.uncheck('input[aria-label="Show Passing & support"]')
    page.fill('#cat-new', 'Power play'); page.click('text=Add category')
    page.goto(APP + '#team/roster'); page.wait_for_selector('section[data-tsec="roster"]:not(.hidden)')
    page.fill('#r-num', '7'); page.fill('#r-name', 'Sam'); page.select_option('#r-pri', 'C'); page.click('#roster-add button[type=submit]')
    page.screenshot(path=SHOTS + '/4-settings.png', full_page=True)
    check('only works on the web version' in page.text_content('#team-sync'), 'opened from a file, the team data card points to the web version')
    check(page.text_content('#app-version') == 'v1.0.0' and 'v1.0.0' in page.text_content('#brand-version'), 'version shows in Settings and the header')
    st = page.evaluate('window.__bwp.state.settings')
    fo = [c for c in st['categories'] if c['name'] == 'Faceoffs'][0]
    check(fo['before'] == 2 and fo['after'] == 6, 'faceoff window saved 2/6')
    check(st['coachName'] == 'Cristian' and st['roster'][0]['number'] == '7', 'coach name and roster saved')

    # reload -> game needs relink (files are session-only)
    gid = page.evaluate('window.__bwp.state.games[0].id')
    page.goto(APP + '#tag/' + gid)
    page.reload()
    page.wait_for_selector('#relink:not(.hidden)')
    check(True, 'after reload the app asks to reconnect videos')
    page.set_input_files('#relink-input', [P1, P2])
    page.wait_for_selector('#relink.hidden', state='attached')
    page.wait_for_timeout(500)
    keys = page.eval_on_selector_all('#tags .tagbtn .key', 'e => e.map(x => x.textContent)')
    check(len(keys) == 9 and keys[-1] == '9', 'hidden category removed; Power play takes key 9')
    # Faceoffs is now key 4 (Passing hidden)
    page.evaluate('window.__bwp.player.seek(30)'); page.wait_for_timeout(300)
    page.keyboard.press('4')
    page.wait_for_timeout(150)
    fc = [c for c in page.evaluate('window.__bwp.state.games[0].clips') if c['categoryId'] == 'cat_5']
    check(len(fc) == 1 and fc[0]['start'] == 28 and fc[0]['end'] == 36 and fc[0]['by'] == 'Cristian', 'faceoff tap uses 2s/6s window and coach name')
    check(len(page.evaluate('window.__bwp.state.games[0].clips')) == 4, '4 clips persisted across reload')
    page.screenshot(path=SHOTS + '/5-after-reload.png')

    # backup round trip
    with page.expect_download() as dl:
        page.click('#b-backup')
    path = dl.value.path()
    data = json.load(open(path))
    check(data['app'] == 'bulldogs-watch-party' and len(data['games'][0]['clips']) == 4, 'backup file has 4 clips')

    # games list
    page.goto(APP + '#games')
    check('4 clips' in page.text_content('#games'), 'games list shows clip count')
    page.screenshot(path=SHOTS + '/6-games.png')

    # narrow (tablet-ish) layout has no horizontal scroll
    page.set_viewport_size({'width': 820, 'height': 1100})
    page.goto(APP + '#tag/' + gid)
    page.wait_for_timeout(300)
    sw = page.evaluate('document.documentElement.scrollWidth')
    check(sw <= 820, 'no horizontal scroll at 820px (%d)' % sw)

    check(not errors, 'no page errors: ' + '; '.join(errors[:5]))
    b.close()

print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
