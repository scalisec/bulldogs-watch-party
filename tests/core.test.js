const test = require('node:test');
const assert = require('node:assert/strict');
const WP = require('../core.js');

const REAL = '1__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T151933.mp4';

test('formatTime', () => {
  assert.equal(WP.formatTime(0), '0:00');
  assert.equal(WP.formatTime(75), '1:15');
  assert.equal(WP.formatTime(3725), '1:02:05');
  assert.equal(WP.formatTime(252.5, true), '4:12.5');
  assert.equal(WP.formatTime(-3), '0:00');
  assert.equal(WP.formatTime(NaN), '0:00');
  assert.equal(WP.formatTime(59.99, true), '0:59.9');
});

test('parseTime accepts common forms and rejects junk', () => {
  assert.equal(WP.parseTime('75'), 75);
  assert.equal(WP.parseTime('1:15'), 75);
  assert.equal(WP.parseTime(' 1:02:05 '), 3725);
  assert.equal(WP.parseTime('4:12.5'), 252.5);
  assert.ok(Number.isNaN(WP.parseTime('4:75')));
  assert.ok(Number.isNaN(WP.parseTime('abc')));
  assert.ok(Number.isNaN(WP.parseTime('')));
  assert.ok(Number.isNaN(WP.parseTime('-5')));
  assert.equal(WP.parseTime(WP.formatTime(3725)), 3725);
});

test('parseLiveBarnName reads the real download name', () => {
  const p = WP.parseLiveBarnName(REAL);
  assert.equal(p.index, 1);
  assert.equal(p.rink, 'Mountainside Arena Rink');
  assert.equal(p.label, 'LEAGUE PARTNER GAMES ONLY');
  assert.equal(p.date, '2026-10-18');
  assert.equal(p.time, '15:19:33');
  assert.ok(p.startMs > 0);
});

test('parseLiveBarnName tolerates other names', () => {
  const p = WP.parseLiveBarnName('my game.mp4');
  assert.equal(p.index, null);
  assert.equal(p.date, null);
  assert.equal(p.rink, 'my game');
  assert.equal(WP.parseLiveBarnName(undefined).rink, null);
});

test('orderParts sorts by LiveBarn start time, then index, then name', () => {
  const parts = [
    { name: '3__Rink__X__2026-10-18T160000.mp4' },
    { name: '1__Rink__X__2026-10-18T151933.mp4' },
    { name: '2__Rink__X__2026-10-18T153000.mp4' }
  ];
  assert.deepEqual(WP.orderParts(parts).map((p) => p.name[0]), ['1', '2', '3']);
  // a later download with a lower index still sorts by time
  const mixed = [{ name: '1__R__X__2026-10-18T160000.mp4' }, { name: '1__R__X__2026-10-18T150000.mp4' }];
  assert.equal(WP.orderParts(mixed)[0].name, '1__R__X__2026-10-18T150000.mp4');
  assert.deepEqual(WP.orderParts([{ name: 'part10.mp4' }, { name: 'part2.mp4' }]).map((p) => p.name), ['part2.mp4', 'part10.mp4']);
});

test('timeline maps global time to parts and back', () => {
  const tl = WP.buildTimeline([600, 600, 300]);
  assert.equal(tl.total, 1500);
  assert.deepEqual(WP.locate(tl, 0), { part: 0, local: 0 });
  assert.deepEqual(WP.locate(tl, 599.5), { part: 0, local: 599.5 });
  assert.deepEqual(WP.locate(tl, 600), { part: 1, local: 0 });
  assert.deepEqual(WP.locate(tl, 1300), { part: 2, local: 100 });
  assert.deepEqual(WP.locate(tl, 99999), { part: 2, local: 300 });
  assert.deepEqual(WP.locate(tl, -4), { part: 0, local: 0 });
  assert.equal(WP.toGlobal(tl, 1, 30), 630);
  assert.ok(Number.isNaN(WP.toGlobal(tl, 5, 0)));
});

test('autoWindow uses the category window and clamps to the game', () => {
  const cat = { before: 10, after: 5 };
  assert.deepEqual(WP.autoWindow(100, cat, 600), { start: 90, end: 105 });
  assert.deepEqual(WP.autoWindow(3, cat, 600), { start: 0, end: 8 });
  assert.deepEqual(WP.autoWindow(598, cat, 600), { start: 588, end: 600 });
  assert.deepEqual(WP.autoWindow(100, null, 600), { start: 92, end: 104 });
  // faceoff-style window: short before, long after
  assert.deepEqual(WP.autoWindow(50, { before: 2, after: 6 }, 600), { start: 48, end: 56 });
  // zero/zero still produces a minimum-length clip
  const z = WP.autoWindow(50, { before: 0, after: 0 }, 600);
  assert.equal(z.end - z.start, WP.MIN_CLIP);
});

test('validateRange catches bad clips', () => {
  assert.equal(WP.validateRange(10, 20, 600), null);
  assert.match(WP.validateRange(20, 10, 600), /at least/);
  assert.match(WP.validateRange(10, 10.5, 600), /at least/);
  assert.match(WP.validateRange(10, 700, 900), /at most/);
  assert.match(WP.validateRange(590, 610, 600), /after the game ends/);
  assert.match(WP.validateRange(NaN, 10, 600), /m:ss/);
});

test('makeClip and updateClip', () => {
  const c = WP.makeClip({ start: 90.04, end: 105, categoryId: 'cat_1', players: ['#7', '12', '7', 'x'], note: 'Nice', by: 'Cristian', method: 'tap', total: 600 });
  assert.equal(c.start, 90);
  assert.deepEqual(c.players, ['7', '12']);
  assert.equal(c.flag, 'do');
  assert.equal(c.method, 'tap');
  assert.throws(() => WP.makeClip({ start: 1, end: 5, total: 600 }), /category/);
  const u = WP.updateClip(c, { end: 110, flag: 'work', players: ['3'] }, 600);
  assert.equal(u.end, 110);
  assert.equal(u.flag, 'work');
  assert.deepEqual(u.players, ['3']);
  assert.throws(() => WP.updateClip(c, { end: 80 }, 600), /at least/);
  assert.equal(c.end, 105, 'original clip is not mutated');
});

test('sortClips orders by start', () => {
  const clips = [{ start: 50, end: 60, createdAt: 2 }, { start: 10, end: 20, createdAt: 1 }, { start: 50, end: 55, createdAt: 3 }];
  assert.deepEqual(WP.sortClips(clips).map((c) => c.end), [20, 55, 60]);
});

test('categories: keys skip hidden ones, max nine keys', () => {
  let cats = WP.defaultCategories();
  assert.equal(cats.length, 9);
  assert.ok(cats.every((c) => c.before === 8 && c.after === 4));
  cats = WP.updateCategory(cats, 'cat_2', { hidden: true });
  const keyed = WP.keyedCategories(cats);
  assert.equal(keyed.length, 8);
  assert.equal(keyed[1].name, 'Forecheck / puck pursuit');
  assert.equal(keyed[1].key, '2');
  cats = WP.updateCategory(cats, 'cat_2', { hidden: false });
  cats = WP.addCategory(cats, 'Power play', '#0891B2');
  const k2 = WP.keyedCategories(cats);
  assert.equal(k2.length, 10);
  assert.equal(k2[9].key, null);
  assert.equal(WP.categoryForKey(cats, '1').name, 'Breakouts');
  assert.equal(WP.categoryForKey(cats, '0'), null);
});

test('categories: add, rename, window, move, remove rules', () => {
  let cats = WP.defaultCategories();
  assert.throws(() => WP.addCategory(cats, '  '), /required/);
  assert.throws(() => WP.addCategory(cats, 'breakouts'), /already exists/);
  cats = WP.updateCategory(cats, 'cat_5', { name: 'Faceoff wins', before: 2, after: 6 });
  const f = cats.find((c) => c.id === 'cat_5');
  assert.equal(f.name, 'Faceoff wins');
  assert.equal(f.before, 2);
  assert.equal(f.after, 6);
  assert.equal(WP.updateCategory(cats, 'cat_1', { before: 500 }).find((c) => c.id === 'cat_1').before, 60);
  assert.equal(WP.updateCategory(cats, 'cat_1', { after: 'x' }).find((c) => c.id === 'cat_1').after, 4);
  assert.throws(() => WP.updateCategory(cats, 'cat_1', { name: 'Goalie' }), /already exists/);
  const moved = WP.moveCategory(cats, 'cat_1', 1);
  assert.equal(moved[1].id, 'cat_1');
  assert.equal(WP.moveCategory(cats, 'cat_1', -1)[0].id, 'cat_1');
  const games = [{ clips: [{ categoryId: 'cat_3' }] }];
  assert.throws(() => WP.removeCategory(cats, 'cat_3', games), /Hide it/);
  assert.equal(WP.removeCategory(cats, 'cat_4', games).length, 8);
});

