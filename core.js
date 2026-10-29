/* Bulldogs Watch Party — core logic (no DOM). Works in the browser (window.WP) and in Node (require). */
(function (root) {
  'use strict';

  const APP_VERSION = '2.0.2';
  const APP_RELEASED = '2026-10-29';
  const SCHEMA_VERSION = 1;
  const DEFAULT_BEFORE = 8;
  const DEFAULT_AFTER = 4;
  const MIN_CLIP = 1;      // seconds
  const MAX_CLIP = 180;    // seconds

  // ---------- ids ----------
  let counter = 0;
  function uid(prefix) {
    counter += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rand + counter.toString(36);
  }

  // ---------- time ----------
  function pad(n) { return String(n).padStart(2, '0'); }

  /** 75 -> "1:15", 3725 -> "1:02:05". Negative/NaN -> "0:00". Tenths optional. */
  function formatTime(sec, withTenths) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    let whole = Math.floor(sec);
    let tenths = Math.floor((sec - whole) * 10 + 1e-6);
    if (tenths >= 10) { whole += 1; tenths = 0; }
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const base = h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
    return withTenths ? base + '.' + tenths : base;
  }

  /** Accepts "75", "1:15", "1:02:05", "4:12.5". Returns seconds or NaN. */
  function parseTime(text) {
    if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? text : NaN;
    if (typeof text !== 'string') return NaN;
    const t = text.trim();
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
    const [main, frac] = t.split('.');
    const parts = main.split(':').map(Number);
    if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return NaN;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    if (frac) sec += Number('0.' + frac);
    return sec;
  }

  // ---------- LiveBarn file names ----------
  /**
   * LiveBarn downloads look like:
   *   1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.mp4
   * Returns { index, rink, label, date, startSec, startMs } — missing pieces are null.
   */
  function parseLiveBarnName(name) {
    const out = { index: null, rink: null, label: null, date: null, time: null, startMs: null };
    if (typeof name !== 'string') return out;
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, '');
    const idx = base.match(/^(\d+)__/);
    if (idx) out.index = Number(idx[1]);
    const stamp = base.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})/);
    if (stamp) {
      out.date = stamp[1] + '-' + stamp[2] + '-' + stamp[3];
      out.time = stamp[4] + ':' + stamp[5] + ':' + stamp[6];
      out.startMs = Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]);
    }
    const segs = base.split('__').filter(Boolean);
    let rest = segs;
    if (idx) rest = rest.slice(1);
    if (stamp) rest = rest.filter((s) => !/\d{4}-\d{2}-\d{2}T\d{6}/.test(s));
    if (rest.length >= 1) out.rink = rest[0].replace(/_/g, ' ').trim() || null;
    if (rest.length >= 2) out.label = rest.slice(1).join(' ').replace(/_/g, ' ').trim() || null;
    return out;
  }

  /** Sort parts into play order: LiveBarn start time, then index, then name. */
  function orderParts(parts) {
    return parts.slice().sort((a, b) => {
      const pa = parseLiveBarnName(a.name);
      const pb = parseLiveBarnName(b.name);
      if (pa.startMs != null && pb.startMs != null && pa.startMs !== pb.startMs) return pa.startMs - pb.startMs;
      if (pa.index != null && pb.index != null && pa.index !== pb.index) return pa.index - pb.index;
      return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    });
  }

  /** Guess game details from the first part's file name. */
  function guessGameDetails(parts) {
    const ordered = orderParts(parts);
    const first = ordered.length ? parseLiveBarnName(ordered[0].name) : {};
    return { date: first.date || null, rink: first.rink || null };
  }

  // ---------- virtual timeline across parts ----------
  function buildTimeline(durations) {
    const offsets = [];
    let total = 0;
    for (const d of durations) {
      offsets.push(total);
      total += Number.isFinite(d) && d > 0 ? d : 0;
    }
    return { offsets, durations: durations.slice(), total };
  }

  /** Global seconds -> { part, local }. Clamps to the timeline. */
  function locate(tl, t) {
    if (!tl.durations.length) return { part: 0, local: 0 };
    const tt = Math.max(0, Math.min(Number.isFinite(t) ? t : 0, tl.total));
    for (let i = tl.offsets.length - 1; i >= 0; i--) {
      if (tt >= tl.offsets[i]) {
        // exactly at the very end of a part that has a successor -> start of next part
        const local = tt - tl.offsets[i];
        return { part: i, local: Math.min(local, tl.durations[i]) };
      }
    }
    return { part: 0, local: 0 };
  }

  function toGlobal(tl, part, local) {
    if (part < 0 || part >= tl.offsets.length) return NaN;
    return tl.offsets[part] + Math.max(0, Math.min(local, tl.durations[part]));
  }

  // ---------- categories ----------
  const DEFAULT_CATEGORY_LIST = [
    ['Breakouts', '#2563EB'],
    ['Passing & support', '#0D9488'],
    ['Forecheck / puck pursuit', '#EA580C'],
    ['Backcheck & D-zone', '#7C3AED'],
    ['Faceoffs', '#64748B'],
    ['Shots & scoring chances', '#DC2626'],
    ['Goalie', '#16A34A'],
    ['Compete & battles', '#92400E'],
    ['Wow plays', '#CA8A04']
  ];

  function defaultCategories() {
    return DEFAULT_CATEGORY_LIST.map(([name, color], i) => ({
      id: 'cat_' + (i + 1),
      name,
      color,
      before: DEFAULT_BEFORE,
      after: DEFAULT_AFTER,
      hidden: false
    }));
  }

  function clampWindow(n, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(60, Math.round(v * 10) / 10));
  }

  /** Visible categories in order, each with its keyboard key ("1".."9" for the first nine, else null). */
  function keyedCategories(categories) {
    let k = 0;
    return categories.filter((c) => !c.hidden).map((c) => {
      k += 1;
      return Object.assign({}, c, { key: k <= 9 ? String(k) : null });
    });
  }

  function categoryForKey(categories, key) {
    return keyedCategories(categories).find((c) => c.key === String(key)) || null;
  }

  function addCategory(categories, name, color) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Category name is required');
    if (categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) throw new Error('A category with that name already exists');
    return categories.concat([{ id: uid('cat'), name: clean, color: color || '#475569', before: DEFAULT_BEFORE, after: DEFAULT_AFTER, hidden: false }]);
  }

  function updateCategory(categories, id, patch) {
    const p = Object.assign({}, patch);
    if ('name' in p) {
      p.name = String(p.name || '').trim();
      if (!p.name) throw new Error('Category name is required');
      if (categories.some((c) => c.id !== id && c.name.toLowerCase() === p.name.toLowerCase())) throw new Error('A category with that name already exists');
    }
    if ('before' in p) p.before = clampWindow(p.before, DEFAULT_BEFORE);
    if ('after' in p) p.after = clampWindow(p.after, DEFAULT_AFTER);
    return categories.map((c) => (c.id === id ? Object.assign({}, c, p) : c));
  }

  function moveCategory(categories, id, delta) {
    const i = categories.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= categories.length) return categories.slice();
    const copy = categories.slice();
    const [item] = copy.splice(i, 1);
    copy.splice(j, 0, item);
    return copy;
  }

  function categoryInUse(games, id) {
    return games.some((g) => (g.clips || []).some((c) => clipCategoryIds(c).includes(id)));
  }

  // ---------- several categories on one clip (v1.3) ----------
  // A clip has a main category (categoryId: its colour, quick-tag key and Drive name) and can also
  // be in more (alsoCats), e.g. a breakout with a nice pass. Filters and the library see all of them.
  function clipCategoryIds(clip) {
    if (!clip) return [];
    const ids = [clip.categoryId].concat(Array.isArray(clip.alsoCats) ? clip.alsoCats : []).filter((x) => typeof x === 'string' && x);
    return [...new Set(ids)];
  }

  /** The patch that gives a clip exactly these categories (the first is the main one). */
  function categoriesPatch(ids) {
    const list = [...new Set((ids || []).filter((x) => typeof x === 'string' && x))];
    if (!list.length) throw new Error('A clip needs at least one category');
    return { categoryId: list[0], alsoCats: list.slice(1) };
  }

  /** Add or remove one category. Removing the main one makes the next one main; the last one can't be removed. */
  function toggleClipCategory(clip, id) {
    const ids = clipCategoryIds(clip);
    if (ids.includes(id)) {
      if (ids.length === 1) throw new Error('A clip needs at least one category');
      return categoriesPatch(ids.filter((x) => x !== id));
    }
    return categoriesPatch(ids.concat([id]));
  }

  /** { id, name: "Breakout + Nice pass", color } — the main category's colour, every name. */
  function clipCategoryLabel(clip, categories) {
    const cats = clipCategoryIds(clip).map((id) => (categories || []).find((c) => c.id === id)).filter(Boolean);
    if (!cats.length) return null;
    return { id: cats[0].id, name: cats.map((c) => c.name).join(' + '), color: cats[0].color, main: cats[0] };
  }

  function removeCategory(categories, id, games) {
    if (categoryInUse(games || [], id)) throw new Error('This category has clips. Hide it instead of deleting it.');
    return categories.filter((c) => c.id !== id);
  }

  // ---------- clips ----------
  /** Automatic window around a tap at time t, clamped to [0, total]. */
  function autoWindow(t, category, total) {
    const before = category && Number.isFinite(category.before) ? category.before : DEFAULT_BEFORE;
    const after = category && Number.isFinite(category.after) ? category.after : DEFAULT_AFTER;
    const end = Math.min(total, t + after);
    const start = Math.max(0, t - before);
    return { start: round1(start), end: round1(Math.max(end, Math.min(total, start + MIN_CLIP))) };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function validateRange(start, end, total) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter start and end as m:ss or h:mm:ss';
    if (start < 0) return 'Start can’t be before the game starts';
    if (Number.isFinite(total) && total > 0 && end > total + 0.05) return 'End is after the game ends (' + formatTime(total) + ')';
    if (end - start < MIN_CLIP) return 'A clip must be at least ' + MIN_CLIP + ' second long';
    if (end - start > MAX_CLIP) return 'A clip can be at most ' + MAX_CLIP / 60 + ' minutes long';
    return null;
  }

  function makeClip(fields) {
    const err = validateRange(fields.start, fields.end, fields.total);
    if (err) throw new Error(err);
    if (!fields.categoryId) throw new Error('Pick a category');
    return {
      id: uid('clip'),
      categoryId: fields.categoryId,
      alsoCats: [],
      start: round1(fields.start),
      end: round1(fields.end),
      players: normalizePlayers(fields.players || []),
      flag: fields.flag === 'work' ? 'work' : 'do',
      note: String(fields.note || '').slice(0, 140),
      by: String(fields.by || '').slice(0, 40),
      method: ['tap', 'marks', 'manual', 'goal'].includes(fields.method) ? fields.method : 'manual',
      zoom: isZoomed(fields.zoom) ? normalizeZoom(fields.zoom) : null,
      speeds: [],
      freeze: null,
      titleBar: true,
      events: (fields.events || []).filter((e) => EVENT_IDS.includes(e)),
      hiddenAuto: [],
      zone: '',
      situation: 'even',
      starred: false,
      tags: [],
      private: !!fields.private,
      drive: [],
      createdAt: fields.now || Date.now()
    };
  }

  // ---------- zoom ----------
  // A view is { scale, x, y }: scale 1–MAX_ZOOM, (x, y) = centre of the view as fractions of the frame (0–1).
  const MAX_ZOOM = 6;
  const FIT = Object.freeze({ scale: 1, x: 0.5, y: 0.5 });

  function normalizeZoom(z) {
    const s = Math.max(1, Math.min(MAX_ZOOM, Number(z && z.scale) || 1));
    const half = 0.5 / s;
    const cx = Math.max(half, Math.min(1 - half, Number.isFinite(z && z.x) ? z.x : 0.5));
    const cy = Math.max(half, Math.min(1 - half, Number.isFinite(z && z.y) ? z.y : 0.5));
    return { scale: Math.round(s * 100) / 100, x: Math.round(cx * 10000) / 10000, y: Math.round(cy * 10000) / 10000 };
  }

  function isZoomed(z) { return !!z && Number(z.scale) > 1.001; }

  /** Zoom by `factor` keeping the frame point under (fx, fy) — fractions of the view — fixed on screen. */
  function zoomAt(z, factor, fx, fy) {
    const cur = normalizeZoom(z || FIT);
    const px = Number.isFinite(fx) ? fx : 0.5;
    const py = Number.isFinite(fy) ? fy : 0.5;
    const s2 = Math.max(1, Math.min(MAX_ZOOM, cur.scale * factor));
    const frameX = cur.x + (px - 0.5) / cur.scale;
    const frameY = cur.y + (py - 0.5) / cur.scale;
    return normalizeZoom({ scale: s2, x: frameX - (px - 0.5) / s2, y: frameY - (py - 0.5) / s2 });
  }

  /** Move the view by (dx, dy) given as fractions of the visible view (drag distance / view size). */
  function panZoom(z, dx, dy) {
    const cur = normalizeZoom(z || FIT);
    return normalizeZoom({ scale: cur.scale, x: cur.x - dx / cur.scale, y: cur.y - dy / cur.scale });
  }

  /** Source rectangle (pixels) that a zoom view shows, for drawing a frame into a canvas. */
  function zoomSourceRect(z, vw, vh) {
    const v = normalizeZoom(z || FIT);
    const sw = vw / v.scale;
    const sh = vh / v.scale;
    return { sx: (v.x - 0.5 / v.scale) * vw, sy: (v.y - 0.5 / v.scale) * vh, sw, sh };
  }

  /** View fraction (where the pointer is on screen) -> frame fraction (spot on the rink), and back. */
  function viewToFrame(z, fx, fy) {
    const v = normalizeZoom(z || FIT);
    return { x: v.x + (fx - 0.5) / v.scale, y: v.y + (fy - 0.5) / v.scale };
  }
  function frameToView(z, x, y) {
    const v = normalizeZoom(z || FIT);
    return { x: (x - v.x) * v.scale + 0.5, y: (y - v.y) * v.scale + 0.5 };
  }

  // ---------- clip edits: speed sections, freeze-and-draw, render plan ----------
  const RATES = [0.25, 0.5, 1.5, 2];
  const MAX_SPEEDS = 3;
  const MIN_SPEED_LEN = 0.5;
  const DEFAULT_HOLD = 3;
  const MAX_SHAPES = 30;
  const COLORS = { yellow: '#FACC15', white: '#FFFFFF', red: '#EF4444' };

  function sortedSpeeds(list) { return (list || []).slice().sort((a, b) => a.start - b.start); }

  /** Check a list of speed sections against a clip range. Returns an error message or null. */
  function validateSpeeds(list, start, end) {
    const s = sortedSpeeds(list);
    if (s.length > MAX_SPEEDS) return 'Up to ' + MAX_SPEEDS + ' speed sections per clip';
    for (let i = 0; i < s.length; i++) {
      const x = s[i];
      if (!RATES.includes(Number(x.rate))) return 'Pick a speed: 0.25×, 0.5×, 1.5× or 2×';
      if (!(x.start >= start - 1e-6 && x.end <= end + 1e-6)) return 'Speed sections must be inside the clip';
      if (x.end - x.start < MIN_SPEED_LEN - 1e-6) return 'A speed section must be at least ' + MIN_SPEED_LEN + ' s';
      if (i > 0 && x.start < s[i - 1].end - 1e-6) return 'Speed sections can’t overlap';
    }
    return null;
  }

  /** Add a speed section starting at `at` (default 3 s long, trimmed to fit before the next section / clip end). */
  function addSpeed(clip, at, rate) {
    const list = sortedSpeeds(clip.speeds);
    if (list.length >= MAX_SPEEDS) throw new Error('Up to ' + MAX_SPEEDS + ' speed sections per clip');
    let start = Math.max(clip.start, Math.min(round1(at), clip.end - MIN_SPEED_LEN));
    const inside = list.find((x) => start >= x.start && start < x.end);
    if (inside) start = inside.end;
    const next = list.find((x) => x.start >= start);
    const limit = Math.min(clip.end, next ? next.start : clip.end);
    const end = round1(Math.min(limit, start + 3));
    const item = { id: uid('spd'), start: round1(start), end, rate: RATES.includes(rate) ? rate : 0.5 };
    const out = sortedSpeeds(list.concat([item]));
    const err = validateSpeeds(out, clip.start, clip.end);
    if (err) throw new Error(err === 'A speed section must be at least ' + MIN_SPEED_LEN + ' s' ? 'No room for a speed section here' : err);
    return out;
  }

  function updateSpeed(clip, id, patch) {
    const out = sortedSpeeds((clip.speeds || []).map((x) => (x.id === id ? Object.assign({}, x, patch, {
      start: 'start' in patch ? round1(patch.start) : x.start,
      end: 'end' in patch ? round1(patch.end) : x.end,
      rate: 'rate' in patch ? Number(patch.rate) : x.rate
    }) : x)));
    const err = validateSpeeds(out, clip.start, clip.end);
    if (err) throw new Error(err);
    return out;
  }

  function removeSpeed(clip, id) { return (clip.speeds || []).filter((x) => x.id !== id); }

  /** After a trim, clip speed sections and the freeze to the new range (dropping what no longer fits). */
  function fitEditsToRange(clip) {
    const speeds = sortedSpeeds(clip.speeds).map((x) => Object.assign({}, x, { start: Math.max(x.start, clip.start), end: Math.min(x.end, clip.end) }))
      .filter((x) => x.end - x.start >= MIN_SPEED_LEN - 1e-6);
    let freeze = clip.freeze || null;
    if (freeze && (freeze.at < clip.start || freeze.at > clip.end)) freeze = null;
    return Object.assign({}, clip, { speeds, freeze });
  }

  function setFreeze(clip, at, hold) {
    if (!(at >= clip.start - 1e-6 && at <= clip.end + 1e-6)) throw new Error('Freeze inside the clip');
    const prev = clip.freeze || { shapes: [] };
    const h = Number(hold);
    return { at: round1(at), hold: Number.isFinite(h) ? Math.max(1, Math.min(10, Math.round(h * 2) / 2)) : (prev.hold || DEFAULT_HOLD), shapes: prev.shapes || [] };
  }

  function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

  /** Shapes are stored in frame fractions (a spot on the rink), so they stay put if the zoom changes. */
  function normalizeShape(s) {
    if (!s || !['arrow', 'circle', 'free'].includes(s.type)) throw new Error('Unknown drawing');
    const pts = (s.pts || []).map((p) => [Math.round(clamp01(p[0]) * 10000) / 10000, Math.round(clamp01(p[1]) * 10000) / 10000]);
    const need = s.type === 'free' ? 2 : 2;
    if (pts.length < need) throw new Error('Drawing too small');
    const keep = s.type === 'free' ? pts.slice(0, 400) : [pts[0], pts[pts.length - 1]];
    return { type: s.type, color: Object.values(COLORS).includes(s.color) ? s.color : COLORS.yellow, pts: keep };
  }

  function addShape(freeze, shape) {
    if (!freeze) throw new Error('Freeze a frame first');
    if ((freeze.shapes || []).length >= MAX_SHAPES) throw new Error('Up to ' + MAX_SHAPES + ' drawings on one frame');
    return Object.assign({}, freeze, { shapes: (freeze.shapes || []).concat([normalizeShape(shape)]) });
  }

  /**
   * The clip as it will play out: a list of segments in order.
   *   play: source [from, to) at `rate`
   *   hold: freeze on source time `at` for `hold` seconds (shows the drawing)
   * Each segment carries outStart/outEnd on the exported video's timeline.
   */
  function buildPlan(clip) {
    if (hasRec(clip)) return recPlan(clip);
    const cuts = new Set([clip.start, clip.end]);
    const speeds = sortedSpeeds(clip.speeds).filter((x) => x.end > clip.start && x.start < clip.end);
    for (const x of speeds) { cuts.add(Math.max(clip.start, x.start)); cuts.add(Math.min(clip.end, x.end)); }
    const f = clip.freeze && clip.freeze.at >= clip.start && clip.freeze.at <= clip.end ? clip.freeze : null;
    if (f) cuts.add(f.at);
    const points = [...cuts].sort((a, b) => a - b);
    const out = [];
    let t = 0;
    const pushHold = () => {
      const hold = f.hold || DEFAULT_HOLD;
      out.push({ kind: 'hold', at: f.at, hold, outStart: t, outEnd: t + hold });
      t += hold;
    };
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      if (f && Math.abs(from - f.at) < 1e-9 && !out.some((s) => s.kind === 'hold')) pushHold();
      if (to - from < 1e-6) continue;
      const sp = speeds.find((x) => from >= x.start - 1e-9 && to <= x.end + 1e-9);
      const rate = sp ? Number(sp.rate) : 1;
      const len = (to - from) / rate;
      out.push({ kind: 'play', from, to, rate, outStart: t, outEnd: t + len });
      t += len;
    }
    if (f && !out.some((s) => s.kind === 'hold')) pushHold(); // freeze on the very last frame
    // merge neighbouring play segments at the same rate
    const merged = [];
    for (const s of out) {
      const prev = merged[merged.length - 1];
      if (prev && prev.kind === 'play' && s.kind === 'play' && prev.rate === s.rate && Math.abs(prev.to - s.from) < 1e-9) {
        prev.to = s.to; prev.outEnd = s.outEnd;
      } else merged.push(Object.assign({}, s));
    }
    return merged;
  }

  function planDuration(plan) { return plan.length ? plan[plan.length - 1].outEnd : 0; }

  // ---------- recorded breakdowns (milestone 2b) ----------
  // A recording is stored on the clip as
  //   rec = { rate: 1 | 0.5, voice: bool, duration: seconds of recording,
  //           zoomKeys: [[t, scale, x, y], ...], shapes: [{ t, type, color, pts }], clears: [t, ...] }
  // where every t is seconds since the recording started ("recording time").
  // Speed rule: with voice the export plays at the recorded speed (so the voice stays in sync);
  // without voice it plays at normal speed and the moves/drawings are sped up to match.
  const REC_FADE = 3;          // drawings stay up this many seconds of finished video
  const REC_KEY_INTERVAL = 0.1;

  function hasRec(clip) { return !!(clip && clip.rec && clip.rec.duration > 0); }
  function recExportRate(rec) { return rec.voice ? rec.rate : 1; }
  /** Recording time -> finished-video time. */
  function recOut(rec, t) { return (t * rec.rate) / recExportRate(rec); }
  /** Finished-video time -> recording time. */
  function recIn(rec, outT) { return (outT * recExportRate(rec)) / rec.rate; }

  function newRecording(rate, voice) {
    return { rate: rate === 0.5 ? 0.5 : 1, voice: !!voice, duration: 0, zoomKeys: [], shapes: [], clears: [], createdAt: Date.now() };
  }

  /** Add a zoom key if the view changed (at most every 0.1 s) or a second has passed. Mutates rec (it's a live draft). */
  function addRecKey(rec, t, zoom, force) {
    const z = normalizeZoom(zoom || FIT);
    const key = [Math.round(t * 1000) / 1000, z.scale, z.x, z.y];
    const last = rec.zoomKeys[rec.zoomKeys.length - 1];
    if (!last || force) { rec.zoomKeys.push(key); return true; }
    const changed = last[1] !== key[1] || last[2] !== key[2] || last[3] !== key[3];
    if ((changed && t - last[0] >= REC_KEY_INTERVAL - 1e-9) || t - last[0] >= 1) { rec.zoomKeys.push(key); return true; }
    return false;
  }

  /** The recorded view at a finished-video time, smoothly between keys. */
  function recZoomAt(rec, outT) {
    const keys = rec.zoomKeys || [];
    if (!keys.length) return null;
    const t = recIn(rec, outT);
    let k = keys[0];
    if (t <= keys[0][0]) k = keys[0];
    else if (t >= keys[keys.length - 1][0]) k = keys[keys.length - 1];
    else {
      let i = 1;
      while (i < keys.length && keys[i][0] < t) i++;
      const a = keys[i - 1];
      const b = keys[i];
      const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
      k = [t, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
    const z = normalizeZoom({ scale: k[1], x: k[2], y: k[3] });
    return isZoomed(z) ? z : null;
  }

  /** Drawings showing at a finished-video time, each with an `alpha` for the fade-out. */
  function recShapesAt(rec, outT) {
    const t = recIn(rec, outT);
    const out = [];
    for (const s of rec.shapes || []) {
      if (s.t > t + 1e-9) continue;
      const age = outT - recOut(rec, s.t);
      if (age >= REC_FADE) continue;
      if ((rec.clears || []).some((c) => c > s.t && c <= t + 1e-9)) continue;
      const alpha = age > REC_FADE - 0.4 ? Math.max(0, (REC_FADE - age) / 0.4) : 1;
      out.push(Object.assign({}, s, { alpha }));
    }
    return out;
  }

  function addRecShape(rec, t, shape) {
    if ((rec.shapes || []).length >= 200) throw new Error('Too many drawings in one recording');
    rec.shapes.push(Object.assign({ t: Math.round(t * 1000) / 1000 }, normalizeShape(shape)));
  }

  function addRecClear(rec, t) { rec.clears.push(Math.round(t * 1000) / 1000); }

  /** The finished video for a recorded clip: one play segment at the export speed. */
  function recPlan(clip) {
    const rec = clip.rec;
    const er = recExportRate(rec);
    const to = Math.min(clip.end, clip.start + rec.duration * rec.rate);
    return [{ kind: 'play', from: clip.start, to, rate: er, outStart: 0, outEnd: (to - clip.start) / er }];
  }

  function recSummary(rec) {
    const bits = ['Recorded ' + formatTime(rec.duration)];
    bits.push(rec.rate === 0.5 ? 'at half speed' : 'at normal speed');
    bits.push(rec.voice ? 'with voice' : 'no voice');
    const n = (rec.shapes || []).length;
    if (n) bits.push(n + (n === 1 ? ' drawing' : ' drawings'));
    return bits.join(' · ');
  }

  /** Title bar words for an exported clip. */
  function titleLines(clip, category, game) {
    const top = [category ? category.name : 'Clip', game ? gameTitle(game) : null].filter(Boolean).join(' · ');
    const bits = [];
    if (clip.players && clip.players.length) bits.push(clip.players.map((p) => '#' + p).join(' '));
    if (clip.note) bits.push(clip.note);
    return { top, bottom: bits.join(' — ') };
  }

  function exportFileName(clip, category, game) {
    const d = game && game.date ? game.date : 'game';
    const t = formatTime(clip.start).replace(/:/g, 'm') + 's';
    const who = (clip.players || []).map((p) => '#' + p).join(' ');
    const clean = (x) => String(x || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/[\s.]+$/g, '').replace(/\s+/g, ' ').trim();
    const base = clean([d, category ? category.name : 'Clip', t, who].filter(Boolean).join(' ')).slice(0, 120);
    // the clip's note goes at the end (v2.0.2), cut at a word boundary so names stay readable
    let note = clean(clip.note);
    if (note.length > 80) note = note.slice(0, 80).replace(/\s+\S*$/, '') + '…';
    return base + (note ? ' - ' + note : '') + '.mp4';
  }

  /** Output size: at most maxW wide, same shape as the source, even numbers (encoders need them). */
  function exportSize(vw, vh, maxW) {
    const w = Math.min(maxW || 1280, vw);
    const W = Math.max(2, Math.floor(w / 2) * 2);
    const H = Math.max(2, Math.round((W * vh) / vw / 2) * 2);
    return { width: W, height: H };
  }

  /** CSS transform for an element sized exactly to the frame, with transform-origin 0 0. */
  function zoomTransform(z) {
    const v = normalizeZoom(z || FIT);
    if (!isZoomed(v)) return '';
    const tx = (0.5 - v.scale * v.x) * 100 / v.scale;
    const ty = (0.5 - v.scale * v.y) * 100 / v.scale;
    return 'scale(' + v.scale + ') translate(' + tx.toFixed(3) + '%, ' + ty.toFixed(3) + '%)';
  }

  function updateClip(clip, patch, total) {
    const next = Object.assign({}, clip, patch);
    if ('start' in patch || 'end' in patch) {
      const err = validateRange(next.start, next.end, total);
      if (err) throw new Error(err);
      next.start = round1(next.start);
      next.end = round1(next.end);
    }
    if ('players' in patch) next.players = normalizePlayers(patch.players);
    if ('alsoCats' in patch || 'categoryId' in patch) next.alsoCats = clipCategoryIds(next).slice(1);
    if ('flag' in patch) next.flag = patch.flag === 'work' ? 'work' : 'do';
    if ('note' in patch) next.note = String(patch.note || '').slice(0, 140);
    if ('zoom' in patch) next.zoom = isZoomed(patch.zoom) ? normalizeZoom(patch.zoom) : null;
    if ('titleBar' in patch) next.titleBar = !!patch.titleBar;
    if ('events' in patch) next.events = (patch.events || []).filter((e) => EVENT_IDS.includes(e));
    if ('hiddenAuto' in patch) next.hiddenAuto = (patch.hiddenAuto || []).filter((e) => EVENT_IDS.includes(e));
    if ('zone' in patch) next.zone = ZONES.some((z) => z[0] === patch.zone) ? patch.zone : '';
    if ('situation' in patch) { next.situation = SITUATIONS.some((z) => z[0] === patch.situation) ? patch.situation : 'even'; next.situationSet = true; }
    if ('starred' in patch) next.starred = !!patch.starred;
    if ('tags' in patch) next.tags = normalizeTags(patch.tags);
    if ('private' in patch) next.private = !!patch.private;
    if ('speeds' in patch) {
      const err = validateSpeeds(patch.speeds, next.start, next.end);
      if (err) throw new Error(err);
      next.speeds = sortedSpeeds(patch.speeds);
    }
    if ('start' in patch || 'end' in patch) {
      // a recording is timed to the old trim; re-trimming means re-recording
      if (clip.rec && (next.start !== clip.start || next.end !== clip.end)) next.rec = null;
      return fitEditsToRange(next);
    }
    return next;
  }

  function normalizePlayers(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const n = String(raw).replace(/^#/, '').trim();
      if (!/^\d{1,2}$/.test(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.sort((a, b) => Number(a) - Number(b));
  }

  function sortClips(clips) {
    return clips.slice().sort((a, b) => a.start - b.start || a.end - b.end || a.createdAt - b.createdAt);
  }

  // ---------- roster ----------
  const POSITIONS = [['C', 'Centre'], ['LW', 'Left wing'], ['RW', 'Right wing'], ['D', 'Defense'], ['G', 'Goalie']];
  const POSITION_IDS = POSITIONS.map((p) => p[0]);
  const POSITION_GROUPS = [['F', 'Forwards'], ['D', 'Defense'], ['G', 'Goalies']];
  function positionGroup(code) { return code === 'D' ? 'D' : code === 'G' ? 'G' : POSITION_IDS.includes(code) ? 'F' : ''; }
  function positionLabel(code) { const p = POSITIONS.find((x) => x[0] === code); return p ? p[1] : ''; }
  function cleanPos(v) { const c = String(v || '').toUpperCase(); return POSITION_IDS.includes(c) ? c : ''; }

  /** How a player's name shows in the app and in Drive folder names: "S. Smith" (first initial, last name);
      just the first name when there's no last name. */
  function displayName(first, last) {
    const f = String(first || '').trim();
    const l = String(last || '').trim();
    if (!l) return f;
    return (f ? f[0].toUpperCase() + '. ' : '') + l;
  }

  /** One roster entry. Older entries had only { number, name }: name becomes the first name. */
  function normalizePlayer(p) {
    const src = p || {};
    const first = cleanText(src.first != null ? src.first : src.name, 30);
    const last = cleanText(src.last, 30);
    const primary = cleanPos(src.primary);
    let secondary = cleanPos(src.secondary);
    if (secondary === primary) secondary = '';
    return { number: String(src.number == null ? '' : src.number).replace(/^#/, '').trim(), first, last, name: displayName(first, last), primary, secondary };
  }

  function sortRoster(r) { return r.slice().sort((a, b) => Number(a.number) - Number(b.number)); }

  /** addPlayer(roster, { number, first, last, primary, secondary }) — or the older addPlayer(roster, number, name). */
  function addPlayer(roster, fields, oldName) {
    const f = fields && typeof fields === 'object' ? fields : { number: fields, first: oldName };
    const p = normalizePlayer(f);
    if (!/^\d{1,2}$/.test(p.number)) throw new Error('Jersey number must be 0–99');
    if (roster.some((x) => x.number === p.number)) throw new Error('#' + p.number + ' is already on the roster');
    return sortRoster(roster.concat([p]));
  }

  /** Change a player's name or positions (the number stays: clips and the family folder are keyed by it). */
  function updatePlayer(roster, number, patch) {
    const n = String(number);
    if (!roster.some((p) => p.number === n)) throw new Error('#' + n + ' isn\u2019t on the roster');
    return roster.map((p) => (p.number === n ? normalizePlayer(Object.assign({}, p, patch, { number: n })) : p));
  }

  function removePlayer(roster, number) {
    return roster.filter((p) => p.number !== String(number));
  }

  // ---------- game lineup: who played and where, starting from the roster ----------
  function normalizeLineup(l) {
    const src = l || {};
    const away = [...new Set((Array.isArray(src.away) ? src.away : []).map(String))];
    const pos = {};
    for (const [k, v] of Object.entries(src.pos || {})) { const c = cleanPos(v); if (c) pos[String(k)] = c; }
    const guests = dedupeBy((Array.isArray(src.guests) ? src.guests : [])
      .map((g) => ({ number: String(g && g.number != null ? g.number : '').replace(/^#/, '').trim(), name: cleanText(g && g.name, 30), pos: cleanPos(g && g.pos) }))
      .filter((g) => /^\d{1,2}$/.test(g.number)), (g) => g.number);
    return { away, pos, guests };
  }

  /** Everyone for a game: roster players (with this game's position and whether they were away), then guests. */
  function gameLineup(game, roster) {
    const L = normalizeLineup(game && game.lineup);
    const rows = (roster || []).map((p) => ({
      number: p.number, name: p.name, primary: p.primary, secondary: p.secondary,
      pos: L.pos[p.number] || p.primary || '', away: L.away.includes(p.number), guest: false
    }));
    for (const g of L.guests) if (!rows.some((r) => r.number === g.number)) rows.push({ number: g.number, name: g.name || 'Guest', primary: '', secondary: '', pos: g.pos, away: false, guest: true });
    return rows;
  }

  /** Numbers of the players who played in this game (everyone on the roster when no lineup was set). */
  function playersForGame(game, roster) {
    return gameLineup(game, roster).filter((r) => !r.away).map((r) => r.number);
  }

  function setAway(lineup, number, away) {
    const L = normalizeLineup(lineup);
    const n = String(number);
    L.away = away ? [...new Set(L.away.concat([n]))] : L.away.filter((x) => x !== n);
    return L;
  }
  function setGamePos(lineup, number, code, primary) {
    const L = normalizeLineup(lineup);
    const n = String(number);
    const c = cleanPos(code);
    if (L.guests.some((g) => g.number === n)) L.guests = L.guests.map((g) => (g.number === n ? Object.assign({}, g, { pos: c }) : g));
    else if (!c || c === primary) delete L.pos[n];
    else L.pos[n] = c;
    return L;
  }
  function addGuest(lineup, roster, number, name, pos) {
    const L = normalizeLineup(lineup);
    const n = String(number == null ? '' : number).replace(/^#/, '').trim();
    if (!/^\d{1,2}$/.test(n)) throw new Error('Jersey number must be 0–99');
    if ((roster || []).some((p) => p.number === n) || L.guests.some((g) => g.number === n)) throw new Error('#' + n + ' is already in this lineup');
    L.guests.push({ number: n, name: cleanText(name, 30), pos: cleanPos(pos) });
    return L;
  }
  function removeGuest(lineup, number) {
    const L = normalizeLineup(lineup);
    L.guests = L.guests.filter((g) => g.number !== String(number));
    return L;
  }
  /** The lineup of the most recent game before this one (by date), to copy. */
  function lastLineup(games, exceptId) {
    const prev = (games || []).filter((g) => g.id !== exceptId && g.lineup).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0))[0];
    return prev ? normalizeLineup(prev.lineup) : null;
  }

  /** Position groups (F/D/G) of the players on a clip, using this game's positions. */
  function clipPositionGroups(game, clip, roster) {
    const rows = gameLineup(game, roster);
    const out = new Set();
    for (const n of clip.players || []) { const r = rows.find((x) => x.number === n); const g = r ? positionGroup(r.pos) : ''; if (g) out.add(g); }
    return POSITION_GROUPS.map((x) => x[0]).filter((g) => out.has(g));
  }

  // ---------- shared team data (milestone 3a) ----------
  // Shared by all coaches through one file in Google Drive. Each coach's own name stays on their device.
  const TEAM_SECTIONS = ['team', 'league', 'coaches', 'roster', 'categories', 'opponents', 'rinks'];
  const DEFAULT_TEAM = { name: 'Bulldogs U10 Blue', season: '' };

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function teamSnapshot(settings) {
    const out = {};
    for (const k of TEAM_SECTIONS) out[k] = clone(settings[k]);
    return out;
  }

  function cleanText(v, max) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 60); }

  function normalizeTeamData(d) {
    const src = d || {};
    const team = Object.assign({}, DEFAULT_TEAM, src.team || {});
    const coaches = (Array.isArray(src.coaches) ? src.coaches : [])
      .map((c) => ({ name: cleanText(c && c.name, 40), email: cleanText(c && c.email, 120).toLowerCase() }))
      .filter((c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email));
    const roster = (Array.isArray(src.roster) ? src.roster : [])
      .map(normalizePlayer)
      .filter((p) => /^\d{1,2}$/.test(p.number));
    const cats = Array.isArray(src.categories) && src.categories.length ? src.categories : defaultCategories();
    const categories = cats.filter((c) => c && c.id && c.name)
      .map((c) => Object.assign({ before: DEFAULT_BEFORE, after: DEFAULT_AFTER, hidden: false, color: '#475569' }, c));
    const list = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => cleanText(x, 60)).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    return {
      team: { name: cleanText(team.name, 60) || DEFAULT_TEAM.name, season: cleanText(team.season, 30) },
      league: normalizeLeague(src.league),
      coaches: dedupeBy(coaches, (c) => c.email),
      roster: dedupeBy(roster, (p) => p.number).sort((a, b) => Number(a.number) - Number(b.number)),
      categories: dedupeBy(categories, (c) => c.id),
      opponents: list(src.opponents),
      rinks: list(src.rinks)
    };
  }

  function dedupeBy(arr, key) {
    const seen = new Set();
    return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function applyTeamData(settings, data) {
    return Object.assign({}, settings, normalizeTeamData(data));
  }

  function teamFileText(settings, by) {
    return JSON.stringify(Object.assign({ app: 'bulldogs-watch-party', kind: 'team', schema: 1, updatedAt: new Date().toISOString(), updatedBy: by || '' }, teamSnapshot(settings)), null, 2);
  }

  function parseTeamFile(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('The team data file is damaged'); }
    if (!d || d.app !== 'bulldogs-watch-party' || d.kind !== 'team') throw new Error('That file isn’t Watch Party team data');
    return normalizeTeamData(d);
  }

  // --- small list editors ---
  function addCoach(coaches, name, email) {
    const e = cleanText(email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Enter the coach’s Google email');
    if (coaches.some((c) => c.email === e)) throw new Error(e + ' is already a coach');
    return coaches.concat([{ name: cleanText(name, 40), email: e }]);
  }
  function removeCoach(coaches, email) { return coaches.filter((c) => c.email !== email); }
  function addListItem(list, value) {
    const v = cleanText(value, 60);
    if (!v) throw new Error('Enter a name');
    if (list.some((x) => x.toLowerCase() === v.toLowerCase())) return list.slice();
    return list.concat([v]).sort((a, b) => a.localeCompare(b));
  }
  function removeListItem(list, value) { return list.filter((x) => x !== value); }

  // --- three-way merge: base = last synced copy, mine = this device, theirs = what's in Drive now ---
  function mergeKeyed(base, mine, theirs, key, label, conflicts) {
    const b = new Map((base || []).map((x) => [key(x), x]));
    const m = new Map((mine || []).map((x) => [key(x), x]));
    const t = new Map((theirs || []).map((x) => [key(x), x]));
    const result = new Map();
    for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
      const vb = b.get(k), vm = m.get(k), vt = t.get(k);
      let v;
      if (same(vm, vb)) v = vt;
      else if (same(vt, vb)) v = vm;
      else if (same(vm, vt)) v = vm;
      else { v = vt; conflicts.push(label(vm || vt || vb)); }
      if (v !== undefined) result.set(k, v);
    }
    // order: keep whichever side reordered; otherwise theirs, with my new items at the end
    const order = (arr) => (arr || []).map(key);
    const mineReordered = !same(order(mine).filter((k) => b.has(k)), order(base).filter((k) => m.has(k)));
    const primary = mineReordered ? order(mine) : order(theirs);
    const secondary = mineReordered ? order(theirs) : order(mine);
    const keys = [...primary, ...secondary, ...order(base)].filter((k, i, a) => result.has(k) && a.indexOf(k) === i);
    return keys.map((k) => result.get(k));
  }

  function mergeSet(base, mine, theirs) {
    const b = new Set(base || []), m = new Set(mine || []), t = new Set(theirs || []);
    const all = new Set([...m, ...t]);
    return [...all].filter((x) => !((b.has(x) && !m.has(x)) || (b.has(x) && !t.has(x)))).sort((x, y) => x.localeCompare(y));
  }

  function mergeTeam(base, mine, theirs) {
    const B = normalizeTeamData(base || theirs);
    const M = normalizeTeamData(mine);
    const T = normalizeTeamData(theirs);
    const conflicts = [];
    const team = {};
    for (const f of ['name', 'season']) {
      if (same(M.team[f], B.team[f])) team[f] = T.team[f];
      else if (same(T.team[f], B.team[f]) || same(M.team[f], T.team[f])) team[f] = M.team[f];
      else { team[f] = T.team[f]; conflicts.push(f === 'name' ? 'team name' : 'season'); }
    }
    let league = T.league;
    if (same(M.league, B.league)) league = T.league;
    else if (same(T.league, B.league) || same(M.league, T.league)) league = M.league;
    else conflicts.push('league team');
    const merged = {
      team, league,
      coaches: mergeKeyed(B.coaches, M.coaches, T.coaches, (c) => c.email, (c) => 'coach ' + (c.name || c.email), conflicts),
      roster: mergeKeyed(B.roster, M.roster, T.roster, (p) => p.number, (p) => 'player #' + p.number, conflicts),
      categories: mergeKeyed(B.categories, M.categories, T.categories, (c) => c.id, (c) => 'category “' + c.name + '”', conflicts),
      opponents: mergeSet(B.opponents, M.opponents, T.opponents),
      rinks: mergeSet(B.rinks, M.rinks, T.rinks)
    };
    return { merged: normalizeTeamData(merged), conflicts };
  }

  /**
   * One sync decision. dirty = this device has changes not yet in Drive.
   * Returns the data to keep locally, whether it must be written to Drive, and any conflicts (theirs won those).
   */
  function syncStep(o) {
    const theirs = normalizeTeamData(o.theirs);
    if (!o.dirty) return { data: theirs, push: false, conflicts: [] };
    const mine = normalizeTeamData(o.mine);
    if (!o.base) return { data: mine, push: !same(mine, theirs), conflicts: [] };
    const { merged, conflicts } = mergeTeam(o.base, mine, theirs);
    return { data: merged, push: !same(merged, theirs), conflicts };
  }

  // ---------- clip library (milestone 3b) ----------
  const EVENTS = [
    { id: 'goal_for', label: 'Goal for', kind: 'good' },
    { id: 'goal_against', label: 'Goal against', kind: 'bad' },
    { id: 'shot_for', label: 'Shot for' },
    { id: 'shot_against', label: 'Shot against' },
    { id: 'save', label: 'Save' },
    { id: 'turnover', label: 'Turnover' },
    { id: 'takeaway', label: 'Takeaway' },
    { id: 'penalty_for', label: 'Penalty for' },
    { id: 'penalty_against', label: 'Penalty against' },
    { id: 'faceoff_won', label: 'Faceoff won' },
    { id: 'faceoff_lost', label: 'Faceoff lost' }
  ];
  const EVENT_IDS = EVENTS.map((e) => e.id);
  const GAME_TYPES = [['league', 'League'], ['tournament', 'Tournament'], ['exhibition', 'Exhibition'], ['playoff', 'Playoff']];
  const HOME_AWAY = [['home', 'Home'], ['away', 'Away']];
  const ZONES = [['off', 'Offensive'], ['neu', 'Neutral'], ['def', 'Defensive']];
  const SITUATIONS = [['even', 'Even strength'], ['pp', 'Power play'], ['pk', 'Penalty kill']];
  const label = (list, id) => { const x = list.find((p) => p[0] === id); return x ? x[1] : ''; };
  function eventLabel(id) { const e = EVENTS.find((x) => x.id === id); return e ? e.label : id; }

  // --- game marks: periods and goals ---
  function gameMarks(game) {
    const m = game.marks || {};
    return {
      periods: (m.periods || []).slice().sort((a, b) => a.start - b.start),
      goals: (m.goals || []).slice().sort((a, b) => a.t - b.t),
      penalties: (m.penalties || []).slice().sort((a, b) => a.t - b.t)
    };
  }

  // ---------- penalties (v1.4) ----------
  // A penalty: { id, t (when called, video seconds), end (when the player is back; null until marked),
  //   team: 'us' | 'them', player: jersey number or '', type, minutes: 2 | 4 | 5 | 10 }.
  // 'us' = one of our players went to the box (the clip event "Penalty against", we're on the penalty kill).
  const PENALTY_TYPES = [
    ['tripping', 'Tripping'], ['hooking', 'Hooking'], ['slashing', 'Slashing'], ['holding', 'Holding'],
    ['holding_stick', 'Holding the stick'], ['interference', 'Interference'], ['roughing', 'Roughing'],
    ['cross_checking', 'Cross-checking'], ['high_sticking', 'High-sticking'], ['body_checking', 'Body checking'],
    ['checking_behind', 'Checking from behind'], ['head_contact', 'Head contact'], ['elbowing', 'Elbowing'],
    ['kneeing', 'Kneeing'], ['boarding', 'Boarding'], ['charging', 'Charging'], ['spearing', 'Spearing'],
    ['delay_of_game', 'Delay of game'], ['too_many', 'Too many players'], ['unsportsmanlike', 'Unsportsmanlike conduct'],
    ['fighting', 'Fighting'], ['other', 'Other']
  ];
  const PENALTY_LENGTHS = [[2, 'Minor (2)'], [4, 'Double minor (4)'], [5, 'Major (5)'], [10, 'Misconduct (10)']];
  // Video runs longer than the game clock (whistles, faceoffs): until the end is marked, a penalty is
  // estimated to last its minutes times this many video minutes.
  const PENALTY_VIDEO_FACTOR = 1.6;

  function penaltyLabel(p) {
    const type = (PENALTY_TYPES.find((x) => x[0] === p.type) || [null, 'Penalty'])[1];
    const who = p.team === 'us' ? (p.player ? '#' + p.player : 'Us') : 'Them' + (p.player ? ' #' + p.player : '');
    return who + ' · ' + type + ' · ' + (p.minutes === 10 ? '10 misconduct' : p.minutes + ' min');
  }

  /** Mark a penalty called at t. */
  function addPenalty(game, t, fields) {
    const f = fields || {};
    const m = gameMarks(game);
    const minutes = PENALTY_LENGTHS.some((x) => x[0] === Number(f.minutes)) ? Number(f.minutes) : 2;
    const pen = {
      id: uid('pen'), t: round1(t), end: null, team: f.team === 'them' ? 'them' : 'us',
      player: String(f.player == null ? '' : f.player).replace(/[^0-9]/g, '').slice(0, 2),
      type: PENALTY_TYPES.some((x) => x[0] === f.type) ? f.type : 'other', minutes
    };
    m.penalties.push(pen);
    m.penalties.sort((a, b) => a.t - b.t);
    return { marks: m, penalty: pen };
  }

  /** The player is back: mark the end of a penalty at t. */
  function endPenalty(game, id, t) {
    const m = gameMarks(game);
    const p = m.penalties.find((x) => x.id === id);
    if (!p) throw new Error('That penalty is gone');
    if (t <= p.t) throw new Error('A penalty must end after it’s called');
    m.penalties = m.penalties.map((x) => (x.id === id ? Object.assign({}, x, { end: round1(t) }) : x));
    return m;
  }

  function removePenalty(game, id) { const m = gameMarks(game); m.penalties = m.penalties.filter((p) => p.id !== id); return m; }

  /**
   * When a penalty stops counting, and why: 'marked' (end key), 'goal' (a power-play goal ends a minor),
   * or 'estimate' (not marked yet). Misconducts never change the strength, so they're left out of strength.
   */
  function penaltyEnd(game, p) {
    if (p.end != null) return { t: p.end, why: 'marked' };
    const est = p.t + p.minutes * 60 * PENALTY_VIDEO_FACTOR;
    if (p.minutes === 2) {
      const ppSide = p.team === 'us' ? 'against' : 'for'; // the team on the power play scores
      const g = gameMarks(game).goals.find((x) => x.side === ppSide && x.t > p.t && x.t < est);
      if (g) return { t: g.t, why: 'goal' };
    }
    return { t: est, why: 'estimate' };
  }

  /** Penalties still running at t (not ended by a mark, a goal or the estimate). */
  function openPenalties(game, t) {
    return gameMarks(game).penalties.filter((p) => p.end == null && p.t <= t + 0.01 && penaltyEnd(game, p).t > t);
  }

  /** Skaters at t: { us: 5, them: 4, situation: 'pp' | 'pk' | 'even' } (never fewer than 3; misconducts don't count). */
  function strengthAt(game, t) {
    let us = 0, them = 0;
    for (const p of gameMarks(game).penalties) {
      if (p.minutes === 10) continue;
      if (t >= p.t && t < penaltyEnd(game, p).t) { if (p.team === 'us') us += 1; else them += 1; }
    }
    us = Math.min(us, 2); them = Math.min(them, 2);
    return { us: 5 - us, them: 5 - them, situation: us > them ? 'pk' : them > us ? 'pp' : 'even' };
  }

  /** Strength at t: 'pp' (we have more skaters), 'pk' (fewer) or 'even' (equal, incl. 4-on-4). */
  function situationAt(game, t) { return strengthAt(game, t).situation; }

  /**
   * Penalties called by t whose end hasn't been marked (and no power-play goal ended them), including ones
   * past their estimated end, so a forgotten end stays in view. Each with the estimate: { p, est, over, left }.
   */
  function unendedPenalties(game, t) {
    return gameMarks(game).penalties.filter((p) => p.end == null && p.t <= t + 0.01)
      .map((p) => ({ p, end: penaltyEnd(game, p) }))
      .filter((x) => x.end.why !== 'goal')
      .map((x) => ({ p: x.p, est: x.end.t, over: t >= x.end.t, left: Math.max(0, (x.end.t - t) / PENALTY_VIDEO_FACTOR) }));
  }

  /** Power play / penalty kill stretches for the timeline: [{ start, end, situation }]. */
  function strengthBands(game, total) {
    const pts = new Set([0, total]);
    for (const p of gameMarks(game).penalties) { if (p.minutes === 10) continue; pts.add(p.t); pts.add(Math.min(total, penaltyEnd(game, p).t)); }
    const xs = [...pts].filter((x) => x >= 0 && x <= total).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const sit = situationAt(game, (xs[i] + xs[i + 1]) / 2);
      if (sit === 'even') continue;
      const last = out[out.length - 1];
      if (last && last.situation === sit && Math.abs(last.end - xs[i]) < 0.01) last.end = xs[i + 1];
      else out.push({ start: xs[i], end: xs[i + 1], situation: sit });
    }
    return out;
  }

  /**
   * A clip's situation: what the coach picked, or (when the game has penalties marked and the coach hasn't
   * picked one) the strength in the middle of the clip.
   */
  function clipSituation(game, clip) {
    if (clip.situationSet || !gameMarks(game || {}).penalties.length) return clip.situation || 'even';
    return situationAt(game, (clip.start + clip.end) / 2);
  }

  /** Our players who took a penalty called inside [start, end] (added to new clips around the call). */
  function penaltyPlayers(game, start, end) {
    return [...new Set(gameMarks(game || {}).penalties.filter((p) => p.team === 'us' && p.player && p.t >= start - 0.01 && p.t <= end + 0.01).map((p) => p.player))];
  }

  /** P key: starts the next period, or ends the open one. Returns { marks, did: 'start'|'end', n }. */
  function togglePeriod(game, t) {
    const m = gameMarks(game);
    const open = m.periods.find((p) => p.end == null);
    if (open) {
      if (t <= open.start) throw new Error('A period must end after it starts');
      open.end = round1(t);
      return { marks: m, did: 'end', n: open.n };
    }
    const last = m.periods[m.periods.length - 1];
    if (last && t < last.end) throw new Error('That’s inside period ' + last.n + '. Delete its marks to redo them.');
    const n = m.periods.length + 1;
    m.periods.push({ n, start: round1(t), end: null });
    return { marks: m, did: 'start', n };
  }

  const jersey = (v) => String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 2);
  const jerseys = (list, max) => [...new Set((Array.isArray(list) ? list : []).map(jersey).filter(Boolean))].slice(0, max || 30);

  /**
   * Mark a goal. details (v1.8, all optional):
   *   ours ('for'):  scorer, assists [up to 2]
   *   theirs:        oppScorer, oppAssists [up to 2] (their numbers), onIce (our players on the ice)
   */
  function addGoal(game, t, side, details) {
    const m = gameMarks(game);
    const d = details || {};
    const g = { id: uid('goal'), t: round1(t), side: side === 'against' ? 'against' : 'for' };
    if (g.side === 'for') {
      g.scorer = jersey(d.scorer);
      g.assists = jerseys(d.assists).filter((x) => x !== g.scorer).slice(0, 2);
    } else {
      g.oppScorer = jersey(d.oppScorer);
      g.oppAssists = jerseys(d.oppAssists, 2);
      g.onIce = jerseys(d.onIce, 6);
    }
    m.goals.push(g);
    m.goals.sort((a, b) => a.t - b.t);
    return m;
  }

  /** Our players to tag on a goal's clip: scorer and assists for ours, the players on the ice for theirs. */
  function goalPlayers(g) {
    return g.side === 'for' ? [g.scorer].concat(g.assists || []).filter(Boolean) : (g.onIce || []).slice();
  }

  /** "Goal #7 (A: #12, #4)" / "Goal against #19 (A: #3)" — or plain "Goal for" without details. */
  function goalLabel(g) {
    const who = (s, a) => (s ? ' #' + s : '') + (a && a.length ? ' (A: ' + a.map((x) => '#' + x).join(', ') + ')' : s ? ' (unassisted)' : '');
    return g.side === 'for' ? 'Goal' + (g.scorer ? who(g.scorer, g.assists) : ' for') : 'Goal against' + who(g.oppScorer, g.oppAssists);
  }

  const GOAL_BEFORE = 10, GOAL_AFTER = 5;

  /** The clip window for a goal at t: 10 s before (the build-up) to 5 s after. */
  function goalWindow(t, total) {
    return { start: round1(Math.max(0, t - GOAL_BEFORE)), end: round1(Math.min(total, t + GOAL_AFTER)) };
  }

  /** The category goal clips go in: one named like "Goal", else "scoring"/"shots", else the first. */
  function goalCategory(categories) {
    const live = (categories || []).filter((c) => !c.hidden);
    return live.find((c) => /\bgoals?\b/i.test(c.name)) || live.find((c) => /scor|shot/i.test(c.name)) || live[0] || null;
  }

  function removeGoal(game, id) { const m = gameMarks(game); m.goals = m.goals.filter((g) => g.id !== id); return m; }
  function removePeriod(game, n) {
    const m = gameMarks(game);
    m.periods = m.periods.filter((p) => p.n !== n).map((p, i) => Object.assign({}, p, { n: i + 1 }));
    return m;
  }

  function periodName(n) { return n === 4 ? 'OT' : n > 4 ? 'OT' + (n - 3) : 'P' + n; }

  /** What the app works out on its own for a clip: period, time into it, score before the clip, goals inside it. */
  function clipAuto(game, clip) {
    const m = gameMarks(game || {});
    const per = m.periods.filter((p) => clip.start >= p.start - 0.01 && (p.end == null || clip.start <= p.end + 0.01)).pop() || null;
    let f = 0, a = 0;
    for (const g of m.goals) if (g.t < clip.start - 0.01) { if (g.side === 'for') f += 1; else a += 1; }
    const inside = m.goals.filter((g) => g.t >= clip.start - 0.01 && g.t <= clip.end + 0.01);
    const calls = m.penalties.filter((p) => p.t >= clip.start - 0.01 && p.t <= clip.end + 0.01);
    const events = [...new Set(inside.map((g) => (g.side === 'for' ? 'goal_for' : 'goal_against'))
      .concat(calls.map((p) => (p.team === 'us' ? 'penalty_against' : 'penalty_for'))))];
    const state = !m.goals.length && !per ? null : f > a ? 'leading' : f < a ? 'trailing' : 'tied';
    return { period: per ? per.n : null, periodTime: per ? round1(clip.start - per.start) : null, score: { for: f, against: a }, state, events,
      penalties: [...new Set(calls.map((p) => p.type))] };
  }

  /** Events shown on the clip: the coach's own picks plus automatic goal events (unless the coach removed them). */
  function clipEvents(game, clip) {
    const hidden = clip.hiddenAuto || [];
    const auto = clipAuto(game, clip).events.filter((e) => !hidden.includes(e));
    return EVENT_IDS.filter((e) => (clip.events || []).includes(e) || auto.includes(e));
  }

  function toggleEvent(game, clip, ev) {
    if (!EVENT_IDS.includes(ev)) throw new Error('Unknown event');
    const auto = clipAuto(game, clip).events;
    const events = (clip.events || []).slice();
    const hiddenAuto = (clip.hiddenAuto || []).slice();
    const showing = clipEvents(game, clip).includes(ev);
    if (showing) {
      const i = events.indexOf(ev); if (i >= 0) events.splice(i, 1);
      if (auto.includes(ev) && !hiddenAuto.includes(ev)) hiddenAuto.push(ev);
    } else {
      const h = hiddenAuto.indexOf(ev);
      if (h >= 0 && auto.includes(ev)) hiddenAuto.splice(h, 1); else events.push(ev);
    }
    return { events, hiddenAuto };
  }

  function normalizeTags(list) {
    return [...new Set((list || []).map((x) => cleanText(x, 40)).filter(Boolean))].slice(0, 20);
  }

  function clipFeatures(clip) {
    return {
      drawing: !!(clip.freeze && clip.freeze.shapes && clip.freeze.shapes.length) || !!(clip.rec && clip.rec.shapes && clip.rec.shapes.length),
      slow: !!(clip.speeds && clip.speeds.length) || !!(clip.rec && clip.rec.rate < 1 && clip.rec.voice),
      zoom: !!clip.zoom || !!(clip.rec && (clip.rec.zoomKeys || []).some((k) => k[1] > 1.01)),
      voice: !!(clip.rec && clip.rec.voice)
    };
  }

  /** Flat, searchable record of a clip for the shared (or private) library. */
  function libraryEntry(game, clip, categories, coach, roster) {
    const entry = libraryEntryFields(game, clip, categories, coach, roster);
    if (clip.situationSet) entry.situationSet = true; // only when the coach picked one, so older entries don't churn
    return entry;
  }

  function libraryEntryFields(game, clip, categories, coach, roster) {
    const cat = clipCategoryLabel(clip, categories);
    const auto = clipAuto(game, clip);
    return {
      id: clip.id,
      gameId: game.id,
      game: { date: game.date || '', opponent: game.opponent || '', rink: game.rink || '', type: game.gameType || '', homeAway: game.homeAway || '', result: game.result || '', title: gameTitle(game) },
      categoryId: clip.categoryId,
      alsoCats: clipCategoryIds(clip).slice(1),
      category: cat ? cat.name : '',
      color: cat ? cat.color : '#64748B',
      events: clipEvents(game, clip),
      players: (clip.players || []).slice(),
      positions: clipPositionGroups(game, clip, roster),
      flag: clip.flag || 'do',
      note: clip.note || '',
      zone: clip.zone || '',
      situation: clipSituation(game, clip),
      penalties: auto.penalties,
      starred: !!clip.starred,
      tags: normalizeTags(clip.tags),
      private: !!clip.private,
      start: clip.start,
      end: clip.end,
      period: auto.period,
      periodTime: auto.periodTime,
      score: auto.score,
      state: auto.state,
      features: clipFeatures(clip),
      drive: (clip.drive || []).map((d) => ({ folder: d.folder, fileId: d.fileId, name: d.name })),
      by: clip.by || coach || '',
      owner: coach || clip.by || '',
      createdAt: clip.createdAt || 0
    };
  }

  /** Tag fields another coach may edit from the Review screen; copied back into the owner's clip on sync. */
  const SHARED_TAG_FIELDS = ['categoryId', 'alsoCats', 'events', 'players', 'flag', 'note', 'zone', 'situation', 'situationSet', 'starred', 'tags'];

  function emptyFilters() {
    return { q: '', categories: [], penalties: [], events: [], players: [], positions: [], periods: [], flags: [], gameIds: [], gameType: '', homeAway: '', zone: '', situation: '', state: '', tags: [], inDrive: false };
  }

  function normalizeFilters(f) {
    const e = emptyFilters();
    const src = f || {};
    const out = {};
    for (const k of Object.keys(e)) out[k] = Array.isArray(e[k]) ? (Array.isArray(src[k]) ? src[k].map(String) : []) : (k === 'inDrive' ? !!src[k] : cleanText(src[k], 60));
    return out;
  }

  function filterCount(f) {
    const n = normalizeFilters(f);
    let c = n.q ? 1 : 0;
    for (const k of Object.keys(n)) if (Array.isArray(n[k]) && n[k].length) c += 1;
    for (const k of ['gameType', 'homeAway', 'zone', 'situation', 'state']) if (n[k]) c += 1;
    if (n.inDrive) c += 1;
    return c;
  }

  /** AND between filter groups, OR inside a group. */
  function entryMatches(entry, filters) {
    const f = normalizeFilters(filters);
    const any = (want, have) => !want.length || want.some((w) => have.includes(w));
    if (!any(f.categories, clipCategoryIds(entry))) return false;
    if (!any(f.events, entry.events || [])) return false;
    if (!any(f.penalties, entry.penalties || [])) return false;
    if (!any(f.players, entry.players || [])) return false;
    if (!any(f.positions, entry.positions || [])) return false;
    if (!any(f.periods, entry.period != null ? [String(entry.period)] : [])) return false;
    const flags = [entry.flag, entry.starred ? 'starred' : null].filter(Boolean);
    if (!any(f.flags, flags)) return false;
    if (!any(f.gameIds, [entry.gameId])) return false;
    if (!any(f.tags, entry.tags || [])) return false;
    if (f.gameType && entry.game.type !== f.gameType) return false;
    if (f.homeAway && entry.game.homeAway !== f.homeAway) return false;
    if (f.zone && entry.zone !== f.zone) return false;
    if (f.situation && entry.situation !== f.situation) return false;
    if (f.state && entry.state !== f.state) return false;
    if (f.inDrive && !(entry.drive || []).length) return false;
    if (f.q) {
      const hay = [entry.note, entry.category, entry.game.title, entry.game.opponent, entry.game.rink, entry.by,
        ...(entry.tags || []), ...(entry.events || []).map(eventLabel), ...(entry.players || []).map((p) => '#' + p),
        ...(entry.penalties || []).map((id) => (PENALTY_TYPES.find((x) => x[0] === id) || [id, id])[1])].join(' ').toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function sortEntries(list, how) {
    const key = (e) => (e.game.date || '') + String(e.start).padStart(8, '0');
    const out = list.slice().sort((a, b) => key(a).localeCompare(key(b)) || a.start - b.start);
    return how === 'newest' ? out.reverse() : out;
  }

  /** Words describing a filter set, used as a default saved-view name. */
  function describeFilters(f, categories) {
    const n = normalizeFilters(f);
    const bits = [];
    if (n.categories.length) bits.push(n.categories.map((id) => ((categories || []).find((c) => c.id === id) || {}).name || 'category').join(' or '));
    if (n.events.length) bits.push(n.events.map(eventLabel).join(' or '));
    if (n.penalties.length) bits.push(n.penalties.map((id) => (PENALTY_TYPES.find((x) => x[0] === id) || [id, id])[1]).join(' or ') + ' penalties');
    if (n.positions.length) bits.push(n.positions.map((g) => (POSITION_GROUPS.find((x) => x[0] === g) || [g, g])[1]).join(' or '));
    if (n.players.length) bits.push(n.players.map((p) => '#' + p).join(' '));
    if (n.periods.length) bits.push(n.periods.map((p) => periodName(Number(p))).join('/'));
    if (n.flags.length) bits.push(n.flags.map((x) => (x === 'do' ? 'Do this' : x === 'work' ? 'Work on this' : 'Starred')).join(' or '));
    if (n.tags.length) bits.push(n.tags.join(', '));
    if (n.q) bits.push('“' + n.q + '”');
    return bits.join(' · ') || 'All clips';
  }

  function addView(views, name, filters) {
    const nm = cleanText(name, 60);
    if (!nm) throw new Error('Give the view a name');
    return (views || []).filter((v) => v.name.toLowerCase() !== nm.toLowerCase()).concat([{ id: uid('view'), name: nm, filters: normalizeFilters(filters) }]);
  }
  function removeView(views, id) { return (views || []).filter((v) => v.id !== id); }

  // --- library files in Drive (team: _App; private: the coach's own folder) ---
  function normalizeLibrary(d) {
    const src = d || {};
    const entries = {};
    for (const [k, v] of Object.entries(src.entries || {})) if (v && v.id === k && v.game) entries[k] = v;
    const views = (Array.isArray(src.views) ? src.views : []).filter((v) => v && v.id && v.name).map((v) => ({ id: v.id, name: v.name, filters: normalizeFilters(v.filters) }));
    const folders = {};
    for (const [k, v] of Object.entries(src.folders || {})) if (typeof v === 'string' && v) folders[k] = v;
    return { entries, views, folders };
  }

  function libraryFileText(lib, kind, by) {
    const L = normalizeLibrary(lib);
    return JSON.stringify({ app: 'bulldogs-watch-party', kind: kind === 'private' ? 'private-library' : 'library', schema: 1, updatedAt: new Date().toISOString(), updatedBy: by || '', entries: L.entries, views: L.views, folders: L.folders });
  }

  function parseLibraryFile(text, kind) {
    let d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('The clip library file is damaged'); }
    const want = kind === 'private' ? 'private-library' : 'library';
    if (!d || d.app !== 'bulldogs-watch-party' || d.kind !== want) throw new Error('That file isn’t a Watch Party ' + (kind === 'private' ? 'private ' : '') + 'clip library');
    return normalizeLibrary(d);
  }

  function mergeLibrary(base, mine, theirs) {
    const B = normalizeLibrary(base || theirs), M = normalizeLibrary(mine), T = normalizeLibrary(theirs);
    const conflicts = [];
    const lab = (e) => 'clip “' + (e.category || 'clip') + ' ' + formatTime(e.start) + ' ' + (e.game && e.game.title || '') + '”';
    const ents = mergeKeyed(Object.values(B.entries), Object.values(M.entries), Object.values(T.entries), (e) => e.id, lab, conflicts);
    const views = mergeKeyed(B.views, M.views, T.views, (v) => v.id, (v) => 'saved view “' + v.name + '”', conflicts);
    const entries = {};
    for (const e of ents) entries[e.id] = e;
    return { merged: { entries, views, folders: mergeFolders(B.folders, M.folders, T.folders) }, conflicts };
  }

  /** Folder ids: a folder this device changed (e.g. re-created after it was deleted in Drive) wins; otherwise theirs. */
  function mergeFolders(base, mine, theirs) {
    const out = Object.assign({}, theirs);
    for (const [k, v] of Object.entries(mine || {})) if (!(k in out) || (base || {})[k] !== v) out[k] = v;
    return out;
  }

  function syncLibraryStep(o) {
    const theirs = normalizeLibrary(o.theirs);
    if (!o.dirty) return { data: theirs, push: false, conflicts: [] };
    const mine = normalizeLibrary(o.mine);
    if (!o.base) {
      const merged = { entries: Object.assign({}, theirs.entries, mine.entries), views: dedupeBy(theirs.views.concat(mine.views), (v) => v.id), folders: Object.assign({}, mine.folders, theirs.folders) };
      return { data: merged, push: !same(merged, theirs), conflicts: [] };
    }
    const { merged, conflicts } = mergeLibrary(o.base, mine, theirs);
    return { data: merged, push: !same(merged, theirs), conflicts };
  }

  /** Build this device's view of a library: entries from my local clips (fresh), plus everyone else's from the last sync. */
  function buildMyLibrary(cache, games, categories, coach, privateSide, deletedIds, roster) {
    const L = normalizeLibrary(cache);
    const mineIds = new Set();
    const entries = {};
    for (const g of games) for (const c of g.clips || []) {
      if (!!c.private !== !!privateSide) continue;
      mineIds.add(c.id);
      entries[c.id] = libraryEntry(g, c, categories, coach, roster);
    }
    const localIds = new Set();
    for (const g of games) for (const c of g.clips || []) localIds.add(c.id);
    const gone = new Set(deletedIds || []);
    for (const [id, e] of Object.entries(L.entries)) {
      if (mineIds.has(id) || gone.has(id)) continue;
      if (localIds.has(id)) continue; // my clip that moved to the other library
      entries[id] = e;
    }
    return { entries, views: L.views, folders: L.folders };
  }

  /** Copy tag edits other coaches made (via Review) back into my local clip. */
  function applyEntryTags(clip, entry, base) {
    if (!entry) return clip;
    const out = Object.assign({}, clip);
    let changed = false;
    for (const k of SHARED_TAG_FIELDS) {
      if (k === 'events') continue;
      if (base && same(entry[k], base[k])) continue;
      if (!same(out[k], entry[k]) && entry[k] !== undefined) { out[k] = clone(entry[k]); changed = true; }
    }
    if (!base || !same(entry.events, base.events)) {
      // events in the library are the visible set; store them as the coach's picks
      if (!same(entry.events, out.events)) { out.events = (entry.events || []).filter((e) => EVENT_IDS.includes(e)); out.hiddenAuto = []; changed = true; }
    }
    return changed ? out : clip;
  }

  /** Drive folder names for clip destinations. */
  function playerLabel(dest, roster) {
    const m = /^player:(\d{1,2})$/.exec(dest || '');
    if (!m) return null;
    const p = (roster || []).find((x) => x.number === m[1]);
    return '#' + m[1] + (p && p.name ? ' ' + p.name : '');
  }

  /** Drive folder names. All sit side by side in the team folder, so a coach can connect them in one pick. */
  function folderName(dest, roster) {
    if (dest === 'team') return 'Team clips';
    if (dest === 'coaches') return 'Coaches only';
    if (dest === 'private') return 'My private clips';
    const who = playerLabel(dest, roster);
    if (who) return 'Family \u2013 ' + who;
    throw new Error('Unknown folder');
  }

  /** The Drive folders the admin account creates up front: Team, Coaches only and one per player. */
  function teamFolderKeys(roster) {
    return ['team', 'coaches'].concat((roster || []).map((p) => 'player:' + p.number));
  }

  function destLabel(dest, roster) {
    if (dest === 'team') return 'Team';
    if (dest === 'coaches') return 'Coaches';
    if (dest === 'private') return 'My private folder';
    return playerLabel(dest, roster) + ' family';
  }

  // ---------- games ----------

  // ---------- league schedule (the data Alliance Tracker publishes) ----------
  // teams.json: [{ id, name, divisionId, division, association, logo }]
  // clubs.json: club teams outside the Alliance (e.g. OWHA), same shape, divisionId like 'bghc-2066'
  // games/<divisionId>.json: [{ id, start, home, away, homeScore, awayScore, status, venue, code, liveBarn, type, gamesheet }]
  const DEFAULT_LEAGUE = { teamId: '2712:burlington-bulldogs-blue', name: 'Burlington Bulldogs Blue', divisionId: 2712, division: 'U10 BB', logo: 'logos/49dba036a6a8.png' };
  const LEAGUE_TYPES = { regular: 'league', league: 'league', playoff: 'playoff', playoffs: 'playoff', tournament: 'tournament', exhibition: 'exhibition' };

  /** A safe league logo path ("logos/abc.png") or ''. */
  /** A division id: an Alliance number (2712) or a club team id ('bghc-2066'). */
  function divisionKey(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const t = String(v == null ? '' : v).trim();
    if (/^\d{1,7}$/.test(t)) return Number(t);
    return /^[a-z0-9][a-z0-9-]{0,40}$/i.test(t) ? t : null;
  }
  function leagueLogo(v) { return typeof v === 'string' && /^logos\/[\w.-]+\.(png|jpe?g|svg|webp|gif)$/i.test(v) ? v : ''; }
  function httpsUrl(v) { return typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : ''; }

  /** The team's league setting. teamId '' means "not using the league schedule". */
  function normalizeLeague(l) {
    if (l === undefined || l === null || typeof l !== 'object') return Object.assign({}, DEFAULT_LEAGUE);
    if (!l.teamId) return { teamId: '', name: '', divisionId: null, division: '', logo: '' };
    return {
      teamId: cleanText(l.teamId, 120), name: cleanText(l.name, 80),
      divisionId: divisionKey(l.divisionId),
      division: cleanText(l.division, 40), logo: leagueLogo(l.logo)
    };
  }

  /** teams.json -> cleaned list, sorted by division then name. */
  function leagueTeams(data) {
    return (Array.isArray(data) ? data : [])
      .filter((t) => t && t.id && t.name && divisionKey(t.divisionId) != null)
      .map((t) => ({ teamId: String(t.id), name: cleanText(t.name, 80), divisionId: divisionKey(t.divisionId), league: cleanText(t.league || 'Alliance', 30), division: cleanText(t.division, 40), association: cleanText(t.association, 120), logo: leagueLogo(t.logo) }))
      .sort((a, b) => a.division.localeCompare(b.division, undefined, { numeric: true }) || a.name.localeCompare(b.name));
  }

  /**
   * The league team a Watch Party team most likely is, from its name, e.g. "Burlington Barracudas U13 B"
   * -> Burlington Barracudas · U13 B (OWHA). Needs the league team's whole name in ours; the division
   * ("U13 B", "U10 BB") breaks ties. Returns { team, sure } or null.
   */
  function guessLeagueTeam(teams, ourName) {
    const norm = (x) => ' ' + String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    const ours = norm(ourName);
    if (ours.trim().length < 3) return null;
    const scored = [];
    for (const t of teams || []) {
      if (!ours.includes(norm(t.name))) continue;
      const div = norm(String(t.division || '').replace(/\(.*\)/, ''));
      scored.push({ t, s: norm(t.name).length + (div.trim() && ours.includes(div) ? 100 : 0) });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.s - a.s);
    const best = scored[0];
    const tie = scored.length > 1 && scored[1].s === best.s;
    return tie ? null : { team: best.t, sure: best.s >= 100 };
  }

  /** "Mountainside (Mountainside)" -> "Mountainside"; other venues stay as they are. */
  function cleanVenue(v) {
    const t = cleanText(v, 80);
    const m = /^(.+?)\s*\((.+)\)$/.exec(t);
    return m && m[1].toLowerCase() === m[2].toLowerCase() ? m[1] : t;
  }

  function scoreResult(us, them) {
    if (!Number.isFinite(us) || !Number.isFinite(them)) return '';
    return (us > them ? 'W' : us < them ? 'L' : 'T') + ' ' + us + '–' + them;
  }

  function gamesheetUrl(gs) {
    return gs && Number.isFinite(Number(gs.season)) && Number.isFinite(Number(gs.game)) ? 'https://gamesheetstats.com/seasons/' + Number(gs.season) + '/games/' + Number(gs.game) : '';
  }

  /**
   * One team's schedule from a division's games file, from that team's side:
   * [{ id, date, time, opponent, homeAway, rink, result, gameType, final, code, liveBarn, gamesheet, opponentLogo }], oldest first.
   * teams (optional) supplies the opponent logos.
   */
  function teamSchedule(games, teamName, teams) {
    const logos = new Map((teams || []).map((t) => [t.name, t.logo]));
    const out = [];
    for (const g of Array.isArray(games) ? games : []) {
      if (!g || (g.home !== teamName && g.away !== teamName) || g.home === g.away) continue;
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(g.start || '');
      if (!m) continue;
      const home = g.home === teamName;
      const opponent = cleanText(home ? g.away : g.home, 80);
      const final = g.status === 'final';
      const us = Number(home ? g.homeScore : g.awayScore);
      const them = Number(home ? g.awayScore : g.homeScore);
      out.push({
        id: String(g.id), date: m[1], time: m[2] + ':' + m[3], opponent, homeAway: home ? 'home' : 'away',
        rink: cleanVenue(g.venue), result: final && g.homeScore != null && g.awayScore != null ? scoreResult(us, them) : '',
        gameType: LEAGUE_TYPES[String(g.type || '').toLowerCase()] || '', final, code: cleanText(g.code, 30),
        liveBarn: httpsUrl(g.liveBarn), gamesheet: gamesheetUrl(g.gamesheet), opponentLogo: logos.get(opponent) || ''
      });
    }
    return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }

  const RINK_FILLER = new Set(['arena', 'rink', 'centre', 'center', 'the', 'cc', 'sports', 'complex', 'community', 'recreation', 'rec', 'ice', 'pad', 'and', 'of', 'league', 'partner', 'games', 'only']);
  function rinkWords(s) { return new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !RINK_FILLER.has(w) && !/^\d+$/.test(w))); }
  function rinkOverlap(a, b) { const A = rinkWords(a); for (const w of rinkWords(b)) if (A.has(w)) return true; return false; }

  /**
   * The schedule game that a set of LiveBarn files belongs to, or null.
   * Same date; the recording starts from an hour before to two hours after the scheduled time
   * (or it is the team's only game that day). A rink name match breaks ties.
   */
  function matchScheduleGame(schedule, parts) {
    const ordered = orderParts((parts || []).map((p) => (typeof p === 'string' ? { name: p } : p)));
    const f = ordered.length ? parseLiveBarnName(ordered[0].name) : {};
    if (!f.date) return null;
    const sameDay = (schedule || []).filter((g) => g.date === f.date);
    if (!sameDay.length) return null;
    const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const fileMin = f.time ? mins(f.time) : null;
    const scored = sameDay.map((g) => {
      const diff = fileMin == null ? 0 : fileMin - mins(g.time);
      return { g, diff, near: diff >= -60 && diff <= 120, rink: rinkOverlap(g.rink, f.rink) };
    });
    const ok = scored.filter((x) => x.near);
    const pool = ok.length ? ok : (sameDay.length === 1 ? scored : []);
    if (!pool.length) return null;
    pool.sort((a, b) => (b.rink - a.rink) || (Math.abs(a.diff) - Math.abs(b.diff)));
    return pool[0].g;
  }

  /** What a schedule game fills in on a game (every field stays editable). */
  function scheduleFields(s) {
    return { date: s.date, time: s.time, opponent: s.opponent, rink: s.rink, result: s.result, gameType: s.gameType, homeAway: s.homeAway };
  }

  /** The league details kept on a game. */
  function leagueLink(s) {
    if (!s || !s.id) return null;
    return { id: String(s.id), code: cleanText(s.code, 30), date: s.date, time: s.time, opponent: cleanText(s.opponent, 80), rink: cleanText(s.rink, 80),
      liveBarn: httpsUrl(s.liveBarn), gamesheet: httpsUrl(s.gamesheet), opponentLogo: leagueLogo(s.opponentLogo) };
  }

  /** Link an existing game to a schedule game: details come from the schedule; a result already entered is kept. */
  function linkGame(game, s) {
    const f = scheduleFields(s);
    return Object.assign({}, game, f, { result: game.result || f.result, league: leagueLink(s) });
  }

  /** "15:15" -> "3:15 PM" */
  function formatClock(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    if (!m) return '';
    const h = Number(m[1]);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function newGame(fields) {
    const parts = orderParts(fields.parts || []).map((p) => ({
      name: p.name, size: p.size, duration: p.duration, lastModified: p.lastModified || null
    }));
    if (!parts.length) throw new Error('Add at least one video file');
    if (parts.some((p) => !(p.duration > 0))) throw new Error('Could not read the length of one of the videos');
    const guess = guessGameDetails(parts);
    return {
      id: uid('game'),
      date: fields.date || guess.date || '',
      time: /^\d{2}:\d{2}$/.test(fields.time || '') ? fields.time : '',
      opponent: String(fields.opponent || '').trim(),
      rink: String(fields.rink || guess.rink || '').trim(),
      result: String(fields.result || '').trim(),
      gameType: GAME_TYPES.some((x) => x[0] === fields.gameType) ? fields.gameType : '',
      homeAway: HOME_AWAY.some((x) => x[0] === fields.homeAway) ? fields.homeAway : '',
      marks: { periods: [], goals: [] },
      league: leagueLink(fields.league),
      parts,
      clips: [],
      createdAt: fields.now || Date.now()
    };
  }

  /** Drive folder for one game's clips, e.g. "2026-10-18 vs Burlington Raiders" (sorts by date). */
  function gameFolderName(game) {
    const opp = cleanText(game.opponent, 60).replace(/[\\/:*?"<>|]+/g, '-');
    return [(game.date || 'Undated'), opp ? 'vs ' + opp : (game.time ? formatClock(game.time) : 'Game')].join(' ');
  }

  function gameTitle(game) {
    const d = game.date ? formatDate(game.date) : 'Undated game';
    return game.opponent ? d + ' vs ' + game.opponent : d;
  }

  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  function gameTimeline(game) {
    return buildTimeline(game.parts.map((p) => p.duration));
  }

  /** Match newly picked files to a saved game's parts by name and size. */
  function matchFiles(parts, files) {
    const result = [];
    const missing = [];
    for (const p of parts) {
      const f = files.find((x) => x.name === p.name && (p.size == null || x.size === p.size));
      if (f) result.push(f); else missing.push(p.name);
    }
    return { files: missing.length ? null : result, missing };
  }

  // ---------- state + persistence ----------
  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      settings: { coachName: '', team: Object.assign({}, DEFAULT_TEAM), league: Object.assign({}, DEFAULT_LEAGUE), coaches: [], categories: defaultCategories(), roster: [], opponents: [], rinks: [] },
      games: [],
      sync: null,
      lib: { team: { entries: {}, views: [] }, priv: { entries: {}, views: [] }, teamSync: null, privSync: null, deleted: [], scope: 'team' }
    };
  }

  function migrate(state) {
    const base = defaultState();
    if (!state || typeof state !== 'object') return base;
    const s = Object.assign({}, base, state);
    s.settings = Object.assign({}, base.settings, state.settings || {});
    if (!Array.isArray(s.settings.categories) || !s.settings.categories.length) s.settings.categories = defaultCategories();
    s.settings.categories = s.settings.categories.map((c) => Object.assign({ before: DEFAULT_BEFORE, after: DEFAULT_AFTER, hidden: false }, c));
    if (!Array.isArray(s.settings.roster)) s.settings.roster = [];
    s.settings.roster = s.settings.roster.map(normalizePlayer);
    if (!s.settings.team || typeof s.settings.team !== 'object') s.settings.team = Object.assign({}, DEFAULT_TEAM);
    for (const k of ['coaches', 'opponents', 'rinks']) if (!Array.isArray(s.settings[k])) s.settings[k] = [];
    s.settings.league = normalizeLeague(s.settings.league);
    if (!Array.isArray(s.games)) s.games = [];
    if (!s.sync || typeof s.sync !== 'object') s.sync = null;
    const L = Object.assign({}, base.lib, s.lib || {});
    L.team = normalizeLibrary(L.team); L.priv = normalizeLibrary(L.priv);
    if (!Array.isArray(L.deleted)) L.deleted = [];
    if (!['team', 'private', 'both'].includes(L.scope)) L.scope = 'team';
    s.lib = L;
    for (const g of s.games) {
      if (!g.marks) g.marks = { periods: [], goals: [] };
      for (const c of g.clips || []) {
        if (!Array.isArray(c.events)) c.events = [];
        if (!Array.isArray(c.hiddenAuto)) c.hiddenAuto = [];
        if (!Array.isArray(c.tags)) c.tags = [];
        if (!Array.isArray(c.drive)) c.drive = [];
        if (c.situation == null) c.situation = 'even';
        if (c.zone == null) c.zone = '';
      }
    }
    s.version = SCHEMA_VERSION;
    return s;
  }

  /** Keyboard shortcuts, shown by the ? key and on the printable shortcuts page. */
  const SHORTCUTS = [
    { title: 'Watch and tag (game screen)', keys: [
      ['Space or K', 'Play / pause'],
      ['\u2190 / \u2192', 'Back / forward 5 seconds'],
      ['Shift + \u2190 / \u2192', 'Back / forward 1 second'],
      ['1 \u2013 9', 'Tag a clip with that category'],
      ['I', 'Mark the start of a play'],
      ['O', 'Mark the end, then press 1\u20139 for the category'],
      ['Esc', 'Cancel the start/end marks'],
      ['P', 'Period start / period end'],
      ['G', 'Goal for (we score)'],
      ['H', 'Goal against'],
      ['X', 'Penalty: call one, or mark a player back'],
      ['T', 'New clip with a custom tag you type'],
      ['+ / \u2212', 'Zoom in / out'],
      ['0', 'Back to the whole rink'],
      ['Scroll \u00b7 drag \u00b7 double-click', 'Zoom \u00b7 move \u00b7 zoom in or back out']
    ] },
    { title: 'Clip editor', keys: [
      ['Space', 'Preview the finished clip / stop'],
      ['\u2190 / \u2192', 'Back / forward 1 second'],
      [', / .', 'Back / forward one frame'],
      ['Ctrl + Z', 'Undo the last drawing'],
      ['Esc', 'Done drawing']
    ] },
    { title: 'While recording a breakdown', keys: [
      ['Space or Esc', 'Stop recording'],
      ['D', 'Switch between moving the picture and drawing'],
      ['C', 'Clear the drawings'],
      ['+ / \u2212 / 0', 'Zoom in / out / whole rink']
    ] },
    { title: 'Anywhere', keys: [
      ['?', 'Show these shortcuts']
    ] }
  ];

  /** Compare 'a.b.c' version strings: >0 when a is newer. */
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // ---------- saving in pieces (IndexedDB records) ----------
  // The state is saved as small records so an edit only rewrites what changed:
  // 'meta' (settings, sync, small library bits), one record per library part, one per game.
  const LIB_PARTS = ['team', 'priv', 'teamSync', 'privSync'];

  /** All records for a state: [{ key, value, track }]. track=false means "always write" (small). */
  function stateRecords(state) {
    const out = [{ key: 'meta', track: false, value: {
      version: state.version, settings: state.settings, sync: state.sync,
      lib: { deleted: state.lib.deleted, scope: state.lib.scope }, gameIds: state.games.map((g) => g.id)
    } }];
    for (const p of LIB_PARTS) out.push({ key: 'lib:' + p, track: true, value: state.lib[p] || null });
    for (const g of state.games) out.push({ key: 'game:' + g.id, track: true, value: g });
    return out;
  }

  /** A cheap fingerprint of an object: its identity, plus each property's identity/value and array lengths.
      It notices reassigned properties and pushed arrays; deep in-place edits must be flagged by the caller. */
  function recordSig(o) {
    if (!o || typeof o !== 'object') return [o];
    const out = [o];
    for (const k of Object.keys(o)) {
      const v = o[k];
      out.push(k, v);
      if (Array.isArray(v)) out.push(v.length);
      else if (v && typeof v === 'object') out.push(Object.keys(v).length);
    }
    return out;
  }
  function sameSig(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Rebuild the state from records (a Map or object of key -> value). */
  function stateFromRecords(recs) {
    const get = (k) => (recs instanceof Map ? recs.get(k) : recs[k]);
    const meta = get('meta');
    if (!meta) return null;
    const lib = Object.assign({}, meta.lib || {});
    for (const p of LIB_PARTS) lib[p] = get('lib:' + p) || null;
    if (!lib.team) delete lib.team;
    if (!lib.priv) delete lib.priv;
    const games = (meta.gameIds || []).map((id) => get('game:' + id)).filter(Boolean);
    return migrate({ version: meta.version, settings: meta.settings, sync: meta.sync, lib, games });
  }

  function createStore(storage, key) {
    const k = key || 'bulldogs-watch-party:v1';
    return {
      load() {
        try { return migrate(JSON.parse(storage.getItem(k))); } catch (e) { return defaultState(); }
      },
      save(state) {
        storage.setItem(k, JSON.stringify(state));
      }
    };
  }

  /** Backup file for one game (clips + the categories/roster they reference). */
  function exportBackup(state, gameId) {
    const games = gameId ? state.games.filter((g) => g.id === gameId) : state.games;
    return JSON.stringify({ app: 'bulldogs-watch-party', version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: state.settings, games }, null, 2);
  }

  /** Merge a backup into state. Games with the same id are replaced; unknown categories are added. */
  function importBackup(state, text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('That file is not a Watch Party backup'); }
    if (!data || data.app !== 'bulldogs-watch-party' || !Array.isArray(data.games)) throw new Error('That file is not a Watch Party backup');
    const next = migrate(JSON.parse(JSON.stringify(state)));
    const cats = next.settings.categories;
    for (const c of (data.settings && data.settings.categories) || []) {
      if (!cats.some((x) => x.id === c.id)) cats.push(Object.assign({ before: DEFAULT_BEFORE, after: DEFAULT_AFTER, hidden: false }, c));
    }
    for (const p of (data.settings && data.settings.roster) || []) {
      if (!next.settings.roster.some((r) => r.number === p.number)) next.settings.roster.push(p);
    }
    let added = 0;
    for (const g of data.games) {
      if (!g || !g.id || !Array.isArray(g.parts)) continue;
      next.games = next.games.filter((x) => x.id !== g.id).concat([g]);
      added += 1;
    }
    return { state: next, count: added };
  }

  // ---------- game summaries and season stats (v2.0) ----------

  /** "Bulldogs U10 Blue" -> "Bulldogs", "Burlington Raiders" -> "Raiders": the name to show on a scoreboard. */
  function shortTeamName(name) {
    const words = String(name || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const cut = words.findIndex((w) => /^(U\d{1,2}|\d{1,2}U|AAA|AA|A|BB|B|C|CC|DD|MD|HL|LL|Jr\.?|Sr\.?)$/i.test(w));
    const keep = cut > 0 ? words.slice(0, cut) : cut === 0 ? words.slice(1) : words;
    return keep.length ? keep[keep.length - 1] : '';
  }

  /** "W 2–1" / "L 1-3" / "2-2" -> { for, against } (null when there's no score in the text). */
  function parseResult(text) {
    const m = /(\d{1,2})\s*[–\-:]\s*(\d{1,2})/.exec(String(text || ''));
    return m ? { for: Number(m[1]), against: Number(m[2]) } : null;
  }

  /** The period a moment of video falls in (its number), or null between periods / before any are marked. */
  function periodAt(game, t) {
    const p = gameMarks(game).periods.filter((x) => t >= x.start - 0.01 && (x.end == null || t <= x.end + 0.01)).pop();
    return p ? p.n : null;
  }

  function periodLabel(n) { return n == null ? '' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n === 4 ? 'OT' : 'OT' + (n - 3); }

  /** What the penalty led to: 'pp-goal' / 'no-goal' (theirs) or 'pk-goal' / 'killed' (ours); '' for a misconduct. */
  function penaltyOutcome(game, p) {
    if (p.minutes === 10) return '';
    const end = penaltyEnd(game, p).t;
    const side = p.team === 'us' ? 'against' : 'for';
    const scored = gameMarks(game).goals.some((g) => g.side === side && g.t > p.t && g.t <= end + 0.01);
    return p.team === 'us' ? (scored ? 'pk-goal' : 'killed') : (scored ? 'pp-goal' : 'no-goal');
  }
  const OUTCOME_LABELS = { 'pp-goal': 'Power-play goal', 'no-goal': 'No goal on the power play', 'pk-goal': 'Goal against on the kill', killed: 'Killed' };

  /**
   * A game's summary from the coach's marks: final score (marks first, then the result text), goals by
   * period, goals and penalties in order with their period, each player's points, and whether the marked
   * goals agree with the final score that was entered or came from the league.
   *   officialResult: the league schedule's result text, when known
   */
  function gameSummary(game, roster, officialResult) {
    const m = gameMarks(game);
    const goals = [];
    let f = 0, a = 0;
    for (const g of m.goals) {
      if (g.side === 'for') f += 1; else a += 1;
      const st = strengthAt(game, g.t - 0.05);
      const strength = g.side === 'for' ? (st.situation === 'pp' ? 'pp' : st.situation === 'pk' ? 'sh' : '') : (st.situation === 'pk' ? 'pp' : st.situation === 'pp' ? 'sh' : '');
      goals.push(Object.assign({}, g, { n: periodAt(game, g.t), score: { for: f, against: a }, strength }));
    }
    const penalties = m.penalties.map((p) => Object.assign({}, p, { n: periodAt(game, p.t), outcome: penaltyOutcome(game, p) }));
    const typed = parseResult(game.result) || parseResult(officialResult);
    const marked = m.goals.length > 0;
    const score = marked ? { for: f, against: a } : typed;
    const source = marked ? 'marks' : typed ? 'result' : 'none';
    const mismatch = !!(marked && typed && (typed.for !== f || typed.against !== a));
    const outcome = score ? (score.for > score.against ? 'W' : score.for < score.against ? 'L' : 'T') : '';
    // goals per period (plus any outside a marked period)
    const nums = [...new Set(m.periods.map((p) => p.n).concat([1, 2, 3]))].sort((x, y) => x - y);
    const byPeriod = nums.map((n) => ({ n, for: goals.filter((g) => g.n === n && g.side === 'for').length, against: goals.filter((g) => g.n === n && g.side === 'against').length }));
    const loose = goals.filter((g) => g.n == null);
    if (loose.length) byPeriod.push({ n: null, for: loose.filter((g) => g.side === 'for').length, against: loose.filter((g) => g.side === 'against').length });
    // points this game
    const pts = {};
    const P = (n) => (pts[n] = pts[n] || { number: n, g: 0, a: 0, pim: 0, ppg: 0, shg: 0 });
    for (const g of goals) {
      if (g.side !== 'for') continue;
      if (g.scorer) { P(g.scorer).g += 1; if (g.strength === 'pp') P(g.scorer).ppg += 1; if (g.strength === 'sh') P(g.scorer).shg += 1; }
      for (const x of g.assists || []) P(x).a += 1;
    }
    for (const p of m.penalties) if (p.team === 'us' && p.player) P(p.player).pim += p.minutes;
    const names = new Map((roster || []).map((r) => [r.number, r.name]));
    const points = Object.values(pts).map((x) => Object.assign(x, { name: names.get(x.number) || '', pts: x.g + x.a }))
      .sort((x, y) => y.pts - x.pts || y.g - x.g || Number(x.number) - Number(y.number));
    const goalies = gameLineup(game, roster).filter((r) => !r.away && r.pos === 'G').map((r) => r.number);
    return { score, source, mismatch, typed, outcome, goals, penalties, byPeriod, points, goalies,
      pim: { us: m.penalties.filter((p) => p.team === 'us').reduce((s, p) => s + p.minutes, 0), them: m.penalties.filter((p) => p.team === 'them').reduce((s, p) => s + p.minutes, 0) },
      marked, periodsMarked: m.periods.length };
  }

  /** "W 2–1" from a summary ('' when there's no score). */
  function summaryResult(sum) { return sum && sum.score ? sum.outcome + ' ' + sum.score.for + '–' + sum.score.against : ''; }

  /**
   * Season numbers across games: record, goals for/against, PIM, and each player's GP, G, A, PTS, PIM,
   * PP goals and clips. gameType '' = every game. official(game) gives the league result text, when known.
   */
  function seasonStats(games, roster, gameType, official) {
    const list = (games || []).filter((g) => !gameType || g.gameType === gameType);
    const rec = { w: 0, l: 0, t: 0, gf: 0, ga: 0, pim: 0, games: 0 };
    const players = new Map();
    const row = (n) => {
      if (!players.has(n)) players.set(n, { number: n, name: '', gp: 0, g: 0, a: 0, pts: 0, pim: 0, ppg: 0, clips: 0, goalie: false, gGp: 0, ga: 0, gw: 0, gl: 0, gt: 0 });
      return players.get(n);
    };
    for (const r of roster || []) { const x = row(r.number); x.name = r.name || ''; }
    for (const game of list) {
      const sum = gameSummary(game, roster, official ? official(game) : '');
      if (sum.score) {
        rec.games += 1; rec.gf += sum.score.for; rec.ga += sum.score.against;
        if (sum.outcome === 'W') rec.w += 1; else if (sum.outcome === 'L') rec.l += 1; else rec.t += 1;
      }
      rec.pim += sum.pim.us;
      for (const n of playersForGame(game, roster)) row(n).gp += 1;
      for (const p of sum.points) { const x = row(p.number); x.g += p.g; x.a += p.a; x.pim += p.pim; x.ppg += p.ppg; }
      for (const c of game.clips || []) for (const n of c.players || []) row(n).clips += 1;
      if (sum.score && sum.goalies.length === 1) {
        const x = row(sum.goalies[0]);
        x.goalie = true; x.gGp += 1; x.ga += sum.score.against;
        if (sum.outcome === 'W') x.gw += 1; else if (sum.outcome === 'L') x.gl += 1; else x.gt += 1;
      }
    }
    const rows = [...players.values()].map((x) => Object.assign(x, { pts: x.g + x.a }))
      .filter((x) => x.gp || x.pts || x.pim || x.clips || x.goalie)
      .sort((x, y) => y.pts - x.pts || y.g - x.g || Number(x.number) - Number(y.number));
    return { record: rec, players: rows };
  }

  /** Change a goal's details (scorer/assists or their numbers/on ice). Returns new marks. */
  function updateGoal(game, id, details) {
    const m = gameMarks(game);
    const old = m.goals.find((g) => g.id === id);
    if (!old) throw new Error('That goal is gone');
    const fresh = addGoal({ marks: { goals: [], periods: [], penalties: [] } }, old.t, old.side, details).goals[0];
    const next = Object.assign({}, old, fresh, { id: old.id, t: old.t });
    if (next.side === 'for') { delete next.oppScorer; delete next.oppAssists; delete next.onIce; } else { delete next.scorer; delete next.assists; }
    m.goals = m.goals.map((g) => (g.id === id ? next : g));
    return m;
  }

  /** Coach's notes on a game summary: { wentWell, workOn } (plain text, capped). */
  function summaryNotes(game) {
    const n = (game && game.summaryNotes) || {};
    return { wentWell: String(n.wentWell || '').slice(0, 4000), workOn: String(n.workOn || '').slice(0, 4000) };
  }

  const WP = {
    APP_VERSION, APP_RELEASED, SCHEMA_VERSION, DEFAULT_BEFORE, DEFAULT_AFTER, MIN_CLIP, MAX_CLIP,
    uid, formatTime, parseTime, parseLiveBarnName, orderParts, guessGameDetails,
    buildTimeline, locate, toGlobal,
    defaultCategories, keyedCategories, categoryForKey, addCategory, updateCategory, moveCategory, removeCategory, categoryInUse,
    autoWindow, validateRange, makeClip, updateClip, normalizePlayers, sortClips,
    MAX_ZOOM, FIT, normalizeZoom, isZoomed, zoomAt, panZoom, zoomTransform, zoomSourceRect, viewToFrame, frameToView,
    RATES, MAX_SPEEDS, DEFAULT_HOLD, COLORS, validateSpeeds, addSpeed, updateSpeed, removeSpeed, fitEditsToRange,
    setFreeze, addShape, normalizeShape, buildPlan, planDuration, titleLines, exportFileName, exportSize,
    REC_FADE, hasRec, recExportRate, recOut, recIn, newRecording, addRecKey, recZoomAt, recShapesAt, addRecShape, addRecClear, recPlan, recSummary,
    addPlayer, removePlayer,
    newGame, gameTitle, formatDate, gameTimeline, matchFiles,
    POSITIONS, POSITION_IDS, POSITION_GROUPS, positionGroup, positionLabel, displayName, normalizePlayer, updatePlayer,
    normalizeLineup, gameLineup, playersForGame, setAway, setGamePos, addGuest, removeGuest, lastLineup, clipPositionGroups,
    defaultState, migrate, createStore, exportBackup, importBackup, SHORTCUTS, compareVersions, LIB_PARTS, stateRecords, recordSig, sameSig, stateFromRecords,
    TEAM_SECTIONS, DEFAULT_TEAM, teamSnapshot, normalizeTeamData, applyTeamData, teamFileText, parseTeamFile,
    addCoach, removeCoach, addListItem, removeListItem, mergeTeam, syncStep,
    EVENTS, EVENT_IDS, GAME_TYPES, HOME_AWAY, ZONES, SITUATIONS, label, eventLabel, gameMarks, togglePeriod, addGoal, removeGoal, removePeriod, periodName,
    clipAuto, clipEvents, toggleEvent, normalizeTags, clipFeatures, libraryEntry, SHARED_TAG_FIELDS, emptyFilters, normalizeFilters, filterCount, entryMatches,
    sortEntries, describeFilters, addView, removeView, normalizeLibrary, libraryFileText, parseLibraryFile, mergeLibrary, syncLibraryStep, buildMyLibrary,
    gameFolderName, goalPlayers, goalLabel, goalWindow, goalCategory, GOAL_BEFORE, GOAL_AFTER,
    PENALTY_TYPES, PENALTY_LENGTHS, PENALTY_VIDEO_FACTOR, penaltyLabel, addPenalty, endPenalty, removePenalty, penaltyEnd, openPenalties, unendedPenalties, strengthAt, situationAt, strengthBands, clipSituation, penaltyPlayers,
    clipCategoryIds, categoriesPatch, toggleClipCategory, clipCategoryLabel,
    applyEntryTags, folderName, teamFolderKeys, destLabel,
    DEFAULT_LEAGUE, divisionKey, normalizeLeague, guessLeagueTeam, leagueTeams, leagueLogo, cleanVenue, scoreResult, gamesheetUrl, teamSchedule, matchScheduleGame, scheduleFields, leagueLink, linkGame, formatClock,
    shortTeamName, parseResult, periodAt, periodLabel, penaltyOutcome, OUTCOME_LABELS, gameSummary, summaryResult, seasonStats, updateGoal, summaryNotes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WP;
  else root.WP = WP;
})(typeof window !== 'undefined' ? window : this);
