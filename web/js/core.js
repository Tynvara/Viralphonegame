/*
 * Moonsling — core game logic.
 *
 * Pure simulation: no DOM, no canvas, no audio. Everything the renderer and UI
 * need is exposed as plain data on the Game instance, and things that "happen"
 * (captures, deaths, stars...) are pushed to `game.events` for the UI to consume.
 *
 * All state is plain data (the RNG state is a number), so a game can be cloned
 * with structuredClone — the balance tests use that to look ahead.
 *
 * World units: the playfield is always 400 units wide; height depends on the
 * screen aspect ratio. y grows downwards (canvas convention), so the moon
 * travels towards negative y.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoonCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const W = 400;
  const MOON_R = 7;
  const ZONE_LEN = 15;          // planets per colour zone
  const CAM_ANCHOR = 0.68;      // current planet sits at 68% of screen height
  const STAR_PICKUP_R = 30;      // generous "magnet" radius
  const NEAR_MISS_PAD = 14;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** Difficulty ramps from 0 to 1 over the first 70 planets. */
  function difficulty(i) { return clamp(i / 70, 0, 1); }

  // ---------------------------------------------------------------------------
  // Seeds & daily challenge
  // ---------------------------------------------------------------------------

  function hashString(str) { // FNV-1a, 32 bit
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const DAILY_EPOCH_UTC = Date.UTC(2026, 10, 14); // Daily #1 = 14 Nov 2026

  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDaysKey(key, days) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }
  function dailyNumber(d) {
    d = d || new Date();
    const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((utc - DAILY_EPOCH_UTC) / 86400000) + 1;
  }
  function dailySeed(d) { return hashString('moonsling:daily:' + dateKey(d)) || 1; }

  // ---------------------------------------------------------------------------
  // Cosmetics (data only; the renderer decides how to draw them)
  // ---------------------------------------------------------------------------

  const SKINS = [
    { id: 'luna',    name: 'Luna',      price: 0,   color: '#f4f1ff', glow: '#bfb4ff', trail: '#d9d2ff' },
    { id: 'ember',   name: 'Ember',     price: 25,  color: '#ffb067', glow: '#ff6a2b', trail: '#ff7a3d' },
    { id: 'mint',    name: 'Mint',      price: 50,  color: '#8affd0', glow: '#2bffa8', trail: '#3dffb0' },
    { id: 'bubble',  name: 'Bubblegum', price: 90,  color: '#ff9ae6', glow: '#ff3fcf', trail: '#ff6bd6' },
    { id: 'glacier', name: 'Glacier',   price: 140, color: '#bdf0ff', glow: '#3fc8ff', trail: '#7fd8ff' },
    { id: 'gold',    name: 'Gold Rush', price: 220, color: '#ffe27a', glow: '#ffb800', trail: '#ffd34d' },
    { id: 'shadow',  name: 'Eclipse',   price: 350, color: '#1d1a2e', glow: '#a855ff', trail: '#a855ff' },
    { id: 'rainbow', name: 'Prismatic', price: 500, color: '#ffffff', glow: '#ffffff', trail: 'rainbow' },
  ];

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------

  class Game {
    /**
     * @param {{seed?: number, height?: number}} opts
     */
    constructor(opts) {
      opts = opts || {};
      this.W = W;
      this.H = Math.max(480, opts.height || 800);
      this.seed = (opts.seed >>> 0) || 1;
      this.rs = this.seed;          // RNG state
      this.t = 0;
      this.planets = [];
      this.asteroids = [];
      this.holes = [];
      this.stars = [];
      this.nextIndex = 0;
      this.lastPlanet = null;
      this.uid = 0;

      this.state = 'ready';         // ready | play | dead
      this.score = 0;
      this.hops = 0;                // successful forward captures
      this.maxIndex = 0;            // furthest planet index reached
      this.streak = 0;              // consecutive perfects
      this.bestStreak = 0;
      this.perfects = 0;
      this.skips = 0;
      this.starsCollected = 0;
      this.launches = 0;
      this.zone = 0;
      this.hopLog = [];             // 'P' perfect, 'G' good, 'X' death
      this.events = [];
      this.deathReason = null;
      this.timerOn = false;         // orbit decay timer (off until first capture)

      this._genNext();
      const p0 = this.planets[0];
      this.cur = p0;
      this.origin = null;
      this.moon = {
        state: 'orbit', x: 0, y: 0, vx: 0, vy: 0, r: MOON_R,
        angle: -Math.PI / 2, radius: p0.orbitR, targetR: p0.orbitR,
        dir: 1, omega: p0.omega, decay: 0, decayMax: 1, speed: 0, flightTime: 0,
      };
      this.camY = p0.y - this.H * CAM_ANCHOR;
      this._placeMoon();
      this._generate();
    }

    // --- RNG ---------------------------------------------------------------
    rand() { // mulberry32
      let t = (this.rs = (this.rs + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.rand(); }
    sign() { return this.rand() < 0.5 ? -1 : 1; }

    clone() {
      const c = structuredClone(this);
      Object.setPrototypeOf(c, Game.prototype);
      return c;
    }

    // --- World generation --------------------------------------------------
    _makePlanet(i, x, y, r) {
      const d = difficulty(i);
      const orbitR = r + 18;
      // First few planets get a bigger capture zone so new players land some hops.
      const captureR = orbitR + lerp(46, 30, d) + this.range(0, 8) + Math.max(0, 6 - i) * 4;
      return {
        id: this.uid++, i, x, baseX: x, y, r, orbitR,
        captureR0: captureR, captureR,
        omega: lerp(2.5, 3.7, d) * this.range(0.92, 1.1),
        decay: lerp(5.0, 3.2, d),
        move: null, pulse: null,
        color: Math.floor(this.rand() * 4),
        ringed: this.rand() < 0.22,
        rot: this.range(0, TAU),
        rotSpeed: this.range(0.3, 0.9) * this.sign(),
        craters: [0, 1, 2].map(() => ({ a: this.range(0, TAU), d: this.range(0.2, 0.7), s: this.range(0.12, 0.24) })),
      };
    }

    _genNext() {
      const i = this.nextIndex++;
      const prev = this.lastPlanet;
      let p;
      if (!prev) {
        p = this._makePlanet(0, W / 2, 0, 30);
        p.omega = 2.3;
        p.captureR = p.captureR0 = p.orbitR + 46;
      } else {
        const d = difficulty(i);
        const gap = lerp(175, 240, d) + this.range(-22, 22);
        const r = clamp(lerp(30, 22, d) + this.range(-5, 5), 16, 36);
        const orbitR = r + 18;
        const margin = orbitR + 16;
        const moving = i >= 8 && this.rand() < lerp(0.25, 0.55, clamp((i - 8) / 50, 0, 1));
        let x;
        if (moving) {
          x = W / 2 + this.range(-30, 30);
        } else {
          for (let k = 0; k < 6; k++) {
            x = this.range(margin, W - margin);
            if (Math.abs(x - prev.baseX) > 60) break;
          }
        }
        p = this._makePlanet(i, x, prev.y - gap, r);
        if (moving) {
          const amp = Math.min(this.range(45, 105), x - margin, W - margin - x);
          p.move = { amp, speed: this.range(0.7, 1.3) * lerp(1, 1.4, d), phase: this.range(0, TAU) };
        }
        if (i >= 22 && this.rand() < lerp(0.2, 0.4, clamp((i - 22) / 50, 0, 1))) {
          p.pulse = { speed: this.range(1.8, 2.6), phase: this.range(0, TAU) };
        }
        this._genGap(prev, p, i);
      }
      this.planets.push(p);
      this.lastPlanet = p;
      return p;
    }

    /** Stars and hazards in the gap between two consecutive planets. */
    _genGap(prev, p, i) {
      // Collectible stars on the line between the planets, inside the part of
      // the trip the moon actually flies (after leaving the orbit, before the
      // next capture zone). Some are offset to tempt a riskier, off-centre shot.
      if (this.rand() < 0.65) {
        let n = 1 + Math.floor(this.rand() * 3);
        const off = this.rand() < 0.3 ? this.range(-45, 45) : 0;
        const dx = p.baseX - prev.baseX, dy = p.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const t0 = (prev.orbitR + 14) / len;
        const t1 = 1 - (p.captureR0 + 12) / len;
        const span = (t1 - t0) * len;
        if (span < 0) n = 0;
        else n = Math.min(n, 1 + Math.floor(span / 26));
        for (let k = 0; k < n; k++) {
          const t = n === 1 ? (t0 + t1) / 2 : t0 + ((t1 - t0) * k) / (n - 1);
          this.stars.push({
            id: this.uid++,
            x: clamp(prev.baseX + dx * t + nx * off, 16, W - 16),
            y: prev.y + dy * t + ny * off,
            taken: false, ph: this.range(0, TAU),
          });
        }
      }
      // Drifting asteroids.
      if (i >= 12) {
        const a = clamp((i - 12) / 50, 0, 1);
        if (this.rand() < lerp(0.35, 0.75, a)) {
          const count = 1 + (a > 0.4 && this.rand() < 0.45 ? 1 : 0);
          for (let k = 0; k < count; k++) {
            // Keep asteroids clear of both planets' orbits so an orbiting moon is always safe.
            const r = this.range(9, 15);
            const clear = r + MOON_R + 8;
            const lo = prev.y - prev.orbitR - clear;
            const hi = p.y + p.orbitR + clear;
            const y = lerp(hi, lo, this.range(0.25, 0.75));
            if (lo - hi < 8) continue;
            this.asteroids.push({
              id: this.uid++,
              x: this.range(0, W),
              y,
              r,
              vx: this.sign() * this.range(30, 70) * (1 + a * 0.6),
              rot: this.range(0, TAU), rs: this.range(-2, 2),
              shape: [0, 1, 2, 3, 4, 5, 6, 7].map(() => this.range(0.75, 1.15)),
              near: false, nearDone: false,
            });
          }
        }
      }
      // Black holes bend your flight path (and swallow you if you get too close).
      if (i >= 28 && this.rand() < lerp(0.22, 0.4, clamp((i - 28) / 50, 0, 1))) {
        const side = this.sign();
        const mx = (prev.baseX + p.baseX) / 2;
        let hx = mx + side * this.range(70, 120);
        if (hx < 40 || hx > W - 40) hx = mx - side * this.range(70, 120);
        this.holes.push({
          id: this.uid++, x: clamp(hx, 40, W - 40), y: (prev.y + p.y) / 2 + this.range(-20, 20),
          r: 14, range: 230, G: 3.2e6, rot: this.range(0, TAU),
        });
      }
    }

    _generate() {
      while (this.lastPlanet.y > this.camY - this.H * 0.8) this._genNext();
      const cutoff = this.camY + this.H + 300;
      if (this.planets.length && this.planets[0].y > cutoff) {
        this.planets = this.planets.filter((p) => p.y <= cutoff || p === this.cur || p === this.origin);
      }
      if (this.stars.length && this.stars[0].y > cutoff) this.stars = this.stars.filter((s) => s.y <= cutoff);
      if (this.asteroids.length && this.asteroids[0].y > cutoff) this.asteroids = this.asteroids.filter((s) => s.y <= cutoff);
      if (this.holes.length && this.holes[0].y > cutoff) this.holes = this.holes.filter((s) => s.y <= cutoff);
    }

    // --- Public API --------------------------------------------------------
    setHeight(h) {
      const nh = Math.max(480, h);
      this.camY += (this.H - nh) * CAM_ANCHOR;
      this.H = nh;
      this._generate();
    }

    start() { if (this.state === 'ready') this.state = 'play'; }

    /** Launch the moon. Returns true if it actually launched. */
    tap() {
      if (this.state !== 'play') return false;
      const m = this.moon;
      if (m.state !== 'orbit') return false;
      const speed = lerp(560, 650, difficulty(this.maxIndex));
      const tx = -Math.sin(m.angle) * m.dir;
      const ty = Math.cos(m.angle) * m.dir;
      m.vx = tx * speed;
      m.vy = ty * speed;
      m.speed = speed;
      m.state = 'flight';
      m.flightTime = 0;
      this.origin = this.cur;
      this.launches++;
      this._emit({ type: 'launch', x: m.x, y: m.y });
      return true;
    }

    /** Direction the moon would fly if launched right now (unit vector). */
    aimDir() {
      const m = this.moon;
      return { x: -Math.sin(m.angle) * m.dir, y: Math.cos(m.angle) * m.dir };
    }

    update(dt) {
      if (!(dt > 0)) return;
      this.t += dt;
      const t = this.t;
      for (const p of this.planets) {
        if (p.move) p.x = p.baseX + p.move.amp * Math.sin(t * p.move.speed + p.move.phase);
        if (p.pulse) {
          const k = 0.5 + 0.5 * Math.sin(t * p.pulse.speed + p.pulse.phase);
          const minR = p.orbitR + 10;
          p.captureR = minR + (p.captureR0 - minR) * k;
        }
        p.rot += p.rotSpeed * dt;
      }
      for (const a of this.asteroids) {
        a.x += a.vx * dt;
        if (a.x < -40) a.x += W + 80;
        else if (a.x > W + 40) a.x -= W + 80;
        a.rot += a.rs * dt;
      }
      for (const h of this.holes) h.rot += dt * 1.6;

      const m = this.moon;
      if (m.state === 'orbit' || m.state === 'falling') this._updateOrbit(dt);
      else if (m.state === 'flight') this._updateFlight(dt);

      if (this.cur) {
        const target = this.cur.y - this.H * CAM_ANCHOR;
        this.camY += (target - this.camY) * (1 - Math.exp(-dt * 4.5));
      }
      this._generate();
    }

    result() {
      return {
        score: this.score, hops: this.hops, perfects: this.perfects, bestStreak: this.bestStreak,
        stars: this.starsCollected, skips: this.skips, reason: this.deathReason,
        hopLog: this.hopLog.slice(), zone: this.zone, seed: this.seed,
      };
    }

    // --- Internals ---------------------------------------------------------
    _emit(e) { this.events.push(e); }

    _placeMoon() {
      const m = this.moon, p = this.cur;
      m.x = p.x + Math.cos(m.angle) * m.radius;
      m.y = p.y + Math.sin(m.angle) * m.radius;
    }

    _updateOrbit(dt) {
      const m = this.moon, p = this.cur;
      if (m.state === 'falling') {
        m.omega += dt * 7;
        m.radius -= dt * (p.orbitR - p.r) * 2.4;
        m.angle += m.dir * m.omega * dt;
        this._placeMoon();
        if (m.radius <= p.r + m.r * 0.3) this._die('crashed');
        return;
      }
      m.angle += m.dir * m.omega * dt;
      if (m.angle > TAU) m.angle -= TAU; else if (m.angle < 0) m.angle += TAU;
      m.radius += (m.targetR - m.radius) * (1 - Math.exp(-dt * 9));
      if (this.timerOn && this.state === 'play') {
        const before = m.decay;
        m.decay -= dt;
        for (const th of [1.5, 1.0, 0.5]) {
          if (before > th && m.decay <= th) this._emit({ type: 'tick', left: th });
        }
        if (m.decay <= 0) {
          m.decay = 0;
          m.state = 'falling';
          this._emit({ type: 'decayed' });
        }
      }
      this._placeMoon();
    }

    _updateFlight(dt) {
      const m = this.moon;
      m.flightTime += dt;
      const steps = Math.max(1, Math.ceil((m.speed * dt) / 5));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        for (const bh of this.holes) {
          const dx = bh.x - m.x, dy = bh.y - m.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bh.range * bh.range) {
            const d = Math.sqrt(d2);
            if (d < bh.r + m.r * 0.5) { this._die('swallowed'); return; }
            const acc = bh.G / Math.max(d2, 900);
            m.vx += (dx / d) * acc * h;
            m.vy += (dy / d) * acc * h;
            const sp = Math.hypot(m.vx, m.vy);
            m.vx *= m.speed / sp;
            m.vy *= m.speed / sp;
          }
        }
        m.x += m.vx * h;
        m.y += m.vy * h;

        for (const st of this.stars) {
          if (st.taken) continue;
          const dx = st.x - m.x, dy = st.y - m.y;
          if (dx * dx + dy * dy < STAR_PICKUP_R * STAR_PICKUP_R) {
            st.taken = true;
            this.starsCollected++;
            this._emit({ type: 'star', x: st.x, y: st.y });
          }
        }

        if (this._checkAsteroids()) return;

        for (const p of this.planets) {
          if (p === this.origin) continue;
          const dx = m.x - p.x, dy = m.y - p.y;
          if (dx * dx + dy * dy <= p.captureR * p.captureR) { this._capture(p); return; }
        }

        const sy = m.y - this.camY;
        if (m.x < -m.r * 2 || m.x > W + m.r * 2 || sy > this.H + m.r * 2 || sy < -m.r * 2) {
          this._die('lost');
          return;
        }
      }
    }

    _checkAsteroids() {
      const m = this.moon;
      for (const a of this.asteroids) {
        const dx = a.x - m.x, dy = a.y - m.y;
        const rr = a.r + m.r - 2;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) { this._die('smashed'); return true; }
        if (m.state === 'flight' && !a.nearDone) {
          const nr = rr + NEAR_MISS_PAD;
          if (d2 < nr * nr) a.near = true;
          else if (a.near) {
            a.nearDone = true;
            this._emit({ type: 'close', x: m.x, y: m.y });
          }
        }
      }
      return false;
    }

    _capture(p) {
      const m = this.moon;
      const rx = m.x - p.x, ry = m.y - p.y;
      const dist = Math.hypot(rx, ry);
      const ux = m.vx / m.speed, uy = m.vy / m.speed;
      const cross = rx * uy - ry * ux;      // signed distance of flight line from centre
      const perfect = Math.abs(cross) <= p.r + 8;

      m.state = 'orbit';
      m.angle = Math.atan2(ry, rx);
      m.radius = dist;
      m.targetR = p.orbitR;
      m.dir = Math.abs(cross) < 1 ? (m.dir || 1) : (cross > 0 ? 1 : -1);
      m.omega = p.omega;
      m.decay = m.decayMax = p.decay;
      this.cur = p;
      this.origin = null;
      this.timerOn = true;

      const advanced = p.i - this.maxIndex;
      if (advanced > 0) {
        if (perfect) {
          this.streak++;
          this.perfects++;
          if (this.streak > this.bestStreak) this.bestStreak = this.streak;
        } else {
          this.streak = 0;
        }
        const bonus = perfect ? Math.min(this.streak, 5) : 0;
        const pts = advanced + bonus;
        if (advanced > 1) this.skips++;
        this.score += pts;
        this.hops++;
        this.maxIndex = p.i;
        this.hopLog.push(perfect ? 'P' : 'G');
        this._emit({ type: 'capture', perfect, pts, streak: this.streak, advanced, off: Math.abs(cross), x: m.x, y: m.y, px: p.x, py: p.y, planet: p.id });
        const zone = Math.floor(this.maxIndex / ZONE_LEN);
        if (zone > this.zone) {
          this.zone = zone;
          this._emit({ type: 'zone', zone });
        }
      } else {
        this._emit({ type: 'recapture', x: m.x, y: m.y, px: p.x, py: p.y, planet: p.id });
      }
    }

    _die(reason) {
      if (this.state === 'dead') return;
      const m = this.moon;
      this.state = 'dead';
      m.state = 'dead';
      this.deathReason = reason;
      this.streak = 0;
      this.hopLog.push('X');
      this._emit({ type: 'death', reason, x: m.x, y: m.y });
    }
  }

  // ---------------------------------------------------------------------------
  // Sharing (Wordle-style spoiler-free run summary)
  // ---------------------------------------------------------------------------

  const DEATH_TEXT = {
    lost: 'Lost in space',
    crashed: 'Orbit decayed',
    smashed: 'Asteroid hit',
    swallowed: 'Swallowed by a black hole',
  };

  function emojiGrid(log, max, perRow) {
    max = max || 30;
    perRow = perRow || 10;
    const map = { P: '🟩', G: '🟨', X: '💥' };
    let cells = log.map((c) => map[c] || '⬛');
    let prefix = '';
    if (cells.length > max) {
      prefix = '…+' + (cells.length - max) + '\n';
      cells = cells.slice(cells.length - max);
    }
    const rows = [];
    for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow).join(''));
    return prefix + rows.join('\n');
  }

  /**
   * @param {{score:number, hops:number, perfects:number, hopLog:string[],
   *          daily?:boolean, dailyNo?:number, streakDays?:number, url?:string}} r
   */
  function shareText(r) {
    const lines = [];
    if (r.daily) lines.push('🌙 Moonsling Daily #' + r.dailyNo + ' — ' + r.score + ' pts' + (r.streakDays > 1 ? ' 🔥' + r.streakDays : ''));
    else lines.push('🌙 I scored ' + r.score + ' in Moonsling!');
    lines.push('🪐 ' + r.hops + ' planets · ✨ ' + r.perfects + ' perfect');
    lines.push(emojiGrid(r.hopLog));
    lines.push(r.daily ? 'Can you beat today\'s run?' : 'Can you beat me?');
    if (r.url) lines.push(r.url);
    return lines.join('\n');
  }

  return {
    W, MOON_R, ZONE_LEN, CAM_ANCHOR, SKINS, DEATH_TEXT,
    Game, difficulty, hashString, dateKey, addDaysKey, dailyNumber, dailySeed,
    emojiGrid, shareText, clamp, lerp,
  };
}));
