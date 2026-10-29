# Changelog

## 2.1.0 — 2026-10-29 (official game sheets)

- **Import the official GameSheet game sheet (PDF).** It's the file a team official downloads from GameSheet.
  - Add it on the **New game** screen ("Game sheet (optional)"), on a game's **Summary** ("Import game sheet (PDF)"), or with **Import game sheet** on the Games screen.
  - The PDF is read on this computer and never uploaded.
  - Only numbers are kept: goals (period, clock, scorer and assists by jersey), penalties (period, jersey, minutes, infraction), the final score and period lengths. No player or official names are stored.
- **Your marks win; the sheet fills in what they're missing.** Goals are matched by period and order.
  - A goal you marked without a scorer gets the sheet's scorer and assists, and its clip's players and note follow.
  - When your scorer differs from the sheet, the goal is flagged **Differs** with **Keep mine** or **Use game sheet**.
  - Goals and penalties only on the sheet appear in the summary and season stats, marked "From game sheet" (no video, so no ▶ button). Penalties stay summary-only: mark them with X yourself if you want clips.
  - The summary warns when the goals don't add up to the sheet's final score.
- **Games with no video.** Use **Game sheet** on a played league game (or Import game sheet) to make a summary-only game, marked "No video available".
  - It opens on its Summary, with no Watch and tag tab.
  - It counts in Summaries and Season stats.
  - If you add video for that game later, the same game gets the video and keeps its sheet and notes.
- **Fixed:** when the league schedule couldn't be reached (offline), the Games screen kept retrying and redrawing. It now waits a minute between tries (Refresh still tries straight away).
- Bundles pdf.js 3.11.174 (Mozilla, Apache 2.0) in `vendor/` to read the PDF. It loads only when you import a sheet.

## 2.0.2 — 2026-10-29 (missing team folders: asks before creating)

- **The app now finds team folders that were deleted in Google Drive** (or are in the trash), along with folders that were never made, such as one for a new player.
- **It asks before creating anything.** A pop-up lists each folder ("Family – #7 … (deleted in Drive)") and where it will go. **Create folders** makes them; **Cancel** makes nothing and doesn't ask again until the app is reopened.
  - The check runs when the admin account opens the app or syncs, and before exporting to a folder that's missing.
  - **Team › Drive and access › Check for missing folders** runs it at any time.
- **Folders always go next to the team data file.** If the team data file was moved to another folder, that folder becomes the team folder.
- **Fixed: duplicate folders.** The app used to create a second set of folders when the admin account opened the team on a second device before its clip library had synced. It now checks only after the library sync, so it knows the folders that already exist.
- **Fixed: re-created folders being overwritten.** A folder re-created on this device is no longer replaced by the old ID from the copy in Drive.
- First-time setup ("Create team data in my Drive") still creates the folders straight away, since you started it.

## 2.0.1 — 2026-10-29 (Games home is the season schedule again)

- **The Games home lists the whole season again.**
  - **Coming up** shows the next 2 games, with **Show all upcoming**.
  - **Played** lists every game, newest first. That includes league games without video and your own games that aren't on the league schedule, mixed in by date.
- **Each row shows** date and time, opponent with logo, rink, home/away, result, summary status, clips (and how many were exported), and LiveBarn and GameSheet links.
  - Rows end with **Open** for a game you've added, or **Add video** for a played game that isn't added yet.
- The separate "Played, waiting for video" box is gone, because those games are now rows in the table.

## 2.0.0 — 2026-10-29 (game summaries, new layout)

- **Games home and New game are separate screens.**
  - Games lists your games with result, clips and summary state, plus a Find box.
  - League games already played but not added yet are listed under "Played, waiting for video". Each has an **Add video** button that opens New game with that game already picked.
  - **+ New game** has its own screen with three steps.
- **Each game has three tabs:** Watch and tag · Summary · Game details. A header shows the game, its league links and a back button.
- **Scoreboard on the video.** It shows our score, the period and their score, plus Power play / Penalty kill when someone's in the box. It doesn't show a clock, because a game clock can't be worked out accurately from the video.
- **Watch and tag is tidier.**
  - The duplicate Goal and Penalty buttons were removed, leaving one row of game event buttons.
  - The long keyboard tips are now under **?**.
  - Game type, home/away, the list of marks and the lineup moved to Game details.
