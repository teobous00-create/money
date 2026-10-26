import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__say = '3€ bonus σήμερα';
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: window.__say.slice(0, 5) }], { isFinal: false })] }); }, 150);
      setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: window.__say }], { isFinal: true })] }); this.onend?.(); }, 700); }
    stop() {} abort() {}
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(1200);   // tracker creates the jobs
await p.click('[aria-label="Job settings"]'); await p.waitForTimeout(600);
await p.locator('.sheet').last().getByText('Morning').click(); await p.waitForTimeout(600);
await p.locator('.sheet').last().locator('.field', { hasText: 'Usual day pay' }).locator('input').fill('40');
await p.locator('.sheet').last().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(600);
await p.goBack(); await p.waitForTimeout(500);
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(600);
await p.reload(); await p.waitForTimeout(1200);
ok(await p.locator('.nav-item.on').innerText() === 'Transactions', 'opens on Transactions');
ok(await p.locator('[aria-label=Search]').count() === 0 && await p.locator('[aria-label="Speak a command"]').count() === 1, 'mic instead of search');
await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(350);
await p.screenshot({ path: `${OUT}/m1.png` });
ok(/3€ b/.test(await p.locator('.voice-pill').innerText().catch(() => '')), 'pill shows what it hears');
await p.waitForTimeout(900);
const tt = await p.locator('.toast').innerText().catch(() => '');
ok(/Morning · bonus 3 €/.test(tt), 'bonus went to the morning shift: ' + tt);
await p.screenshot({ path: `${OUT}/m2.png` });
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(900);
ok(/40 € \+ 3 €/.test(await p.locator('.card', { hasText: 'Morning' }).innerText()), 'owed to you: 40 € + 3 €');
await p.goto(process.env.URL + '?a=shift'); await p.waitForTimeout(1200);
ok(await p.locator('.nav-item.on').innerText() === 'Tracker', 'shortcut still wins over Transactions');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
