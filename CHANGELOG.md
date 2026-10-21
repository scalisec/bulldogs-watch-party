# Changelog

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
