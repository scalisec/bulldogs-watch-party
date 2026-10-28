/* Watch Party — rink sound for exported clips (v1.7).
   Reads just the audio a clip needs straight from the LiveBarn MP4 (no need to load an hour-long file):
   finds the file's index ("moov"), looks up the audio samples for those seconds, decodes them with the
   browser's AudioDecoder and lays them out on the clip's timeline. Normal-speed parts get sound;
   slow-motion and freeze parts stay quiet. Works in the browser (window.WPAudio) and Node (parser only). */
(function (root) {
  'use strict';

  const OUT_RATE = 48000;
  const FADE = 0.012; // seconds of fade at each edge, so cuts don't click

  // ---------- MP4 boxes ----------
  const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
  const u16 = (b, o) => (b[o] << 8) + b[o + 1];
  const typeAt = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  /** Top-level boxes of a file, reading only their headers: [{ type, start, size }]. read(offset, length) -> Uint8Array. */
  async function topBoxes(read, fileSize) {
    const out = [];
    let pos = 0;
    while (pos + 8 <= fileSize && out.length < 64) {
      const h = await read(pos, 16);
      let size = u32(h, 0);
      const type = typeAt(h, 4);
      if (size === 1) size = u64(h, 8);
      else if (size === 0) size = fileSize - pos;
      if (size < 8) break;
      out.push({ type, start: pos, size });
      pos += size;
    }
    return out;
  }

  /** Child boxes inside bytes[from, to). */
  function children(b, from, to) {
    const out = [];
    let p = from;
    while (p + 8 <= to) {
      let size = u32(b, p);
      const type = typeAt(b, p + 4);
      let head = 8;
      if (size === 1) { size = u64(b, p + 8); head = 16; } else if (size === 0) size = to - p;
      if (size < head || p + size > to) break;
      out.push({ type, start: p, body: p + head, end: p + size });
      p += size;
    }
    return out;
  }
  const child = (b, box, type) => children(b, box.body, box.end).find((c) => c.type === type) || null;

  /** MPEG-4 descriptor length (1–4 bytes, 7 bits each). */
  function descLen(b, p) {
    let len = 0, n = 0;
    for (; n < 4; n++) { const x = b[p + n]; len = (len << 7) | (x & 0x7f); if (!(x & 0x80)) { n++; break; } }
    return { len, n };
  }

  /** AudioSpecificConfig bytes from an esds box (ES_Descriptor > DecoderConfig > DecSpecificInfo). */
  function ascFromEsds(b, esds) {
    let p = esds.body + 4; // version + flags
    const walk = (p, end, want) => {
      while (p < end) {
        const tag = b[p];
        const { len, n } = descLen(b, p + 1);
        const body = p + 1 + n;
        if (tag === want) return { body, end: body + len };
        p = body + len;
      }
      return null;
    };
    const es = walk(p, esds.end, 0x03);
    if (!es) return null;
    let q = es.body + 2; // ES_ID
    const flags = b[q]; q += 1;
    if (flags & 0x80) q += 2;
    if (flags & 0x40) q += 1 + b[q];
    if (flags & 0x20) q += 2;
    const dc = walk(q, es.end, 0x04);
    if (!dc) return null;
    const dsi = walk(dc.body + 13, dc.end, 0x05);
    return dsi ? b.slice(dsi.body, dsi.end) : null;
  }

  /**
   * The audio track from a moov box's bytes (fileOffset = where those bytes start in the file):
   * { codec, sampleRate, channels, description, timescale, shift, samples: [{ offset, size, dts, dur }] } or null.
   */
  function audioTrack(b) {
    const moov = children(b, 0, b.length).find((c) => c.type === 'moov');
    if (!moov) return null;
    for (const trak of children(b, moov.body, moov.end).filter((c) => c.type === 'trak')) {
      const mdia = child(b, trak, 'mdia');
      if (!mdia) continue;
      const hdlr = child(b, mdia, 'hdlr');
      if (!hdlr || typeAt(b, hdlr.body + 8) !== 'soun') continue;
      const mdhd = child(b, mdia, 'mdhd');
      const timescale = b[mdhd.body] === 1 ? u32(b, mdhd.body + 20) : u32(b, mdhd.body + 12);
      const stbl = child(b, child(b, mdia, 'minf'), 'stbl');
      const stsd = child(b, stbl, 'stsd');
      const entry = children(b, stsd.body + 8, stsd.end)[0];
      if (!entry || (entry.type !== 'mp4a' && entry.type !== 'Opus')) return { unsupported: entry ? entry.type : 'none' };
      const ver = u16(b, entry.body + 8);
      let channels = u16(b, entry.body + 16);
      let sampleRate = u32(b, entry.body + 24) >>> 16;
      const kidsFrom = entry.body + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
      let codec, description;
      if (entry.type === 'mp4a') {
        // AAC (what LiveBarn uses)
        const esds = children(b, kidsFrom, entry.end).find((c) => c.type === 'esds');
        const asc = esds ? ascFromEsds(b, esds) : null;
        if (!asc || !asc.length) return { unsupported: 'mp4a without config' };
        codec = 'mp4a.40.' + (asc[0] >> 3);
        description = asc;
      } else {
        // Opus in MP4: the dOps box becomes an OpusHead header (little-endian) for the decoder
        const dops = children(b, kidsFrom, entry.end).find((c) => c.type === 'dOps');
        if (!dops) return { unsupported: 'Opus without config' };
        const d = dops.body;
        channels = b[d + 1];
        const head = new Uint8Array(19);
        head.set([79, 112, 117, 115, 72, 101, 97, 100, 1, channels]); // "OpusHead", version 1
        const pre = u16(b, d + 2), rate = u32(b, d + 4), gain = u16(b, d + 8);
        head[10] = pre & 255; head[11] = pre >> 8;
        head[12] = rate & 255; head[13] = (rate >> 8) & 255; head[14] = (rate >> 16) & 255; head[15] = (rate >>> 24) & 255;
        head[16] = gain & 255; head[17] = gain >> 8; head[18] = 0;
        codec = 'opus';
        description = head;
        sampleRate = 48000;
      }
      // sample table
      const tbl = (t) => child(b, stbl, t);
      const stts = tbl('stts'), stsc = tbl('stsc'), stsz = tbl('stsz'), stco = tbl('stco'), co64 = tbl('co64');
      const n = u32(b, stsz.body + 8);
      const fixed = u32(b, stsz.body + 4);
      const sizes = new Array(n);
      for (let i = 0; i < n; i++) sizes[i] = fixed || u32(b, stsz.body + 12 + i * 4);
      const chunkCount = u32(b, (stco || co64).body + 4);
      const chunks = new Array(chunkCount);
      for (let i = 0; i < chunkCount; i++) chunks[i] = stco ? u32(b, stco.body + 8 + i * 4) : u64(b, co64.body + 8 + i * 8);
      const runs = [];
      const scN = u32(b, stsc.body + 4);
      for (let i = 0; i < scN; i++) runs.push({ first: u32(b, stsc.body + 8 + i * 12), per: u32(b, stsc.body + 12 + i * 12) });
      const samples = new Array(n);
      let s = 0;
      for (let r = 0; r < runs.length && s < n; r++) {
        const lastChunk = r + 1 < runs.length ? runs[r + 1].first - 1 : chunkCount;
        for (let c = runs[r].first; c <= lastChunk && s < n; c++) {
          let off = chunks[c - 1];
          for (let k = 0; k < runs[r].per && s < n; k++) { samples[s] = { offset: off, size: sizes[s], dts: 0, dur: 0 }; off += sizes[s]; s++; }
        }
      }
      let dts = 0, idx = 0;
      const ttN = u32(b, stts.body + 4);
      for (let i = 0; i < ttN; i++) {
        const count = u32(b, stts.body + 8 + i * 8), delta = u32(b, stts.body + 12 + i * 8);
        for (let k = 0; k < count && idx < n; k++, idx++) { if (samples[idx]) { samples[idx].dts = dts; samples[idx].dur = delta; } dts += delta; }
      }
      // edit list: audio usually starts with some priming samples that aren't played
      let shift = 0;
      const edts = child(b, trak, 'edts');
      const elst = edts && child(b, edts, 'elst');
      if (elst) {
        const v = b[elst.body];
        const cnt = u32(b, elst.body + 4);
        for (let i = 0; i < cnt; i++) {
          const o = elst.body + 8 + i * (v === 1 ? 20 : 12);
          const mt = v === 1 ? u64(b, o + 8) : u32(b, o + 4);
          if (mt !== 0xffffffff && mt >= 0 && mt < 1e12) { shift = mt; break; }
        }
      }
      return { codec, sampleRate, channels: Math.max(1, channels), description, timescale, shift, samples: samples.filter(Boolean) };
    }
    return null;
  }

  /** Find and parse a file's audio track, reading only the box headers and the moov box. */
  async function readTrack(read, fileSize) {
    const boxes = await topBoxes(read, fileSize);
    const moov = boxes.find((x) => x.type === 'moov');
    if (!moov) return null;
    if (moov.size > 200 * 1024 * 1024) return null;
    const bytes = await read(moov.start, moov.size);
    return audioTrack(bytes);
  }

  // ---------- browser: decode a range of a File ----------
  const fileReader = (file) => async (offset, length) => new Uint8Array(await file.slice(offset, Math.min(file.size, offset + length)).arrayBuffer());
  const trackCache = new WeakMap();

  async function trackFor(file) {
    if (!trackCache.has(file)) trackCache.set(file, readTrack(fileReader(file), file.size).catch(() => null));
    return trackCache.get(file);
  }

  /** Mono samples for [from, to] seconds of one file: { samples, rate, start } (start = time of samples[0]) or null. */
  async function decodeRange(file, from, to) {
    const tr = await trackFor(file);
    if (!tr || tr.unsupported || !tr.samples.length || !('AudioDecoder' in root)) return null;
    const ts = tr.timescale;
    const t0 = Math.max(0, from - 0.15) * ts + tr.shift, t1 = (to + 0.15) * ts + tr.shift;
    let i0 = tr.samples.findIndex((s) => s.dts + s.dur > t0);
    if (i0 < 0) return null;
    i0 = Math.max(0, i0 - 2); // AAC needs a frame or two of lead-in
    let i1 = i0;
    while (i1 < tr.samples.length && tr.samples[i1].dts < t1) i1++;
    const pick = tr.samples.slice(i0, i1);
    if (!pick.length) return null;
    // one read for the whole stretch when the samples sit close together (they usually interleave with video)
    const lo = pick[0].offset, hi = pick[pick.length - 1].offset + pick[pick.length - 1].size;
    const blob = hi - lo < 64 * 1024 * 1024 ? new Uint8Array(await file.slice(lo, hi).arrayBuffer()) : null;
    const parts = [];
    let err = null;
    const dec = new AudioDecoder({
      output: (ad) => {
        const n = ad.numberOfFrames, ch = ad.numberOfChannels;
        const mono = new Float32Array(n);
        const tmp = new Float32Array(n);
        for (let c = 0; c < ch; c++) {
          ad.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
          for (let k = 0; k < n; k++) mono[k] += tmp[k] / ch;
        }
        parts.push({ t: ad.timestamp / 1e6, rate: ad.sampleRate, data: mono });
        ad.close();
      },
      error: (e) => { err = e; }
    });
    const config = { codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.description };
    const ok = await AudioDecoder.isConfigSupported(config).then((r) => r.supported).catch(() => false);
    if (!ok) { dec.close(); return null; }
    dec.configure(config);
    for (const s of pick) {
      const data = blob ? blob.subarray(s.offset - lo, s.offset - lo + s.size) : new Uint8Array(await file.slice(s.offset, s.offset + s.size).arrayBuffer());
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(((s.dts - tr.shift) / ts) * 1e6), duration: Math.round((s.dur / ts) * 1e6), data }));
      if (err) break;
    }
    await dec.flush().catch((e) => { err = err || e; });
    dec.close();
    if (err || !parts.length) return null;
    parts.sort((a, b) => a.t - b.t);
    const rate = parts[0].rate;
    const start = parts[0].t;
    const len = Math.round((parts[parts.length - 1].t - start) * rate) + parts[parts.length - 1].data.length;
    const samples = new Float32Array(Math.max(0, len));
    for (const p of parts) samples.set(p.data.subarray(0, Math.max(0, Math.min(p.data.length, len - Math.round((p.t - start) * rate)))), Math.max(0, Math.round((p.t - start) * rate)));
    return { samples, rate, start };
  }

  /**
   * The rink sound for a clip's plan as one mono track at 48 kHz, the length of the finished video:
   * normal-speed parts get the game's sound (from whichever part file they're in); slow motion and freezes are quiet.
   * Returns { samples, sampleRate, covered } or null when the video has no sound this browser can read.
   */
  async function rinkTrack(plan, tl, files) {
    const W = root.WP;
    const total = W.planDuration(plan);
    const out = new Float32Array(Math.ceil(total * OUT_RATE));
    let covered = 0, any = false, readable = false;
    for (const seg of plan) {
      if (seg.kind !== 'play' || Math.abs(seg.rate - 1) > 1e-6) continue;
      // split at part boundaries
      let t = seg.from;
      while (t < seg.to - 1e-3) {
        const loc = W.locate(tl, t + 1e-4);
        const partEnd = tl.offsets[loc.part] + tl.durations[loc.part];
        const e = Math.min(seg.to, partEnd);
        const file = files[loc.part];
        if (file) {
          const a = t - tl.offsets[loc.part], b = e - tl.offsets[loc.part];
          const pcm = await decodeRange(file, a, b);
          if (pcm) {
            readable = true;
            const outStart = seg.outStart + (t - seg.from);
            const n = Math.floor((b - a) * OUT_RATE);
            const fadeN = Math.floor(FADE * OUT_RATE);
            for (let k = 0; k < n; k++) {
              const src = (a + k / OUT_RATE - pcm.start) * pcm.rate;
              const i = Math.floor(src);
              if (i < 0 || i + 1 >= pcm.samples.length) continue;
              const f = src - i;
              let v = pcm.samples[i] * (1 - f) + pcm.samples[i + 1] * f;
              const edge = Math.min(k, n - 1 - k);
              if (edge < fadeN) v *= edge / fadeN;
              const j = Math.round(outStart * OUT_RATE) + k;
              if (j >= 0 && j < out.length) { out[j] = v; any = true; }
            }
            covered += b - a;
          }
        }
        t = e;
      }
    }
    if (!readable || !any) return null;
    return { samples: out, sampleRate: OUT_RATE, covered };
  }

  /** Voice on top, rink sound underneath at `bed` volume (default a quarter). Same length as the longer. */
  function mixTracks(voice, rink, bed) {
    if (!rink) return voice;
    if (!voice) return rink;
    const g = bed == null ? 0.25 : bed;
    const n = Math.max(voice.samples.length, rink.samples.length);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = (voice.samples[i] || 0) + g * (rink.samples[i] || 0);
      out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    return { samples: out, sampleRate: voice.sampleRate };
  }

  const api = { OUT_RATE, topBoxes, audioTrack, readTrack, decodeRange, rinkTrack, mixTracks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPAudio = api;
})(typeof window !== 'undefined' ? window : this);
