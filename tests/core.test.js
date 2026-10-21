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