test('roster', () => {
  let r = WP.addPlayer([], '12', 'Sam');
  r = WP.addPlayer(r, '#7', '');
  assert.deepEqual(r.map((p) => p.number), ['7', '12']);
  assert.throws(() => WP.addPlayer(r, '7'), /already/);
  assert.throws(() => WP.addPlayer(r, '123'), /0/);
  assert.deepEqual(WP.removePlayer(r, '7').map((p) => p.number), ['12']);
});

test('newGame orders parts and guesses date and rink from LiveBarn names', () => {
  const g = WP.newGame({
    opponent: ' Rangers ',
    parts: [
      { name: '2__Mountainside_Arena_Rink__L__2026-10-18T153000.mp4', size: 2, duration: 600 },
      { name: REAL, size: 1, duration: 623.36 }
    ]
  });
  assert.equal(g.parts[0].name, REAL);
  assert.equal(g.date, '2026-10-18');
  assert.equal(g.rink, 'Mountainside Arena Rink');
  assert.equal(g.opponent, 'Rangers');
  assert.equal(WP.gameTitle(g), 'Oct 18, 2026 vs Rangers');
  assert.ok(Math.abs(WP.gameTimeline(g).total - 1223.36) < 1e-9);
  assert.throws(() => WP.newGame({ parts: [] }), /at least one/);
  assert.throws(() => WP.newGame({ parts: [{ name: 'a.mp4', duration: 0 }] }), /length/);
});

test('matchFiles relinks by name and size', () => {
  const parts = [{ name: 'a.mp4', size: 10 }, { name: 'b.mp4', size: 20 }];
  const ok = WP.matchFiles(parts, [{ name: 'b.mp4', size: 20 }, { name: 'a.mp4', size: 10 }, { name: 'c.mp4', size: 1 }]);
  assert.deepEqual(ok.files.map((f) => f.name), ['a.mp4', 'b.mp4']);
  const bad = WP.matchFiles(parts, [{ name: 'a.mp4', size: 11 }]);
  assert.equal(bad.files, null);
  assert.deepEqual(bad.missing, ['a.mp4', 'b.mp4']);
});

test('store round-trips and survives corrupt data', () => {
  const mem = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const store = WP.createStore(mem);
  const s = store.load();
  assert.equal(s.games.length, 0);
  assert.equal(s.settings.categories.length, 9);
  s.settings.coachName = 'Cristian';
  store.save(s);
  assert.equal(store.load().settings.coachName, 'Cristian');
  mem.data['bulldogs-watch-party:v1'] = '{not json';
  assert.equal(store.load().settings.categories.length, 9);
});

test('migrate fills in missing category windows', () => {
  const s = WP.migrate({ settings: { categories: [{ id: 'x', name: 'Old', color: '#000' }] } });
  assert.equal(s.settings.categories[0].before, 8);
  assert.equal(s.settings.categories[0].hidden, false);
  assert.deepEqual(s.games, []);
});

test('backup export/import merges games and categories', () => {
  const a = WP.defaultState();
  a.settings.categories = WP.addCategory(a.settings.categories, 'Power play');
  const g = WP.newGame({ parts: [{ name: REAL, size: 1, duration: 600 }] });
  g.clips.push(WP.makeClip({ start: 1, end: 5, categoryId: a.settings.categories[9].id, total: 600 }));
  a.games.push(g);
  const text = WP.exportBackup(a, g.id);
  const b = WP.defaultState();
  const { state, count } = WP.importBackup(b, text);
  assert.equal(count, 1);
  assert.equal(state.games[0].clips.length, 1);
  assert.ok(state.settings.categories.some((c) => c.name === 'Power play'));
  // importing again replaces rather than duplicates
  assert.equal(WP.importBackup(state, text).state.games.length, 1);
  assert.throws(() => WP.importBackup(b, '{"app":"other"}'), /not a Watch Party backup/);
  assert.throws(() => WP.importBackup(b, 'nope'), /not a Watch Party backup/);
});

test('zoom: normalize keeps the view inside the frame', () => {
  assert.deepEqual(WP.normalizeZoom(null), { scale: 1, x: 0.5, y: 0.5 });
  assert.deepEqual(WP.normalizeZoom({ scale: 2, x: 0, y: 1 }), { scale: 2, x: 0.25, y: 0.75 });
  assert.equal(WP.normalizeZoom({ scale: 50 }).scale, WP.MAX_ZOOM);
  assert.equal(WP.normalizeZoom({ scale: 0.3 }).scale, 1);
  assert.ok(!WP.isZoomed(WP.FIT));
  assert.ok(WP.isZoomed({ scale: 1.5 }));
});

test('zoom: zoomAt keeps the point under the cursor fixed', () => {
  // zoom 2x on the right-hand quarter of the frame
  const z = WP.zoomAt(WP.FIT, 2, 0.75, 0.5);
  assert.equal(z.scale, 2);
  assert.equal(z.x, 0.625);
  // the frame point 0.75 is still at view position 0.75
  assert.ok(Math.abs(z.x + (0.75 - 0.5) / z.scale - 0.75) < 1e-9);
  // zooming back out returns to fit
  assert.deepEqual(WP.zoomAt(z, 0.5, 0.75, 0.5), { scale: 1, x: 0.5, y: 0.5 });
  // near an edge the view is clamped
  const e = WP.zoomAt(WP.FIT, 4, 1, 1);
  assert.equal(e.x, 0.875);
  assert.equal(e.y, 0.875);
});

test('zoom: pan moves the view and stops at the edges', () => {
  const z = { scale: 2, x: 0.5, y: 0.5 };
  assert.deepEqual(WP.panZoom(z, 0.2, 0), { scale: 2, x: 0.4, y: 0.5 });
  assert.deepEqual(WP.panZoom(z, -5, 5), { scale: 2, x: 0.75, y: 0.25 });
});

test('zoom: CSS transform centres the chosen point', () => {
  assert.equal(WP.zoomTransform(WP.FIT), '');
  // view centred on frame point (0.25, 0.5) at 2x: translate x = 0.5/2 - 0.25 = 0
  assert.equal(WP.zoomTransform({ scale: 2, x: 0.25, y: 0.5 }), 'scale(2) translate(0.000%, -25.000%)');
});

test('zoom: clips store a zoom only when zoomed in', () => {
  const a = WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 60, zoom: { scale: 2.5, x: 0.3, y: 0.6 } });
  assert.deepEqual(a.zoom, { scale: 2.5, x: 0.3, y: 0.6 });
  const b = WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 60, zoom: WP.FIT });
  assert.equal(b.zoom, null);
  assert.equal(WP.updateClip(a, { zoom: null }, 60).zoom, null);
  assert.equal(WP.updateClip(b, { zoom: { scale: 3, x: 0, y: 0 } }, 60).zoom.x, 0.1667);
});

// ---------- milestone 2a: edits and render plan ----------
const baseClip = () => WP.makeClip({ start: 10, end: 22, categoryId: 'cat_1', total: 600 });

test('plan: a plain clip is one play segment', () => {
  const plan = WP.buildPlan(baseClip());
  assert.deepEqual(plan, [{ kind: 'play', from: 10, to: 22, rate: 1, outStart: 0, outEnd: 12 }]);
  assert.equal(WP.planDuration(plan), 12);
  // clips saved before milestone 2 (no speeds/freeze fields) still plan fine
  const old = { start: 5, end: 8 };
  assert.equal(WP.planDuration(WP.buildPlan(old)), 3);
});

test('plan: slow motion and speed-up change the output length', () => {
  const c = baseClip();
  c.speeds = [{ id: 'a', start: 12, end: 14, rate: 0.5 }, { id: 'b', start: 18, end: 22, rate: 2 }];
  const plan = WP.buildPlan(c);
  assert.deepEqual(plan.map((s) => [s.from, s.to, s.rate]), [[10, 12, 1], [12, 14, 0.5], [14, 18, 1], [18, 22, 2]]);
  // 2 + 4 + 4 + 2 = 12
  assert.equal(WP.planDuration(plan), 12);
  assert.equal(plan[1].outStart, 2);
  assert.equal(plan[1].outEnd, 6);
});

test('plan: freeze holds the frame inside the timeline, even inside slow motion', () => {
  const c = baseClip();
  c.freeze = { at: 15, hold: 3, shapes: [] };
  let plan = WP.buildPlan(c);
  assert.deepEqual(plan.map((s) => s.kind), ['play', 'hold', 'play']);
  assert.equal(plan[1].at, 15);
  assert.equal(WP.planDuration(plan), 15);
  c.speeds = [{ id: 'a', start: 14, end: 16, rate: 0.5 }];
  plan = WP.buildPlan(c);
  assert.deepEqual(plan.map((s) => s.kind + ':' + (s.rate || s.hold)), ['play:1', 'play:0.5', 'hold:3', 'play:0.5', 'play:1']);
  // 4 + 2 + 3 + 2 + 6 = 17
  assert.equal(WP.planDuration(plan), 17);
  // freeze on the first and last frame
  c.speeds = [];
  c.freeze = { at: 10, hold: 2, shapes: [] };
  assert.equal(WP.buildPlan(c)[0].kind, 'hold');
  c.freeze = { at: 22, hold: 2, shapes: [] };
  const last = WP.buildPlan(c);
  assert.equal(last[last.length - 1].kind, 'hold');
  assert.equal(WP.planDuration(last), 14);
});

