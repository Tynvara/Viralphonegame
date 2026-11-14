/*
 * Moonsling — canvas renderer and visual effects (particles, popups, shake).
 * Reads game state from a MoonCore.Game; never mutates it.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const { W, SKINS } = window.MoonCore;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const ZONES = [
    { name: 'NEBULA',  sky: ['#12062b', '#2b0f55', '#55206e'], accent: '#ff5fa2', planets: ['#ff7eb6', '#ffb36b', '#8be9fd', '#c3a6ff'] },
    { name: 'LAGOON',  sky: ['#02132b', '#06395c', '#0d6a80'], accent: '#3ee6d2', planets: ['#5ef2d6', '#ffd66b', '#6bb8ff', '#ff8fa3'] },
    { name: 'AURORA',  sky: ['#02140f', '#083a33', '#196a4f'], accent: '#7dff9e', planets: ['#9dff8a', '#64f0ff', '#f9a8ff', '#fff17a'] },
    { name: 'EMBER',   sky: ['#190602', '#47150a', '#883312'], accent: '#ffb347', planets: ['#ffcf5c', '#ff7a45', '#ffe9a8', '#ff5f6d'] },
    { name: 'CRIMSON', sky: ['#15020a', '#40061e', '#7c1137'], accent: '#ff4d6d', planets: ['#ff8fab', '#ffd6a5', '#cdb4ff', '#ff5c8a'] },
    { name: 'VOID',    sky: ['#010103', '#09091a', '#1a1a3a'], accent: '#a3a3ff', planets: ['#e0e0ff', '#9a9cff', '#6cf5ff', '#ff9ef5'] },
    { name: 'PRISM',   sky: ['#0c0424', '#290d5d', '#0d4f6e'], accent: '#ffffff', planets: ['#ff6bd6', '#6bffb8', '#ffe66b', '#6bd2ff'] },
  ];
  const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI'];
  function zoneInfo(z) {
    const k = ((z % ZONES.length) + ZONES.length) % ZONES.length;
    const lap = Math.floor(z / ZONES.length);
    return { ...ZONES[k], name: ZONES[k].name + (lap < ROMAN.length ? ROMAN[lap] : ' ∞') };
  }

  // --- colour helpers --------------------------------------------------------
  const rgbCache = new Map();
  function hexToRgb(hex) {
    let c = rgbCache.get(hex);
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      rgbCache.set(hex, c);
    }
    return c;
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a[0] + (b[0] - a[0]) * t), g = Math.round(a[1] + (b[1] - a[1]) * t), bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  const shade = (hex, t) => (t >= 0 ? mix(hex, '#ffffff', t) : mix(hex, '#000000', -t));

  function starPath(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.scale = 1;
      this.H = 800;
      this.particles = [];
      this.texts = [];
      this.ripples = [];
      this.trail = [];
      this.shake = 0;
      this.flash = 0;
      this.flashColor = '#ffffff';
      this.kick = 0;
      this.bgZone = 0;
      this.time = 0;
      this.skin = SKINS[0];
      this.gradCache = new Map();
      this.starGlow = null;
      this.bgStars = [];
      for (let layer = 0; layer < 3; layer++) {
        const n = [70, 40, 18][layer];
        for (let i = 0; i < n; i++) {
          this.bgStars.push({
            x: Math.random() * W, y: Math.random(), layer,
            size: [0.9, 1.4, 2.1][layer], f: [0.08, 0.18, 0.32][layer],
            tw: 1 + Math.random() * 3, ph: Math.random() * TAU,
          });
        }
      }
      this.blobs = [0, 1, 2].map((i) => ({ x: Math.random() * W, y: Math.random(), r: 160 + Math.random() * 120, k: i }));
    }

    resize(cssW, cssH, dpr) {
      const ratio = Math.min(dpr || 1, 2.5);
      this.canvas.width = Math.max(1, Math.round(cssW * ratio));
      this.canvas.height = Math.max(1, Math.round(cssH * ratio));
      this.gradCache.clear();
      this.starGlow = null;
      this.scale = this.canvas.width / W;
      this.H = (cssH / cssW) * W;
    }

    setSkin(skin) { this.skin = skin || SKINS[0]; }

    reset() {
      this.particles.length = 0;
      this.texts.length = 0;
      this.ripples.length = 0;
      this.trail.length = 0;
      this.gradCache.clear();
      this.shake = 0;
      this.flash = 0;
      this.kick = 0;
    }

    zoneInfo(z) { return zoneInfo(z); }

    // --- effects API -------------------------------------------------------
    burst(x, y, color, n, speed, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU;
        const v = speed * (0.35 + Math.random() * 0.75);
        const life = 0.45 + Math.random() * 0.5;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: (size || 3) * (0.6 + Math.random() * 0.8), color });
      }
      if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    }
    popText(text, x, y, color, size) { this.texts.push({ text, x, y, color, size: size || 22, life: 1.0, max: 1.0 }); }
    ripple(x, y, r, color) { this.ripples.push({ x, y, r, color, life: 0.5, max: 0.5 }); }
    doFlash(color, amount) { this.flashColor = color || '#ffffff'; this.flash = Math.max(this.flash, amount); }

    skinColorAt(i, t) {
      const s = this.skin;
      if (s.trail === 'rainbow') return `hsl(${((t * 120 + i * 14) % 360).toFixed(0)},100%,65%)`;
      return s.trail;
    }

    // --- per-frame ---------------------------------------------------------
    /**
     * @param {object} g     MoonCore.Game
     * @param {number} dt    real seconds since last frame (for effects)
     * @param {{guide?: boolean, dim?: number}} opts
     */
    draw(g, dt, opts) {
      opts = opts || {};
      this.time += dt;
      const ctx = this.ctx;
      const H = this.H;
      const s = this.scale;

      // effects timers
      this.shake = Math.max(0, this.shake - dt * 30);
      this.flash = Math.max(0, this.flash - dt * 2.2);
      this.kick = Math.max(0, this.kick - dt * 4);
      this.bgZone += (g.zone - this.bgZone) * (1 - Math.exp(-dt * 1.5));

      // trail
      const m = g.moon;
      if (m.state !== 'dead') {
        this.trail.push({ x: m.x, y: m.y });
        if (this.trail.length > 26) this.trail.shift();
      } else if (this.trail.length) {
        this.trail.shift();
      }

      const sx = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;
      const sy = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;

      // background (screen space)
      ctx.setTransform(s, 0, 0, s, 0, 0);
      this._drawSky(g, H);

      // world space
      const zoom = 1 + this.kick * 0.025;
      ctx.setTransform(s * zoom, 0, 0, s * zoom, (sx - (W * (zoom - 1)) / 2) * s, (sy - (H * (zoom - 1)) / 2) * s);
      ctx.translate(0, -g.camY);

      const dim = opts.dim || 0;

      for (const h of g.holes) this._drawHole(h);
      for (const p of g.planets) {
        const zone = Math.floor(p.i / window.MoonCore.ZONE_LEN);
        const color = zoneInfo(zone).planets[p.color];
        const alpha = dim && p !== g.cur ? 1 - dim : 1;
        this._drawPlanet(g, p, color, p === g.cur, alpha);
      }
      for (const st of g.stars) if (!st.taken) this._drawStar(st);
      for (const a of g.asteroids) this._drawAsteroid(a);

      if (opts.guide && m.state === 'orbit' && g.state !== 'dead') this._drawGuide(g, true);
      else if (m.state === 'orbit' && g.state !== 'dead') this._drawGuide(g, false);

      this._drawTrail();
      if (m.state !== 'dead') this._drawMoon(m.x, m.y, m.r);

      this._drawRipples(dt);
      this._drawParticles(dt);
      this._drawTexts(dt);

      // flash overlay (screen space)
      if (this.flash > 0) {
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.fillStyle = rgba(this.flashColor, Math.min(0.5, this.flash));
        ctx.fillRect(0, 0, W, H);
      }
    }

    _drawSky(g, H) {
      const ctx = this.ctx;
      const z0 = Math.floor(this.bgZone), f = this.bgZone - z0;
      const A = zoneInfo(z0), B = zoneInfo(z0 + 1);
      const top = mix(A.sky[0], B.sky[0], f), midc = mix(A.sky[1], B.sky[1], f), bot = mix(A.sky[2], B.sky[2], f);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, top);
      grad.addColorStop(0.6, midc);
      grad.addColorStop(1, bot);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // nebula blobs (slow parallax)
      const accent = mix(A.accent, B.accent, f);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.blobs) {
        const tile = H + b.r * 2;
        let y = ((b.y * tile - g.camY * 0.05) % tile + tile) % tile - b.r;
        const rg = ctx.createRadialGradient(b.x, y, 0, b.x, y, b.r);
        const col = b.k === 1 ? midc : accent;
        rg.addColorStop(0, rgba(col, b.k === 1 ? 0.18 : 0.10));
        rg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(b.x - b.r, y - b.r, b.r * 2, b.r * 2);
      }
      // stars
      const t = this.time;
      for (const st of this.bgStars) {
        const y = ((st.y * H - g.camY * st.f) % H + H) % H;
        const a = 0.35 + 0.35 * Math.sin(t * st.tw + st.ph) + st.layer * 0.12;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0.05, Math.min(1, a)).toFixed(2)})`;
        ctx.fillRect(st.x, y, st.size, st.size);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /** Gradients are built once per planet around (0,0) and reused via translate(). */
    _planetGrads(p, color) {
      let c = this.gradCache.get(p.id);
      if (c && c.color === color) return c;
      const ctx = this.ctx, r = p.r;
      const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.4);
      glow.addColorStop(0, rgba(color, 0.35));
      glow.addColorStop(1, rgba(color, 0));
      const body = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      body.addColorStop(0, shade(color, 0.45));
      body.addColorStop(0.55, color);
      body.addColorStop(1, shade(color, -0.45));
      const term = ctx.createLinearGradient(-r, -r, r, r);
      term.addColorStop(0.45, 'rgba(0,0,0,0)');
      term.addColorStop(1, 'rgba(0,0,0,0.35)');
      c = { color, glow, body, term, crater: rgba(shade(color, -0.35), 0.55) };
      if (this.gradCache.size > 300) this.gradCache.clear();
      this.gradCache.set(p.id, c);
      return c;
    }

    _drawPlanet(g, p, color, isCur, alpha) {
      const ctx = this.ctx;
      const r = p.r;
      const gr = this._planetGrads(p, color);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = alpha;

      // capture zone
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 7]);
      ctx.lineDashOffset = -this.time * 12;
      ctx.strokeStyle = rgba(color, isCur ? 0.22 : p.pulse ? 0.55 : 0.38);
      ctx.beginPath();
      ctx.arc(0, 0, p.captureR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!isCur) {
        ctx.fillStyle = rgba(color, 0.05);
        ctx.fill();
      }

      // glow
      ctx.fillStyle = gr.glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.4, 0, TAU);
      ctx.fill();

      if (p.ringed) this._drawRing(0, 0, r, color, true);

      // body
      ctx.fillStyle = gr.body;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();

      // rotating craters (fake 3D: they slide across and squash at the limb)
      ctx.save();
      ctx.clip();
      ctx.fillStyle = gr.crater;
      for (const c of p.craters) {
        const a = c.a + p.rot;
        const depth = Math.cos(a);
        if (depth < -0.1) continue;
        const cs = c.s * r;
        ctx.beginPath();
        ctx.ellipse(Math.sin(a) * r * 0.85, (c.d - 0.45) * r * 1.4, cs * Math.max(0.15, depth), cs, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = gr.term;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      if (p.ringed) this._drawRing(0, 0, r, color, false);

      // decay timer on the current planet
      if (isCur && g.timerOn && (g.moon.state === 'orbit' || g.moon.state === 'falling')) {
        const frac = Math.max(0, g.moon.decay / g.moon.decayMax);
        const low = g.moon.decay < 1.0;
        const blink = low && Math.floor(this.time * 8) % 2 === 0;
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.arc(0, 0, p.orbitR + 13, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = low ? (blink ? '#ff4d6d' : '#ffd0d8') : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, p.orbitR + 13, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawRing(x, y, r, color, back) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      if (back) ctx.rect(x - r * 3, y - r * 3, r * 6, r * 3);
      else ctx.rect(x - r * 3, y, r * 6, r * 3);
      ctx.clip();
      ctx.strokeStyle = rgba(shade(color, 0.3), 0.75);
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.75, r * 0.45, -0.25, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    _drawHole(h) {
      const ctx = this.ctx;
      const { x, y } = h;
      ctx.save();
      // gravity field hint
      const field = ctx.createRadialGradient(x, y, 10, x, y, h.range * 0.6);
      field.addColorStop(0, 'rgba(160,90,255,0.22)');
      field.addColorStop(1, 'rgba(160,90,255,0)');
      ctx.fillStyle = field;
      ctx.beginPath();
      ctx.arc(x, y, h.range * 0.6, 0, TAU);
      ctx.fill();
      // accretion disk
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = ['rgba(255,150,80,0.55)', 'rgba(255,90,200,0.45)', 'rgba(140,120,255,0.4)'][k];
        ctx.lineWidth = 3 - k * 0.6;
        ctx.beginPath();
        ctx.ellipse(x, y, h.r * (1.9 + k * 0.45), h.r * (0.75 + k * 0.18), h.rot * (k % 2 ? -1 : 1) * 0.6 + k, 0, TAU * 0.8);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      const core = ctx.createRadialGradient(x, y, 0, x, y, h.r * 1.3);
      core.addColorStop(0, '#000000');
      core.addColorStop(0.75, '#05010d');
      core.addColorStop(1, 'rgba(120,60,255,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, h.r * 1.3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    _drawAsteroid(a) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      const n = a.shape.length;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU;
        const rr = a.r * a.shape[i];
        if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = '#6b5f73';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff6b6b';
      ctx.stroke();
      ctx.fillStyle = '#4e4456';
      ctx.beginPath();
      ctx.arc(a.r * 0.25, -a.r * 0.2, a.r * 0.28, 0, TAU);
      ctx.arc(-a.r * 0.3, a.r * 0.3, a.r * 0.18, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    _drawStar(st) {
      const ctx = this.ctx;
      if (!this.starGlow) {
        this.starGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
        this.starGlow.addColorStop(0, 'rgba(255,220,90,0.55)');
        this.starGlow.addColorStop(1, 'rgba(255,220,90,0)');
      }
      ctx.save();
      ctx.translate(st.x, st.y + Math.sin(this.time * 3 + st.ph) * 3);
      ctx.fillStyle = this.starGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, TAU);
      ctx.fill();
      starPath(ctx, 0, 0, 8, Math.sin(this.time * 2 + st.ph) * 0.3);
      ctx.fillStyle = '#ffe066';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#fff6c2';
      ctx.stroke();
      ctx.restore();
    }

    _drawGuide(g, full) {
      const ctx = this.ctx;
      const m = g.moon;
      const d = g.aimDir();
      if (!full) {
        // short aim hint
        const len = 46;
        const grad = ctx.createLinearGradient(m.x, m.y, m.x + d.x * len, m.y + d.y * len);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x + d.x * len, m.y + d.y * len);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      // Tutorial guide: ray-cast to the first capture ring or screen edge.
      let hitT = Infinity, hitP = null;
      for (const p of g.planets) {
        if (p === g.cur) continue;
        const fx = m.x - p.x, fy = m.y - p.y;
        const b = fx * d.x + fy * d.y;
        const c = fx * fx + fy * fy - p.captureR * p.captureR;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < hitT) { hitT = t; hitP = p; }
      }
      const maxT = Math.min(hitT, 900);
      const ok = !!hitP;
      let perfect = false;
      if (ok) {
        const fx = hitP.x - m.x, fy = hitP.y - m.y;
        perfect = Math.abs(fx * d.y - fy * d.x) <= hitP.r + 8;
      }
      const col = perfect ? '#7dff9e' : ok ? '#ffe066' : '#ff8a8a';
      ctx.strokeStyle = rgba(col, 0.85);
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x + d.x * maxT, m.y + d.y * maxT);
      ctx.stroke();
      ctx.setLineDash([]);
      if (ok) {
        ctx.strokeStyle = rgba(col, 0.9);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(hitP.x, hitP.y, hitP.captureR, 0, TAU);
        ctx.stroke();
      }
    }

    _drawTrail() {
      const ctx = this.ctx;
      const tr = this.trail;
      if (tr.length < 2) return;
      ctx.lineCap = 'round';
      const n = tr.length;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.strokeStyle = this.skinColorAt(i, this.time);
        ctx.globalAlpha = k * 0.7;
        ctx.lineWidth = 1 + k * 7;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'butt';
    }

    _drawMoon(x, y, r) {
      const ctx = this.ctx;
      const skin = this.skin;
      const glowCol = skin.trail === 'rainbow' ? `hsl(${((this.time * 120) % 360).toFixed(0)},100%,65%)` : skin.glow;
      const gl = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
      gl.addColorStop(0, glowCol.startsWith('#') ? rgba(glowCol, 0.65) : glowCol.replace('hsl', 'hsla').replace(')', ',0.6)'));
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = skin.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (skin.id === 'shadow') {
        ctx.strokeStyle = glowCol;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.32, 0, TAU);
      ctx.fill();
    }

    _drawRipples(dt) {
      const ctx = this.ctx;
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const rp = this.ripples[i];
        rp.life -= dt;
        if (rp.life <= 0) { this.ripples.splice(i, 1); continue; }
        const k = 1 - rp.life / rp.max;
        ctx.strokeStyle = rgba(rp.color, (1 - k) * 0.8);
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r * (0.6 + k * 0.9), 0, TAU);
        ctx.stroke();
      }
    }

    _drawParticles(dt) {
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.life -= dt;
        if (pt.life <= 0) { this.particles.splice(i, 1); continue; }
        pt.vx *= 1 - dt * 2.5;
        pt.vy *= 1 - dt * 2.5;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        const k = pt.life / pt.max;
        ctx.globalAlpha = k;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * (0.4 + k * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawTexts(dt) {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const tx = this.texts[i];
        tx.life -= dt;
        if (tx.life <= 0) { this.texts.splice(i, 1); continue; }
        const age = tx.max - tx.life;
        const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.55 : age < 0.22 ? 1.15 - ((age - 0.12) / 0.1) * 0.15 : 1;
        const y = tx.y - age * 40;
        ctx.globalAlpha = Math.min(1, tx.life * 2.5);
        ctx.font = `900 ${Math.round(tx.size * pop)}px ${FONT}`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(10,4,30,0.75)';
        ctx.strokeText(tx.text, tx.x, y);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.text, tx.x, y);
      }
      ctx.globalAlpha = 1;
    }
  }

  window.MoonRender = { Renderer, ZONES, zoneInfo, rgba, mix, starPath, FONT };
})();
