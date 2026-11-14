// Smoke test + screenshots for Critter Merge in headless Chromium.
// Fails on any console error. Usage:
//   node tools/critter-screens.mjs [outDir] [scale=1] [width=412] [height=915]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'critter-merge', 'web');
const outDir = path.resolve(process.argv[2] || 'critter-merge/screenshots');
const scale = Number(process.argv[3] || 1);
const vw = Number(process.argv[4] || 412);
const vh = Number(process.argv[5] || 915);
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('saved', name); };
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => ({ ui: window.__critter.ui, drops: window.__critter.game && window.__critter.game.drops, n: window.__critter.game && window.__critter.game.bodies.length }));

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await wait(1200);
await shot('01-title');

await page.click('#playBtn');
await wait(600);
await shot('02-start-hint');

// Real touch drops: press, slide, release.
const rect = await page.evaluate(() => window.__critter.renderer.tankRect());
for (let i = 0; i < 6; i++) {
  const x = rect.left + rect.width * (0.2 + 0.12 * i);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.left + rect.width / 2, y: rect.top + 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: rect.top + 60 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await wait(650);
}
console.log('after touch drops', await state());

// Fast-forward a busy tank with a simple "aim at a twin" strategy.
await page.evaluate(() => {
  const M = window.__critter, g = M.game, C = window.CritterCore;
  let f = 0;
  while (g.drops < 70 && g.state === 'play' && f++ < 60 * 400) {
    if (g.canDrop() && f % 40 === 0) {
      let best = null;
      for (const b of g.bodies) if (b.tier === g.cur && (!best || b.y < best.y)) best = b;
      g.setAim(best ? best.x : 40 + Math.random() * (C.TW - 80));
      g.drop();
    }
    g.update(1 / 60);
    g.events = g.events.filter((e) => e.type !== 'drop' && e.type !== 'over');
    for (const e of g.events) if (e.type === 'merge' && e.tier >= 5) M.save.discovered[e.tier] = true;
    g.events = g.events.filter((e) => e.type !== 'merge' || e.tier < 5).slice(-3);
  }
});
await wait(1200);
console.log('busy tank', await state());
await shot('03-busy-tank');

// Discovery card (pretend a brand-new critter was just made).
await page.evaluate(() => {
  const M = window.__critter;
  M.save.discovered[7] = false;
  M.game.events.push({ type: 'merge', tier: 7, x: 180, y: 300, points: 28, combo: 1 });
});
await wait(1200);
console.log('discover', await state());
await shot('04-discover');
await page.click('#discOk');
await wait(400);

await page.click('#pauseBtn');
await wait(400);
await shot('05-pause');
await page.click('#resumeBtn');
await wait(300);

// Shake.
await page.click('#shakeBtn');
await wait(300);

// Fill the tank to the brim → Bubble Rescue → then game over.
await page.evaluate(() => {
  const g = window.__critter.game;
  let f = 0;
  const fill = () => {
    if (g.state !== 'play' || f++ > 60 * 120) return;
    if (window.__critter.ui === 'discover') document.getElementById('discOk').click();
    g.cooldown = 0;
    if (f % 6 === 0) { g.cur = [3, 5, 4, 6][(f / 6) % 4]; g.setAim(60 + ((f * 37) % 240)); g.drop(); }
    setTimeout(fill, 16);
  };
  fill();
});
await page.waitForFunction(() => window.__critter.game.rescues === 0, null, { timeout: 60000 });
await wait(500);
await shot('06-bubble-rescue');
await page.waitForFunction(() => window.__critter.ui === 'over', null, { timeout: 90000 });
await wait(800);
await shot('07-game-over');

await page.click('#overHomeBtn');
await wait(400);
await page.click('#albumBtn');
await wait(500);
await shot('08-album');

console.log('final', await state());
await browser.close();
server.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('no console errors');
