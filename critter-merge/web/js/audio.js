/*
 * Critter Merge — synthesised sounds and a gentle background tune (WebAudio).
 */
(function () {
  'use strict';

  let ctx = null, master = null, sfx = null, music = null, noiseBuf = null;
  let muted = false, musicOn = true, unlocked = false;
  let musicTimer = null, nextNoteT = 0, step = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      master.connect(comp).connect(ctx.destination);
      sfx = ctx.createGain();
      sfx.connect(master);
      music = ctx.createGain();
      music.gain.value = musicOn ? 0.5 : 0;
      music.connect(master);
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    if (!unlocked) {
      try {
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, 22050);
        src.connect(c.destination);
        src.start(0);
        unlocked = true;
      } catch (e) { /* retry next gesture */ }
    }
    startMusic();
  }

  function tone(freq, dur, o) {
    o = o || {};
    const c = ensure();
    if (!c || muted) return;
    const t0 = (o.at || c.currentTime) + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(o.bus || sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, o) {
    o = o || {};
    const c = ensure();
    if (!c || muted) return;
    const t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 800, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // C major pentatonic
  const PENTA = [0, 2, 4, 7, 9];
  const note = (n) => 261.63 * Math.pow(2, (Math.floor(n / 5) * 12 + PENTA[((n % 5) + 5) % 5]) / 12);

  // --- background tune: soft marimba-like notes over a slow chord loop -------
  const CHORDS = [[0, 2, 4], [4, 6, 8], [3, 5, 7], [1, 3, 5]]; // pentatonic-step chords
  const TEMPO = 0.32; // seconds per eighth note
  function scheduleMusic() {
    if (!ctx || !musicOn || muted) return;
    while (nextNoteT < ctx.currentTime + 0.4) {
      const bar = Math.floor(step / 8) % CHORDS.length;
      const chord = CHORDS[bar];
      const beat = step % 8;
      if (beat === 0 || beat === 4) tone(note(chord[0] - 5) / 2, 1.2, { type: 'triangle', vol: 0.09, at: nextNoteT, bus: music });
      const pattern = [1, 0, 1, 1, 0, 1, 0, 1];
      if (pattern[beat] && Math.random() < 0.8) {
        const n = chord[Math.floor(Math.random() * 3)] + (Math.random() < 0.3 ? 5 : 0);
        tone(note(n), 0.5, { type: 'sine', vol: 0.07, at: nextNoteT, bus: music });
        tone(note(n) * 2, 0.25, { type: 'sine', vol: 0.015, at: nextNoteT, bus: music });
      }
      nextNoteT += TEMPO;
      step++;
    }
  }
  function startMusic() {
    if (!ctx || musicTimer) return;
    nextNoteT = ctx.currentTime + 0.1;
    musicTimer = setInterval(scheduleMusic, 120);
  }

  window.CritterAudio = {
    unlock,
    setMuted(v) {
      muted = !!v;
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.03);
    },
    setMusic(v) {
      musicOn = !!v;
      if (music && ctx) music.gain.setTargetAtTime(musicOn ? 0.5 : 0, ctx.currentTime, 0.1);
      if (musicOn && ctx) nextNoteT = Math.max(nextNoteT, ctx.currentTime + 0.05);
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx) nextNoteT = Math.max(nextNoteT, ctx.currentTime + 0.05); },

    drop() { tone(600, 0.14, { type: 'sine', vol: 0.16, slide: 0.5 }); },
    merge(tier, combo) {
      const n = 12 - tier + Math.min(combo - 1, 4) * 2;
      tone(320, 0.07, { type: 'sine', vol: 0.18, slide: 3 });                    // bubble pop
      tone(note(n), 0.35, { type: 'triangle', vol: 0.2, delay: 0.03 });
      if (tier >= 5) tone(note(n + 2), 0.4, { type: 'sine', vol: 0.12, delay: 0.1 });
    },
    discover() { [5, 7, 9, 10, 12].forEach((n, i) => tone(note(n), 0.35, { type: 'triangle', vol: 0.15, delay: i * 0.09 })); },
    party() {
      [0, 2, 4, 5, 7, 9, 10].forEach((n, i) => tone(note(n + 5), 0.4, { type: 'triangle', vol: 0.15, delay: i * 0.07 }));
      for (let i = 0; i < 8; i++) tone(300 + Math.random() * 400, 0.07, { type: 'sine', vol: 0.1, slide: 3, delay: 0.5 + i * 0.06 });
    },
    warn() { tone(660, 0.12, { type: 'square', vol: 0.04 }); tone(520, 0.12, { type: 'square', vol: 0.04, delay: 0.15 }); },
    rescue() { for (let i = 0; i < 10; i++) tone(note(5 + i), 0.12, { type: 'sine', vol: 0.11, slide: 1.5, delay: i * 0.05 }); },
    shake() { noise(0.5, { freq: 400, to: 120, vol: 0.35 }); tone(110, 0.4, { type: 'sine', vol: 0.15, slide: 0.7 }); },
    over() { [9, 7, 5, 2].forEach((n, i) => tone(note(n), 0.45, { type: 'triangle', vol: 0.14, delay: i * 0.18 })); },
    best() { [5, 7, 9, 12, 14].forEach((n, i) => tone(note(n), 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.08 })); },
    click() { tone(880, 0.05, { type: 'sine', vol: 0.08 }); },
    pop() {
      noise(0.12, { filter: 'highpass', freq: 1800, vol: 0.25 });
      tone(500, 0.12, { type: 'sine', vol: 0.2, slide: 2.4 });
      tone(note(12), 0.3, { type: 'triangle', vol: 0.12, delay: 0.06 });
    },
    star(i) { tone(note(7 + i * 2), 0.35, { type: 'triangle', vol: 0.18 }); tone(note(12 + i * 2), 0.3, { type: 'sine', vol: 0.08, delay: 0.04 }); },
    win() { [0, 4, 7, 12].forEach((n, i) => tone(note(n + 5), 0.4, { type: 'triangle', vol: 0.15, delay: i * 0.1 })); },
    lose() { [7, 5, 4].forEach((n, i) => tone(note(n), 0.4, { type: 'triangle', vol: 0.12, delay: i * 0.16 })); },
  };
})();
