# Bulldogs Watch Party — milestones 1, 2a and 2b

Watch a LiveBarn game on your PC, tag clips for the U10 Blue team, and turn clips into finished MP4 videos with drawings, slow motion and zoom.

There's no sign-in and no server. Video files stay on your computer, and games and clips are saved in this browser.

## Run it

1. Unzip the folder anywhere on your PC (e.g. `Documents\Bulldogs Watch Party`).
2. Open `index.html` in **Chrome or Edge**.
3. Bookmark the page.

Keep using the same browser on the same PC: that's where your games and clips are saved.

## Watch and tag (milestone 1)

- **New game:** drag in the LiveBarn downloads. They're put in play order automatically, and the date and rink are read from the file names.
- **Tagging:**
  - Tap a category, or press `1`–`9`, to grab a clip using that category's before/after window.
  - Press `I` and `O` for an exact start and end, then pick a category.
  - "New clip from times…" lets you type a start and end time.
- **Zoom:**
  - Scroll on the video to zoom in where the pointer is (up to 6×). Drag to move around, and double-click to zoom in or back out to the whole rink.
  - A clip made while zoomed keeps that framing.
- **Settings:**
  - Your name.
  - Categories: rename, colour, before/after seconds, show/hide, reorder.
  - Roster of jersey numbers.
- **Backup:** download a game's clips as a `.json` file.

## Clip editor (milestone 2a)

Click **Edit** on any clip. Everything saves as you go.

- **Trim:**
  - Drag the blue handles, or type a start/end.
  - "Start = playhead" and "End = playhead" set them from the current frame.
- **Freeze and draw:**
  - Pause on the key moment, then click **Freeze here and draw**.
  - Draw arrows, circles or freehand lines in yellow, white or red. Undo with `Ctrl+Z`.
  - The finished video holds that frame with your drawings (3 s by default, 1–10 s), then plays on.
- **Slow motion / speed up:** add up to 3 sections at 0.25×, 0.5×, 1.5× or 2×. They show in orange on the trim bar.
- **Zoom:** scroll or drag on the picture. "Fit" shows the whole rink.
- **Details:** category, players, Do this / Work on this, and a note.
- **Title bar:** tick it to add category, game, players and note along the bottom.
- **Preview finished clip** plays it exactly as the export will look.
- **Export MP4** makes the video on this computer and asks where to save it.
  - It plays through the clip once while it records, so a 15-second clip takes about 15–20 seconds. Keep the tab open.
  - Video is 1280 wide and keeps the LiveBarn shape. It's about 3–5 MB for a 15-second clip.
  - Exported clips have sound only when you record a voice-over (below).

### Record a breakdown (milestone 2b)

In the clip editor, tick **Voice-over** and/or **Record at half speed**, then click **Record breakdown**.

- **During the countdown and recording:**
  - After a 3-second countdown the clip plays from its start.
  - Scroll to zoom and drag to move. Press `D` to switch to drawing (arrows, circles, freehand) and back.
  - `C` clears the drawings. Drawings fade after 3 s.
  - It stops by itself at the clip's end, or press `Esc` / **Stop**.
- **Afterwards:** **Play recording** shows it with your voice. **Record again** replaces it; **Delete recording** removes it.
- **Speed rule:**
  - With voice, the finished video plays at the speed you recorded (a half-speed take becomes a slow-motion breakdown).
  - Without voice, it plays at normal speed.
- **What the recording replaces:** while a recording exists, the export uses it instead of the slow-motion sections, freeze and fixed zoom. Changing the trim deletes the recording.
- **Storage:** voice recordings are kept in this browser and aren't included in game backups.

### Editor keys

| Key | Action |
| --- | --- |
| Space | Preview / stop |
| ← → | Back / forward 1 s |
| , . | Back / forward one frame |
| Ctrl+Z | Undo last drawing |
| Esc | Stop drawing |

## Watch-and-tag keys

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← → | Back / forward 5 s (Shift: 1 s) |
| 1–9 | Tag with that category |
| I / O | Mark start / end |
| + / − / 0 | Zoom in / out / fit |
| Esc | Cancel marks |

## Reopening a game later

Video files can't be saved inside the browser. When you reopen a game, click **Reconnect videos**, or choose the same files again.

## Tests

- `node --test tests/` runs the core logic tests (41).
- `python3 tests/e2e.py <screenshot-dir> <media-dir>` runs the browser test (73 checks). It covers tagging, zoom, the editor, drawing, slow motion, preview, MP4 export, and recording a breakdown with a simulated microphone.

## Included library

`vendor/mp4-muxer.js` (MIT licence, see `vendor/mp4-muxer.LICENSE`) packages the encoded video into an MP4 file.

## Coming next

- **Milestone 3:** Google Drive sign-in, folders, and a shared library.
- **Milestone 4:** tablet and phone layouts.