test('speed sections: add fills the gap, enforces limits', () => {
  let c = baseClip();
  c.speeds = WP.addSpeed(c, 11, 0.5);
  assert.deepEqual(c.speeds.map((x) => [x.start, x.end, x.rate]), [[11, 14, 0.5]]);
  // adding inside an existing section starts after it
  c.speeds = WP.addSpeed(c, 12, 2);
  assert.deepEqual(c.speeds.map((x) => [x.start, x.end]), [[11, 14], [14, 17]]);
  c.speeds = WP.addSpeed(c, 21.8, 0.25);
  assert.deepEqual(c.speeds[2], Object.assign({}, c.speeds[2], { start: 21.5, end: 22 }));
  assert.throws(() => WP.addSpeed(c, 10, 0.5), /Up to 3/);
  assert.throws(() => WP.updateSpeed(c, c.speeds[0].id, { end: 15 }), /overlap/);
  assert.throws(() => WP.updateSpeed(c, c.speeds[0].id, { rate: 3 }), /Pick a speed/);
  assert.throws(() => WP.updateSpeed(c, c.speeds[0].id, { start: 9 }), /inside the clip/);
  c.speeds = WP.updateSpeed(c, c.speeds[0].id, { rate: 0.25, start: 10 });
  assert.equal(c.speeds[0].start, 10);
  assert.equal(WP.removeSpeed(c, c.speeds[0].id).length, 2);
});

test('trimming clips speed sections and drops a freeze that falls outside', () => {
  let c = baseClip();
  c.speeds = [{ id: 'a', start: 11, end: 14, rate: 0.5 }, { id: 'b', start: 19, end: 22, rate: 2 }];
  c.freeze = { at: 20, hold: 3, shapes: [] };
  c = WP.updateClip(c, { start: 12, end: 19.2 }, 600);
  assert.deepEqual(c.speeds.map((x) => [x.start, x.end]), [[12, 14]]);
  assert.equal(c.freeze, null);
});

test('freeze and drawings', () => {
  const c = baseClip();
  assert.throws(() => WP.setFreeze(c, 30), /inside the clip/);
  let f = WP.setFreeze(c, 15.04, 4);
  assert.deepEqual(f, { at: 15, hold: 4, shapes: [] });
  assert.equal(WP.setFreeze(c, 15, 99).hold, 10);
  f = WP.addShape(f, { type: 'arrow', color: '#FACC15', pts: [[0.1, 0.2], [0.3, 0.33], [0.5, 1.4]] });
  assert.deepEqual(f.shapes[0].pts, [[0.1, 0.2], [0.5, 1]]);
  f = WP.addShape(f, { type: 'free', color: 'purple', pts: [[0, 0], [0.1, 0.1], [0.2, 0.15]] });
  assert.equal(f.shapes[1].color, '#FACC15');
  assert.equal(f.shapes[1].pts.length, 3);
  assert.throws(() => WP.addShape(f, { type: 'circle', pts: [[0, 0]] }), /too small/);
  assert.throws(() => WP.addShape(null, { type: 'circle', pts: [[0, 0], [1, 1]] }), /Freeze a frame first/);
  // moving the freeze keeps the drawings
  c.freeze = f;
  assert.equal(WP.setFreeze(c, 18).shapes.length, 2);
});

test('zoom rectangles and pointer mapping', () => {
  assert.deepEqual(WP.zoomSourceRect(WP.FIT, 4080, 1808), { sx: 0, sy: 0, sw: 4080, sh: 1808 });
  const r = WP.zoomSourceRect({ scale: 2, x: 0.75, y: 0.5 }, 4000, 2000);
  assert.deepEqual(r, { sx: 2000, sy: 500, sw: 2000, sh: 1000 });
  const z = { scale: 2, x: 0.75, y: 0.5 };
  const f = WP.viewToFrame(z, 0.5, 0.5);
  assert.deepEqual(f, { x: 0.75, y: 0.5 });
  const back = WP.frameToView(z, 0.875, 0.625);
  assert.ok(Math.abs(back.x - 0.75) < 1e-9 && Math.abs(back.y - 0.75) < 1e-9);
});

test('export size keeps the panoramic shape, even numbers', () => {
  assert.deepEqual(WP.exportSize(4080, 1808), { width: 1280, height: 568 });
  assert.deepEqual(WP.exportSize(1020, 452), { width: 1020, height: 452 });
  assert.deepEqual(WP.exportSize(1920, 1080), { width: 1280, height: 720 });
});

test('title lines and file names', () => {
  const g = WP.newGame({ opponent: 'Rangers', parts: [{ name: REAL, size: 1, duration: 600 }] });
  const c = WP.makeClip({ start: 244, end: 256, categoryId: 'cat_1', players: ['12', '7'], note: 'Stay wide', total: 600 });
  const cat = { name: 'Breakouts' };
  assert.deepEqual(WP.titleLines(c, cat, g), { top: 'Breakouts · Oct 18, 2026 vs Rangers', bottom: '#7 #12 — Stay wide' });
  assert.equal(WP.exportFileName(c, cat, g), '2026-10-18 Breakouts 4m04s #7 #12.mp4');
  assert.equal(WP.exportFileName(c, { name: 'A/B: "x"' }, g), '2026-10-18 A-B- -x- 4m04s #7 #12.mp4');
});

test('updateClip: title bar choice and speed list validation', () => {
  let c = baseClip();
  assert.equal(c.titleBar, true);
  c = WP.updateClip(c, { titleBar: false }, 600);
  assert.equal(c.titleBar, false);
  assert.throws(() => WP.updateClip(c, { speeds: [{ start: 5, end: 8, rate: 0.5 }] }, 600), /inside the clip/);
});

