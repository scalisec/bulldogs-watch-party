# Watch Party by Bench Boss Labs

*Better tools. Bigger games.*

Watch a LiveBarn game on your PC, tag clips for the team (first used by the Bulldogs U10 Blue), and turn clips into finished MP4 videos with drawings, slow motion and zoom.

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

## Team page (v1.0)

**Team** in the top menu holds everything the coaches share, and any coach can change it:

- **Roster:**
  - Jersey number, first and last name (shown as first initial + last name, e.g. "S. Smith"), and a primary and optional secondary position (C, LW, RW, D, G).
  - Filter by forwards, defense or goalies, and edit a player in place.
- **Coaches, Clip categories, Opponents and rinks, Team name and season.**
- **Admin › Drive and access** appears only for the account that owns the team's Drive folder. It shows:
  - Which coaches have access, with a button to share with new ones.
  - Every clip folder with its clip count and an Open in Drive link.

**Settings** keeps your own things: your name, Google sign-in and team data, shortcuts, and about.

## Game lineups (v1.0)

- **New game:** below opponent and date, the lineup lists the roster.
  - Mark players **Away**, or change a position for this game only ("Playing LW this game (usually D)").
  - Add a **guest player** (affiliate or call-up), or **Copy last game's lineup**.
- **Game screen:** the same lineup can be changed from **Lineup for this game**.
- **Clip editor:** the player buttons show who played: away players are left out and guests are included.
- **Review:** a **Position** filter (Forwards, Defense, Goalies) uses each player's position in that game.

## Several teams (v1.2)

The team button in the header lists the teams on this device, switches between them and adds new ones (Settings › Teams does the same).

- **Separate data:** each team has its own browser database. The first team keeps `bwp-data`; others are `bwp-data:<id>`. The list of teams is in `localStorage` (`bwp-teams`), and small per-team settings get a `:<id>` suffix.
- **Separate Drive folders:** each team has its own folder ("<team> – Watch Party"; the first Bulldogs team keeps "Bulldogs Watch Party") with its own team data and clip library. Private clips go in "My Watch Party clips (private)", with " – <team>" added for any team after the first.
- **One account, several teams:** "Open shared team data" uses the file whose team name matches, or asks.
- **Removing a team** deletes only its browser database.

## League schedule (v1.1)

Games fill in from the Alliance schedule instead of being typed. Watch Party reads the files that [Alliance Tracker](https://scalisec.github.io/alliance-tracker/) publishes: `data/teams.json` (teams, divisions, logos) and `data/games/<division>.json` (dates, times, rinks, scores, LiveBarn and GameSheet links). The address is `leagueDataUrl` in `config.js`.

- **Team › Team and league** sets the league team (shared with all coaches). Default: Burlington Bulldogs Blue, U10 BB.
- **New game:** pick a game from the schedule, or drop the LiveBarn files and the matching game (same date, starting from an hour before to two hours after the scheduled time, rink as a tie-breaker) is picked for you. Everything stays editable.
- **The result** comes from the final score once, and is never changed afterwards.
- **Game screen:** the opponent logo, plus Open in LiveBarn and GameSheet links. Older games can be linked with **Link to league schedule**.
- **Offline:** the last schedule read is kept in the browser.

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

**Install the app (v1.1.1):** Settings › Install the app adds Watch Party to the home screen or desktop. `sw.js` is a minimal service worker that only exists so Chrome offers its install prompt; it caches nothing.

When a new version is on the site, a yellow banner offers **Reload now**, so phones that can't press Ctrl+F5 still update. On a phone, Chrome's menu › **Add to Home screen** installs the app with its own icon.

## Reopening a game later

Video files can't be saved inside the browser. When you reopen a game, click **Reconnect videos**, or choose the same files again.

## Tests

- `node --test tests/core.test.js` runs the core logic tests (74).
- `python3 tests/e2e_v12.py <screenshot-dir>` tests v1.2: adding and switching teams, copied categories, each team's own games, roster, league and Drive folders, a second device finding the right team's data, the "which team?" choice, and removing a team (25 checks, simulated Drive).
- `python3 tests/e2e_v11.py <screenshot-dir> <media-dir>` tests v1.1: the league team, the schedule picker, matching LiveBarn files to a game, logos and links, linking an older game, and the offline copy (31 checks, including Settings › Install the app). It serves the Alliance data from `tests/fixtures/alliance`.
- `python3 tests/e2e_v10.py <screenshot-dir> <media-dir>` tests v1.0: branding, roster names and positions, the Team page and Admin section, game lineups, clip players from the lineup and the Review position filter (23 checks).
- `python3 tests/e2e_v07.py <screenshot-dir>` tests the storage move, a 60-game season, Review paging, G/H keys, shortcuts and the update banner (22 checks).
- `python3 tests/e2e_library.py <screenshot-dir> <media-dir>` tests marks, tags, Drive uploads, the shared and private libraries and Review with two coaches and a phone against a simulated Drive (49 checks).
- `python3 tests/e2e_drive.py <screenshot-dir>` tests shared team data with two coaches against a simulated Google Drive (23 checks).
- `python3 tests/e2e.py <screenshot-dir> <media-dir>` runs the browser test (75 checks). It covers tagging, zoom, the editor, drawing, slow motion, preview, MP4 export, and recording a breakdown with a simulated microphone.

GitHub runs the core tests, `e2e_drive.py`, `e2e_v07.py` and `e2e_v12.py` on every push (`.github/workflows/tests.yml`). The two tests that need game video run locally only, so team footage never goes on GitHub.

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
| `app/lineup.js` | The lineup editor (New game form and game screen) |
| `app/teams.js` | Several teams on one device: the header team switcher, Add a team, and the “which team?” choice |
| `app/league.js` | The league schedule: reads Alliance Tracker data, the schedule picker and the League team setting |
| `app/settings.js` | Settings screen: your name, Google sign-in, shortcuts, about |
| `app/team.js` | Team page: roster, coaches, categories, lists, and the Admin section |
| `app/team-sync.js` | Shared team data in Drive |
| `app/library.js` | Shared and private clip libraries |
| `app/review.js` | Review screen |
| `app/main.js` | Routing, keyboard, update banner, start-up |
| `styles.css` | All page styles (Bench Boss Labs dark navy) |
| `icons/` | App icons redrawn from the Bench Boss Labs symbol (`icon.svg` full, `favicon.svg` simplified for tabs) |

Each `app/` file starts with the names it uses from earlier files (`const { … } = App`), and reaches later files as `App.name`. State that changes as you move around lives on `App`: the open game `App.G`, its timeline `App.TL`, its player `App.player`, and the open clip editor `App.E`.

## Included library

`vendor/mp4-muxer.js` (MIT licence, see `vendor/mp4-muxer.LICENSE`) packages the encoded video into an MP4 file.

## Coming next

- **Milestone 4:** tablet and phone layouts.
