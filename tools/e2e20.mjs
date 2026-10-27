// the mic stops by itself: 1 s after the last words, 5 s if nothing is said
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__say = null; window.__stops = [];
  // like Chrome on Android: keeps listening until told to stop
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { this.t0 = Date.now(); const s = window.__say; if (!s) return;
      const w = s.split(' '); w.forEach((_, i) => setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: w.slice(0, i + 1).join(' ') }], { isFinal: false })] }), 300 + i * 400)); }
    stop() { window.__stops.push(Date.now() - this.t0); setTimeout(() => this.onend?.(), 50); }
    abort() {}
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
await p.evaluate(() => { window.__say = 'καφές 3 revolut'; });   // last word at ~1,1 s
await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(3000);
const s1 = await p.evaluate(() => window.__stops[0]);
ok(s1 > 2000 && s1 < 2400, `stopped ~1 s after the last word (${s1} ms)`);
ok(/Revolut 3 €/.test(await p.locator('.toast').innerText().catch(() => '')), 'and saved it');
ok(await p.locator('.voice-pill').count() === 0, 'listening pill gone');
await p.evaluate(() => { window.__say = null; });
await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(5600);
const s2 = await p.evaluate(() => window.__stops[1]);
ok(s2 > 4900 && s2 < 5300, `nothing said → stopped after 5 s (${s2} ms)`);
console.log('errors:', errors.length ? errors : 'none');
await b.close();
