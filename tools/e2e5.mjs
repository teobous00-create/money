import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const names = async () => (await p.locator('.screen .cat-grid .cat-name').allInnerTexts());
const center = async (i) => { const bb = await p.locator('.screen .cat-grid .cat-tile').nth(i).boundingBox(); return [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
const periodBefore = await p.locator('.period-pill').innerText();
const before = await names();
console.log('before:', before.slice(0, 8).join(', '));
// drag tile 0 to position 5 (second row, second column)
const [x0, y0] = await center(0); const [x5, y5] = await center(5);
await touch('touchStart', x0, y0); await p.waitForTimeout(600);
for (let k = 1; k <= 20; k++) { await touch('touchMove', x0 + (x5 - x0) * k / 20, y0 + (y5 - y0) * k / 20); await p.waitForTimeout(25); }
await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/s1-dragging.png' });
await touch('touchEnd', 0, 0); await p.waitForTimeout(700);
const after = await names();
console.log('after: ', after.slice(0, 8).join(', '));
ok(after[5] === before[0] && after[0] === before[1], 'tile moved from slot 1 to slot 6, others shifted');
ok(!(await p.locator('.sheet').count()), 'no sheet opened by the drag');
ok((await p.locator('.period-pill').innerText()) === periodBefore, 'month did not change during the horizontal drag');
// hold without moving → details
const [hx, hy] = await center(1);
await touch('touchStart', hx, hy); await p.waitForTimeout(650); await touch('touchEnd', 0, 0); await p.waitForTimeout(900);
ok((await p.locator('.sheet').count()) > 0 && (await p.locator('.sheet').last().innerText()).includes('transactions'), 'hold and release opens details');
await p.goBack(); await p.waitForTimeout(700);
// tap → add screen
await p.locator('.screen .cat-grid .cat-tile').nth(2).click(); await p.waitForTimeout(700);
ok(await p.locator('.split').count() === 1, 'tap opens the add screen');
await p.goBack(); await p.waitForTimeout(700);
// persists after reload
await p.reload(); await p.waitForTimeout(1800);
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(900);   // your account opens on Transactions
ok(JSON.stringify((await names()).slice(0, 8)) === JSON.stringify(after.slice(0, 8)), 'order kept after reload');
// add picker uses the same order
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(500);
await p.click('.fab'); await p.waitForTimeout(700);
const pick = await p.locator('.sheet .cat-name').allInnerTexts();
ok(pick[0] === after[0] && pick[5] === after[5], 'the + picker shows the same order');
await p.goBack(); await p.waitForTimeout(600);

// subcategories: open Σπίτι editor via detail → pencil
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(800);
const idx = (await names()).indexOf('Σπίτι');
const [sx, sy] = await center(idx);
await touch('touchStart', sx, sy); await p.waitForTimeout(650); await touch('touchEnd', 0, 0); await p.waitForTimeout(900);
await p.locator('.sheet [aria-label=Edit]').first().click(); await p.waitForTimeout(900);
const sheet = p.locator('.sheet').last();
await sheet.getByText('Subcategories').scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
const subs = async () => sheet.locator('.sub-row .grow').allInnerTexts();
const sb = await subs();
console.log('subs before:', sb.join(', '));
const g0 = await sheet.locator('.sub-row .grip').nth(0).boundingBox(); const r0 = await sheet.locator('.sub-row').nth(0).boundingBox(); const r2 = await sheet.locator('.sub-row').nth(2).boundingBox();
const gx = g0.x + g0.width / 2, gy = g0.y + g0.height / 2;
await touch('touchStart', gx, gy); await p.waitForTimeout(40); // no hold needed on the handle
for (let k = 1; k <= 15; k++) { await touch('touchMove', gx, gy + (r2.y - r0.y) * k / 15); await p.waitForTimeout(25); }
await p.waitForTimeout(250);
await p.screenshot({ path: OUT + '/s2-subdrag.png' });
await touch('touchEnd', 0, 0); await p.waitForTimeout(700);
const sa = await subs();
console.log('subs after: ', sa.join(', '));
ok(sa[2] === sb[0] && sa[0] === sb[1], 'subcategory moved down two places via the ≡ handle');
// tapping the row (not the handle) opens it for editing
await sheet.locator('.sub-row .grow').nth(1).click(); await p.waitForTimeout(800);
ok((await p.locator('.sheet').last().innerText()).includes('Edit subcategory'), 'tapping a row opens the subcategory editor');
await p.goBack(); await p.waitForTimeout(600);
// chips in add screen follow
for (let k = 0; k < 3 && await p.locator('.sheet').count(); k++) { await p.goBack(); await p.waitForTimeout(600); }
const idx2 = (await names()).indexOf('Σπίτι');
await p.locator('.screen .cat-grid .cat-tile').nth(idx2).click(); await p.waitForTimeout(800);
const chips = await p.locator('.subchip').allInnerTexts();
ok(chips[0].trim() === sa[0] && chips[2].trim() === sa[2], 'subcategory chips follow the new order: ' + chips.slice(0, 3).join(', '));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
