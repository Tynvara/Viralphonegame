// Renders Play Store listing art with headless Chromium:
//   store/icon-512.png        (hi-res app icon, 512×512)
//   store/feature-graphic.png (feature graphic, 1024×500)
// Usage: node tools/store-art.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body style="margin:0;background:#000"></body>');

const images = await page.evaluate(() => {
  const TAU = Math.PI * 2;
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function sky(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#3a1470');
    g.addColorStop(0.6, '#12062b');
    g.addColorStop(1, '#0b0420');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 2500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.2 + rnd() * 0.7).toFixed(2)})`;
      const s = 1 + rnd() * 2.5;
      ctx.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }

  function planet(ctx, x, y, r, c0, c1, c2) {
    const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.4);
    glow.addColorStop(0, c1 + '66');
    glow.addColorStop(1, c1 + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, TAU);
    ctx.fill();
    const b = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    b.addColorStop(0, c0);
    b.addColorStop(0.55, c1);
    b.addColorStop(1, c2);
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y + r * 0.25, r * 0.2, 0, TAU);
    ctx.arc(x - r * 0.25, y + r * 0.45, r * 0.12, 0, TAU);
    ctx.fill();
  }

  function moonWithTrail(ctx, cx, cy, R, a0, a1, mr) {
    ctx.lineCap = 'round';
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const t0 = a0 + ((a1 - a0) * (i - 1)) / steps, t1 = a0 + ((a1 - a0) * i) / steps;
      ctx.strokeStyle = `rgba(217,210,255,${((i / steps) * 0.85).toFixed(3)})`;
      ctx.lineWidth = mr * (0.3 + (i / steps) * 1.1);
      ctx.beginPath();
      ctx.arc(cx, cy, R, t0, t1);
      ctx.stroke();
    }
    const mx = cx + Math.cos(a1) * R, my = cy + Math.sin(a1) * R;
    const g = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3.2);
    g.addColorStop(0, 'rgba(191,180,255,0.75)');
    g.addColorStop(1, 'rgba(191,180,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 3.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, TAU);
    ctx.fill();
  }

  function ring(ctx, x, y, R, w) {
    ctx.strokeStyle = 'rgba(255,255,255,0.33)';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
  }

  // --- icon 512 ---
  const icon = document.createElement('canvas');
  icon.width = icon.height = 512;
  let ctx = icon.getContext('2d');
  sky(ctx, 512, 512);
  const s = 512 / 108;
  ring(ctx, 256, 256, 27 * s, 1.6 * s);
  planet(ctx, 256, 256, 15 * s * 1.05, '#ffe3f0', '#ff5fa2', '#a02a63');
  moonWithTrail(ctx, 256, 256, 27 * s, -2.6, -0.87, 5.2 * s);

  // --- feature graphic 1024×500 ---
  const fg = document.createElement('canvas');
  fg.width = 1024;
  fg.height = 500;
  ctx = fg.getContext('2d');
  sky(ctx, 1024, 500);
  planet(ctx, 800, 330, 70, '#fff1d6', '#ffb36b', '#9a4a12');
  ring(ctx, 800, 330, 118, 3);
  planet(ctx, 930, 110, 34, '#d8fbff', '#8be9fd', '#22708a');
  planet(ctx, 640, 80, 26, '#efe6ff', '#c3a6ff', '#5a3d99');
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = 'rgba(255,224,102,0.8)';
  ctx.lineWidth = 3;
  const mx = 800 + Math.cos(-1.8) * 118, my = 330 + Math.sin(-1.8) * 118;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(640, 80);
  ctx.stroke();
  ctx.setLineDash([]);
  moonWithTrail(ctx, 800, 330, 118, -3.7, -1.8, 13);
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 100px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,95,162,0.6)';
  ctx.shadowBlur = 40;
  ctx.fillText('MOON', 60, 250);
  const mw = ctx.measureText('MOON').width;
  const tg = ctx.createLinearGradient(0, 160, 0, 250);
  tg.addColorStop(0, '#ffd1e6');
  tg.addColorStop(1, '#ff5fa2');
  ctx.fillStyle = tg;
  ctx.fillText('SLING', 60 + mw, 250);
  ctx.shadowBlur = 0;
  ctx.font = `800 40px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('Tap to sling. Hit the planets.', 64, 320);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = '#ffe066';
  ctx.fillText('★ New Daily Challenge every day', 64, 380);

  return { icon: icon.toDataURL('image/png'), feature: fg.toDataURL('image/png') };
});

fs.writeFileSync(path.join(out, 'icon-512.png'), Buffer.from(images.icon.split(',')[1], 'base64'));
fs.writeFileSync(path.join(out, 'feature-graphic.png'), Buffer.from(images.feature.split(',')[1], 'base64'));
await browser.close();
console.log('wrote store/icon-512.png and store/feature-graphic.png');