test('app version is a semantic version with a release date', () => {
  assert.match(WP.APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(WP.APP_RELEASED, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- milestone 2b: recorded breakdowns ----------
const recClip = (rate, voice, duration) => {
  const c = WP.makeClip({ start: 10, end: 20, categoryId: 'cat_1', total: 600 });
  c.rec = Object.assign(WP.newRecording(rate, voice), { duration });
  return c;
};

test('recording speed rule: voice keeps the recorded speed, no voice plays at normal speed', () => {
  // half speed, voice: 10 s of game recorded over 20 s -> 20 s finished video at 0.5x
  let p = WP.buildPlan(recClip(0.5, true, 20));
  assert.deepEqual(p, [{ kind: 'play', from: 10, to: 20, rate: 0.5, outStart: 0, outEnd: 20 }]);
  // half speed, no voice -> 10 s at normal speed
  p = WP.buildPlan(recClip(0.5, false, 20));
  assert.deepEqual(p, [{ kind: 'play', from: 10, to: 20, rate: 1, outStart: 0, outEnd: 10 }]);
  // normal speed with voice -> 10 s
  assert.equal(WP.planDuration(WP.buildPlan(recClip(1, true, 10))), 10);
  // stopped early: 4 s of half-speed recording covers 2 s of game
  p = WP.buildPlan(recClip(0.5, false, 4));
  assert.equal(p[0].to, 12);
  assert.equal(WP.planDuration(p), 2);
});

test('recording ignores slow-motion sections and freeze while it exists', () => {
  const c = recClip(1, false, 10);
  c.speeds = [{ id: 'a', start: 12, end: 14, rate: 0.5 }];
  c.freeze = { at: 15, hold: 3, shapes: [] };
  assert.equal(WP.planDuration(WP.buildPlan(c)), 10);
  c.rec = null;
  assert.equal(WP.planDuration(WP.buildPlan(c)), 15);
});

test('recording time maps to finished-video time', () => {
  const v = WP.newRecording(0.5, true);
  const n = WP.newRecording(0.5, false);
  assert.equal(WP.recOut(v, 8), 8);
  assert.equal(WP.recOut(n, 8), 4);
  assert.equal(WP.recIn(n, 4), 8);
});

test('zoom keys: only on change (max 10/s) or once a second, interpolated on playback', () => {
  const r = WP.newRecording(1, false);
  assert.ok(WP.addRecKey(r, 0, null));
  assert.ok(!WP.addRecKey(r, 0.05, { scale: 2, x: 0.5, y: 0.5 }), 'too soon');
  assert.ok(WP.addRecKey(r, 0.1, { scale: 2, x: 0.5, y: 0.5 }));
  assert.ok(!WP.addRecKey(r, 0.5, { scale: 2, x: 0.5, y: 0.5 }), 'unchanged');
  assert.ok(WP.addRecKey(r, 1.1, { scale: 2, x: 0.5, y: 0.5 }), 'heartbeat');
  assert.ok(WP.addRecKey(r, 2.1, { scale: 3, x: 0.5, y: 0.5 }));
  assert.equal(WP.recZoomAt(r, 0), null, 'starts on the whole rink');
  assert.equal(WP.recZoomAt(r, 0.05).scale, 1.5, 'halfway between keys');
  assert.equal(WP.recZoomAt(r, 1.6).scale, 2.5);
  assert.equal(WP.recZoomAt(r, 99).scale, 3, 'holds the last view');
  assert.equal(WP.recZoomAt(WP.newRecording(1, false), 3), null, 'no keys = whole rink');
  // half speed without voice: recording time 2.1 lands at video time 1.05
  const h = WP.newRecording(0.5, false);
  WP.addRecKey(h, 0, null); WP.addRecKey(h, 2, { scale: 3, x: 0.5, y: 0.5 });
  assert.equal(WP.recZoomAt(h, 1).scale, 3);
});

test('recorded drawings appear, fade after 3 s and can be cleared', () => {
  const r = WP.newRecording(1, false);
  WP.addRecShape(r, 2, { type: 'arrow', color: '#FACC15', pts: [[0.1, 0.1], [0.4, 0.4]] });
  WP.addRecShape(r, 6, { type: 'circle', color: '#EF4444', pts: [[0.5, 0.5], [0.6, 0.6]] });
  assert.equal(WP.recShapesAt(r, 1.9).length, 0);
  assert.equal(WP.recShapesAt(r, 2).length, 1);
  assert.equal(WP.recShapesAt(r, 4)[0].alpha, 1);
  const fading = WP.recShapesAt(r, 4.8)[0].alpha;
  assert.ok(fading > 0 && fading < 1, 'fades in the last 0.4 s');
  assert.equal(WP.recShapesAt(r, 5).length, 0, 'gone after 3 s');
  WP.addRecClear(r, 6.5);
  assert.equal(WP.recShapesAt(r, 6.2).length, 1);
  assert.equal(WP.recShapesAt(r, 6.6).length, 0, 'cleared');
  // without voice at half speed, fade time is measured in finished video seconds
  const h = WP.newRecording(0.5, false);
  WP.addRecShape(h, 2, { type: 'arrow', color: '#FACC15', pts: [[0.1, 0.1], [0.4, 0.4]] });
  assert.equal(WP.recShapesAt(h, 1).length, 1);
  assert.equal(WP.recShapesAt(h, 3.9).length, 1);
  assert.equal(WP.recShapesAt(h, 4.1).length, 0);
});

test('re-trimming a recorded clip drops the recording; other edits keep it', () => {
  const c = recClip(1, true, 10);
  assert.ok(WP.hasRec(WP.updateClip(c, { note: 'x' }, 600)));
  assert.equal(WP.updateClip(c, { start: 11 }, 600).rec, null);
  assert.ok(WP.hasRec(WP.updateClip(c, { start: 10 }, 600)), 'same trim keeps it');
});

test('recording summary', () => {
  const r = Object.assign(WP.newRecording(0.5, true), { duration: 21 });
  WP.addRecShape(r, 2, { type: 'arrow', color: '#FACC15', pts: [[0.1, 0.1], [0.4, 0.4]] });
  assert.equal(WP.recSummary(r), 'Recorded 0:21 · at half speed · with voice · 1 drawing');
});

// ---------- milestone 3a: shared team data ----------
const teamBase = () => WP.normalizeTeamData({
  team: { name: 'Bulldogs U10 Blue', season: '2026-27' },
  coaches: [{ name: 'Cristian', email: 'C@Example.com ' }],
  roster: [{ number: '7', name: 'Sam' }, { number: '12', name: '' }],
  opponents: ['Oakville', 'Milton'],
  rinks: ['Mountainside Arena Rink']
});

test('team data: normalize cleans, sorts and fills defaults', () => {
  const d = teamBase();
  assert.equal(d.coaches[0].email, 'c@example.com');
  assert.deepEqual(d.opponents, ['Milton', 'Oakville']);
  assert.equal(d.categories.length, 9, 'default categories when none given');
  const n = WP.normalizeTeamData({ coaches: [{ email: 'not-an-email' }], roster: [{ number: '#5' }, { number: '5' }, { number: 'x' }], opponents: [' A ', 'A', ''] });
  assert.deepEqual(n.coaches, []);
  assert.deepEqual(n.roster, [{ number: '5', first: '', last: '', name: '', primary: '', secondary: '' }]);
  assert.deepEqual(n.opponents, ['A']);
  assert.equal(n.team.name, 'Bulldogs U10 Blue');
});

test('team file round trip and validation', () => {
  const s = WP.applyTeamData(WP.defaultState().settings, teamBase());
  s.coachName = 'Cristian';
  const text = WP.teamFileText(s, 'c@example.com');
  assert.ok(!text.includes('coachName'), 'each coach keeps their own name locally');
  const back = WP.parseTeamFile(text);
  assert.deepEqual(back, WP.normalizeTeamData(teamBase()));
  assert.throws(() => WP.parseTeamFile('{"app":"x"}'), /isn’t Watch Party team data/);
  assert.throws(() => WP.parseTeamFile('nope'), /damaged/);
});

test('list editors: coaches, opponents, rinks', () => {
  let c = WP.addCoach([], 'Pat', 'Pat@Gmail.com');
  assert.deepEqual(c, [{ name: 'Pat', email: 'pat@gmail.com' }]);
  assert.throws(() => WP.addCoach(c, 'X', 'pat@gmail.com'), /already a coach/);
  assert.throws(() => WP.addCoach(c, 'X', 'nope'), /Google email/);
  assert.deepEqual(WP.removeCoach(c, 'pat@gmail.com'), []);
  let o = WP.addListItem(['Milton'], ' Burlington ');
  assert.deepEqual(o, ['Burlington', 'Milton']);
  assert.deepEqual(WP.addListItem(o, 'milton'), o, 'no duplicates');
  assert.deepEqual(WP.removeListItem(o, 'Milton'), ['Burlington']);
});

test('merge: changes to different things from two coaches both survive', () => {
  const base = teamBase();
  const mine = WP.normalizeTeamData(Object.assign({}, base, { roster: base.roster.concat([{ number: '3', name: 'Ava' }]), opponents: ['Milton'] }));
  const theirs = WP.normalizeTeamData(Object.assign({}, base, {
    team: { name: base.team.name, season: '2026-2027' },
    roster: base.roster.map((p) => p.number === '12' ? { number: '12', name: 'Leo' } : p),
    opponents: base.opponents.concat(['Hamilton'])
  }));
  const { merged, conflicts } = WP.mergeTeam(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(merged.team.season, '2026-2027');
  assert.deepEqual(merged.roster.map((p) => p.number + p.name), ['3Ava', '7Sam', '12Leo']);
  assert.deepEqual(merged.opponents, ['Hamilton', 'Milton'], 'my removal of Oakville and their add of Hamilton both kept');
});

test('merge: the same item changed both ways keeps the Drive version and reports it', () => {
  const base = teamBase();
  const mine = WP.normalizeTeamData(Object.assign({}, base, { roster: [{ number: '7', name: 'Samuel' }, base.roster[1]] }));
  const theirs = WP.normalizeTeamData(Object.assign({}, base, { roster: [{ number: '7', name: 'Sammy' }, base.roster[1]], team: { name: 'Bulldogs Blue', season: base.team.season } }));
  const m2 = WP.normalizeTeamData(Object.assign({}, mine, { team: { name: 'U10 Blue Bulldogs', season: base.team.season } }));
  const { merged, conflicts } = WP.mergeTeam(base, m2, theirs);
  assert.equal(merged.roster[0].name, 'Sammy');
  assert.equal(merged.team.name, 'Bulldogs Blue');
  assert.deepEqual(conflicts.sort(), ['player #7', 'team name']);
});

test('merge: deletes and category reordering', () => {
  const base = teamBase();
  const cats = base.categories;
  // I move Faceoffs to the top; they rename Goalie and delete a player
  const mineCats = [cats[4]].concat(cats.filter((c, i) => i !== 4));
  const mine = WP.normalizeTeamData(Object.assign({}, base, { categories: mineCats }));
  const theirs = WP.normalizeTeamData(Object.assign({}, base, {
    categories: cats.map((c) => c.id === 'cat_7' ? Object.assign({}, c, { name: 'Goaltending' }) : c),
    roster: [base.roster[1]]
  }));
  const { merged, conflicts } = WP.mergeTeam(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(merged.categories[0].name, 'Faceoffs', 'my reorder kept');
  assert.ok(merged.categories.some((c) => c.name === 'Goaltending'), 'their rename kept');
  assert.deepEqual(merged.roster.map((p) => p.number), ['12'], 'their delete kept');
});

test('syncStep decides what to keep and whether to write', () => {
  const base = teamBase();
  const theirs = WP.normalizeTeamData(Object.assign({}, base, { rinks: ['Appleby'] }));
  let r = WP.syncStep({ base, mine: base, theirs, dirty: false });
  assert.deepEqual(r.data.rinks, ['Appleby']);
  assert.equal(r.push, false);
  const mine = WP.normalizeTeamData(Object.assign({}, base, { opponents: base.opponents.concat(['Hamilton']) }));
  r = WP.syncStep({ base, mine, theirs, dirty: true });
  assert.deepEqual(r.data.rinks, ['Appleby']);
  assert.ok(r.data.opponents.includes('Hamilton'));
  assert.equal(r.push, true);
  // first sync from a device with no base: local data wins and is written
  r = WP.syncStep({ base: null, mine, theirs, dirty: true });
  assert.deepEqual(r.data, mine);
  assert.equal(r.push, true);
});

test('migrate adds shared-team fields to older saved data', () => {
  const s = WP.migrate({ settings: { coachName: 'C', roster: [{ number: '7', name: '' }] }, games: [] });
  assert.deepEqual(s.settings.team, WP.DEFAULT_TEAM);
  assert.deepEqual(s.settings.coaches, []);
  assert.deepEqual(s.settings.opponents, []);
  assert.equal(s.sync, null);
  assert.equal(s.settings.roster.length, 1);
});

// ---------- milestone 3b: tagging model and clip library ----------
const libGame = () => {
  const g = WP.newGame({ opponent: 'Rangers', gameType: 'league', homeAway: 'home', parts: [{ name: REAL, size: 1, duration: 3000 }] });
  return g;
};

test('period marks: P starts, then ends, then starts the next', () => {
  const g = libGame();
  let r = WP.togglePeriod(g, 60); g.marks = r.marks;
  assert.equal(r.did, 'start'); assert.equal(r.n, 1);
  r = WP.togglePeriod(g, 900); g.marks = r.marks;
  assert.equal(r.did, 'end');
  assert.throws(() => WP.togglePeriod(g, 800), /inside period 1/);
  r = WP.togglePeriod(g, 1000); g.marks = r.marks;
  assert.equal(r.n, 2);
  assert.throws(() => WP.togglePeriod(g, 990), /end after it starts/);
  g.marks = WP.removePeriod(g, 1);
  assert.deepEqual(g.marks.periods.map((p) => [p.n, p.start]), [[1, 1000]], 'remaining periods renumber');
  assert.equal(WP.periodName(4), 'OT');
});

test('auto tags: period, time into it, score before, goal events inside the clip', () => {
  const g = libGame();
  g.marks = { periods: [{ n: 1, start: 60, end: 900 }, { n: 2, start: 1000, end: null }], goals: [] };
  g.marks = WP.addGoal(g, 300, 'for');
  g.marks = WP.addGoal(g, 1100, 'against');
  g.marks = WP.addGoal(g, 1200, 'for');
  const c = WP.makeClip({ start: 1190, end: 1205, categoryId: 'cat_1', total: 3000 });
  const a = WP.clipAuto(g, c);
  assert.equal(a.period, 2);
  assert.equal(a.periodTime, 190);
  assert.deepEqual(a.score, { for: 1, against: 1 });
  assert.equal(a.state, 'tied');
  assert.deepEqual(a.events, ['goal_for']);
  assert.deepEqual(WP.clipEvents(g, c), ['goal_for']);
  const early = WP.makeClip({ start: 10, end: 20, categoryId: 'cat_1', total: 3000 });
  assert.equal(WP.clipAuto(g, early).period, null, 'before the first period mark');
  assert.equal(WP.clipAuto(libGame(), early).state, null, 'no marks = no score state');
});

test('events: coach picks plus automatic goals; removing an auto goal sticks', () => {
  const g = libGame();
  g.marks = WP.addGoal(g, 100, 'for');
  let c = WP.makeClip({ start: 90, end: 105, categoryId: 'cat_1', total: 3000 });
  c = WP.updateClip(c, WP.toggleEvent(g, c, 'takeaway'), 3000);
  assert.deepEqual(WP.clipEvents(g, c), ['goal_for', 'takeaway']);
  c = WP.updateClip(c, WP.toggleEvent(g, c, 'goal_for'), 3000);
  assert.deepEqual(WP.clipEvents(g, c), ['takeaway'], 'auto goal removed by the coach');
  assert.deepEqual(c.hiddenAuto, ['goal_for']);
  c = WP.updateClip(c, WP.toggleEvent(g, c, 'goal_for'), 3000);
  assert.deepEqual(WP.clipEvents(g, c), ['goal_for', 'takeaway'], 'and put back');
  c = WP.updateClip(c, WP.toggleEvent(g, c, 'faceoff_won'), 3000);
  assert.ok(WP.clipEvents(g, c).includes('faceoff_won'));
  assert.throws(() => WP.toggleEvent(g, c, 'nope'), /Unknown event/);
});

test('clip tag fields validate', () => {
  let c = WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 60, private: true });
  assert.equal(c.private, true);
  assert.equal(c.situation, 'even');
  c = WP.updateClip(c, { zone: 'off', situation: 'pp', starred: 1, tags: [' Silver Stick ', 'Silver Stick', ''], private: false }, 60);
  assert.deepEqual([c.zone, c.situation, c.starred, c.tags, c.private], ['off', 'pp', true, ['Silver Stick'], false]);
  c = WP.updateClip(c, { zone: 'moon', situation: 'x' }, 60);
  assert.deepEqual([c.zone, c.situation], ['', 'even']);
});

test('library entry carries game, tags, auto fields and features', () => {
  const g = libGame();
  g.marks = { periods: [{ n: 1, start: 0, end: null }], goals: [{ id: 'g1', t: 50, side: 'for' }] };
  const c = WP.updateClip(WP.makeClip({ start: 45, end: 55, categoryId: 'cat_1', players: ['7'], note: 'Nice', total: 3000, by: 'Cristian' }), { starred: true, zone: 'off', tags: ['Silver Stick'] }, 3000);
  c.freeze = { at: 50, hold: 3, shapes: [{ type: 'arrow', color: '#FACC15', pts: [[0, 0], [1, 1]] }] };
  const e = WP.libraryEntry(g, c, WP.defaultCategories(), 'Cristian');
  assert.equal(e.category, 'Breakouts');
  assert.equal(e.game.title, 'Oct 18, 2026 vs Rangers');
  assert.equal(e.game.type, 'league');
  assert.deepEqual(e.events, ['goal_for']);
  assert.equal(e.period, 1);
  assert.equal(e.features.drawing, true);
  assert.equal(e.starred, true);
  assert.equal(e.owner, 'Cristian');
});

test('filters: AND between groups, OR inside a group, search words', () => {
  const g = libGame();
  const cats = WP.defaultCategories();
  const mk = (f) => WP.libraryEntry(g, WP.updateClip(WP.makeClip(Object.assign({ start: 1, end: 5, categoryId: 'cat_1', total: 3000 }, f)), f.patch || {}, 3000), cats, 'C');
  const a = mk({ events: ['goal_for'], players: ['7'], note: 'great breakout' });
  const b = mk({ categoryId: 'cat_5', events: ['faceoff_lost'], players: ['12'] });
  const c = mk({ events: ['goal_against'], players: ['7', '12'], patch: { starred: true } });
  const pick = (f) => [a, b, c].filter((e) => WP.entryMatches(e, f)).map((e) => [a, b, c].indexOf(e));
  assert.deepEqual(pick({}), [0, 1, 2]);
  assert.deepEqual(pick({ categories: ['cat_1'], events: ['goal_for'] }), [0]);
  assert.deepEqual(pick({ events: ['goal_for', 'goal_against'] }), [0, 2]);
  assert.deepEqual(pick({ players: ['12'] }), [1, 2]);
  assert.deepEqual(pick({ flags: ['starred'] }), [2]);
  assert.deepEqual(pick({ q: 'great #7' }), [0]);
  assert.deepEqual(pick({ q: 'faceoff lost' }), [1]);
  assert.deepEqual(pick({ gameType: 'tournament' }), []);
  assert.equal(WP.filterCount({ categories: ['cat_1'], events: ['goal_for'], q: 'x' }), 3);
  assert.equal(WP.describeFilters({ categories: ['cat_1'], events: ['goal_for'] }, cats), 'Breakouts · Goal for');
});

test('saved views', () => {
  let v = WP.addView([], 'Goals against', { events: ['goal_against'] });
  v = WP.addView(v, 'goals against', { events: ['goal_against'], periods: ['3'] });
  assert.equal(v.length, 1, 'same name replaces');
  assert.deepEqual(v[0].filters.periods, ['3']);
  assert.throws(() => WP.addView(v, ' ', {}), /name/);
  assert.equal(WP.removeView(v, v[0].id).length, 0);
});

test('library file round trip, merge and sync', () => {
  const g = libGame();
  const cats = WP.defaultCategories();
  const e1 = WP.libraryEntry(g, WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 3000 }), cats, 'A');
  const e2 = WP.libraryEntry(g, WP.makeClip({ start: 9, end: 15, categoryId: 'cat_2', total: 3000 }), cats, 'B');
  const base = { entries: { [e1.id]: e1 }, views: [] };
  const text = WP.libraryFileText(base, 'team', 'a@x.com');
  assert.deepEqual(WP.parseLibraryFile(text), WP.normalizeLibrary(base));
  assert.throws(() => WP.parseLibraryFile(text, 'private'), /private clip library/);
  // A edits e1 note, B adds e2: both survive
  const mine = { entries: { [e1.id]: Object.assign({}, e1, { note: 'edited' }) }, views: WP.addView([], 'Mine', {}) };
  const theirs = { entries: { [e1.id]: e1, [e2.id]: e2 }, views: [] };
  const r = WP.syncLibraryStep({ base, mine, theirs, dirty: true });
  assert.equal(r.data.entries[e1.id].note, 'edited');
  assert.ok(r.data.entries[e2.id]);
  assert.equal(r.data.views.length, 1);
  assert.equal(r.push, true);
  // deletion on my side removes it
  const del = WP.syncLibraryStep({ base: theirs, mine: { entries: { [e2.id]: e2 }, views: [] }, theirs, dirty: true });
  assert.deepEqual(Object.keys(del.data.entries), [e2.id]);
});

test('buildMyLibrary: my clips fresh, others kept, private split, deleted dropped', () => {
  const g = libGame();
  const cats = WP.defaultCategories();
  const mineClip = WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 3000 });
  const privClip = WP.makeClip({ start: 7, end: 9, categoryId: 'cat_1', total: 3000, private: true });
  g.clips = [mineClip, privClip];
  const other = WP.libraryEntry(Object.assign(libGame(), { id: 'other' }), WP.makeClip({ start: 2, end: 6, categoryId: 'cat_2', total: 3000 }), cats, 'B');
  const gone = WP.libraryEntry(g, WP.makeClip({ start: 3, end: 6, categoryId: 'cat_2', total: 3000 }), cats, 'A');
  const team = WP.buildMyLibrary({ entries: { [other.id]: other, [gone.id]: gone, [privClip.id]: WP.libraryEntry(g, privClip, cats, 'A') }, views: [] }, [g], cats, 'A', false, [gone.id]);
  assert.deepEqual(Object.keys(team.entries).sort(), [mineClip.id, other.id].sort(), 'private clip moved out, deleted clip dropped');
  const priv = WP.buildMyLibrary({ entries: {} }, [g], cats, 'A', true, []);
  assert.deepEqual(Object.keys(priv.entries), [privClip.id]);
});

