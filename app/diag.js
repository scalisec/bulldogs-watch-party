/* Watch Party — Performance log (v2.2): records freezes and what was happening, to find out why the app stalls.
   Always on and light: it watches the screen's frames, the video's frames, slow script work and slow key/click
   handling, and keeps the last ~1,500 events in this browser (nothing is sent anywhere). Settings › Troubleshooting
   shows a summary, and "Download log" saves it as a file to share. F8 marks "it froze just now". */
App.ready.then(() => {
  'use strict';
  const { $, el, toast } = App;

  const KEY = 'bwp-diag';
  const MAX = 1500;
  const D = { events: [], prev: null, sessionStart: Date.now(), counts: {}, dirty: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.events)) D.prev = saved; // the last session's log (kept so a reload after a freeze doesn't lose it)
  } catch (e) { /* ignore */ }

  const r = (n) => Math.round(n);
  const video = () => {
    const v = !$('view-edit').classList.contains('hidden') ? $('e-video') : $('video');
    return v && v.src ? v : null;
  };

  /** What the app was doing: screen, playing, speed, zoom, video size and position. */
  function ctx() {
    const v = video();
    const c = { view: (location.hash.replace('#', '') || 'games').split('/')[0], vis: document.visibilityState };
    if (v) {
      c.playing = !v.paused; c.rate = v.playbackRate; c.vt = Math.round(v.currentTime * 10) / 10; c.ready = v.readyState;
      c.res = v.videoWidth + 'x' + v.videoHeight;
      if (v.getVideoPlaybackQuality) { const q = v.getVideoPlaybackQuality(); c.dropped = q.droppedVideoFrames; c.frames = q.totalVideoFrames; }
    }
    if (App.zoom && App.zoom.scale) c.zoom = Math.round(App.zoom.scale * 10) / 10;
    return c;
  }

  function log(type, data, withCtx) {
    const ev = Object.assign({ at: Date.now(), type }, data || {}, withCtx === false ? {} : ctx());
    D.events.push(ev);
    if (D.events.length > MAX) D.events.splice(0, D.events.length - MAX);
    D.counts[type] = (D.counts[type] || 0) + 1;
    D.dirty = true;
    if (type === 'freeze' || type === 'video-stuck' || type === 'marked') renderDiagSoon();
    return ev;
  }

  // ---- 1. the screen stops updating (frames not drawn): a gap between animation frames while the tab is visible ----
  let lastFrame = performance.now();
  let lastVisible = document.visibilityState === 'visible';
  function frame(now) {
    const gap = now - lastFrame;
    if (document.visibilityState === 'visible' && lastVisible && gap > 500) log(gap >= 1500 ? 'freeze' : 'slow-frame', { ms: r(gap) });
    lastVisible = document.visibilityState === 'visible';
    lastFrame = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); lastVisible = document.visibilityState === 'visible'; log('visibility', { state: document.visibilityState }, false); });

  // ---- 2. the app itself is busy (script blocked): a timer that should fire every 250 ms runs late ----
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const late = now - lastTick - 250;
    if (late > 400 && document.visibilityState === 'visible') { D.busyAt = now; log('busy', { ms: r(late) }); }
    lastTick = now;
  }, 250);

  // ---- 3. the video stops showing new pictures while it plays (sound and keys keep going) ----
  // requestVideoFrameCallback fires for every video frame put on screen.
  const watched = new Map(); // video element -> { lastFrameAt, lastMediaTime, reported }
  function watchVideo(v) {
    if (!v || !v.requestVideoFrameCallback || watched.has(v)) return;
    const st = { lastFrameAt: 0, lastMediaTime: 0, reported: false };
    watched.set(v, st);
    const onFrame = (now, meta) => {
      st.lastFrameAt = performance.now(); st.lastMediaTime = meta.mediaTime; st.reported = false;
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    for (const name of ['waiting', 'stalled', 'error', 'emptied']) v.addEventListener(name, () => log('video-' + name, v.error ? { code: v.error.code, msg: v.error.message } : {}));
    v.addEventListener('loadedmetadata', () => log('video-load', {}));
    // frames stop while paused or seeking: start counting again from when it plays
    v.addEventListener('playing', () => { st.lastFrameAt = performance.now(); st.reported = false; });
    let seekStart = 0;
    v.addEventListener('seeking', () => { seekStart = performance.now(); });
    v.addEventListener('seeked', () => { st.lastFrameAt = performance.now(); const ms = performance.now() - seekStart; if (ms > 800) log('slow-seek', { ms: r(ms) }); });
  }
  watchVideo($('video')); watchVideo($('e-video'));
  setInterval(() => {
    const v = video();
    const st = v && watched.get(v);
    if (!st || v.paused || v.seeking || v.readyState < 3 || document.visibilityState !== 'visible') return;
    // the app itself was busy just now: that's not the video's fault (it can't report frames while the app is blocked)
    if (performance.now() - (D.busyAt || -1e9) < 3000) { st.lastFrameAt = performance.now(); return; }
    const since = performance.now() - st.lastFrameAt;
    if (st.lastFrameAt && since > 1200 && !st.reported) {
      st.reported = true;
      log('video-stuck', { ms: r(since), timeMoved: Math.round((v.currentTime - st.lastMediaTime) * 10) / 10 });
    }
  }, 500);

  // ---- 4. slow script work and slow responses to keys/clicks (Chrome's own measurements) ----
  function observe(type, fn, opts) {
    try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe(Object.assign({ type, buffered: false }, opts || {})); } catch (e) { /* not supported */ }
  }
  observe('long-animation-frame', (e) => {
    if (e.duration < 300) return;
    const s = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
    log('long-frame', { ms: r(e.duration), blocking: r(e.blockingDuration || 0), script: s ? [s.invoker, s.sourceFunctionName, (s.sourceURL || '').split('/').pop()].filter(Boolean).join(' ') : '' });
  });
  observe('longtask', (e) => { if (e.duration >= 300) log('long-task', { ms: r(e.duration) }); });
  observe('event', (e) => { if (e.duration >= 300) log('slow-input', { ms: r(e.duration), input: e.name }); }, { durationThreshold: 300 });

  // ---- 5. memory (Chrome only), errors and what the app was doing ----
  setInterval(() => {
    const m = performance.memory;
    if (m) log('memory', { usedMB: r(m.usedJSHeapSize / 1e6), limitMB: r(m.jsHeapSizeLimit / 1e6) }, false);
  }, 60000);
  window.addEventListener('error', (e) => log('error', { msg: String(e.message || e.error || '').slice(0, 300), where: (e.filename || '').split('/').pop() + ':' + (e.lineno || '') }));
  window.addEventListener('unhandledrejection', (e) => log('error', { msg: String((e.reason && e.reason.message) || e.reason || '').slice(0, 300), where: 'promise' }));
  window.addEventListener('hashchange', () => log('screen', {}));

  // ---- F8: "it froze just now" ----
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F8') return;
    e.preventDefault();
    log('marked', { note: 'Coach pressed F8' });
    toast('Freeze marked in the performance log (Settings › Troubleshooting)');
  });

  // ---- the computer: browser, screen, graphics (shows if hardware acceleration is off) ----
  function env() {
    const e = { app: WP.APP_VERSION, ua: navigator.userAgent, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
      screen: screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1), window: innerWidth + 'x' + innerHeight };
    try {
      const c = document.createElement('canvas').getContext('webgl');
      const ext = c && c.getExtension('WEBGL_debug_renderer_info');
      e.gpu = c ? String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : 'none (WebGL off)';
    } catch (x) { e.gpu = 'unknown'; }
    e.hardwareAccel = /swiftshader|llvmpipe|software|basic render/i.test(e.gpu) ? 'off (software drawing)' : 'on';
    return e;
  }

  // ---- saving (in this browser only) ----
  function persist() {
    if (!D.dirty) return;
    D.dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify({ sessionStart: D.sessionStart, savedAt: Date.now(), env: env(), events: D.events.slice(-MAX) })); } catch (e) { /* storage full: keep in memory */ }
  }
  setInterval(persist, 30000);
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });

  // ---- what the log points to ----
  /**
   * A plain reading of the events: which kind of freeze happens most, and what to try.
   * video-stuck = the video picture stopped while the app ran (graphics / video decoding);
   * freeze = the whole screen stopped drawing; busy / long-frame = the app's own work.
   */
  function diagnose(events) {
    const n = (t) => events.filter((x) => x.type === t).length;
    const busyTimes = events.filter((x) => x.type === 'busy' || (x.type === 'long-frame' && x.ms >= 1000)).map((x) => x.at);
    const nearBusy = (x) => busyTimes.some((t) => Math.abs(t - x.at) < 3000);
    const video = events.filter((x) => x.type === 'video-stuck' && !nearBusy(x)).length;
    const screenF = events.filter((x) => x.type === 'freeze' && !nearBusy(x)).length;
    const busy = events.filter((x) => x.type === 'freeze' && nearBusy(x)).length + events.filter((x) => x.type === 'busy' && !events.some((y) => y.type === 'freeze' && Math.abs(y.at - x.at) < 3000)).length;
    const marked = n('marked');
    const gpu = (D.envCache = D.envCache || env());
    const lines = [];
    if (!video && !screenF && !busy) lines.push(marked ? 'You marked freezes, but nothing slow was measured at those times. That points to the graphics card or Windows rather than the app: try the hardware acceleration switch below.' : 'No freezes recorded yet. Keep using the app; when it freezes, press F8 so the moment is marked.');
    if (video) lines.push(video + ' time' + (video === 1 ? '' : 's') + ' the video picture stopped while the app kept running (the sound and keys keep working). That’s the video decoding / graphics side, not the app’s code. Try: Chrome Settings › System › “Use graphics acceleration when available” (turn it off, restart Chrome, test; then back on if it’s worse), update the graphics driver, and play the LiveBarn file from your computer’s drive rather than a cloud-synced folder.');
    if (screenF) lines.push(screenF + ' time' + (screenF === 1 ? '' : 's') + ' the whole screen stopped drawing for 1.5 s or more.' + (busy ? '' : ' The app wasn’t busy then, so it’s the browser/graphics side.'));
    if (busy) lines.push(busy + ' time' + (busy === 1 ? '' : 's') + ' the app’s own work took over a second. The log names the code involved; send it to me.');
    if (/off/.test(gpu.hardwareAccel)) lines.push('Hardware acceleration looks OFF in this browser (graphics: ' + gpu.gpu + '). Video then plays on the processor, which can stall on 1080p LiveBarn files. Turn it on in Chrome Settings › System.');
    return lines;
  }

  function renderDiag() {
    const box = $('diag-body');
    if (!box) return;
    const ev = D.events;
    const recent = ev.filter((x) => ['freeze', 'video-stuck', 'busy', 'long-frame', 'slow-input', 'slow-seek', 'marked', 'error', 'video-error', 'video-stalled'].includes(x.type)).slice(-12).reverse();
    const label = { freeze: 'Screen stopped', 'video-stuck': 'Video picture stuck', busy: 'App busy', 'long-frame': 'Slow work', 'slow-input': 'Slow key/click', 'slow-seek': 'Slow jump', marked: 'You pressed F8', error: 'Error', 'video-error': 'Video error', 'video-stalled': 'Video stalled' };
    const when = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const e = env();
    box.replaceChildren(
      el('div', { class: 'row small muted', style: 'gap:6px 16px' },
        el('span', {}, 'Since ' + when(D.sessionStart) + ': '),
        el('span', {}, (D.counts['video-stuck'] || 0) + ' video stuck'),
        el('span', {}, (D.counts.freeze || 0) + ' screen stopped'),
        el('span', {}, ((D.counts.busy || 0) + (D.counts['long-frame'] || 0)) + ' slow app work'),
        el('span', {}, (D.counts.marked || 0) + ' marked with F8'),
        el('span', {}, 'Graphics: ' + e.gpu + ' (acceleration ' + e.hardwareAccel + ')')),
      el('div', { class: 'stack', style: 'gap:6px' }, ...diagnose(ev.concat(D.prev ? D.prev.events : [])).map((t) => el('div', { class: 'diagnote' }, t))),
      recent.length ? el('div', { class: 'tablewrap' }, el('table', { class: 'dtable', id: 'diag-recent' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'What'), el('th', {}, 'How long'), el('th', {}, 'Screen'), el('th', {}, 'Video'))),
        el('tbody', {}, ...recent.map((x) => el('tr', {},
          el('td', { style: 'white-space:nowrap' }, when(x.at)),
          el('td', {}, label[x.type] || x.type, x.script ? el('div', { class: 'small muted' }, x.script) : '', x.msg ? el('div', { class: 'small muted' }, x.msg) : ''),
          el('td', {}, x.ms ? (x.ms / 1000).toFixed(1) + ' s' : ''),
          el('td', {}, ({ tag: 'Watch and tag', edit: 'Clip editor', sum: 'Summary', info: 'Game details', review: 'Review', games: 'Games', new: 'New game', summaries: 'Summaries', stats: 'Season stats', team: 'Team', settings: 'Settings' })[x.view] || x.view || ''),
          el('td', { class: 'small' }, x.res ? [x.playing ? 'playing' : 'paused', x.rate !== 1 ? x.rate + '×' : '', x.res, x.zoom > 1 ? 'zoom ' + x.zoom + '×' : ''].filter(Boolean).join(' · ') : '')))))) : '',
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn small primary', onclick: download }, 'Download log'),
        el('button', { type: 'button', class: 'btn small', onclick: () => { log('marked', { note: 'Marked from Settings' }); renderDiag(); } }, 'Mark a freeze now'),
        el('button', { type: 'button', class: 'btn small', onclick: clear }, 'Clear log')),
      el('span', { class: 'small muted' }, 'Always on and light. When the app freezes, press F8 (the keys keep working during a freeze), then come here and press Download log and send me the file. The log stays in this browser; it has screen names, times and video positions, nothing about players.'));
  }
  let renderT = 0;
  function renderDiagSoon() { clearTimeout(renderT); renderT = setTimeout(() => { if (!$('view-settings').classList.contains('hidden')) renderDiag(); }, 300); }

  function download() {
    const data = { app: 'bulldogs-watch-party', kind: 'performance-log', created: new Date().toISOString(), env: env(), diagnosis: diagnose(D.events.concat(D.prev ? D.prev.events : [])),
      session: { start: new Date(D.sessionStart).toISOString(), counts: D.counts, events: D.events }, previousSession: D.prev };
    App.download('watch-party-performance-log-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', JSON.stringify(data, null, 1));
  }
  function clear() {
    D.events = []; D.counts = {}; D.prev = null; D.sessionStart = Date.now(); D.dirty = false;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    renderDiag();
    toast('Performance log cleared');
  }

  log('start', { env: env() }, false);
  App.diag = { log, events: () => D.events, diagnose, renderDiag, persist, env };
}).catch((e) => setTimeout(() => { throw e; }));
