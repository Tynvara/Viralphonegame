/*
 * Critter Merge — critter artwork, drawn in code (no image files).
 * drawCritter() is the single source of the art; the renderer caches it into
 * sprites and the menus use it as <img> data URLs.
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const INK = '#2b2140';
  const PAD = 1.7; // sprite half-size in units of R (room for tusks, tails, spouts)

  const LOOK = [
    { base: '#ff9cb3', dark: '#d9506f', light: '#ffd6e0' }, // shrimp
    { base: '#ff8a2a', dark: '#c4560a', light: '#ffc48f' }, // clownfish
    { base: '#ff5d5d', dark: '#bf3030', light: '#ffa3a3' }, // crab
    { base: '#ffc93c', dark: '#cf8a0c', light: '#ffeaa6' }, // starfish
    { base: '#f2e07a', dark: '#b89d34', light: '#fff7c9' }, // pufferfish
    { base: '#c79bff', dark: '#7f52cc', light: '#efe2ff' }, // jellyfish
    { base: '#3fae5b', dark: '#25723a', light: '#8fdc9f' }, // turtle (shell)
    { base: '#b45ad8', dark: '#74299a', light: '#e6b8f7' }, // octopus
    { base: '#8fd0f5', dark: '#4a92c4', light: '#dff3ff' }, // narwhal
    { base: '#4a86f0', dark: '#2652b3', light: '#bcd5ff' }, // whale
  ];

  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }

  function bodyFill(ctx, R, look) {
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.42, R * 0.08, 0, 0, R * 1.05);
    g.addColorStop(0, look.light);
    g.addColorStop(0.55, look.base);
    g.addColorStop(1, look.dark);
    return g;
  }

  function outline(ctx, R, color) {
    ctx.lineWidth = Math.max(1.2, R * 0.07);
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function eye(ctx, x, y, r, blink) {
    if (blink) {
      ctx.beginPath();
      ctx.arc(x, y - r * 0.2, r * 0.75, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.stroke();
      return;
    }
    circle(ctx, x, y, r);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.14);
    ctx.strokeStyle = INK;
    ctx.stroke();
    circle(ctx, x + r * 0.12, y + r * 0.12, r * 0.62);
    ctx.fillStyle = INK;
    ctx.fill();
    circle(ctx, x - r * 0.08, y - r * 0.12, r * 0.24);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  /** Standard cute face. Options are fractions of R. */
  function face(ctx, R, o) {
    o = o || {};
    const ex = (o.ex === undefined ? 0.32 : o.ex) * R;
    const ey = (o.ey === undefined ? -0.08 : o.ey) * R;
    const er = (o.er === undefined ? 0.17 : o.er) * R;
    const cx = (o.cx || 0) * R;
    const my = (o.my === undefined ? 0.24 : o.my) * R;
    // cheeks
    ctx.fillStyle = 'rgba(255,105,140,0.42)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * (ex + er * 1.15), ey + er * 1.55, er * 0.8, er * 0.48, 0, 0, TAU);
      ctx.fill();
    }
    eye(ctx, cx - ex, ey, er, o.blink);
    eye(ctx, cx + ex, ey, er, o.blink);
    ctx.strokeStyle = '#5b2338';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, R * 0.055);
    if (o.mouth === 'o') {
      ctx.beginPath();
      ctx.ellipse(cx, my, R * 0.07, R * 0.09, 0, 0, TAU);
      ctx.fillStyle = '#8a2b45';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, my - R * 0.08, R * 0.13, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
    }
  }

  function clipBody(ctx, R) { circle(ctx, 0, 0, R); ctx.clip(); }

  const DRAW = [
    // 0 shrimp
    function (ctx, R, L, blink) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = L.dark;
      ctx.lineWidth = R * 0.08;
      ctx.beginPath();
      ctx.moveTo(-R * 0.15, -R * 0.88);
      ctx.quadraticCurveTo(-R * 0.2, -R * 1.45, -R * 0.75, -R * 1.5);
      ctx.moveTo(R * 0.1, -R * 0.9);
      ctx.quadraticCurveTo(R * 0.15, -R * 1.5, R * 0.6, -R * 1.55);
      ctx.stroke();
      ctx.beginPath(); // tail fan
      ctx.moveTo(R * 0.78, R * 0.05);
      ctx.lineTo(R * 1.32, -R * 0.32);
      ctx.quadraticCurveTo(R * 1.45, R * 0.12, R * 1.32, R * 0.52);
      ctx.closePath();
      ctx.fillStyle = L.base;
      ctx.fill();
      outline(ctx, R, L.dark);
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.save();
      clipBody(ctx, R);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = R * 0.07;
      for (const x of [0.38, 0.62, 0.84]) {
        ctx.beginPath();
        ctx.arc(R * (x - 1.2), 0, R * 1.2, -0.6, 0.6);
        ctx.stroke();
      }
      ctx.restore();
      face(ctx, R, { cx: -0.12, ex: 0.28, blink });
    },
    // 1 clownfish
    function (ctx, R, L, blink) {
      ctx.beginPath(); // tail
      ctx.moveTo(R * 0.75, 0);
      ctx.lineTo(R * 1.35, -R * 0.5);
      ctx.quadraticCurveTo(R * 1.2, 0, R * 1.35, R * 0.5);
      ctx.closePath();
      ctx.fillStyle = L.base;
      ctx.fill();
      outline(ctx, R, INK);
      circle(ctx, R * 0.05, -R * 0.9, R * 0.32); // dorsal fin
      ctx.fillStyle = L.base;
      ctx.fill();
      outline(ctx, R, INK);
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      ctx.save();
      clipBody(ctx, R);
      ctx.lineWidth = R * 0.07;
      ctx.strokeStyle = INK;
      for (const x of [-0.86, 0.5]) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x * R, -R, R * 0.26, R * 2);
        ctx.strokeRect(x * R, -R * 1.2, R * 0.26, R * 2.4);
      }
      ctx.restore();
      circle(ctx, 0, 0, R);
      outline(ctx, R, INK);
      face(ctx, R, { ex: 0.26, cx: -0.12, blink });
    },
    // 2 crab
    function (ctx, R, L, blink) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = L.dark;
      ctx.lineWidth = R * 0.12;
      for (const s of [-1, 1]) {
        for (const y of [0.15, 0.45, 0.72]) {
          ctx.beginPath();
          ctx.moveTo(s * R * 0.8, y * R);
          ctx.quadraticCurveTo(s * R * 1.15, (y - 0.05) * R, s * R * 1.22, (y + 0.22) * R);
          ctx.stroke();
        }
      }
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      for (const s of [-1, 1]) { // claws
        circle(ctx, s * R * 0.8, -R * 0.72, R * 0.32);
        ctx.fillStyle = L.base;
        ctx.fill();
        outline(ctx, R, L.dark);
        ctx.beginPath();
        ctx.moveTo(s * R * 0.8, -R * 0.72);
        ctx.lineTo(s * R * 1.05, -R * 0.98);
        ctx.lineTo(s * R * 0.62, -R * 1.02);
        ctx.closePath();
        ctx.fillStyle = L.dark;
        ctx.fill();
      }
      ctx.strokeStyle = L.dark; // eye stalks
      ctx.lineWidth = R * 0.08;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * R * 0.22, -R * 0.55);
        ctx.lineTo(s * R * 0.28, -R * 0.92);
        ctx.stroke();
      }
      face(ctx, R, { ex: 0.28, ey: -0.95, er: 0.18, my: 0.22, blink });
    },
    // 3 starfish
    function (ctx, R, L, blink) {
      ctx.beginPath();
      const arms = 5, outer = R * 1.04, inner = R * 0.62;
      for (let i = 0; i < arms; i++) {
        const a = -Math.PI / 2 + (i * TAU) / arms;
        const b = a + Math.PI / arms;
        const tipX = Math.cos(a) * outer, tipY = Math.sin(a) * outer;
        const inX = Math.cos(b) * inner, inY = Math.sin(b) * inner;
        if (i === 0) ctx.moveTo(Math.cos(a - 0.22) * outer * 0.9, Math.sin(a - 0.22) * outer * 0.9);
        ctx.quadraticCurveTo(tipX * 1.08, tipY * 1.08, Math.cos(a + 0.22) * outer * 0.9, Math.sin(a + 0.22) * outer * 0.9);
        ctx.quadraticCurveTo(inX * 0.92, inY * 0.92, Math.cos(b + Math.PI / arms - 0.22) * outer * 0.9, Math.sin(b + Math.PI / arms - 0.22) * outer * 0.9);
      }
      ctx.closePath();
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < arms; i++) {
        const a = -Math.PI / 2 + (i * TAU) / arms;
        for (const d of [0.62, 0.82]) { circle(ctx, Math.cos(a) * R * d, Math.sin(a) * R * d, R * 0.055); ctx.fill(); }
      }
      face(ctx, R, { ex: 0.2, ey: -0.02, er: 0.14, my: 0.22, blink });
    },
    // 4 pufferfish
    function (ctx, R, L, blink) {
      const n = 16;
      ctx.fillStyle = L.dark;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a - 0.1) * R * 0.92, Math.sin(a - 0.1) * R * 0.92);
        ctx.lineTo(Math.cos(a) * R * 1.18, Math.sin(a) * R * 1.18);
        ctx.lineTo(Math.cos(a + 0.1) * R * 0.92, Math.sin(a + 0.1) * R * 0.92);
        ctx.closePath();
        ctx.fill();
      }
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.fillStyle = 'rgba(160,130,40,0.35)';
      for (const [x, y] of [[-0.45, -0.55], [0.1, -0.7], [0.5, -0.45], [-0.15, -0.42]]) { circle(ctx, x * R, y * R, R * 0.07); ctx.fill(); }
      ctx.beginPath(); // side fin
      ctx.ellipse(R * 0.82, R * 0.3, R * 0.22, R * 0.12, 0.6, 0, TAU);
      ctx.fillStyle = L.light;
      ctx.fill();
      outline(ctx, R * 0.6, L.dark);
      face(ctx, R, { ex: 0.32, er: 0.18, mouth: 'o', my: 0.3, blink });
    },
    // 5 jellyfish
    function (ctx, R, L, blink) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const x = (-0.56 + i * 0.28) * R;
        ctx.beginPath();
        ctx.moveTo(x, R * 0.2);
        ctx.bezierCurveTo(x - R * 0.15, R * 0.5, x + R * 0.15, R * 0.7, x - R * 0.05, R * 1.02);
        ctx.strokeStyle = L.dark;
        ctx.lineWidth = R * 0.13;
        ctx.stroke();
        ctx.strokeStyle = L.base;
        ctx.lineWidth = R * 0.07;
        ctx.stroke();
      }
      ctx.beginPath(); // bell
      ctx.arc(0, R * 0.12, R * 0.96, Math.PI, 0);
      const sc = 4;
      for (let i = 0; i < sc; i++) {
        const x0 = R * 0.96 - (i * 1.92 * R) / sc;
        const x1 = R * 0.96 - ((i + 1) * 1.92 * R) / sc;
        ctx.quadraticCurveTo((x0 + x1) / 2, R * 0.42, x1, R * 0.12);
      }
      ctx.closePath();
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.beginPath();
      ctx.ellipse(-R * 0.42, -R * 0.42, R * 0.2, R * 0.11, -0.6, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      face(ctx, R, { ex: 0.3, ey: -0.2, er: 0.15, my: 0.08, blink });
    },
    // 6 sea turtle
    function (ctx, R, L, blink) {
      const skin = '#b5e8a4', skinDark = '#5f9e52';
      for (const [x, y, rot] of [[-0.88, -0.35, -0.6], [0.88, -0.35, 0.6], [-0.82, 0.62, 0.6], [0.82, 0.62, -0.6]]) {
        ctx.beginPath();
        ctx.ellipse(x * R, y * R, R * 0.32, R * 0.17, rot, 0, TAU);
        ctx.fillStyle = skin;
        ctx.fill();
        outline(ctx, R * 0.8, skinDark);
      }
      circle(ctx, 0, R * 0.08, R * 0.92);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.save();
      circle(ctx, 0, R * 0.08, R * 0.92);
      ctx.clip();
      ctx.strokeStyle = L.dark;
      ctx.lineWidth = R * 0.06;
      const hex = (cx, cy, s) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + Math.PI / 6;
          const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      };
      hex(0, R * 0.25, R * 0.3);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        hex(Math.cos(a) * R * 0.6, R * 0.25 + Math.sin(a) * R * 0.6, R * 0.3);
      }
      ctx.restore();
      circle(ctx, 0, -R * 0.62, R * 0.44); // head
      ctx.fillStyle = skin;
      ctx.fill();
      outline(ctx, R * 0.8, skinDark);
      face(ctx, R, { ex: 0.17, ey: -0.7, er: 0.11, my: -0.48, blink });
    },
    // 7 octopus
    function (ctx, R, L, blink) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const x = (-0.62 + i * 0.31) * R;
        const s = x < -1 ? -1 : x > 1 ? 1 : 0;
        const ex = x + s * R * 0.2, ey = R * (i === 2 ? 1.08 : 0.98);
        const arm = () => {
          ctx.beginPath();
          ctx.moveTo(x * 0.85, R * 0.3);
          ctx.quadraticCurveTo(x + s * R * 0.02, R * 0.82, ex, ey);
        };
        arm();
        ctx.strokeStyle = L.dark;
        ctx.lineWidth = R * 0.24;
        ctx.stroke();
        arm();
        ctx.strokeStyle = L.base;
        ctx.lineWidth = R * 0.15;
        ctx.stroke();
        ctx.fillStyle = L.light;
        for (const t of [0.55, 0.8]) {
          circle(ctx, x * 0.85 + (ex - x * 0.85) * t, R * 0.3 + (ey - R * 0.3) * t, R * 0.035);
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.ellipse(0, -R * 0.08, R * 0.92, R * 0.86, 0, 0, TAU);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      outline(ctx, R, L.dark);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (const [x, y, r] of [[-0.35, -0.62, 0.1], [0.3, -0.7, 0.07], [0.55, -0.35, 0.08]]) { circle(ctx, x * R, y * R, r * R); ctx.fill(); }
      face(ctx, R, { ex: 0.3, ey: -0.05, er: 0.16, my: 0.24, blink });
    },
    // 8 narwhal
    function (ctx, R, L, blink) {
      ctx.beginPath(); // tusk
      ctx.moveTo(-R * 0.02, -R * 0.82);
      ctx.lineTo(R * 0.42, -R * 1.62);
      ctx.lineTo(R * 0.16, -R * 0.8);
      ctx.closePath();
      ctx.fillStyle = '#fff1d2';
      ctx.fill();
      outline(ctx, R * 0.6, '#b99a62');
      ctx.strokeStyle = '#c9ab72';
      ctx.lineWidth = R * 0.035;
      for (const t of [0.25, 0.45, 0.65]) {
        const x = -R * 0.02 + (R * 0.44) * t, y = -R * 0.82 - R * 0.8 * t;
        ctx.beginPath();
        ctx.moveTo(x, y + R * 0.06);
        ctx.lineTo(x + R * 0.14 * (1 - t), y - R * 0.02);
        ctx.stroke();
      }
      ctx.beginPath(); // tail
      ctx.moveTo(R * 0.82, R * 0.1);
      ctx.quadraticCurveTo(R * 1.25, -R * 0.2, R * 1.38, -R * 0.35);
      ctx.quadraticCurveTo(R * 1.2, R * 0.15, R * 1.38, R * 0.55);
      ctx.quadraticCurveTo(R * 1.1, R * 0.45, R * 0.82, R * 0.4);
      ctx.closePath();
      ctx.fillStyle = L.base;
      ctx.fill();
      outline(ctx, R, L.dark);
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      ctx.save();
      clipBody(ctx, R);
      ctx.beginPath();
      ctx.ellipse(0, R * 0.85, R * 0.85, R * 0.55, 0, 0, TAU);
      ctx.fillStyle = L.light;
      ctx.fill();
      ctx.fillStyle = 'rgba(60,120,170,0.35)';
      for (const [x, y, r] of [[-0.5, -0.5, 0.08], [-0.15, -0.72, 0.06], [0.35, -0.6, 0.09], [0.62, -0.25, 0.06], [-0.7, -0.1, 0.06]]) { circle(ctx, x * R, y * R, r * R); ctx.fill(); }
      ctx.restore();
      circle(ctx, 0, 0, R);
      outline(ctx, R, L.dark);
      face(ctx, R, { ex: 0.3, ey: -0.05, er: 0.15, my: 0.26, blink });
    },
    // 9 blue whale
    function (ctx, R, L, blink) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#8fd3ff'; // spout
      ctx.lineWidth = R * 0.08;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.92);
      ctx.lineTo(0, -R * 1.25);
      ctx.moveTo(0, -R * 1.2);
      ctx.quadraticCurveTo(-R * 0.25, -R * 1.5, -R * 0.42, -R * 1.25);
      ctx.moveTo(0, -R * 1.2);
      ctx.quadraticCurveTo(R * 0.25, -R * 1.5, R * 0.42, -R * 1.25);
      ctx.stroke();
      ctx.fillStyle = '#bfe8ff';
      for (const [x, y] of [[-0.45, -1.15], [0.45, -1.15], [-0.18, -1.5], [0.2, -1.52]]) { circle(ctx, x * R, y * R, R * 0.06); ctx.fill(); }
      ctx.beginPath(); // tail fluke
      ctx.moveTo(R * 0.82, -R * 0.05);
      ctx.quadraticCurveTo(R * 1.1, -R * 0.2, R * 1.22, -R * 0.62);
      ctx.quadraticCurveTo(R * 1.32, -R * 0.2, R * 1.48, -R * 0.42);
      ctx.quadraticCurveTo(R * 1.35, R * 0.05, R * 0.85, R * 0.25);
      ctx.closePath();
      ctx.fillStyle = L.base;
      ctx.fill();
      outline(ctx, R, L.dark);
      circle(ctx, 0, 0, R);
      ctx.fillStyle = bodyFill(ctx, R, L);
      ctx.fill();
      ctx.save();
      clipBody(ctx, R);
      ctx.beginPath();
      ctx.ellipse(0, R * 0.78, R * 0.95, R * 0.55, 0, 0, TAU);
      ctx.fillStyle = L.light;
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,110,190,0.45)';
      ctx.lineWidth = R * 0.035;
      for (const y of [0.42, 0.56, 0.7, 0.84]) {
        ctx.beginPath();
        ctx.moveTo(-R * 0.5, y * R);
        ctx.quadraticCurveTo(0, (y + 0.06) * R, R * 0.5, y * R);
        ctx.stroke();
      }
      ctx.restore();
      circle(ctx, 0, 0, R);
      outline(ctx, R, L.dark);
      face(ctx, R, { ex: 0.32, ey: -0.12, er: 0.15, my: 0.18, blink });
    },
  ];

  /** Draw critter `tier` centred at (0,0) with body radius R. */
  function drawCritter(ctx, tier, R, opts) {
    opts = opts || {};
    ctx.save();
    DRAW[tier](ctx, R, LOOK[tier], !!opts.blink);
    ctx.restore();
  }

  /** Cached bitmaps of every critter at the current pixel scale. */
  class Sprites {
    constructor(radii) { this.radii = radii; this.scale = 0; this.open = []; this.shut = []; }
    build(pxPerUnit) {
      if (Math.abs(pxPerUnit - this.scale) < 0.01) return;
      this.scale = pxPerUnit;
      this.open = [];
      this.shut = [];
      this.radii.forEach((R, tier) => {
        for (const blink of [false, true]) {
          const half = Math.ceil(R * PAD * pxPerUnit);
          const c = document.createElement('canvas');
          c.width = c.height = half * 2;
          const ctx = c.getContext('2d');
          ctx.translate(half, half);
          ctx.scale(pxPerUnit, pxPerUnit);
          drawCritter(ctx, tier, R, { blink });
          (blink ? this.shut : this.open).push(c);
        }
      });
    }
    /** Draw critter centred at (x,y) in a context already scaled to world units. */
    draw(ctx, tier, x, y, r, angle, blink) {
      const img = (blink ? this.shut : this.open)[tier];
      if (!img) return;
      const R = this.radii[tier];
      const size = R * PAD * 2 * (r / R);
      ctx.save();
      ctx.translate(x, y);
      if (angle) ctx.rotate(angle);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  /** PNG data URL of one critter, `px` pixels square (for menus). */
  function critterImage(tier, px, silhouette) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    const R = px / (PAD * 2);
    ctx.translate(px / 2, px / 2 + R * 0.12);
    drawCritter(ctx, tier, R);
    if (silhouette) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = 'rgba(10,40,80,0.55)';
      ctx.fillRect(0, 0, px, px);
    }
    return c.toDataURL('image/png');
  }

  window.CritterArt = { drawCritter, Sprites, critterImage, LOOK, PAD };
})();
