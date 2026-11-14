/*
 * Moonsling — procedurally synthesised sound effects (WebAudio, no asset files).
 * Captures climb a pentatonic scale as your perfect streak grows.
 */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(comp).connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.6);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, dur, o) {
    o = o || {};
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t0 + dur);
    const vol = o.vol || 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, o) {
    o = o || {};
    const c = ensure();
    if (!c || muted || !noiseBuf) return;
    const t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.Q.value = o.q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // Pentatonic steps (semitones) – climbs with the perfect streak.
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
  const note = (step) => 440 * Math.pow(2, step / 12);

  window.MoonAudio = {
    unlock() { ensure(); },
    isMuted() { return muted; },
    setMuted(v) {
      muted = !!v;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.02);
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {}); },

    launch() {
      tone(300, 0.1, { type: 'triangle', vol: 0.12, slide: 1.9 });
      noise(0.12, { filter: 'bandpass', freq: 900, to: 3000, q: 2, vol: 0.06 });
    },
    capture(streak, perfect) {
      if (perfect) {
        const f = note(SCALE[Math.min(streak, SCALE.length - 1)] + 3);
        tone(f, 0.22, { type: 'sine', vol: 0.3 });
        tone(f * 2, 0.28, { type: 'triangle', vol: 0.1, delay: 0.035 });
        tone(f * 1.5, 0.34, { type: 'sine', vol: 0.08, delay: 0.07 });
      } else {
        tone(note(-2), 0.16, { type: 'sine', vol: 0.24 });
        tone(note(5), 0.12, { type: 'triangle', vol: 0.06, delay: 0.03 });
      }
    },
    star() {
      tone(1568, 0.08, { type: 'triangle', vol: 0.09 });
      tone(2349, 0.12, { type: 'triangle', vol: 0.07, delay: 0.05 });
    },
    tick(left) { tone(left <= 0.5 ? 1320 : 990, 0.05, { type: 'square', vol: 0.045 }); },
    close() { tone(620, 0.12, { type: 'sine', vol: 0.1, slide: 1.6 }); },
    decayed() { tone(500, 0.4, { type: 'triangle', vol: 0.12, slide: 0.4 }); },
    death() {
      noise(0.55, { freq: 1800, to: 120, vol: 0.4 });
      tone(180, 0.55, { type: 'sawtooth', vol: 0.1, slide: 0.3 });
    },
    zone() { [0, 4, 7, 12].forEach((s, i) => tone(note(s + 3), 0.6, { type: 'sine', vol: 0.09, delay: i * 0.08 })); },
    best() { [0, 4, 7, 12, 16].forEach((s, i) => tone(note(s + 3), 0.3, { type: 'triangle', vol: 0.12, delay: i * 0.09 })); },
    click() { tone(880, 0.05, { type: 'sine', vol: 0.08 }); },
    buy() { [7, 12, 19].forEach((s, i) => tone(note(s), 0.2, { type: 'triangle', vol: 0.1, delay: i * 0.06 })); },
  };
})();
