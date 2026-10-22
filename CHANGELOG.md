# Changelog

## 0.9.0 — 2026-10-22 (admin account owns the team folder)

- **One admin account owns the team's Drive folder.**
  - Creating team data now also creates **Team clips**, **Coaches only** and a **Family – #N Name** folder for every player, up front.
  - New players get their family folder automatically on the admin's next visit.
- **Flatter layout:** everything sits side by side in **Bulldogs Watch Party**. There's no more `_App` or `Players` sub-folder.
- **Coaches join in one pick:** **Open shared team data** asks them to select everything in the shared folder. This gives the app Google's permission to save into folders the admin created.
- **Settings shows "Team folders: N of M connected"** for coaches. **Connect team folders** picks up new ones, and an export to an unconnected folder offers the same button, keeping the video for **Retry upload**.
- **"Owner" is what Drive says:** the app checks who actually owns the team data file, so a coach's phone no longer thinks it's the owner.
- Tests now simulate Google's per-app file access, and cover a coach saving a clip into the admin's folder.

## 0.8.0 — 2026-10-21 (code clean-up)

No new features. The same app, reorganised so it's easier to change safely:
- `app.js` (2,600 lines) is split into 12 files in `app/`, one per screen or job:
  - `base`, `player`, `games`, `tag`, `editor`, `record`, `export`
  - `settings`, `team-sync`, `library`, `review`, `main`
- The files share one namespace, `window.App`. Each waits for the saved data to load (`App.ready`), then runs in page order. There's still no build step, and it still works when opened as a file.
- Team data and the clip libraries now use one shared Drive sync routine (`WPDrive.syncJson`) instead of two near-copies.
- Page styles moved from `index.html` to `styles.css`.

## 0.7.0 — 2026-10-21 (speed and reliability)

- **No more storage limit:**
  - Games and clips moved from one localStorage entry (capped at about 5 MB, roughly a season with a few coaches tagging) to the browser's database.
  - Only changed records are rewritten, so saving a full season edit takes milliseconds.
  - Existing data moves over automatically.
  - The app asks Chrome to keep its data permanently, and Settings › About shows the storage used.
- **Google sign-in:**
  - The header says when the hour-long sign-in has run out; tap to sign in again.
  - Export to Drive refreshes the sign-in before rendering, not after.
- **Drive uploads:**
  - Upload once, and other folders get a Google-side copy.
  - Upload progress in %.
  - A failed upload keeps the finished video and offers **Retry upload**, with no empty file left behind.
  - **Save the MP4 to** choices are remembered on each device.
- **Review:**
  - Shows 48 clips at a time with **Show more**, and filtering is much faster.
  - The next clip downloads while the current one plays.
  - Other coaches' new clips appear when you open Review or come back to the app.
  - On phones the filters fold behind a button.
- **Keys:**
  - **H** is now goal against (was Shift+G); G and H work with Caps Lock on.
  - **?** shows all shortcuts, and `shortcuts.html` is a printable one-pager.
- **Smaller things:**
  - The app's own dialogs replace the browser's pop-ups.
  - Messages stack (up to 3) so a quick second tag doesn't hide the first one's Undo.
  - Warns before closing during an export, upload or sync.
  - Unexpected errors show a **Copy details** button.
  - The editor stops redrawing while paused, which saves battery.
- **Updates and install:**
  - Scripts carry the version number, and a banner offers **Reload now** when a newer version is on the site.
  - The app can be installed to a phone's home screen (icon and manifest).
- Tests run on GitHub on every push.

## 0.6.0 — 2026-10-21 (milestone 3b: clip library)

- **Periods and goals:**
  - On the game screen, **P** marks each period start and end. **G** marks a goal for, **Shift+G** a goal against. They show on the timeline and in a list you can delete from.
  - Game type and home/away are set on the game form and the game screen.