test('applyEntryTags copies other coaches’ tag edits into my clip', () => {
  const g = libGame();
  const cats = WP.defaultCategories();
  const clip = WP.makeClip({ start: 1, end: 5, categoryId: 'cat_1', total: 3000, note: 'old' });
  const base = WP.libraryEntry(g, clip, cats, 'A');
  const edited = Object.assign({}, base, { note: 'new', starred: true, events: ['takeaway'] });
  const out = WP.applyEntryTags(clip, edited, base);
  assert.equal(out.note, 'new');
  assert.equal(out.starred, true);
  assert.deepEqual(out.events, ['takeaway']);
  assert.equal(WP.applyEntryTags(clip, base, base), clip, 'no change, same object');
});

test('folder names for destinations', () => {
  const roster = [{ number: '7', name: 'Sam' }, { number: '12', name: '' }];
  assert.equal(WP.folderName('team'), 'Team clips');
  assert.equal(WP.folderName('player:7', roster), 'Family \u2013 #7 Sam');
  assert.equal(WP.folderName('player:12', roster), 'Family \u2013 #12');
  assert.deepEqual(WP.teamFolderKeys(roster).slice(0, 3), ['team', 'coaches', 'player:7']);
  assert.equal(WP.destLabel('player:7', roster), '#7 Sam family');
  assert.throws(() => WP.folderName('x'), /Unknown folder/);
});

