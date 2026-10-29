"""Browser test for v1.7: exported clips carry the rink sound, read from the LiveBarn MP4s.
Normal-speed parts have sound, slow motion is quiet, the on/off box works, and a clip across two parts works.
LiveBarn MP4s are H.264 + AAC, which the open-source test browser can't decode, so this uses MP4 copies with
VP9 + Opus (<media-dir>/opusmp4/); the same reader handles both (core tests check the AAC parsing on real-format files).
usage: python3 tests/e2e_v17.py <screenshot-dir> <media-dir>"""
import os, subprocess, sys, re
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '.'
MEDIA = (sys.argv[2] if len(sys.argv) > 2 else '.').rstrip('/') + '/'
APP = 'file://' + ROOT + '/index.html'
P1 = MEDIA + 'opusmp4/1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.mp4'
P2 = MEDIA + 'opusmp4/2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.mp4'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def loudness(path, start, dur):
    """Mean volume in dB of [start, start+dur] of the file's audio (-91 = silence)."""
    r = subprocess.run(['ffmpeg', '-v', 'info', '-ss', str(start), '-t', str(dur), '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'mean_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else -999.0

def streams(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration', '-of', 'compact', path], capture_output=True, text=True)
    return r.stdout

def export(page, name):
    with page.expect_download(timeout=90000) as dl:
        page.click('#e-export')
    out = SHOTS + '/' + name
    dl.value.save_as(out)
    return out

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    ctx.route('https://scalisec.github.io/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(APP + '#new'); page.wait_for_function('window.__bwp')
    page.set_input_files('#file-input', [P1, P2])
    page.wait_for_function("!document.getElementById('g-start').disabled", timeout=30000)
    page.fill('#g-opp', 'Raiders'); page.click('#g-start')
    page.wait_for_function("document.getElementById('clock').textContent.endsWith('1:10')", timeout=15000)

    # ---- a clip 0:10–0:22 with slow motion 0:14–0:16 (0.5x)
    page.evaluate("""(() => { const g = window.__bwp.state.games[0];
      const c = WP.makeClip({ start: 10, end: 22, total: 70, categoryId: window.__bwp.state.settings.categories[0].id });
      c.speeds = [{ start: 14, end: 16, rate: 0.5 }]; c.titleBar = false; g.clips.push(c); })()""")
    page.goto(APP + '#edit/' + page.evaluate('window.__bwp.state.games[0].id') + '/' + page.evaluate('window.__bwp.state.games[0].clips[0].id'))
    page.wait_for_selector('#view-edit:not(.hidden)'); page.wait_for_timeout(800)
    check(page.is_checked('#e-rink'), '“Include rink sound” is on by default')
    out = export(page, 'v17-rink.mp4')
    info = streams(out)
    check('codec_type=audio' in info, 'the exported MP4 has a sound track: ' + info.replace('\n', ' | '))
    # output: 0–4 s normal (sound), 4–8 s slow (quiet), 8–14 s normal (sound)
    a, s, c2 = loudness(out, 0.5, 3), loudness(out, 4.6, 2.8), loudness(out, 8.6, 4.5)
    print('loudness dB: normal %.1f, slow %.1f, normal %.1f' % (a, s, c2))
    check(a > -60 and c2 > -60, 'normal-speed parts have rink sound (%.1f / %.1f dB)' % (a, c2))
    check(s < -80, 'the slow-motion part is quiet (%.1f dB)' % s)
    check(page.evaluate('window.__bwp.lastExport.audio') is not None, 'the export reports an audio codec')

    # ---- the same stretch of the original file should sound the same (sync)
    src = loudness(P1, 10.5, 3)
    check(abs(src - a) < 4, 'sound level matches the original at the same moment (%.1f vs %.1f dB)' % (a, src))

    # ---- turn it off: no sound track, and it's remembered
    page.uncheck('#e-rink')
    out2 = export(page, 'v17-norink.mp4')
    check('codec_type=audio' not in streams(out2), 'with the box off, the clip has no sound')
    check(page.evaluate("localStorage.getItem('bwp-rink-sound')") == 'off', 'the choice is remembered on this device')
    page.check('#e-rink')

    # ---- a clip across the two parts (0:36–0:46; part 1 ends at 0:40)
    page.evaluate("""(() => { const g = window.__bwp.state.games[0];
      const c = WP.makeClip({ start: 36, end: 46, total: 70, categoryId: window.__bwp.state.settings.categories[0].id });
      c.titleBar = false; g.clips.push(c); })()""")
    page.goto(APP + '#edit/' + page.evaluate('window.__bwp.state.games[0].id') + '/' + page.evaluate('window.__bwp.state.games[0].clips[1].id'))
    page.wait_for_selector('#view-edit:not(.hidden)'); page.wait_for_timeout(800)
    out3 = export(page, 'v17-twoparts.mp4')
    x1, x2 = loudness(out3, 0.5, 3), loudness(out3, 5, 4)
    check(x1 > -60 and x2 > -60, 'a clip across two parts has sound in both (%.1f / %.1f dB)' % (x1, x2))
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    b.close()
print('\n%d failures' % len(fails))
sys.exit(1 if fails else 0)
