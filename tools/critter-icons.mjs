// Renders Critter Merge icons from the in-code critter art:
//   critter-merge/web/icon-{180,192,512}.png   (iPad/iPhone home screen, web)
//   critter-merge/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png (Android adaptive icon)
// Usage: node tools/critter-icons.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'critter-merge');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ path: path.join(root, 'web/js/art.js') });
const out = await page.evaluate(() => {
  const { drawCritter } = window.CritterArt;
  function icon(px, withBg, safe) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    if (withBg) {
      const g = ctx.createLinearGradient(0, 0, 0, px);
      g.addColorStop(0, '#5fdcf7');
      g.addColorStop(1, '#1477c9');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, px, px);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = px * 0.012;
      for (const [x, y, r] of [[0.16, 0.2, 0.05], [0.84, 0.16, 0.035], [0.86, 0.34, 0.022], [0.12, 0.42, 0.025]]) {
        ctx.beginPath();
        ctx.arc(x * px, y * px, r * px, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const k = safe || 1;
    ctx.save(); // big clownfish
    ctx.translate(px * 0.46, px * 0.56);
    drawCritter(ctx, 1, px * 0.27 * k);
    ctx.restore();
    ctx.save(); // little pufferfish buddy
    ctx.translate(px * (0.5 + 0.27 * k), px * (0.56 - 0.25 * k));
    drawCritter(ctx, 4, px * 0.11 * k);
    ctx.restore();
    return c.toDataURL('image/png');
  }
  return { i180: icon(180, true), i192: icon(192, true), i512: icon(512, true), fg: icon(432, false, 0.62) };
});
const write = (rel, url) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', rel);
};
write('web/icon-180.png', out.i180);
write('web/icon-192.png', out.i192);
write('web/icon-512.png', out.i512);
write('app/src/main/res/drawable-nodpi/ic_launcher_foreground.png', out.fg);
await browser.close();