- **Automatic tags:** every clip gets its period, time into the period, the score just before it, and leading/tied/trailing. Clips containing a goal mark get Goal for / Goal against automatically; you can remove them.
- **New clip tags:**
  - Events: any number of goal for/against, shot for/against, save, turnover, takeaway, penalty for/against, faceoff won/lost.
  - Zone, situation, star, and custom tags.
  - **Private (only me)** for personal clips.
- **Save to Google Drive on export:**
  - Team clips can go to the Team, Coaches only, and players' family folders. The app creates the folders under Bulldogs Watch Party, with Players › #7 Sam etc.
  - Private clips go to a separate **My Watch Party clips (private)** folder.
  - Drive descriptions are neutral (category, game, period).
- **Clip library:** a shared, coaches-only library file in _App holds every team clip's tags. A private library in your private folder holds your private clips.
  - Both sync automatically.
  - Other coaches' tag edits flow back to the coach who made the clip. Deleted clips leave the library.
  - Your other devices find your files without picking.
- **Review screen:**
  - Team / Private / Both (starts on Team, then remembers your choice per device).
  - Search, and filters for category, events, players, period, Do/Work/Starred, score, zone, situation, custom tags, game, game type and home/away.
  - Shared saved views.
  - Play all as a playlist with auto-play next, playing from Drive or from the game files on this PC.
  - Edit tags while watching, Copy link, Open in Drive.

## 0.5.0 — 2026-10-20 (milestone 3a)

- **Team data shared through Google Drive.** Team name and season, coaches, roster, categories (with their before/after windows), opponents and rinks.
- **Sign in with Google** in Settings, using the narrow `drive.file` permission.
  - The head coach creates **Bulldogs Watch Party › _App › Watch Party team data.json** in their Drive and shares the folder with the coaches on the list.
  - Other coaches pick the shared file once with the Google file picker.
- **Syncing:**
  - Changes sync automatically. When two coaches edit at the same time, their changes are merged.
  - If both change the same item, the Drive version is kept and the coach is told which item.
  - Offline changes are kept and synced later. The header shows the sync state.
- **New game** suggests opponents and rinks from the shared lists and adds new ones automatically.
- Google values live in `config.js`.

## 0.4.0 — 2026-10-20 (milestone 2b)

- **Record a breakdown** in the clip editor. The clip plays from its start while you scroll to zoom, drag to move and draw arrows, circles or freehand lines; drawings fade after 3 s.
- **Optional voice-over** from the microphone, and an option to record at half speed.
  - With voice, the finished video plays at the speed you recorded, so your words stay in sync.
  - Without voice, it plays at normal speed.
- **Recording controls:** countdown, Stop (Esc), D to switch between moving and drawing, C to clear drawings. Play recording, Record again, Delete recording.
- **Export** follows the recorded zoom moves and drawings and adds the voice as the sound track: AAC where available, Opus fallback.
- The editor scrolls the picture into view when you start drawing or recording.

## 0.3.0 — 2026-10-20 (milestone 2a)

- **Clip editor:**
  - Trim by dragging handles or typing times.
  - Freeze-and-draw with arrows, circles and freehand lines in three colours.
  - Up to 3 slow-motion / speed-up sections per clip.
  - Zoom, clip details, and an optional title bar.
- **Preview finished clip** plays exactly as the export will.
- **Export MP4** in the browser: H.264 where available, VP9 fallback. Exports have no sound yet.
- **Version number** shows in Settings and the header.

## 0.2.0 — 2026-10-20

- **Zoom while watching:** scroll wheel, +/−/Fit buttons, drag to move, double-click.
- Clips keep the zoom they were tagged with, and it can be changed or cleared per clip.
- Only one pop-up at a time, so Undo always applies to the latest clip.

## 0.1.0 — 2026-10-20 (milestone 1)

- Import LiveBarn parts and play them as one game timeline.
- **Tagging:** a tap with per-category windows, I/O marks, or typed start and end times.
- **Clip list:** play, edit and delete clips.
- **Settings:** categories, roster, your name.
- Backups as `.json` files.
