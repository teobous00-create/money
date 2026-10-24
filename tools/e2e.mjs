import { chromium } from 'playwright';
const OUT = process.env.OUT;
const CSV = process.env.CSV;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.env.SCHEME || 'light' });
const p = await ctx.newPage();
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
const shot = async n => { await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${n}.png` }); };
await p.goto(process.env.URL);
await p.waitForTimeout(800);
await shot('01-empty');
// import
await p.click('[aria-label=Settings]');
await p.waitForTimeout(500);
await p.getByText('Import from 1Money').click();
await p.waitForTimeout(500);
await p.setInputFiles('input[type=file]', CSV);
await p.waitForTimeout(500);
await shot('02-import-preview');
await p.getByRole('button', { name: 'Import', exact: true }).click();
await p.waitForTimeout(600);
await shot('03-import-done');
await p.getByText('Go to accounts').click();
await shot('04-accounts');
const text = await p.locator('.screen').innerText();
for (const [n, v] of [['Μετρητά', '90'], ['Πιστωτική', '−346,73'], ['Revolut', '17,53'], ['Ultima', '92,04'], ['Eightcup', '500']]) {
  const re = new RegExp(n + '[^\\n]*\\n?[^\\n]*' + v.replace(/[.,]/g, m => '\\' + m));
  console.log((re.test(text) ? 'ok  ' : 'FAIL') + ' balance ' + n + ' = ' + v);
}
await p.click('.nav-item:nth-child(2)');
await shot('05-categories');
await p.click('.nav-item:nth-child(3)');
await shot('06-transactions');
await p.click('.nav-item:nth-child(4)');
await shot('07-overview');
// add an expense via categories
await p.click('.nav-item:nth-child(2)');
await p.waitForTimeout(500);
await p.locator('.cat-tile').filter({ hasText: 'Supermarket' }).first().click();
await p.waitForTimeout(600);
for (const k of ['4', ',', '5', '0']) await p.click(`.key[aria-label="${k}"]`);
await p.locator('.chip', { hasText: 'Καφές' }).click();
await shot('08-add-expense');
await p.click('.key[aria-label=Save]');
await shot('09-after-save');
await p.click('.nav-item:nth-child(3)');
await shot('10-tx-after');
// transfer
await p.click('.fab');
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Transfer', exact: true }).click();
await p.waitForTimeout(400);
await shot('11-transfer');
// period picker
await p.keyboard.press('Escape');
await p.goBack();
await p.waitForTimeout(500);
await p.click('.period-pill');
await shot('12-period');
await p.goBack();
await p.waitForTimeout(400);
// filter
await p.click('.total-btn');
await shot('13-filter');
await p.goBack();
await p.waitForTimeout(400);
// reload persistence
await p.reload();
await p.waitForTimeout(1500);
const t2 = await p.locator('.topbar').innerText();
console.log('after reload header:', t2.replace(/\n/g, ' | '));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
