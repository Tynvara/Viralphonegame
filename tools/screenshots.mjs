// Drives the web build in headless Chromium: smoke-tests every screen, fails on
// console errors, and saves screenshots (handy for the Play Store listing too).
//
// Usage: node tools/screenshots.mjs [outDir=store/screenshots] [scale=1] [width=412] [height=915] [png|jpg]
// Play Store phone screenshots: node tools/screenshots.mjs store/screenshots 3 360 640 jpg  (→ 1080×1920)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const outDir = path.resolve(process.argv[2] || 'store/screenshots');
const scale = Number(process.argv[3] || 1);
const vw = Number(process.argv[4] || 412);
const vh = Number(process.argv[5] || 915);
const fmt = process.argv[6] === 'jpg' ? 'jpg' : 'png';
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = async (name) => {
  const opts = fmt === 'jpg' ? { type: 'jpeg', quality: 88 } : { type: 'png' };
  await page.screenshot({ path: path.join(outDir, name + '.' + fmt), ...opts });
  console.log('saved', name);
};
const wait = (ms) => page.waitForTimeout(ms);

// In-page autopilot: launches whenever a lookahead says it will be a (perfect) capture.
const installBot = () => page.evaluate(() => {
  const M = window.__moonsling;
  function probe(g) {
    const c = g.clone();
    c.events = [];
    if (!c.tap()) return null;
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60);
      for (const e of c.events) {
        if (e.type === 'death' || e.type === 'recapture') return null;
        if (e.type === 'capture') return e;
      }
      c.events.length = 0;
    }
    return null;
  }
  window.__botStep = function (g) {
    if (g.state !== 'play' || g.moon.state !== 'orbit') return false;
    const r = probe(g);
    if (r && (r.perfect || (g.timerOn && g.moon.decay < 0.6))) { g.tap(); return true; }
    return false;
  };
  window.__bot = setInterval(() => { if (M.ui === 'playing') window.__botStep(M.game); }, 16);
  // Fast-forward the simulation (no rendering) until `hops` is reached.
  window.__fastForward = function (hops) {
    const g = M.game;
    let n = 0;
    while (g.hops < hops && g.state === 'play' && n++ < 200000) {
      window.__botStep(g);
      g.update(1 / 60);
      if (g.state === 'dead') break;
      g.events = g.events.filter((e) => e.type === 'death');
    }
    return { hops: g.hops, score: g.score, state: g.state };
  };
});
const stopBot = () => page.evaluate(() => clearInterval(window.__bot));

await page.goto(url);
await wait(1200);
await shot('01-title');

// Start + tutorial guide visible.
await page.touchscreen.tap(vw / 2, vh * 0.47);
await wait(700);
await shot('02-tutorial');

await installBot();
await page.waitForFunction(() => window.__moonsling.game.hops >= 4, null, { timeout: 30000 });
await wait(300);
await shot('03-gameplay');

// Later zones and hazards.
let ff = await page.evaluate(() => window.__fastForward(27));
console.log('fast-forward', ff);
await wait(1500);
await shot('04-zone-hazards');
ff = await page.evaluate(() => window.__fastForward(44));
console.log('fast-forward', ff);
await wait(1500);
await shot('05-black-holes');

// Let the orbit decay → game over.
await stopBot();
await page.waitForFunction(() => window.__moonsling.ui === 'over', null, { timeout: 15000 });
await wait(900);
await shot('06-game-over');

// Score card image used for sharing.
const card = await page.evaluate(() => {
  const r = window.__moonsling.game.result();
  return window.MoonShare.renderCard(Object.assign(r, { daily: true, dailyNo: 1 })).toDataURL('image/png');
});
fs.writeFileSync(path.join(outDir, '07-share-card.png'), Buffer.from(card.split(',')[1], 'base64'));
console.log('saved 07-share-card');

// Skins screen with some bank.
await page.evaluate(() => { window.__moonsling.save.bank = 320; });
await page.getByRole('button', { name: 'HOME' }).last().click();
await wait(500);
await page.click('#skinsBtn');
await wait(500);
await page.locator('.skin').nth(1).click();
await wait(400);
await shot('08-skins');
await page.click('#skinsClose');
await wait(400);

// Daily run + pause.
await page.click('#dailyBtn');
await wait(600);
await page.click('#pauseBtn');
await wait(400);
await shot('09-pause');

const text = await page.evaluate(() => window.MoonCore.shareText({ score: 57, hops: 31, perfects: 12, hopLog: 'PGPPGPPPGGPPPPGPGPPPGGPPPGPPGPGX'.split(''), daily: true, dailyNo: 1, streakDays: 3, url: 'https://example.com/moonsling' }));
console.log('\nshare text:\n' + text + '\n');

await browser.close();
server.close();

if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('no console errors');