- **Game details** can also change the date, opponent, rink and final score. Backup and Delete game are here too.
- **Summary tab for each game:**
  - Final score and goals by period.
  - Goals, with power-play and short-handed goals marked. **Edit** fixes who scored, and the goal clip's players and note follow.
  - Penalties, with what they led to (power-play goal, killed…).
  - Clips, coach's notes (what went well / work on), and points this game.
  - **Export all goal clips** and **Print or save as PDF**.
  - A warning appears when the marked goals don't add up to the final score.
- **Summaries tab:** record, goals for/against, penalty minutes, next game, and a card for every game. League games without video show their league score.
- **Season stats:** each player's GP, G, A, PTS, PIM, PP goals and clips, filtered by League, Tournament, Exhibition, Playoff or all games. Goalies get GP, GA, GAA and a W–L–T record. Clicking a player's clips opens Review filtered to them.
- Summaries work on a phone and are for coaches only.

## 1.8.1 — 2026-10-29 (clip notes in file names)

- **Exported file names end with the clip's note**, e.g. "2026-10-18 Breakouts 4m04s #7 #12 - Stay wide on the wall.mp4". This applies to Drive uploads and downloads alike.
  - Clips with no note are named as before.
  - Long notes are cut at a word, about 80 characters, with "…".
  - Characters that file names can't hold (/ : * ? " < > |) become "-".
  - Clips you've already exported keep their old names. Export one again to get the new name.

## 1.8.0 — 2026-10-28 (goal clips, view follows your zoom, folders per game)

- **Goals make their own clip.** G and H (or the Goal buttons) pause the video and open a goal popup:
  - **Our goal:** who scored and up to two assists, from the game's lineup.
  - **Their goal:** their scorer's and assists' numbers, plus which of our players were on the ice. All optional.
  - **Save goal** (or Enter) marks the goal and adds a goal clip from 10 s before to 5 s after, tagged with those players. It goes in the scoring category (changeable in the popup), with a note like "Goal #7 (A: #12, #4)". Undo removes both.
  - The marks list and game panel show the scorer.
- **The exported view matches your screen.** While a clip plays on the game screen (▶ Play clip), zooming and dragging the picture sets that clip's view, so its export shows exactly what you see. A note confirms "View saved to this clip". When the clip ends or you move elsewhere, zooming goes back to being just for watching.
- **Drive exports go in a folder per game:**
  - Inside Team clips, Coaches only, each family folder and your private folder, each game gets a folder like "2026-10-18 vs Burlington Raiders".
  - The folder is made the first time a clip from that game is saved, and found again on your other devices.
  - Another coach exporting the same game makes their own folder of the same name, because Google only lets the app use folders it created on that account.
- Enter saves the goal and penalty popups even after tapping player buttons.

## 1.7.0 — 2026-10-28 (rink sound in exported clips)

- **Exported clips now carry the game's sound.** Until now, an exported clip only had sound when you'd recorded a breakdown with your voice.
  - The rink sound plays during the normal-speed parts.
  - Slow-motion and freeze-frame parts are quiet, and the sound picks up again in sync afterwards.
  - On a breakdown with your voice-over, the rink sound goes underneath, quietly (about a quarter volume).
- **"Include rink sound"** on the export panel turns it on or off. It's on by default, and the choice is remembered on this computer.
- **How it works:** the app reads just the clip's few seconds of audio straight from the LiveBarn MP4, so there's no extra wait for long games. A clip that spans two LiveBarn files gets sound from both.
- **If a video's sound can't be read** (e.g. not an MP4), the clip still exports, without rink sound, and the app says so.

## 1.6.1 — 2026-10-28 (finding a club team's schedule)

- **Barracudas (and other club teams) are easy to find now.**
  - A team without a league team gets an **"Is this Burlington Barracudas · U13 B (OWHA)? Use its schedule"** button on the New game form and the Team page, whenever its name contains a league team's name.
  - Adding a team whose name clearly says which league team it is (e.g. "Burlington Barracudas U13 B") picks that team's schedule automatically.
