import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// fake speech recognition: "says" whatever window.__say holds
await ctx.addInitScript(() => {
  window.__say = 'delivery 12 ευρώ και 50 χθες revolut';
  localStorage.setItem('money:voice-auto', '0');   // this test checks the filled-in form
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { const t = window.__say; this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 300); }
    stop() {} abort() {}
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
const top = () => p.locator('.sheet').last();
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
// typed
await p.click('[aria-label="Add transaction"]'); await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/q0.png` });
await top().locator('.quick-input').fill('καφές με Γιώργο 4 Παρασκευή μετρητά');
await top().locator('.quick-input').press('Enter'); await p.waitForTimeout(900);
let t = await top().innerText();
await p.screenshot({ path: `${OUT}/q1.png` });
ok(/Μετρητά/.test(t) && /Supermarket/.test(t) && /Expense/.test(t), 'typed: Supermarket, Μετρητά');
ok(await top().locator('.subchip', { hasText: 'Καφές' }).evaluate(e => getComputedStyle(e).color === 'rgb(255, 255, 255)'), 'subcategory Καφές selected');
ok(await top().locator('.note-input').inputValue() === 'με Γιώργο', 'note "με Γιώργο"');
ok(/23 Oct 2026/.test(t), 'date Friday 23 Oct');
ok((await top().locator('.amount').innerText()).replace(/\s/g, '').startsWith('4'), 'amount 4');
// correct the category → learns
await top().locator('.split-half').nth(1).click(); await p.waitForTimeout(700);
await top().locator('.cat-tile', { hasText: 'Διασκέδαση' }).click(); await p.waitForTimeout(700);
await top().locator('.subchip', { hasText: 'Καφές' }).click(); await p.waitForTimeout(200);
await top().locator('.key[aria-label="go"], .key.go').first().click(); await p.waitForTimeout(900);
const learned = await p.evaluate(() => localStorage.getItem('money:learn'));
ok(/καφεσ/.test(learned ?? ''), 'correction remembered: ' + learned);
// spoken, via the app-icon shortcut
await p.goto(process.env.URL + '?a=voice'); await p.waitForTimeout(2200);
t = await top().innerText();
await p.screenshot({ path: `${OUT}/q2.png` });
ok(/Revolut/.test(t) && /Σπίτι/.test(t) && /Delivery/.test(t), 'spoken: Σπίτι › Delivery, Revolut');
ok((await top().locator('.amount').innerText()).replace(/\s/g, '').startsWith('12,5'), 'amount 12,50');
ok(/26 Oct 2026/.test(t) && /Yesterday/.test(t), 'yesterday');
ok(!(await p.evaluate(() => location.search)), 'url cleaned');
// learned: next time "καφές" goes to Διασκέδαση
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label="Add transaction"]'); await p.waitForTimeout(800);
await top().locator('.quick-input').fill('καφές 2'); await top().locator('.quick-input').press('Enter'); await p.waitForTimeout(900);
ok(/Διασκέδαση/.test(await top().innerText()), 'learned: καφές → Διασκέδαση now');
// transfer
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label="Add transaction"]'); await p.waitForTimeout(800);
await top().locator('.quick-input').fill('από revolut σε μετρητά 50'); await top().locator('.quick-input').press('Enter'); await p.waitForTimeout(900);
t = await top().innerText();
ok(/Transfer/.test(t) && /Revolut/.test(t) && /Μετρητά/.test(t), 'transfer Revolut → Μετρητά');
await p.screenshot({ path: `${OUT}/q3.png` });
// shift shortcut
await p.goto(process.env.URL + '?a=shift'); await p.waitForTimeout(1500);
ok(/Tue 27 Oct|27 Oct|Today/.test(await top().innerText().catch(() => '')), 'shift shortcut opens today\'s shift');
await p.screenshot({ path: `${OUT}/q4.png` });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
