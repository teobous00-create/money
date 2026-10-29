// URL=http://localhost:5173/ OUT=/tmp/shots node tools/e2e-strategy-order.mjs   (dev server with VITE_LOCAL=1)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.env.SCHEME || 'light' });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let fails = 0;
const ok = (c, m) => { fails += !c; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };
const OUT = process.env.OUT;
const shot = async n => { await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${n}.png` }); };
const top = () => p.locator('.sheet').last();
const names = () => top().locator('.sub-row .ellipsis').allInnerTexts();

await p.goto(process.env.URL); await p.waitForTimeout(900);
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(800);
await p.getByText('Trading', { exact: true }).click(); await p.waitForTimeout(600);

// add three strategies (the first opens straight into "New strategy")
await p.getByRole('button', { name: 'Add strategy' }).click(); await p.waitForTimeout(600);
for (const [i, n] of ['DEEP DIP GOLD', 'TSSB', 'TSSS'].entries()) {
  if (i > 0) { await top().getByRole('button', { name: 'New strategy' }).click(); await p.waitForTimeout(500); }
  await top().locator('input').first().fill(n);
  await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(700);
  await p.locator('.row.small.bold').last().click(); await p.waitForTimeout(600);   // reopen the picker
}
ok((await names()).join(',') === 'DEEP DIP GOLD,TSSB,TSSS', 'three strategies in creation order: ' + (await names()).join(','));
await shot('s1-picker');

// drag TSSS (3rd) above DEEP DIP GOLD (1st) by its handle (after the 'Saved' toast is gone, it sits over the list)
await p.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
const grip = top().locator('.sub-row .grip').nth(2);
const first = top().locator('.sub-row').nth(0);
const g = await grip.boundingBox(), f = await first.boundingBox();
const cdp = await ctx.newCDPSession(p);
const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: g.x + g.width / 2, y }] });
const y0 = g.y + g.height / 2, y1 = f.y + f.height / 2 - 6;
await touch('touchStart', y0); await p.waitForTimeout(60);
for (let i = 1; i <= 16; i++) { await touch('touchMove', y0 + ((y1 - y0) * i) / 16); await p.waitForTimeout(30); }
await touch('touchEnd'); await p.waitForTimeout(900);
ok((await names()).join(',') === 'TSSS,DEEP DIP GOLD,TSSB', 'after drag: ' + (await names()).join(','));
await shot('s2-reordered');

// order survives closing and reopening
await p.keyboard.press('Escape'); await p.goBack().catch(() => {}); await p.waitForTimeout(700);
if (!(await p.locator('.sheet').count())) { await p.locator('.row.small.bold').last().click(); await p.waitForTimeout(700); }
ok((await names()).join(',') === 'TSSS,DEEP DIP GOLD,TSSB', 'order kept after reopening: ' + (await names()).join(','));

// archive DEEP DIP GOLD from its edit sheet
await p.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
await top().getByRole('button', { name: 'Edit DEEP DIP GOLD' }).click(); await p.waitForTimeout(600);
await top().getByRole('button', { name: 'Archive strategy' }).click(); await p.waitForTimeout(800);
ok((await names()).join(',') === 'TSSS,TSSB', 'archived one is gone from the list: ' + (await names()).join(','));
ok(/Archived · 1/i.test(await top().innerText()), 'Archived · 1 section shown');
await top().getByText(/Archived · 1/i).click(); await p.waitForTimeout(600);
ok(await top().getByRole('button', { name: 'Restore' }).isVisible(), 'Restore button visible');
await shot('s3-archived');

// restore it: comes back at the end
await top().getByRole('button', { name: 'Restore' }).click(); await p.waitForTimeout(800);
ok((await names()).join(',') === 'TSSS,TSSB,DEEP DIP GOLD', 'restored at the end: ' + (await names()).join(','));
ok(!/Archived ·/i.test(await top().innerText()), 'archive section gone when empty');
await shot('s4-restored');

// tapping a row still selects it
await p.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
await top().locator('.sub-row button.row').nth(1).click(); await p.waitForTimeout(700);
ok(/TSSB/.test(await p.locator('.row.small.bold').last().innerText()), 'tap selects TSSB');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
await b.close();
