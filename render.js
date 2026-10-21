/* Bulldogs Watch Party — drawing frames and exporting MP4 clips in the browser.
   The editor preview and the export use the same renderFrame(), so what you see is what families get. */
(function (root) {
  'use strict';
  const WP = root.WP;

  // ---------- drawing one frame ----------
  function drawVideo(ctx, video, zoom, W, H) {
    ctx.fillStyle = '#0B1220';
    ctx.fillRect(0, 0, W, H);
    if (!video || !video.videoWidth) return;
    const r = WP.zoomSourceRect(zoom, video.videoWidth, video.videoHeight);
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
  }

  function toCanvas(zoom, W, H, p) {
    const v = WP.frameToView(zoom, p[0], p[1]);
    return [v.x * W, v.y * H];
  }

  function strokeTwice(ctx, color, width, pathFn) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = width + Math.max(2, width * 0.6);
    pathFn(); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    pathFn(); ctx.stroke();
  }

  function drawShape(ctx, s, zoom, W, H) {
    if (s.alpha != null && s.alpha < 1) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      drawShape(ctx, Object.assign({}, s, { alpha: null }), zoom, W, H);
      ctx.restore();
      return;
    }
    const lw = Math.max(3, H * 0.009);
    const pts = s.pts.map((p) => toCanvas(zoom, W, H, p));
    if (s.type === 'free') {
      strokeTwice(ctx, s.color, lw, () => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      });
    } else if (s.type === 'circle') {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const rx = Math.max(lw, Math.abs(b[0] - a[0]) / 2);
      const ry = Math.max(lw, Math.abs(b[1] - a[1]) / 2);
      strokeTwice(ctx, s.color, lw, () => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); });
    } else if (s.type === 'arrow') {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = Math.max(lw * 4, H * 0.035);
      strokeTwice(ctx, s.color, lw, () => {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.moveTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45));
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45));
      });
    }
  }

  function drawTitle(ctx, lines, W, H) {
    if (!lines || !lines.top) return;
    const two = !!lines.bottom;
    const band = Math.round(H * (two ? 0.15 : 0.1));
    const pad = Math.round(H * 0.03);
    ctx.fillStyle = 'rgba(14,26,43,0.80)';
    ctx.fillRect(0, H - band, W, band);
    ctx.fillStyle = '#1D4ED8';
    ctx.fillRect(0, H - band, Math.max(4, W * 0.006), band);
    ctx.textBaseline = 'middle';
    const f1 = Math.round(H * 0.045);
    const f2 = Math.round(H * 0.036);
    const fit = (text, font, maxW) => {
      ctx.font = font;
      let t = text;
      while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -2);
      return t === text ? t : t.trimEnd() + '…';
    };
    const x = pad + Math.max(4, W * 0.006);
    const maxW = W - x - pad;
    ctx.fillStyle = '#FFFFFF';
    const font1 = '600 ' + f1 + 'px Inter, "Segoe UI", system-ui, sans-serif';
    const font2 = '400 ' + f2 + 'px Inter, "Segoe UI", system-ui, sans-serif';
    if (two) {
      ctx.fillText(fit(lines.top, font1, maxW), x, H - band + band * 0.33);
      ctx.fillStyle = '#DCE4F0';
      ctx.fillText(fit(lines.bottom, font2, maxW), x, H - band + band * 0.70);
    } else {
      ctx.fillText(fit(lines.top, font1, maxW), x, H - band / 2);
    }
  }

  function renderFrame(ctx, video, o) {
    drawVideo(ctx, video, o.zoom, o.W, o.H);
    for (const s of o.shapes || []) drawShape(ctx, s, o.zoom, o.W, o.H);
    if (o.draft) drawShape(ctx, o.draft, o.zoom, o.W, o.H);
    if (o.title) drawTitle(ctx, o.title, o.W, o.H);
  }

  // ---------- codec choice ----------
  async function pickCodec(W, H) {
    if (!('VideoEncoder' in root)) throw new Error('This browser can’t make video files. Use the latest Chrome or Edge.');
    const tries = [
      { id: 'avc1.64001f', mux: 'avc', h264: true },  // High
      { id: 'avc1.4d001f', mux: 'avc', h264: true },  // Main
      { id: 'avc1.42001f', mux: 'avc', h264: true },  // Baseline
      { id: 'vp09.00.31.08', mux: 'vp9', h264: false },
      { id: 'vp09.00.10.08', mux: 'vp9', h264: false }
    ];
    for (const t of tries) {
      const cfg = { codec: t.id, width: W, height: H, bitrate: 2500000, framerate: 30 };
      if (t.h264) cfg.avc = { format: 'avc' };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return Object.assign({}, t, { config: cfg });
      } catch (e) { /* try next */ }
    }
    throw new Error('This browser can’t make MP4 video. Use the latest Chrome or Edge.');
  }

  function waitEvent(el, name, ms) {
    return new Promise((res) => {
      const t = setTimeout(done, ms || 5000);
      function done() { clearTimeout(t); el.removeEventListener(name, done); res(); }
      el.addEventListener(name, done);
    });
  }

  /**
   * Play the clip's plan on `player`, calling onFrame(sourceTime, outTime, segment) for every video frame shown.
   * mode 'preview' waits in real time during holds; mode 'export' emits hold frames immediately.
   */
  async function runPlan(player, video, plan, o) {
    const fps = 30;
    for (const seg of plan) {
      if (o.signal && o.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (o.onSegment) o.onSegment(seg);
      if (seg.kind === 'hold') {
        player.pause();
        await player.seek(seg.at);
        if (o.mode === 'export') {
          for (let t = seg.outStart; t < seg.outEnd - 1e-6; t += 1 / fps) await o.onFrame(seg.at, t, seg);
        } else {
          o.onFrame(seg.at, seg.outStart, seg);
          const started = performance.now();
          while (performance.now() - started < seg.hold * 1000) {
            if (o.signal && o.signal.aborted) throw new DOMException('Stopped', 'AbortError');
            await new Promise((r) => setTimeout(r, 50));
            if (o.onTick) o.onTick(seg.outStart + (performance.now() - started) / 1000);
          }
        }
        continue;
      }
      // play segment
      player.pause();
      player.setRate(seg.rate);
      await player.seek(seg.from);
      await o.onFrame(seg.from, seg.outStart, seg);
      await new Promise((resolve, reject) => {
        let last = seg.from;
        let finished = false;
        let watchdog = 0;
        const finish = (err) => {
          if (finished) return;
          finished = true;
          clearInterval(watchdog);
          video.removeEventListener('ended', onEnded);
          player.pause();
          if (err) reject(err); else resolve();
        };
        const onEnded = () => { if (player.partIndex() >= player.partCount() - 1) finish(); };
        video.addEventListener('ended', onEnded);
        let lastBeat = performance.now();
        const arm = () => video.requestVideoFrameCallback(onVideoFrame);
        async function onVideoFrame(now, meta) {
          if (finished) return;
          lastBeat = performance.now();
          if (o.signal && o.signal.aborted) { finish(new DOMException('Stopped', 'AbortError')); return; }
          const s = player.partOffset() + meta.mediaTime;
          if (s >= seg.to - 0.001) { finish(); return; }
          if (s > last + 1e-4) {
            last = s;
            try { await o.onFrame(s, seg.outStart + (s - seg.from) / seg.rate, seg); } catch (e) { finish(e); return; }
          }
          arm();
        }
        arm();
        // re-arm after a part change or a stall; also stop if the clock passes the end
        watchdog = setInterval(() => {
          if (finished) return;
          if (player.time() >= seg.to - 0.001 && video.paused) { finish(); return; }
          if (performance.now() - lastBeat > 1200) { lastBeat = performance.now(); arm(); }
        }, 250);
        player.resume();
      });
    }
    player.pause();
    player.setRate(1);
  }

  // ---------- voice-over audio ----------
  const AUDIO_RATE = 48000;

  /** Decode a recorded voice blob to mono samples at 48 kHz. */
  async function decodeVoice(blob) {
    const ctx = new (root.AudioContext || root.webkitAudioContext)({ sampleRate: AUDIO_RATE });
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const n = buf.length;
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
      }
      return { samples: mono, sampleRate: buf.sampleRate };
    } finally { ctx.close(); }
  }

  async function pickAudioCodec(sampleRate) {
    if (!('AudioEncoder' in root)) return null;
    const tries = [
      { id: 'mp4a.40.2', mux: 'aac', bitrate: 96000 },
      { id: 'opus', mux: 'opus', bitrate: 64000 }
    ];
    for (const t of tries) {
      const config = { codec: t.id, sampleRate, numberOfChannels: 1, bitrate: t.bitrate };
      try {
        const r = await AudioEncoder.isConfigSupported(config);
        if (r.supported) return Object.assign({}, t, { config });
      } catch (e) { /* next */ }
    }
    return null;
  }

  async function encodeAudio(voice, codec, muxer, maxSeconds) {
    let err = null;
    const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure(codec.config);
    const sr = voice.sampleRate;
    const total = Math.min(voice.samples.length, Math.floor(maxSeconds * sr));
    const step = 1024;
    for (let i = 0; i < total; i += step) {
      const n = Math.min(step, total - i);
      const data = voice.samples.slice(i, i + n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / sr) * 1e6), data });
      enc.encode(ad);
      ad.close();
      if (err) throw err;
    }
    await enc.flush();
    enc.close();
    if (err) throw err;
  }

  /** Export one clip to an MP4 Blob.
      o.frameAt(outT, seg) -> { zoom, shapes } lets a recorded breakdown change zoom and drawings frame by frame.
      o.voiceBlob adds the coach's voice as the sound track. */
  async function exportClip(o) {
    const { player, video, plan, W, H } = o;
    const codec = await pickCodec(W, H);
    const total = WP.planDuration(plan);
    let voice = null;
    let acodec = null;
    if (o.voiceBlob) {
      voice = await decodeVoice(o.voiceBlob);
      acodec = await pickAudioCodec(voice.sampleRate);
      if (!acodec) throw new Error('This browser can\u2019t add sound to video files. Use the latest Chrome or Edge.');
    }
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer(Object.assign({ target, video: { codec: codec.mux, width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' },
      acodec ? { audio: { codec: acodec.mux, numberOfChannels: 1, sampleRate: voice.sampleRate } } : {}));
    if (voice) await encodeAudio(voice, acodec, muxer, total);
    let encErr = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
    enc.configure(Object.assign({}, codec.config, { latencyMode: 'quality' }));
    const canvas = o.canvas || document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    let lastKey = -Infinity;
    let lastTs = -1;
    let frames = 0;
    const was = { muted: video.muted };
    video.muted = true;
    try {
      await runPlan(player, video, plan, {
        mode: 'export',
        signal: o.signal,
        onFrame: async (s, outT, seg) => {
          if (encErr) throw encErr;
          const ts = Math.round(outT * 1e6);
          if (ts <= lastTs) return;
          lastTs = ts;
          const st = o.frameAt ? o.frameAt(outT, seg) : { zoom: o.zoom, shapes: seg.kind === 'hold' ? o.shapes : null };
          renderFrame(ctx, video, { zoom: st.zoom, W, H, title: o.title, shapes: st.shapes });
          const vf = new VideoFrame(canvas, { timestamp: ts });
          const key = outT - lastKey >= 2;
          if (key) lastKey = outT;
          enc.encode(vf, { keyFrame: key });
          vf.close();
          frames += 1;
          if (enc.encodeQueueSize > 8 && seg.kind === 'hold') await new Promise((r) => setTimeout(r, 0));
          if (o.onProgress) o.onProgress(Math.min(1, outT / total));
        }
      });
      // close the last frame so the file lasts the full length
      if (lastTs < Math.round(total * 1e6) - 1000) {
        const vf = new VideoFrame(canvas, { timestamp: Math.round(total * 1e6) - 1000 });
        enc.encode(vf, { keyFrame: false });
        vf.close();
      }
      await enc.flush();
      if (encErr) throw encErr;
      muxer.finalize();
    } finally {
      video.muted = was.muted;
      try { enc.close(); } catch (e) { /* already closed */ }
    }
    if (o.onProgress) o.onProgress(1);
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), codec: codec.id, h264: codec.h264, audio: acodec ? acodec.id : null, frames, duration: total };
  }

  root.WPRender = { drawVideo, drawShape, drawTitle, renderFrame, pickCodec, pickAudioCodec, decodeVoice, runPlan, exportClip, waitEvent };
})(window);
