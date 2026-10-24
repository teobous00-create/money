import { chromium } from 'playwright';
const OUT = process.env.OUT, CSV = process.env.CSV;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.env.SCHEME || 'light' });
const p = await ctx.newPage();
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
const shot = async n => { await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/${n}.png` }); };
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);

// 1) tile → editor directly (split layout)
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(500);
await p.locator('.cat-tile').filter({ hasText: 'Supermarket' }).first().click(); await p.waitForTimeout(600);
ok(await p.locator('.split-half').count() === 2, 'split header shown');
for (const k of ['2', '*', '3', '+', '1']) await p.click(`.key[aria-label="${k}"]`);
await shot('a1-calc');
ok((await p.locator('.expr').innerText()).includes('7'), 'calculator 2×3+1 = 7');
await p.click('.key[aria-label=Calculate]'); await p.waitForTimeout(200);
await p.locator('.subchip', { hasText: 'Καφές' }).click();
await p.locator('.note-input').fill('test note');
await shot('a2-editor');
// tap left half → account picker opens (drag zone still allows taps)
await p.locator('.split-half').first().click(); await p.waitForTimeout(500);
ok(await p.getByText('Account', { exact: true }).isVisible(), 'tapping "From account" opens account picker');
await p.locator('.sheet').last().getByText('Revolut').click(); await p.waitForTimeout(400);
ok((await p.locator('.split-half').first().innerText()).includes('Revolut'), 'account changed to Revolut');
await p.click('.key[aria-label=Save]'); await p.waitForTimeout(700);
ok(await p.locator('.split').count() === 0, 'saved and closed');

// 2) FAB → picker tabs → transfer
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(500);
await p.click('.fab'); await p.waitForTimeout(600);
await shot('a3-picker');
await p.locator('.ptab', { hasText: 'Transfer' }).click(); await p.waitForTimeout(400);
await shot('a4-transfer-picker');
await p.locator('.sheet .cat-tile').filter({ hasText: 'Eurobank' }).click(); await p.waitForTimeout(600);
await shot('a5-transfer-editor');
ok((await p.locator('.split-half').nth(1).innerText()).includes('Eurobank'), 'transfer destination shown on the right');

// 3) drag the header down closes the sheet (no reload)
const box = await p.locator('.split').boundingBox();
const cdp = await ctx.newCDPSession(p);
const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + 200, y }] });
await touch('touchStart', box.y + 40);
for (let i = 1; i <= 12; i++) { await touch('touchMove', box.y + 40 + i * 25); await p.waitForTimeout(16); }
await touch('touchEnd', 0); await p.waitForTimeout(800);
ok(await p.locator('.split').count() === 0, 'dragging the colored header down closes the sheet');

// 4) category detail: hide a subcategory
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(500);
const tile = p.locator('.cat-tile').filter({ hasText: 'Σπίτι' }).first();
await tile.dispatchEvent('pointerdown'); await p.waitForTimeout(650); await tile.dispatchEvent('pointerup'); await p.waitForTimeout(800);
await shot('a6-detail');
await p.click('[aria-label="Edit Ενοίκιο"]'); await p.waitForTimeout(600);
await shot('a7-edit-sub');
await p.getByRole('button', { name: 'Hide subcategory' }).click(); await p.waitForTimeout(600);
ok(!(await p.locator('.sheet').last().innerText()).includes('Ενοίκιο'), 'hidden subcategory gone from the detail list');
await p.goBack(); await p.waitForTimeout(600);
await p.getByText(/Hidden categories · 1/).click(); await p.waitForTimeout(600);
await shot('a8-hidden');
ok(await p.locator('.sheet').last().getByText('Ενοίκιο').isVisible(), 'hidden list shows Ενοίκιο');
// totals unchanged after hiding (history kept)
await p.goBack(); await p.waitForTimeout(400);
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(900);
await shot('a9-overview');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
