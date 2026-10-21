/* Bulldogs Watch Party — Plays a game’s LiveBarn parts as one continuous video. */
App.ready.then(() => {
  'use strict';
  const {
    toast
  } = App;

  // =====================================================================
  // PLAYER — plays several part files as one timeline
  // =====================================================================
  function createPlayer(video, files, tl, gameId, onTick) {
    const urls = files.map((f) => URL.createObjectURL(f));
    let cur = -1;
    let rate = 1;
    let wantPlay = false;
    let rangeEnd = null;
    let raf = 0;
    let chain = Promise.resolve();
    let dead = false;

    function once(name, ms) {
      return new Promise((res) => {
        const t = setTimeout(done, ms || 4000);
        function done() { clearTimeout(t); video.removeEventListener(name, done); res(); }
        video.addEventListener(name, done);
      });
    }

    function loadPart(i) {
      if (i === cur) return Promise.resolve();
      cur = i;
      return new Promise((res, rej) => {
        const ok = () => { off(); res(); };
        const bad = () => { off(); rej(new Error('This browser can’t play ' + files[i].name + '. Use Chrome or Edge.')); };
        function off() { video.removeEventListener('loadedmetadata', ok); video.removeEventListener('error', bad); }
        video.addEventListener('loadedmetadata', ok);
        video.addEventListener('error', bad);
        video.src = urls[i];
        video.defaultPlaybackRate = rate;
        video.playbackRate = rate;
      });
    }

    async function doSeek(t) {
      if (dead) return;
      const loc = WP.locate(tl, t);
      await loadPart(loc.part);
      video.playbackRate = rate;
      if (Math.abs(video.currentTime - loc.local) > 0.01) {
        video.currentTime = loc.local;
        if (video.seeking) await once('seeked');
      }
      onTick();
      if (wantPlay) video.play().catch(() => {});
    }

    function seek(t) {
      chain = chain.then(() => doSeek(t)).catch((e) => { toast(e.message, { err: true }); });
      return chain;
    }

    function time() { return cur < 0 ? 0 : tl.offsets[cur] + (video.currentTime || 0); }

    function loop() {
      cancelAnimationFrame(raf);
      if (rangeEnd != null && time() >= rangeEnd) { api.pause(); }
      onTick();
      if (!video.paused) raf = requestAnimationFrame(loop);
    }

    const handlers = {
      play: () => loop(),
      pause: () => { cancelAnimationFrame(raf); onTick(); },
      seeked: () => onTick(),
      ended: () => {
        if (wantPlay && cur < files.length - 1) seek(tl.offsets[cur + 1]);
        else { wantPlay = false; onTick(); }
      }
    };
    for (const [k, fn] of Object.entries(handlers)) video.addEventListener(k, fn);

    const api = {
      gameId,
      time,
      seek,
      isPlaying: () => wantPlay,
      play() {
        wantPlay = true;
        if (time() >= tl.total - 0.05) return seek(0);
        if (cur < 0) return seek(0);
        video.play().catch(() => {});
        onTick();
        return chain;
      },
      pause() { wantPlay = false; rangeEnd = null; video.pause(); onTick(); },
      toggle() { return wantPlay ? api.pause() : api.play(); },
      nudge(d) { return seek(Math.max(0, Math.min(tl.total, time() + d))); },
      setRate(r) { rate = r; video.defaultPlaybackRate = r; video.playbackRate = r; },
      playRange(s, e) { rangeEnd = e; wantPlay = true; return seek(s); },
      resume() { wantPlay = true; rangeEnd = null; video.play().catch(() => {}); },
      partOffset() { return cur < 0 ? 0 : tl.offsets[cur]; },
      partIndex() { return cur; },
      partCount() { return files.length; },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        video.pause();
        for (const [k, fn] of Object.entries(handlers)) video.removeEventListener(k, fn);
        video.removeAttribute('src');
        video.load();
        urls.forEach((u) => URL.revokeObjectURL(u));
      }
    };
    return api;
  }
  Object.assign(App, {
    createPlayer
  });
}).catch((e) => setTimeout(() => { throw e; }));