test('migrate adds library state and clip tag fields to older data', () => {
  const s = WP.migrate({ games: [{ id: 'g', parts: [], clips: [{ id: 'c', start: 1, end: 2 }] }] });
  assert.equal(s.lib.scope, 'team');
  assert.deepEqual(s.games[0].marks, { periods: [], goals: [] });
  assert.deepEqual(s.games[0].clips[0].events, []);
  assert.equal(s.games[0].clips[0].situation, 'even');
});

// ---------- v0.7: saving in pieces, versions, shortcuts ----------
test('stateRecords splits meta, library parts and one record per game; stateFromRecords rebuilds it', () => {
  const s = WP.defaultState();
  const g = WP.newGame({ parts: [{ name: '1__R__2026-10-04T151933.mp4', size: 1, duration: 600 }], opponent: 'A' });
  g.clips.push(WP.makeClip({ start: 1, end: 9, categoryId: s.settings.categories[0].id, total: 600 }));
  s.games.push(g);
  const recs = WP.stateRecords(s);
  assert.deepEqual(recs.map((r) => r.key), ['meta', 'lib:team', 'lib:priv', 'lib:teamSync', 'lib:privSync', 'game:' + g.id]);
  const back = WP.stateFromRecords(new Map(recs.map((r) => [r.key, JSON.parse(JSON.stringify(r.value))])));
  assert.equal(back.games.length, 1);
  assert.equal(back.games[0].clips[0].end, 9);
  assert.equal(WP.stateFromRecords(new Map()), null);
});

test('recordSig notices pushes and reassignments but not identical state', () => {
  const g = { id: 'g', clips: [], marks: { periods: [], goals: [] }, gameType: '' };
  const a = WP.recordSig(g);
  assert.ok(WP.sameSig(a, WP.recordSig(g)));
  g.clips.push({ id: 'c' });
  const b = WP.recordSig(g);
  assert.ok(!WP.sameSig(a, b));
  g.gameType = 'playoff';
  assert.ok(!WP.sameSig(b, WP.recordSig(g)));
  const c = WP.recordSig(g);
  g.marks = { periods: [], goals: [] };
  assert.ok(!WP.sameSig(c, WP.recordSig(g)));
});

