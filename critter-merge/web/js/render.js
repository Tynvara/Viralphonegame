/*
 * Critter Merge — renderer: ocean background, the tank, critters and effects.
 * Reads a CritterCore.Game; never changes it.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const { TW, TH, DROP_Y, CRITTERS } = window.CritterCore;
  const { Sprites, LOOK } = window.CritterArt;
  const FONT = '"Baloo 2", "Arial Rounded MT Bold", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const WALL = 9;           // glass thickness (world units)
  const TOP_ROOM = 104;     // space above the rim for the held critter
  const DEFAULT_SKY = ['#4fd2f5', '#1b8fd8', '#0c4a9a'];

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.sprites = new Sprites(CRITTERS.map((c) => c.r));
      this.particles = [];
      this.texts = [];
      this.floaters = [];
      this.time = 0;
      this.shake = 0;
      this.flash = 0;
      this.tilt = new Map();
      this.bubbles = Array.from({ length: 28 }, () => this._newBubble(true));
      this.fish = Array.from({ length: 3 }, (_, i) => ({ y: 0.15 + i * 0.22, x: Math.random(), v: 0.012 + Math.random() * 0.01, s: 0.8 + Math.random() * 0.6, dir: i % 2 ? -1 : 1 }));
      this.cssW = 1;
      this.cssH = 1;
      this.dpr = 1;
      this.sky = DEFAULT_SKY;
    }

    /** Ocean colours (top, middle, bottom) — each Adventure world has its own. */
    setTheme(sky) {
      const next = sky || DEFAULT_SKY;
      if (next.join() === this.sky.join()) return;
      this.sky = next;
      if (this.backdrop) this._buildBackdrop();
    }

    /** Fit the tank between the HUD (top) and the critter chain (bottom). */
    layout(cssW, cssH, dpr, reserveTop, reserveBottom) {
      this.dpr = Math.min(dpr || 1, 2.5, Math.sqrt(4.5e6 / Math.max(1, cssW * cssH)));
      this.cssW = cssW;
      this.cssH = cssH;
      this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
      this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
      const availH = Math.max(200, cssH - reserveTop - reserveBottom);
      const sW = (cssW - 24) / (TW + WALL * 2);
      const sH = availH / (TH + TOP_ROOM + WALL);
      this.s = Math.max(0.3, Math.min(sW, sH));
      const totalH = (TH + TOP_ROOM + WALL) * this.s;
      this.ox = (cssW - TW * this.s) / 2;
      this.oy = reserveTop + (availH - totalH) + TOP_ROOM * this.s; // tank sits just above the chain
      this.sprites.build(this.s * this.dpr);
      this._buildBackdrop();
    }

    toWorldX(cssX) { return (cssX - this.ox) / this.s; }
    tankRect() { return { left: this.ox, top: this.oy, width: TW * this.s, bottom: this.oy + (TH + WALL) * this.s }; }

    // --- effects -------------------------------------------------------------
    burst(x, y, color, n, speed, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.8), life = 0.5 + Math.random() * 0.5;
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.2, life, max: life, size: (size || 4) * (0.6 + Math.random() * 0.8), color, bubble: Math.random() < 0.5 });
      }
      if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }
    popText(text, x, y, color, size) { this.texts.push({ text, x, y, color, size: size || 24, life: 1.1, max: 1.1 }); }
    float(tier, x, y) { this.floaters.push({ tier, x, y, life: 2.2, max: 2.2, sway: Math.random() * TAU }); }
    colorOf(tier) { return LOOK[tier].base; }

    // --- background ----------------------------------------------------------
    _newBubble(anywhere) {
      return { x: Math.random(), y: anywhere ? Math.random() : 1.05, r: 1.5 + Math.random() * 4, v: 0.03 + Math.random() * 0.05, ph: Math.random() * TAU };
    }

    _buildBackdrop() {
      const w = this.canvas.width, h = this.canvas.height, d = this.dpr;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, this.sky[0]);
      g.addColorStop(0.45, this.sky[1]);
      g.addColorStop(1, this.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // sand
      const sandTop = h - Math.max(46 * d, (this.cssH - (this.oy + (TH + WALL) * this.s)) * d * 0.9);
      ctx.fillStyle = '#f5d99a';
      ctx.beginPath();
      ctx.moveTo(0, sandTop + 10 * d);
      for (let x = 0; x <= w; x += 20 * d) ctx.lineTo(x, sandTop + Math.sin(x / (60 * d)) * 6 * d);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(200,150,80,0.35)';
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < (w * (h - sandTop)) / (900 * d * d); i++) {
        ctx.beginPath();
        ctx.arc(rnd() * w, sandTop + 12 * d + rnd() * (h - sandTop), (1 + rnd() * 2) * d, 0, TAU);
        ctx.fill();
      }
      // pebbles and shells
      for (let i = 0; i < 8; i++) {
        const x = rnd() * w, y = sandTop + (10 + rnd() * 25) * d;
        ctx.fillStyle = ['#e7b6c9', '#c9d6e8', '#ffe1a8'][i % 3];
        ctx.beginPath();
        ctx.ellipse(x, y, (5 + rnd() * 6) * d, (3 + rnd() * 3) * d, 0, 0, TAU);
        ctx.fill();
      }
      this.backdrop = c;
      this.sandTop = sandTop / d;
    }

    _drawWater(dt) {
      const ctx = this.ctx, d = this.dpr, W = this.cssW, H = this.cssH, t = this.time;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.backdrop, 0, 0);
      ctx.setTransform(d, 0, 0, d, 0, 0);

      // light rays
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x = W * (0.12 + i * 0.27) + Math.sin(t * 0.3 + i) * 30;
        const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
        g.addColorStop(0, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 25, 0);
        ctx.lineTo(x + 25, 0);
        ctx.lineTo(x + 110, H * 0.8);
        ctx.lineTo(x - 10, H * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // background fish
      ctx.fillStyle = 'rgba(10,60,120,0.25)';
      for (const f of this.fish) {
        f.x += f.v * f.dir * dt;
        if (f.x > 1.15) f.x = -0.15; else if (f.x < -0.15) f.x = 1.15;
        const x = f.x * W, y = f.y * H + Math.sin(t + f.y * 10) * 6, s = 9 * f.s;
        ctx.beginPath();
        ctx.ellipse(x, y, s * 1.6, s, 0, 0, TAU);
        ctx.moveTo(x - f.dir * s * 1.4, y);
        ctx.lineTo(x - f.dir * s * 2.6, y - s);
        ctx.lineTo(x - f.dir * s * 2.6, y + s);
        ctx.closePath();
        ctx.fill();
      }

      // seaweed at both sides (kept short when the tank fills the screen width)
      const base = this.sandTop + 14;
      const roomy = this.ox > 70;
      for (let i = 0; i < 6; i++) {
        const left = i < 3;
        const x = left ? 10 + i * 18 : W - 10 - (i - 3) * 18;
        const hgt = roomy ? Math.min(H * 0.45, 150 + (i % 3) * 60) : 30 + (i % 3) * 12;
        ctx.strokeStyle = i % 2 ? '#2fae6a' : '#1f8f57';
        ctx.lineWidth = 9 - (i % 3) * 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, base);
        const sw = Math.sin(t * 0.9 + i) * 18;
        ctx.bezierCurveTo(x + sw, base - hgt * 0.35, x - sw, base - hgt * 0.7, x + sw * 0.8, base - hgt);
        ctx.stroke();
      }

      // rising bubbles
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < this.bubbles.length; i++) {
        const b = this.bubbles[i];
        b.y -= b.v * dt;
        if (b.y < -0.05) this.bubbles[i] = this._newBubble(false);
        const x = b.x * W + Math.sin(t * 2 + b.ph) * 6, y = b.y * H;
        ctx.beginPath();
        ctx.arc(x, y, b.r, 0, TAU);
        ctx.stroke();
      }
    }

    // --- per frame -------------------------------------------------------------
    /**
     * @param {object} g CritterCore.Game (may be null on the title screen)
     * @param {number} dt seconds
     * @param {{title?: boolean, showHeld?: boolean}} opts
     */
    draw(g, dt, opts) {
      opts = opts || {};
      this.time += dt;
      this.shake = Math.max(0, this.shake - dt * 25);
      this.flash = Math.max(0, this.flash - dt * 2);
      const ctx = this.ctx, d = this.dpr, s = this.s;
      this._drawWater(dt);

      if (opts.title) {
        this._drawTitleCritters();
      } else if (g) {
        const sx = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;
        const sy = this.shake ? (Math.random() * 2 - 1) * this.shake : 0;
        ctx.setTransform(d * s, 0, 0, d * s, d * (this.ox + sx), d * (this.oy + sy));
        this._drawTank(g, opts);
        this._drawEffects(dt);
      }

      if (this.flash > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, this.flash).toFixed(3)})`;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    _drawTitleCritters() {
      const ctx = this.ctx, d = this.dpr, W = this.cssW, H = this.cssH, t = this.time;
      const k = Math.min(W / 400, H / 760) * 1.05;
      // Floating critters fill the open water between the title text and the buttons.
      const band = this.titleBand || { top: H * 0.38, bottom: H * 0.78 };
      const bh = Math.max(60, band.bottom - band.top);
      const k2 = Math.min(k, bh / 300);
      const spots = [[0.2, 0.3, 9, 0.85], [0.52, 0.18, 6, 0.7], [0.82, 0.32, 5, 0.8], [0.36, 0.62, 3, 0.95], [0.66, 0.66, 1, 1.05], [0.5, 0.42, 0, 1.15], [0.12, 0.8, 2, 0.75], [0.88, 0.82, 4, 0.75]];
      spots.forEach(([fx, fy, tier, sc], i) => {
        const y = band.top + fy * bh + Math.sin(t * 1.4 + i) * 6;
        const x = fx * W + Math.cos(t * 0.8 + i * 2) * 5;
        const unit = k2 * sc * (tier >= 5 ? 0.55 : 0.9);
        ctx.setTransform(d * unit, 0, 0, d * unit, d * x, d * y);
        const blink = (t + i * 1.3) % 4 < 0.12;
        this.sprites.draw(ctx, tier, 0, 0, CRITTERS[tier].r, Math.sin(t + i) * 0.12, blink);
      });
    }

    _drawTank(g, opts) {
      const ctx = this.ctx, t = this.time;
      // water inside the tank
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, 0, TW, TH);

      // rim / danger line
      const warn = g.danger || g.overT > 0;
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      ctx.setLineDash([10, 9]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = warn ? `rgba(255,80,110,${(0.55 + 0.45 * pulse).toFixed(2)})` : 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(TW, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      if (g.overT > 0) {
        const k = Math.min(1, g.overT / window.CritterCore.OVER_TIME);
        ctx.fillStyle = `rgba(255,80,110,${(0.25 * k).toFixed(3)})`;
        ctx.fillRect(0, 0, TW, 60);
      }

      // aim guide + held critter
      if (opts.showHeld && g.state === 'play' && g.dropsLeft() > 0) {
        const tier = g.cur;
        const x = g.clampAim(g.aimX);
        const ready = g.canDrop();
        if (ready) {
          const land = g.landingY(x, tier);
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([3, 9]);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, DROP_Y + CRITTERS[tier].r);
          ctx.lineTo(x, land);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const pop = ready ? 1 : 0.6 + 0.4 * (1 - g.cooldown / 0.45);
        this.sprites.draw(ctx, tier, x, DROP_Y + Math.sin(t * 3) * 2, CRITTERS[tier].r * Math.max(0.2, pop), Math.sin(t * 2) * 0.06, false);
      }

      // critters
      for (const b of g.bodies) {
        if (b.fixed) { this._drawTrapped(b); continue; }
        const vx = b.x - b.px;
        const prev = this.tilt.get(b.id) || 0;
        const tilt = prev + (Math.max(-0.4, Math.min(0.4, vx * 0.18)) - prev) * 0.15;
        this.tilt.set(b.id, tilt);
        const blink = (t + b.wob * 2.1) % 4.6 < 0.13;
        this.sprites.draw(ctx, b.tier, b.x, b.y, b.r, tilt, blink);
      }
      if (this.tilt.size > 400) this.tilt.clear();

      // glass tank (open top)
      const L = -WALL / 2, R = TW + WALL / 2, B = TH + WALL / 2, top = -26, rad = 22;
      ctx.lineWidth = WALL;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(225,245,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(L, top);
      ctx.lineTo(L, B - rad);
      ctx.quadraticCurveTo(L, B, L + rad, B);
      ctx.lineTo(R - rad, B);
      ctx.quadraticCurveTo(R, B, R, B - rad);
      ctx.lineTo(R, top);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, 30);
      ctx.lineTo(10, TH * 0.45);
      ctx.stroke();
    }

    /** A critter trapped in a bubble: bobbing gently, waiting for a match. */
    _drawTrapped(b) {
      const ctx = this.ctx, t = this.time;
      const y = b.y + Math.sin(t * 2 + b.wob) * 1.5;
      const blink = (t + b.wob * 2.1) % 4.6 < 0.13;
      this.sprites.draw(ctx, b.tier, b.x, y, b.r * 0.86, Math.sin(t * 1.3 + b.wob) * 0.08, blink);
      const R = b.r * 1.08;
      const g = ctx.createRadialGradient(b.x - R * 0.3, y - R * 0.35, R * 0.1, b.x, y, R);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(0.7, 'rgba(190,235,255,0.12)');
      g.addColorStop(1, 'rgba(170,225,255,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, y, R, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(b.x, y, R * 0.78, -2.6, -1.9);
      ctx.stroke();
    }

    _drawEffects(dt) {
      const ctx = this.ctx;
      // rescued critters floating away in bubbles
      for (let i = this.floaters.length - 1; i >= 0; i--) {
        const f = this.floaters[i];
        f.life -= dt;
        if (f.life <= 0) { this.floaters.splice(i, 1); continue; }
        f.y -= dt * 260;
        const x = f.x + Math.sin(this.time * 3 + f.sway) * 10;
        const r = CRITTERS[f.tier].r;
        ctx.globalAlpha = Math.min(1, f.life);
        this.sprites.draw(ctx, f.tier, x, f.y, r * 0.85, Math.sin(this.time * 2 + f.sway) * 0.2, false);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, f.y, r * 1.15, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = 'rgba(200,240,255,0.18)';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vx *= 1 - dt * 3;
        p.vy = p.vy * (1 - dt * 3) - dt * 120;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.life / p.max;
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * k), 0, TAU);
        if (p.bubble) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      // popup texts
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const tx = this.texts[i];
        tx.life -= dt;
        if (tx.life <= 0) { this.texts.splice(i, 1); continue; }
        const age = tx.max - tx.life;
        const pop = age < 0.12 ? 0.5 + (age / 0.12) * 0.7 : age < 0.24 ? 1.2 - ((age - 0.12) / 0.12) * 0.2 : 1;
        ctx.font = `800 ${Math.round(tx.size * pop)}px ${FONT}`;
        const half = ctx.measureText(tx.text).width / 2 + 6;
        const x = Math.max(half - 20, Math.min(TW + 20 - half, tx.x));
        const y = tx.y - age * 50;
        ctx.globalAlpha = Math.min(1, tx.life * 2.5);
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(15,40,90,0.8)';
        ctx.strokeText(tx.text, x, y);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.text, x, y);
      }
      ctx.globalAlpha = 1;
    }
  }

  window.CritterRender = { Renderer, FONT };
})();