- **League team picker:** a **Find a team** box narrows the 350+ teams as you type. Club teams (OWHA) are listed first, then Alliance teams by division ("Alliance · U10 BB").
- The app's saved copy of the team list is refreshed. A copy saved before club teams were published (which had no Barracudas) is no longer used.

## 1.6.0 — 2026-10-27 (game status panel)

- **A game status panel under the video**, always in view while you watch and tag:
  - **Period and score** right now, e.g. "P2 · Score 2–1", from your P/G/H marks.
  - **Strength:** "Power play 5-on-4", "Penalty kill 4-on-5", "Even 4-on-4" or "Even strength".
  - **Who's in the box:** every penalty whose end you haven't marked, with when it was called and the estimated time left. An **End penalty** button marks the end at the current moment, with Undo.
  - **Quick buttons:** Goal for, Goal against, Penalty and Tag.
- **Forgotten penalty ends stay in view.** A penalty past its estimated end now stays listed, marked "past its estimated end", until you end it. That applies to the panel and to the X popup; before, it quietly dropped off.
- The panel updates a few times a second at most, so it adds no noticeable load while the video plays.

## 1.5.0 — 2026-10-27 (custom tag while watching)

- **Press T to tag a moment with your own words.** The video pauses and a small popup asks for the tag (e.g. "Great backcheck") and a category.
- **Saving makes a new clip** around that moment, using the category's before/after window. If you've marked a start and end with I and O, it uses those instead.
- **Suggestions as you type:** tags used before (on any clip, yours or the team library's) are offered as you type. Separate several tags with commas; suggestions cover the first one.
- **Category:** starts on the one you used last.
- **Keys:** Enter saves, Esc cancels, and the video carries on afterwards. There's also a **Custom tag T** button on the game screen.
- Clip cards on the game screen now show their custom tags.

## 1.4.0 — 2026-10-27 (penalties)

- **Mark penalties with X.** The video pauses and a popup asks who took it (our player from the game's lineup, or the other team with an optional number), the penalty (tripping, hooking, slashing, …) and the length: minor 2, double minor 4, major 5, misconduct 10.
- **Press X again when the player is back:** the popup lists who's in the box, with a **Back now** button for each. A power-play goal ends a minor on its own. Until the end is marked, the app estimates it from the length plus typical stoppage time.
- **Power play and penalty kill fill in automatically:**
  - Clips during a penalty get the situation (4-on-4 counts as even strength; misconducts don't change it).
  - If you pick a situation yourself, yours is kept.
  - The timeline shows power plays in green and penalty kills in orange.
- **Clips that include the call** get the **Penalty for / Penalty against** event and the penalty type. Our player who took the penalty is added to those clips, both existing and new ones.
- **Review:** a new **Penalty** filter by type (e.g. every tripping call this season). Search finds penalty types too.
- The game screen's marks card is now "Periods, goals and penalties", with a **Penalty X** button. The penalty list can jump to each call or delete it.
- Number keys no longer tag clips while any popup is open.

## 1.3.0 — 2026-10-27 (several categories on a clip)

- **A clip can be in more than one category**, e.g. a breakout with a nice pass. In the clip editor, the Category dropdown is now a set of chips: tap every category that fits.
- **The first category picked is the main one.** Its colour is used on the timeline and clip list, and it's marked "main" when there's more than one. Removing the main category makes the next one main. A clip always keeps at least one.
- **Names show together**, e.g. "Breakouts + Passing & support", in the clip list, editor title, exported video title bar and file name, and in Review.
- **Filters find the clip under any of its categories:** the game screen's clip filter, Review's Category filter and Review search.
- **Review:** the clip tags panel has the same chips, so any coach can add a category to a clip; it syncs back to the clip's owner.
- Clips from earlier versions keep their one category.
- Fixed: the trim bar showed the word "null" when a clip had no freeze frame.

## 1.2.0 — 2026-10-26 (several teams)

- **Coach more than one team.** The team name in the header is now a button: it lists the teams on this device, switches between them, and adds a new one.
- **Each team is fully separate:** games, clips, roster, categories, coaches, league team, and its own Google Drive folder and clip library. Bulldogs coaches never see another team's roster or clips.
- **Add a team** asks for a name and can copy the current team's clip categories. The new team opens on its Team page, ready for a league team and roster.
- **Your existing team becomes the first team** automatically. Nothing moves, and its Drive folder keeps the name "Bulldogs Watch Party".
- **New teams' Drive folders** are named after the team (e.g. "Burlington Barracudas U13 B – Watch Party"), with their own private clips folder.
- **Several teams under one Google account:** "Open shared team data" picks the file with this team's name, or asks which team when it can't tell.
- **Removing a team** deletes it from this browser only; its Drive files stay.
- **Settings › Teams** opens the same switcher.
- "Bulldogs" no longer appears in shared text: the share email, exported clip descriptions and the G key label use the team's name or "we".
- Fixed: two things saving at once could create the private clips folder twice.
- **OWHA club teams in the League team list:** Alliance Tracker now also publishes the Burlington Barracudas U13 B schedule, read from the club site (bghc.ca), so Barracudas games fill in like Bulldogs games: auto-match from LiveBarn files, scores, exhibitions and tournaments. They're listed as "U13 B (OWHA)".

## 1.1.1 — 2026-10-25 (install the app)

- **Settings › Install the app:** an **Install app** button adds Watch Party to the home screen or desktop, where it opens in its own window. In Chrome and Edge it opens the browser's install prompt. Elsewhere it shows the steps for that browser (iPhone Safari, Samsung Internet, Firefox). Once installed, the card says so.
- A minimal service worker (`sw.js`) lets Chrome offer the install prompt. It caches nothing, so updates still arrive through the "Reload now" banner.

## 1.1.0 — 2026-10-25 (league schedule)

- **Games come from the Alliance schedule.** Watch Party reads the schedules, scores, rinks and logos that Alliance Tracker publishes, so there's nothing to type.
- **Team › Team and league:** pick the league team once (default: Burlington Bulldogs Blue, U10 BB). It's shared with every coach. Any Alliance team can be picked, or none.
- **New game form:**
  - A **League schedule** list of the team's games with opponent logos, newest first. Upcoming games are one tap away.
  - Picking a game fills in the date, the new **Start time** field, opponent, rink, home or away, game type and the final score (e.g. "W 2–1"). Every field stays editable.
  - **Dropping LiveBarn files picks the matching game** from the files' date, time and rink. "Not a league game" turns it off for that game.
  - Opponent and rink type-ahead lists include the division's teams and the schedule's rinks.
- **Game screen:** the opponent logo, start time, and **Open in LiveBarn** and **GameSheet** links. Games added before v1.1 get **Link to league schedule**, which suggests the game the video belongs to and keeps a result you already entered.
- The score is filled in once and then left alone.
- The schedule is saved in the browser, so it still shows offline. It refreshes after 30 minutes or with **Refresh**.
- The data address is one line in `config.js` (`leagueDataUrl`), in case Alliance Tracker moves.

## 1.0.0 — 2026-10-25 (Watch Party by Bench Boss Labs)

- **New name and look:**
  - The app is now *Watch Party by Bench Boss Labs*: dark navy throughout, Electric Blue actions and Montserrat headings.
  - The Bench Boss Labs symbol is redrawn as a clean vector, with home-screen icons and a simplified browser-tab icon.
- **Team page** (new menu item): roster, coaches, clip categories, opponents and rinks, team name and season. Any coach can edit.
- **Admin section** (Team › Drive and access): only for the account that owns the team's Drive folder. It shows coach access with a "Share with new coaches" button, and every clip folder with its clip count and Drive link. Admin areas are marked in amber.
- **Settings** is now just yours: name, Google sign-in and team data, shortcuts, about.
- **Roster:** first and last name (shown as "S. Smith"), primary and secondary positions (C, LW, RW, D, G), position filters, and edit in place. Removing a player asks first.
- **Game lineups:**
  - Set on the New game form and changeable on the game screen.
  - Mark players away, give a position for one game, add guest players, and copy the last game's lineup.
  - The clip editor only offers players who played.
- **Review:** a Position filter (Forwards, Defense, Goalies), based on each player's position in that game.
- Older roster entries become a first name automatically; team data from older versions still syncs.

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
