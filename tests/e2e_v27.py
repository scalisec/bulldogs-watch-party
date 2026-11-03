"""Browser test for v2.7: offline mode. With no internet the app still opens (from its own copy), marks and exports
work, clips meant for Drive wait on this device, and back online the app asks before uploading them (or the header
link uploads them). Runs against the simulated Google sign-in and Drive in e2e_drive.py.
usage: python3 tests/e2e_v27.py <screenshot-dir> <media-dir>"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
SRC = os.path.join(HERE, 'e2e_drive.py')
src = open(SRC).read()
g = {'__file__': SRC, '__name__': 'v27'}
sys.argv = [sys.argv[0], SHOTS]
exec(compile(src[:src.index('with sync_playwright() as p:')], SRC, 'exec'), g)
from playwright.sync_api import sync_playwright
APP, drive, setup, check, fails, team, settings = g['APP'], g['drive'], g['setup'], g['check'], g['fails'], g['team'], g['settings']
P1 = MEDIA + '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.webm'
P2 = MEDIA + '2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.webm'

def mp4s(): return [f for f in drive.values() if (f['name'] or '').endswith('.mp4') and not f['trashed']]
def seek(page, t): page.evaluate('window.__bwp.player.seek(%s)' % t); page.wait_for_timeout(300)
def waiting(page): return page.evaluate('App.uploadWaiting()')
def badge(page): return page.text_content('#sync-badge')

def export_offline(A, n):
    A.click('#clips .clip >> nth=%d >> text=Edit' % n)
    A.wait_for_selector('#view-edit:not(.hidden)')
    A.wait_for_function('window.__bwp.editor && window.__bwp.editor.player', timeout=8000)
    A.uncheck('#e-dests label:has-text("This computer") input')
    A.check('#e-dests label:has-text("Team (players") input')
    A.wait_for_timeout(200)
    A.click('#e-export')
    A.wait_for_function("window.__bwp.editor.mode === 'idle' && App.uploadWaiting() === %d" % (n + 1), timeout=90000)
    A.click('#e-back'); A.wait_for_selector('#view-tag:not(.hidden)')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    A, errA = setup(ctx, 'a@team.com')
    team(A, 'roster'); A.fill('#r-num', '7'); A.fill('#r-name', 'Sam'); A.click('button:has-text("Add player")')
    settings(A); A.click('button:has-text("Sign in with Google")'); A.click('button:has-text("Create team data in my Drive")')
    A.wait_for_function("window.__bwp.state.lib.teamSync && !window.__bwp.lib.busy && !window.__bwp.team.busy", timeout=15000)
    # the app keeps its own copy (service worker) once it has been opened online
    A.evaluate('navigator.serviceWorker.ready'); A.reload(); A.wait_for_function('window.__bwp')
    A.wait_for_function('!!navigator.serviceWorker.controller', timeout=10000)
    n_cached = A.evaluate("caches.keys().then((k) => caches.open(k.find((x) => x.startsWith('wp-app-')))).then((c) => c.keys()).then((r) => r.length)")
    check(n_cached >= 35, 'the app keeps a copy of its %d files for offline use' % n_cached)

    A.goto(APP + '#new'); A.set_input_files('#file-input', [P1, P2])
    A.wait_for_function("!document.getElementById('g-start').disabled", timeout=20000)
    A.fill('#g-opp', 'Hawks'); A.click('#g-start')
    A.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=10000)

    # ---- on the train: no internet
    ctx.set_offline(True); A.wait_for_timeout(300)
    check(A.evaluate('navigator.onLine') is False and badge(A).startswith('Offline · saved on this device'), 'offline: header says “Offline · saved on this device”')
    seek(A, 2); A.keyboard.press('p')
    seek(A, 10); A.keyboard.press('s'); A.wait_for_selector('#dlg-shot[open]'); A.keyboard.press('Enter'); A.wait_for_function('!document.getElementById("dlg-shot").open')
    seek(A, 22); A.keyboard.press('1'); A.wait_for_timeout(200)
    seek(A, 40); A.keyboard.press('2'); A.wait_for_timeout(200)
    m = A.evaluate('window.__bwp.state.games[0]')
    check(len(m['marks']['periods']) == 1 and len(m['marks']['shots']) == 1 and len(m['clips']) == 2, 'offline: periods, shots and clips are marked as usual')
    A.click('#clips .clip >> nth=0 >> text=Edit'); A.wait_for_selector('#view-edit:not(.hidden)')
    A.check('#e-dests label:has-text("Team (players") input'); A.wait_for_timeout(200)
    try: A.wait_for_selector('#e-offline-note', timeout=5000); note = True
    except Exception: note = False
    check(note, 'the export panel says the MP4 is made now and uploads later' + ('' if note else ': ' + A.text_content('#e-dests') + ' online=' + str(A.evaluate('navigator.onLine'))))
    A.screenshot(path=SHOTS + '/v27-export-offline.png')
    A.click('#e-back'); A.wait_for_selector('#view-tag:not(.hidden)')
    export_offline(A, 0)
    check(not mp4s() and 'waiting to upload' in A.text_content('#toasts'), 'export offline: the MP4 is made and kept here, nothing sent to Drive')
    export_offline(A, 1)
    check(waiting(A) == 2 and A.evaluate("window.__bwp.state.games[0].clips.every((c) => c.exported)"), 'both clips exported, 2 waiting to upload')
    check('2 to upload' in badge(A), 'header: ' + badge(A))
    A.goto(APP + '#review'); A.wait_for_selector('.rvcard')
    check(A.locator('.rvcard', has_text='waiting to upload').count() == 2, 'Review shows them as “Exported · waiting to upload to Drive”')
    check('Offline' in A.text_content('#rv-lib-status'), 'Review status line: ' + A.text_content('#rv-lib-status'))

    # ---- close the app and open it again, still offline: it opens from its own copy
    A.goto(APP + '#games'); A.wait_for_function('window.__bwp')
    A.reload(); A.wait_for_function('window.__bwp', timeout=15000)
    check(A.is_visible('#view-games:not(.hidden)') and A.evaluate('window.__bwp.state.games.length') == 1, 'reopened with no internet: the app opens, with the game')
    check(waiting(A) == 2 and badge(A).startswith('Offline'), 'and still knows the 2 clips waiting')
    A.screenshot(path=SHOTS + '/v27-offline-home.png')

    # ---- home: back online -> asked first
    ctx.set_offline(False)
    A.wait_for_selector('#dlg-ask[open]', timeout=8000)
    h = A.text_content('#ask-h')
    check('Upload 2 clips to Google Drive?' in h and A.text_content('#ask-ok') == 'Upload now', 'back online: asks “Upload 2 clips to Google Drive?”')
    A.screenshot(path=SHOTS + '/v27-ask.png')
    check(A.text_content('#ask-cancel') == 'Cancel' and 'danger' not in A.get_attribute('#ask-ok', 'class'), 'a normal blue Upload now button, not a red one')
    A.click('#ask-cancel'); A.wait_for_timeout(400)
    check(not mp4s() and waiting(A) == 2, 'Cancel uploads nothing')
    check(badge(A) == '2 clips waiting to upload — tap to upload', 'header: ' + badge(A))
    A.click('#sync-badge')
    A.wait_for_function('App.uploadWaiting() === 0', timeout=30000)
    vids = mp4s()
    tc = next(f for f in drive.values() if f['name'] == 'Team clips')
    check(len(vids) == 2 and all(drive[v['parents'][0]]['parents'] == [tc['id']] for v in vids) and all(len(v['content']) > 50000 for v in vids), 'both uploaded into the game’s folder in Team clips (no exporting again)')
    gm = A.evaluate('window.__bwp.state.games[0]')
    check(all(len(c.get('drive') or []) == 1 for c in gm['clips']), 'the clips now know their Drive copies')
    left = A.evaluate("new Promise((res) => { const r = indexedDB.open('bwp-handles', 1); r.onsuccess = () => { const q = r.result.transaction('h').objectStore('h').getAllKeys(); q.onsuccess = () => res(q.result.filter((k) => String(k).startsWith('upq:')).length); }; })")
    check(left == 0, 'the copies kept on this device are deleted after uploading')
    check('Uploaded 2 clips' in A.text_content('#toasts'), 'toast: Uploaded 2 clips to Google Drive')
    check(not errA, 'no page errors: ' + '; '.join(errA[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
