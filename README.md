# Bulldogs Watch Party — milestones 1, 2 and 3

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
| P | Period start / end |
| G / H | Goal for / goal against |
| + / − / 0 | Zoom in / out / fit |
| Esc | Cancel marks |

Press **?** anywhere for the full list. `shortcuts.html` is a one-page version to print.

## Shared team data and the team's Drive folder

The roster, categories, coaches, opponents, rinks, and team name and season are shared by all coaches through Google Drive. This works on the web version only (https://scalisec.github.io/bulldogs-watch-party/).

**Who owns what (v0.9):** one **admin account** (benchbosslabs@gmail.com) owns the team's Drive folder. Coaches, including the head coach, sign in with their own Google accounts.

- **Admin account (once), in its own Chrome profile:**
  1. Add the roster and the coaches' Google emails in Settings.
  2. Click **Sign in with Google**, then **Create team data in my Drive**.
  3. The app makes one **Bulldogs Watch Party** folder holding:
     - `Watch Party team data.json` and `Watch Party clip library.json`
     - **Team clips** and **Coaches only**
     - **Family – #7 Sam** (one per player)
  4. It shares the folder with the coaches.
  5. When a player is added later, the admin's app creates their family folder the next time it opens.
- **Coaches (once per Google account):**
  1. Open Settings, **Sign in with Google**, then **Open shared team data**.
  2. In Google's picker, open **Bulldogs Watch Party**, select everything inside it, and click **Select**.
  3. Picking is how Google lets this app use folders another account created; it's needed once, not per device.
  4. Later, if a new family folder appears, **Settings › Connect team folders** does the same for it. Settings shows how many team folders are connected.
- **Syncing:**
  - Changes sync automatically. **Sync now** pulls the latest.
  - If two coaches change the same thing at once, the version already in Drive is kept and you're told what clashed.
  - Offline changes wait and sync later.
- **Privacy:**
  - The app uses Google's `drive.file` permission, so it only sees files it created or that you picked. It never sees the rest of your Drive.
  - Share **Team clips** with all families, and each **Family – …** folder with that family only. Never share the top **Bulldogs Watch Party** folder with families: it holds the roster, notes and Coaches only clips.
  - Clips a coach saves are owned by that coach's account, inside the admin's folders.
- **New coaches** must also be added as test users in Google Cloud (Google Auth Platform › Audience).

Each coach's own name (shown on their clips) stays on their device.

## Clip library and Review (milestone 3b)

- **Mark the game:** on the game screen press **P** at the start and end of each period, **G** for a goal for and **H** for a goal against. Clips then get their period and the score automatically, and clips containing a goal are tagged with it.
- **Tag clips:** in the clip editor, set events (any number), zone, situation, star, custom tags, or **Private (only me)**.
- **Save to Drive:** when exporting, tick where the MP4 goes.
  - Team clips: this computer, Team, Coaches only, or the tagged players' family folders.
  - Private clips: your private Drive folder.
- **Review screen:**
  - Choose Team / Private / Both, search, and combine filters (AND between groups, OR within a group).
  - Save a view for all coaches, and **Play all** as a playlist.
  - Tags can be edited while watching.
- **Where things live:**
  - Team clips' tags are in **Bulldogs Watch Party › _App › Watch Party clip library.json**, shared with coaches only.
  - Private clips are in **My Watch Party clips (private)** in your own Drive, shared with no one.
- **Other coaches:** when they open the shared team data, they pick both the team data and the clip library files.
- **Still to confirm:** whether other coaches' copies of the app can save into the team folders, given the app's narrow Google permission. This will be checked when the first coach joins.

## Where things are saved (v0.7)

- Games, clips and settings are kept in the browser's database (IndexedDB) on each device. There's no practical size limit; the old single entry stopped at about 5 MB.
- Only what changed is rewritten, so saving stays instant even with a full season.
- Data saved by v0.6 or earlier moves over automatically the first time v0.7 opens.
- **Settings › About** shows how much space is used, and whether Chrome has agreed to keep it permanently.

## Updates

When a new version is on the site, a yellow banner offers **Reload now**, so phones that can't press Ctrl+F5 still update. On a phone, Chrome's menu › **Add to Home screen** installs the app with its own icon.

## Reopening a game later

Video files can't be saved inside the browser. When you reopen a game, click **Reconnect videos**, or choose the same files again.

## Tests

- `node --test tests/core.test.js` runs the core logic tests (65).
- `python3 tests/e2e_v07.py <screenshot-dir>` tests the storage move, a 60-game season, Review paging, G/H keys, shortcuts and the update banner (22 checks).
- `python3 tests/e2e_library.py <screenshot-dir> <media-dir>` tests marks, tags, Drive uploads, the shared and private libraries and Review with two coaches and a phone against a simulated Drive (48 checks).
- `python3 tests/e2e_drive.py <screenshot-dir>` tests shared team data with two coaches against a simulated Google Drive (23 checks).
- `python3 tests/e2e.py <screenshot-dir> <media-dir>` runs the browser test (75 checks). It covers tagging, zoom, the editor, drawing, slow motion, preview, MP4 export, and recording a breakdown with a simulated microphone.

GitHub runs the core tests, `e2e_drive.py` and `e2e_v07.py` on every push (`.github/workflows/tests.yml`). The two tests that need game video run locally only, so team footage never goes on GitHub.

## How the code is organised

| File | What it does |
| --- | --- |
| `core.js` | Pure logic: time, clips, zoom, speeds, recordings, team data and library merging (tested with Node) |
| `storage.js` | Saving in the browser's database |
| `render.js` | Drawing frames and exporting MP4s |
| `drive.js` | Google sign-in and Drive calls, including the shared sync routine |
| `app/base.js` | Shared helpers, saving, error reporting; loads the data and creates `App` |
| `app/player.js` | Plays a game's parts as one video |
| `app/games.js` | Games screen |
| `app/tag.js` | Game screen: watch, zoom, tag, periods and goals |
| `app/editor.js` | Clip editor: trim, freeze and draw, slow motion, details |
| `app/record.js` | Record a breakdown |
| `app/export.js` | Export and save to this computer or Drive |
| `app/settings.js` | Settings screen |
| `app/team-sync.js` | Shared team data in Drive |
| `app/library.js` | Shared and private clip libraries |
| `app/review.js` | Review screen |
| `app/main.js` | Routing, keyboard, update banner, start-up |
| `styles.css` | All page styles |

Each `app/` file starts with the names it uses from earlier files (`const { … } = App`), and reaches later files as `App.name`. State that changes as you move around lives on `App`: the open game `App.G`, its timeline `App.TL`, its player `App.player`, and the open clip editor `App.E`.

## Included library

`vendor/mp4-muxer.js` (MIT licence, see `vendor/mp4-muxer.LICENSE`) packages the encoded video into an MP4 file.

## Coming next

- **Milestone 4:** tablet and phone layouts.
