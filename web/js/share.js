/*
 * Moonsling — score card image + share plumbing (Android bridge / Web Share / clipboard).
 */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const { zoneInfo, starPath, rgba, FONT } = window.MoonRender;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Draws a 1080×1350 (4:5) score card and returns the canvas. */
  function renderCard(r) {
    const Wc = 1080, Hc = 1350;
    const cv = document.createElement('canvas');
    cv.width = Wc;
    cv.height = Hc;
    const ctx = cv.getContext('2d');
    const z = zoneInfo(r.zone || 0);

    const g = ctx.createLinearGradient(0, 0, 0, Hc);
    g.addColorStop(0, z.sky[0]);
    g.addColorStop(0.55, z.sky[1]);
    g.addColorStop(1, z.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Wc, Hc);

    // deterministic star field
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.2 + rnd() * 0.7).toFixed(2)})`;
      const sz = 1 + rnd() * 3;
      ctx.fillRect(rnd() * Wc, rnd() * Hc, sz, sz);
    }

    // decorative planet + orbit + moon
    const px = 930, py = 1250, pr = 120;
    const glow = ctx.createRadialGradient(px, py, pr * 0.5, px, py, pr * 2.3);
    glow.addColorStop(0, rgba(z.planets[0], 0.45));
    glow.addColorStop(1, rgba(z.planets[0], 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, Wc, Hc);
    const body = ctx.createRadialGradient(px - 50, py - 60, 10, px, py, pr);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.25, z.planets[0]);
    body.addColorStop(1, z.sky[0]);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();
    ctx.setLineDash([14, 18]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(px, py, pr + 60, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const mx = px + Math.cos(-2.0) * (pr + 60), my = py + Math.sin(-2.0) * (pr + 60);
    const mg = ctx.createRadialGradient(mx, my, 6, mx, my, 70);
    mg.addColorStop(0, 'rgba(255,255,255,0.8)');
    mg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(mx, my, 70, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, TAU);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 92px ${FONT}`;
    ctx.fillText('MOONSLING', Wc / 2, 170);
    ctx.font = `800 40px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(r.daily ? `DAILY CHALLENGE #${r.dailyNo}` : 'ENDLESS RUN', Wc / 2, 240);

    ctx.font = `900 300px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = z.accent;
    ctx.shadowBlur = 60;
    ctx.fillText(String(r.score), Wc / 2, 540);
    ctx.shadowBlur = 0;
    ctx.font = `800 44px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('POINTS', Wc / 2, 610);
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(`${r.hops} planets  ·  ${r.perfects} perfect  ·  best streak ${r.bestStreak}`, Wc / 2, 690);

    // hop grid
    const log = r.hopLog.slice(-30);
    const per = 10, cell = 62, gapc = 14;
    const gw = Math.min(log.length, per) * (cell + gapc) - gapc;
    const gx = (Wc - gw) / 2;
    const gy = 760;
    log.forEach((c, i) => {
      const x = gx + (i % per) * (cell + gapc);
      const y = gy + Math.floor(i / per) * (cell + gapc);
      ctx.fillStyle = c === 'P' ? '#4ade80' : c === 'G' ? '#facc15' : '#f43f5e';
      roundRect(ctx, x, y, cell, cell, 14);
      ctx.fill();
    });

    ctx.textAlign = 'left';
    ctx.font = `900 64px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Can you beat me?', 70, Hc - 150);
    ctx.font = `700 38px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Tap to sling. Hit the planets.', 70, Hc - 90);
    starPath(ctx, 70 + 22, Hc - 260, 22, 0);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
    ctx.font = `800 40px ${FONT}`;
    ctx.fillStyle = '#ffe066';
    ctx.fillText(`${r.stars}`, 128, Hc - 246);
    return cv;
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied — paste it anywhere!');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied — paste it anywhere!'); } catch (e2) { toast('Could not share'); }
      ta.remove();
    }
  }

  /** Share a run: image + text where possible, falling back gracefully. */
  async function shareRun(r, text) {
    const native = window.MoonslingAndroid;
    let card = null;
    try { card = renderCard(r); } catch (e) { card = null; }

    if (native && typeof native.shareImage === 'function' && card) {
      native.shareImage(card.toDataURL('image/png').split(',')[1], text);
      return;
    }
    if (native && typeof native.share === 'function') {
      native.share(text);
      return;
    }
    if (navigator.share) {
      try {
        if (card && navigator.canShare) {
          const blob = await new Promise((res) => card.toBlob(res, 'image/png'));
          const file = blob && new File([blob], 'moonsling-score.png', { type: 'image/png' });
          if (file && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text });
            return;
          }
        }
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    copyText(text);
  }

  window.MoonShare = { renderCard, shareRun, toast };
})();
