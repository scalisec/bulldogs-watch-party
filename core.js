/* Bulldogs Watch Party — core logic (no DOM). Works in the browser (window.WP) and in Node (require). */
(function (root) {
  'use strict';

  const APP_VERSION = '0.5.0';
  const APP_RELEASED = '2026-10-20';
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
    return games.some((g) => (g.clips || []).some((c) => c.categoryId === id));
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
      start: round1(fields.start),
      end: round1(fields.end),
      players: normalizePlayers(fields.players || []),
      flag: fields.flag === 'work' ? 'work' : 'do',
      note: String(fields.note || '').slice(0, 140),
      by: String(fields.by || '').slice(0, 40),
      method: ['tap', 'marks', 'manual'].includes(fields.method) ? fields.method : 'manual',
      zoom: isZoomed(fields.zoom) ? normalizeZoom(fields.zoom) : null,
      speeds: [],
      freeze: null,
      titleBar: true,
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
    const raw = [d, category ? category.name : 'Clip', t, who].filter(Boolean).join(' ');
    return raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) + '.mp4';
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
    if ('flag' in patch) next.flag = patch.flag === 'work' ? 'work' : 'do';
    if ('note' in patch) next.note = String(patch.note || '').slice(0, 140);
    if ('zoom' in patch) next.zoom = isZoomed(patch.zoom) ? normalizeZoom(patch.zoom) : null;
    if ('titleBar' in patch) next.titleBar = !!patch.titleBar;
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
  function addPlayer(roster, number, name) {
    const n = String(number).replace(/^#/, '').trim();
    if (!/^\d{1,2}$/.test(n)) throw new Error('Jersey number must be 0–99');
    if (roster.some((p) => p.number === n)) throw new Error('#' + n + ' is already on the roster');
    return roster.concat([{ number: n, name: String(name || '').trim().slice(0, 40) }]).sort((a, b) => Number(a.number) - Number(b.number));
  }

  function removePlayer(roster, number) {
    return roster.filter((p) => p.number !== String(number));
  }

  // ---------- shared team data (milestone 3a) ----------
  // Shared by all coaches through one file in Google Drive. Each coach's own name stays on their device.
  const TEAM_SECTIONS = ['team', 'coaches', 'roster', 'categories', 'opponents', 'rinks'];
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
      .map((p) => ({ number: String(p && p.number).replace(/^#/, ''), name: cleanText(p && p.name, 40) }))
      .filter((p) => /^\d{1,2}$/.test(p.number));
    const cats = Array.isArray(src.categories) && src.categories.length ? src.categories : defaultCategories();
    const categories = cats.filter((c) => c && c.id && c.name)
      .map((c) => Object.assign({ before: DEFAULT_BEFORE, after: DEFAULT_AFTER, hidden: false, color: '#475569' }, c));
    const list = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => cleanText(x, 60)).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    return {
      team: { name: cleanText(team.name, 60) || DEFAULT_TEAM.name, season: cleanText(team.season, 30) },
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
    const merged = {
      team,
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

  // ---------- games ----------
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
      opponent: String(fields.opponent || '').trim(),
      rink: String(fields.rink || guess.rink || '').trim(),
      result: String(fields.result || '').trim(),
      parts,
      clips: [],
      createdAt: fields.now || Date.now()
    };
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
      settings: { coachName: '', team: Object.assign({}, DEFAULT_TEAM), coaches: [], categories: defaultCategories(), roster: [], opponents: [], rinks: [] },
      games: [],
      sync: null
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
    if (!s.settings.team || typeof s.settings.team !== 'object') s.settings.team = Object.assign({}, DEFAULT_TEAM);
    for (const k of ['coaches', 'opponents', 'rinks']) if (!Array.isArray(s.settings[k])) s.settings[k] = [];
    if (!Array.isArray(s.games)) s.games = [];
    if (!s.sync || typeof s.sync !== 'object') s.sync = null;
    s.version = SCHEMA_VERSION;
    return s;
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
    defaultState, migrate, createStore, exportBackup, importBackup,
    TEAM_SECTIONS, DEFAULT_TEAM, teamSnapshot, normalizeTeamData, applyTeamData, teamFileText, parseTeamFile,
    addCoach, removeCoach, addListItem, removeListItem, mergeTeam, syncStep
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WP;
  else root.WP = WP;
})(typeof window !== 'undefined' ? window : this);