test('compareVersions orders versions numerically', () => {
  assert.ok(WP.compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(WP.compareVersions('0.7.0', '0.7.0') === 0);
  assert.ok(WP.compareVersions('0.6.1', '0.7') < 0);
});

test('shortcuts list has G for goal for and H for goal against', () => {
  const all = WP.SHORTCUTS.flatMap((s) => s.keys);
  assert.ok(all.some(([k, w]) => k === 'G' && /Goal for/.test(w)));
  assert.ok(all.some(([k, w]) => k === 'H' && /Goal against/.test(w)));
});

// ---------- v1.0: roster details and game lineups ----------
test('players: names show as first initial + last name; old entries keep their name as the first name', () => {
  assert.equal(WP.displayName('Sam', 'Smith'), 'S. Smith');
  assert.equal(WP.displayName('Sam', ''), 'Sam');
  const old = WP.normalizePlayer({ number: '7', name: 'Sam' });
  assert.equal(old.first, 'Sam'); assert.equal(old.name, 'Sam');
  let r = WP.addPlayer([], { number: '#7', first: 'Sam', last: 'Smith', primary: 'c', secondary: 'RW' });
  assert.deepEqual(r[0], { number: '7', first: 'Sam', last: 'Smith', name: 'S. Smith', primary: 'C', secondary: 'RW' });
  r = WP.addPlayer(r, '12', 'Leo');
  assert.deepEqual(r.map((p) => p.number), ['7', '12']);
  r = WP.updatePlayer(r, '12', { last: 'Lane', primary: 'D', secondary: 'D', number: '99' });
  const leo = r.find((p) => p.number === '12');
  assert.equal(leo.name, 'L. Lane'); assert.equal(leo.primary, 'D'); assert.equal(leo.secondary, '', 'secondary can\'t equal primary');
  assert.throws(() => WP.addPlayer(r, { number: '7' }), /already/);
  assert.equal(WP.folderName('player:7', r), 'Family \u2013 #7 S. Smith');
  assert.equal(WP.positionGroup('LW'), 'F'); assert.equal(WP.positionGroup('D'), 'D'); assert.equal(WP.positionGroup(''), '');
});

test('lineup: away players, a position for one game, guests, copying the last game', () => {
  const roster = [WP.normalizePlayer({ number: '7', first: 'Sam', primary: 'C' }), WP.normalizePlayer({ number: '12', first: 'Leo', primary: 'D' }), WP.normalizePlayer({ number: '4', first: 'Maya', primary: 'D' })];
  const game = { id: 'g1', date: '2026-10-18', lineup: null };
  assert.deepEqual(WP.playersForGame(game, roster), ['7', '12', '4'], 'no lineup: everyone played');
  let L = WP.setAway(game.lineup, '4', true);
  L = WP.setGamePos(L, '12', 'LW', 'D');
  L = WP.addGuest(L, roster, '22', 'Guest', 'D');
  assert.throws(() => WP.addGuest(L, roster, '7'), /already/);
  game.lineup = L;
  const rows = WP.gameLineup(game, roster);
  assert.deepEqual(rows.map((x) => [x.number, x.pos, x.away, x.guest]), [['7', 'C', false, false], ['12', 'LW', false, false], ['4', 'D', true, false], ['22', 'D', false, true]]);
  assert.deepEqual(WP.playersForGame(game, roster), ['7', '12', '22']);
  assert.deepEqual(WP.setGamePos(L, '12', 'D', 'D').pos, {}, 'back to the usual position clears the override');
  assert.deepEqual(WP.clipPositionGroups(game, { players: ['12', '22'] }, roster), ['F', 'D']);
  const prev = WP.lastLineup([game, { id: 'g0', date: '2026-10-01', lineup: { away: ['7'] } }], 'g2');
  assert.deepEqual(prev.away, ['4']);
  assert.deepEqual(WP.removeGuest(L, '22').guests, []);
});

test('review: filter by position group', () => {
  const e = { categoryId: 'c', events: [], players: ['7'], positions: ['F'], flag: 'do', game: { type: '', homeAway: '' }, tags: [] };
  assert.ok(WP.entryMatches(e, { positions: ['F'] }));
  assert.ok(!WP.entryMatches(e, { positions: ['D'] }));
  assert.equal(WP.describeFilters({ positions: ['D', 'G'] }), 'Defense or Goalies');
});

// ---------- league schedule (Alliance Tracker data) ----------
const ALLIANCE_TEAMS = require('./fixtures/alliance/data/teams.json');
const ALLIANCE_GAMES = require('./fixtures/alliance/data/games/2712.json');

test('league teams and the default league team', () => {
  const teams = WP.leagueTeams(ALLIANCE_TEAMS);
  const blue = teams.find((t) => t.teamId === WP.DEFAULT_LEAGUE.teamId);
  assert.equal(blue.name, 'Burlington Bulldogs Blue');
  assert.equal(blue.division, 'U10 BB');
  assert.equal(blue.logo, 'logos/49dba036a6a8.png');
  assert.equal(WP.leagueLogo('https://evil.example/x.png'), '');
  assert.equal(WP.leagueLogo('logos/../x.png'), '');
  assert.deepEqual(WP.normalizeLeague(undefined), WP.DEFAULT_LEAGUE);
  assert.equal(WP.normalizeLeague({ teamId: '' }).teamId, '');
  assert.equal(WP.migrate({}).settings.league.teamId, WP.DEFAULT_LEAGUE.teamId);
});

test('teamSchedule reads one team’s games from its own side', () => {
  const s = WP.teamSchedule(ALLIANCE_GAMES, 'Burlington Bulldogs Blue', WP.leagueTeams(ALLIANCE_TEAMS));
  assert.equal(s.length, 28);
  assert.ok(s.every((g, i) => !i || (s[i - 1].date + s[i - 1].time) <= g.date + g.time), 'oldest first');
  const g = s.find((x) => x.date === '2026-10-18');
  assert.equal(g.time, '15:15');
  assert.equal(g.opponent, 'Burlington Raiders');
  assert.equal(g.homeAway, 'home');
  assert.equal(g.rink, 'Mountainside');
  assert.equal(g.result, 'W 2–1');
  assert.equal(g.gameType, 'league');
  assert.equal(g.opponentLogo, 'logos/8845e5146a9b.png');
  assert.equal(g.gamesheet, 'https://gamesheetstats.com/seasons/15449/games/3080422');
  assert.ok(g.liveBarn.startsWith('https://'));
  const away = s.find((x) => x.date === '2026-10-10');
  assert.equal(away.homeAway, 'away');
  assert.equal(away.result, 'W 3–2', 'the score is from our side');
  assert.ok(s.some((x) => !x.final && x.result === ''), 'upcoming games have no result');
});

test('venue clean-up and results', () => {
  assert.equal(WP.cleanVenue('Mountainside (Mountainside)'), 'Mountainside');
  assert.equal(WP.cleanVenue('Appleby (3)'), 'Appleby (3)');
  assert.equal(WP.scoreResult(1, 3), 'L 1–3');
  assert.equal(WP.scoreResult(2, 2), 'T 2–2');
  assert.equal(WP.formatClock('15:15'), '3:15 PM');
  assert.equal(WP.formatClock('09:05'), '9:05 AM');
  assert.equal(WP.formatClock('12:00'), '12:00 PM');
});

test('matchScheduleGame finds the game from LiveBarn file names', () => {
  const s = WP.teamSchedule(ALLIANCE_GAMES, 'Burlington Bulldogs Blue');
  const m = WP.matchScheduleGame(s, ['2__Mountainside_Arena_Rink__LEAGUE_PARTNER_GAMES_ONLY__2026-10-18T152013.mp4', REAL]);
  assert.equal(m.date, '2026-10-18');
  assert.equal(m.opponent, 'Burlington Raiders');
  assert.equal(WP.matchScheduleGame(s, ['x__2026-09-01T100000.mp4']), null, 'no game that day');
  assert.equal(WP.matchScheduleGame(s, ['my game.mp4']), null, 'no date in the name');
  // two games on one day: the time and rink decide
  const two = [{ id: 'a', date: '2026-11-07', time: '09:00', rink: 'Appleby (3)' }, { id: 'b', date: '2026-11-07', time: '14:00', rink: 'Mountainside' }];
  assert.equal(WP.matchScheduleGame(two, ['1__Mountainside_Arena_Rink__X__2026-11-07T140500.mp4']).id, 'b');
  assert.equal(WP.matchScheduleGame(two, ['1__Appleby_Ice_Centre__X__2026-11-07T085500.mp4']).id, 'a');
  assert.equal(WP.matchScheduleGame(two, ['1__Somewhere__X__2026-11-07T200000.mp4']), null, 'too far from both');
  assert.equal(WP.matchScheduleGame([two[0]], ['1__Somewhere__X__2026-11-07T200000.mp4']).id, 'a', 'the only game that day');
});

test('a new game keeps its league link; linking an existing game keeps an entered result', () => {
  const s = WP.teamSchedule(ALLIANCE_GAMES, 'Burlington Bulldogs Blue', WP.leagueTeams(ALLIANCE_TEAMS)).find((x) => x.date === '2026-10-18');
  const g = WP.newGame(Object.assign({ parts: [{ name: REAL, size: 1, duration: 60 }], league: s }, WP.scheduleFields(s)));
  assert.equal(g.time, '15:15');
  assert.equal(g.opponent, 'Burlington Raiders');
  assert.equal(g.result, 'W 2–1');
  assert.equal(g.league.id, s.id);
  assert.equal(g.league.opponentLogo, 'logos/8845e5146a9b.png');
  const plain = WP.newGame({ parts: [{ name: REAL, size: 1, duration: 60 }], result: 'W 3–1', opponent: 'Raiders' });
  assert.equal(plain.league, null);
  const linked = WP.linkGame(plain, s);
  assert.equal(linked.opponent, 'Burlington Raiders');
  assert.equal(linked.result, 'W 3–1', 'a result already entered is left alone');
  assert.equal(linked.league.code, 'U10BE84');
});

test('league team is shared team data and merges', () => {
  const base = WP.normalizeTeamData({});
  const mine = Object.assign({}, base, { league: { teamId: '2712:burlington-raiders', name: 'Burlington Raiders', divisionId: 2712, division: 'U10 BB', logo: '' } });
  const r = WP.mergeTeam(base, mine, base);
  assert.equal(r.merged.league.teamId, '2712:burlington-raiders');
  assert.equal(WP.normalizeTeamData({ league: { teamId: '' } }).league.teamId, '');
  assert.ok(JSON.parse(WP.teamFileText(WP.defaultState().settings)).league);
});

test('club teams (OWHA) use text division ids', () => {
  assert.equal(WP.divisionKey('bghc-2066'), 'bghc-2066');
  assert.equal(WP.divisionKey('2712'), 2712);
  assert.equal(WP.divisionKey('../x'), null);
  const teams = WP.leagueTeams([{ id: 'bghc-2066:burlington-barracudas', name: 'Burlington Barracudas', divisionId: 'bghc-2066', division: 'U13 B (OWHA)', league: 'OWHA', logo: 'logos/abc123.png' }]);
  assert.equal(teams[0].divisionId, 'bghc-2066');
  const lg = WP.normalizeLeague(teams[0]);
  assert.equal(lg.divisionId, 'bghc-2066');
  const s = WP.teamSchedule([{ id: 59810, start: '2026-09-24T19:00:00-04:00', home: 'Burlington Barracudas', away: 'North Halton Twisters', homeScore: 4, awayScore: 2, status: 'final', venue: 'Mountainside Arena', type: 'exhibition' }], 'Burlington Barracudas');
  assert.deepEqual([s[0].opponent, s[0].result, s[0].gameType, s[0].homeAway], ['North Halton Twisters', 'W 4–2', 'exhibition', 'home']);
});

test('a clip can be in several categories (main one first)', () => {
  const cats = [{ id: 'br', name: 'Breakout', color: '#111111' }, { id: 'pass', name: 'Nice pass', color: '#222222' }, { id: 'gl', name: 'Goal', color: '#333333' }];
  const c = WP.makeClip({ start: 10, end: 20, total: 100, categoryId: 'br' });
  assert.deepEqual(WP.clipCategoryIds(c), ['br']);
  const two = WP.updateClip(c, WP.toggleClipCategory(c, 'pass'), 100);
  assert.deepEqual([two.categoryId, two.alsoCats], ['br', ['pass']]);
  assert.deepEqual(WP.clipCategoryLabel(two, cats), { id: 'br', name: 'Breakout + Nice pass', color: '#111111', main: cats[0] });
  const swapped = WP.updateClip(two, WP.toggleClipCategory(two, 'br'), 100);
  assert.deepEqual([swapped.categoryId, swapped.alsoCats], ['pass', []], 'removing the main one promotes the next');
  assert.throws(() => WP.toggleClipCategory(swapped, 'pass'), /at least one/);
  const back = WP.updateClip(two, { categoryId: 'pass' }, 100);
  assert.deepEqual([back.categoryId, back.alsoCats], ['pass', []], 'setting just the main category replaces it, with no duplicate');
  const game = { id: 'g', clips: [two], parts: [{ name: 'x', duration: 100 }], marks: { periods: [], goals: [] } };
  assert.ok(WP.categoryInUse([game], 'pass'), 'an extra category counts as in use');
  const entry = WP.libraryEntry(game, two, cats, 'Coach', []);
  assert.equal(entry.category, 'Breakout + Nice pass');
  assert.deepEqual(entry.alsoCats, ['pass']);
  assert.ok(WP.entryMatches(entry, { categories: ['pass'] }), 'filtering by the extra category finds it');
  assert.ok(WP.entryMatches(entry, { q: 'nice pass' }), 'search finds the extra category name');
  assert.ok(!WP.entryMatches(entry, { categories: ['gl'] }));
  // another coach adds a category in Review: it comes back into the owner's clip
  const edited = Object.assign({}, entry, { alsoCats: ['pass', 'gl'] });
  const merged = WP.applyEntryTags(two, edited, entry);
  assert.deepEqual(WP.clipCategoryIds(merged), ['br', 'pass', 'gl']);
  // old clips without alsoCats still work
  assert.deepEqual(WP.clipCategoryIds({ categoryId: 'br' }), ['br']);
});

test('penalties: power play / penalty kill, events, end by goal or mark', () => {
  const g = { id: 'g', marks: { periods: [{ n: 1, start: 0, end: null }], goals: [] }, clips: [], parts: [{ name: 'x', duration: 3600 }] };
  let r = WP.addPenalty(g, 100, { team: 'us', player: '#7', type: 'tripping', minutes: 2 });
  g.marks = r.marks;
  assert.deepEqual([r.penalty.player, r.penalty.end], ['7', null]);
  assert.equal(WP.penaltyLabel(r.penalty), '#7 · Tripping · 2 min');
  assert.equal(WP.situationAt(g, 150), 'pk', 'we are short-handed');
  assert.equal(WP.situationAt(g, 100 + 2 * 60 * WP.PENALTY_VIDEO_FACTOR + 1), 'even', 'estimated end');
  // a clip around the call: Penalty against, the penalty type, penalty kill
  const clip = WP.makeClip({ start: 95, end: 110, total: 3600, categoryId: 'x' });
  assert.ok(WP.clipEvents(g, clip).includes('penalty_against'));
  assert.deepEqual(WP.clipAuto(g, clip).penalties, ['tripping']);
  assert.equal(WP.clipSituation(g, clip), 'pk');
  assert.deepEqual(WP.penaltyPlayers(g, 95, 110), ['7']);
  // the coach's own pick wins
  assert.equal(WP.clipSituation(g, WP.updateClip(clip, { situation: 'even' }, 3600)), 'even');
  // a power-play goal against ends the minor early
  g.marks = WP.addGoal(g, 160, 'against');
  assert.deepEqual(WP.penaltyEnd(g, WP.gameMarks(g).penalties[0]), { t: 160, why: 'goal' });
  assert.equal(WP.situationAt(g, 170), 'even');
  // their penalty at the same time as ours: 4-on-4 is even; then they take another = our power play
  r = WP.addPenalty(g, 120, { team: 'them', type: 'hooking', minutes: 2 }); g.marks = r.marks;
  assert.equal(WP.situationAt(g, 130), 'even');
  r = WP.addPenalty(g, 300, { team: 'them', type: 'slashing', minutes: 2 }); g.marks = r.marks;
  assert.equal(WP.situationAt(g, 310), 'pp');
  g.marks = WP.endPenalty(g, r.penalty.id, 350);
  assert.equal(WP.situationAt(g, 351), 'even', 'marked end');
  assert.throws(() => WP.endPenalty(g, r.penalty.id, 200), /after/);
  const bands = WP.strengthBands(g, 3600);
  // 100–120 we're short; 120–160 4-on-4; our minor ends at their goal (160) while theirs runs on: power play to 350
  assert.deepEqual(bands, [{ start: 100, end: 120, situation: 'pk' }, { start: 160, end: 350, situation: 'pp' }]);
  // a misconduct doesn't change the strength
  r = WP.addPenalty(g, 1000, { team: 'us', type: 'unsportsmanlike', minutes: 10 }); g.marks = r.marks;
  assert.equal(WP.situationAt(g, 1010), 'even');
  // library entry + Review filter
  const e = WP.libraryEntry(g, clip, [{ id: 'x', name: 'X', color: '#000' }], 'C', []);
  assert.deepEqual([e.situation, e.penalties], ['pk', ['tripping']]);
  assert.ok(WP.entryMatches(e, { penalties: ['tripping'] }) && !WP.entryMatches(e, { penalties: ['hooking'] }));
  assert.ok(WP.entryMatches(e, { q: 'tripping' }));
  assert.ok(WP.entryMatches(e, { situation: 'pk' }));
  g.marks = WP.removePenalty(g, WP.gameMarks(g).penalties[0].id);
  assert.equal(WP.gameMarks(g).penalties.length, 3);
});

test('game status: strength and unended penalties (forgotten ones stay listed)', () => {
  const g = { id: 'g', marks: { periods: [], goals: [] }, clips: [], parts: [] };
  g.marks = WP.addPenalty(g, 100, { team: 'them', type: 'tripping', minutes: 2 }).marks;
  assert.deepEqual(WP.strengthAt(g, 110), { us: 5, them: 4, situation: 'pp' });
  g.marks = WP.addPenalty(g, 105, { team: 'them', type: 'hooking', minutes: 2 }).marks;
  assert.deepEqual(WP.strengthAt(g, 110), { us: 5, them: 3, situation: 'pp' });
  const est = 100 + 120 * WP.PENALTY_VIDEO_FACTOR;
  let u = WP.unendedPenalties(g, 110);
  assert.equal(u.length, 2);
  assert.equal(Math.round(u[0].left), Math.round((est - 110) / WP.PENALTY_VIDEO_FACTOR), 'game-clock time left (estimated)');
  u = WP.unendedPenalties(g, est + 60);
  assert.equal(u.length, 2, 'still listed after the estimated end');
  assert.ok(u[0].over);
  assert.equal(WP.openPenalties(g, est + 60).length, 0, 'openPenalties (strength) counts them as over by the estimate');
  g.marks = WP.endPenalty(g, u[0].p.id, est + 60);
  assert.equal(WP.unendedPenalties(g, est + 61).length, 1);
  assert.equal(WP.unendedPenalties(g, 50).length, 0, 'not yet called');
});

test('guessLeagueTeam finds the league team from a Watch Party team name', () => {
  const teams = WP.leagueTeams(ALLIANCE_TEAMS.concat(require('./fixtures/alliance/data/clubs.json')));
  const g = WP.guessLeagueTeam(teams, 'Burlington Barracudas U13 B');
  assert.equal(g.team.teamId, 'bghc-2066:burlington-barracudas');
  assert.ok(g.sure, 'name and division both match');
  const b = WP.guessLeagueTeam(teams, 'Bulldogs U10 Blue');
  assert.equal(b, null, 'no league team name is inside "Bulldogs U10 Blue"');
  const b2 = WP.guessLeagueTeam(teams, 'Burlington Bulldogs Blue U10 BB');
  assert.equal(b2.team.teamId, '2712:burlington-bulldogs-blue');
  assert.ok(b2.sure);
  assert.equal(WP.guessLeagueTeam(teams, 'Spare team'), null);
});
