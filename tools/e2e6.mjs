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
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(1000);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const hold = async (loc) => { const bb = await loc.boundingBox(); await touch('touchStart', bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(650); await touch('touchEnd', 0, 0); await p.waitForTimeout(900); };
// Σπίτι budget 1500 via detail → edit
await hold(p.locator('.screen .cat-tile').filter({ hasText: 'Σπίτι' }).first());
await p.locator('.sheet [aria-label=Edit]').first().click(); await p.waitForTimeout(800);
await p.locator('.sheet').last().getByPlaceholder('No budget').fill('1500');
await p.locator('.sheet').last().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
const det = await p.locator('.sheet').last().innerText();
ok(/1\.258,37 € \/ 1\.500 €/.test(det) && /241,63 € left/.test(det), 'detail shows 1.258,37 € / 1.500 € · 241,63 € left');
// subcategory Supermarket budget 200 (spent 288,38 → over)
await p.locator('[aria-label="Edit Supermarket"]').click(); await p.waitForTimeout(800);
await p.locator('.sheet').last().getByPlaceholder('No budget').fill('200');
await p.locator('.sheet').last().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
const det2 = await p.locator('.sheet').last().innerText();
ok(/288,38 € \/ 200 €/.test(det2) && /88,38 € over/.test(det2), 'subcategory row: 288,38 € / 200 € · 88,38 € over');
await p.screenshot({ path: OUT + '/b1-detail.png' });
await p.goBack(); await p.waitForTimeout(800);
ok(await p.locator('.screen .cat-tile').filter({ hasText: 'Σπίτι' }).locator('svg circle').count() >= 2, 'budget ring on the Σπίτι tile');
await p.screenshot({ path: OUT + '/b2-grid.png' });
// overview budgets card
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(1000);
const ov = await p.locator('.screen').last().innerText();
ok(ov.includes('BUDGETS') && ov.indexOf('Σπίτι · Supermarket') < ov.indexOf('1.258,37 € / 1.500 €'), 'overview budgets card, over-budget first');
await p.locator('.screen').last().getByText('BUDGETS').scrollIntoViewIfNeeded();
await p.screenshot({ path: OUT + '/b3-overview.png' });
// analytics
await p.getByRole('button', { name: 'Analytics', exact: true }).click(); await p.waitForTimeout(1200);
const an = await p.locator('.screen').last().innerText();
ok(/12,44 €/.test(an) && /56 shifts/.test(an), 'tips 3-month average 12,44 € over 56 shifts');
ok(/13,41 €/.test(an) && /17 shifts/.test(an), 'tips October 13,41 € over 17 shifts');
ok(/239,04 €/.test(an) && /71,58 €/.test(an), 'saved: October 239,04 € vs 3-month avg 71,58 €');
ok(/890,26 €/.test(an), 'Σπίτι 3-month average 890,26 €');
ok(!/[+−-]\d+%/.test(an), 'no +/- percentage comparisons');
await p.screenshot({ path: OUT + '/b4-analytics.png', fullPage: false });
await p.locator('.screen').last().getByText('Σπίτι').first().click(); await p.waitForTimeout(700);
await p.screenshot({ path: OUT + '/b5-analytics-expanded.png' });
// budgets persisted after reload
await p.reload(); await p.waitForTimeout(1800);
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(800);
ok((await p.locator('.screen').last().innerText()).includes('1.500 €'), 'budgets kept after reload');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
