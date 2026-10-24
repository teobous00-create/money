import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
const setDate = (sel, v) => p.locator(sel).evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.waitForTimeout(2000);
const totalBefore = await p.locator('.total-value').innerText();

// rent: 1st of next month, monthly, until 3 months later
const now = new Date();
const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const end = new Date(now.getFullYear(), now.getMonth() + 3, 15);
await p.click('.nav-item:nth-child(2)'); await p.waitForTimeout(500);
await p.locator('.cat-tile').filter({ hasText: 'Σπίτι' }).first().click(); await p.waitForTimeout(600);
for (const k of ['4', '0', '0']) await p.click(`.key[aria-label="${k}"]`);
await p.locator('.note-input').fill('Rent');
await setDate('.dateline input[type=date]', iso(first));
await p.getByRole('button', { name: /^Repeat/ }).click(); await p.waitForTimeout(500);
await p.locator('.sheet').last().getByText('Every month').click(); await p.waitForTimeout(300);
await setDate('.sheet >> nth=-1 >> input[type=date]', iso(end));
await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/r1-repeat.png' });
await p.locator('.sheet').last().getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(400);
ok((await p.locator('.dateline').innerText()).includes('until'), 'repeat chip shows the end date');
await p.click('.key[aria-label=Save]'); await p.waitForTimeout(2500);
ok((await p.locator('.total-value').innerText()) === totalBefore, 'balance unchanged');
let hdr = await p.locator('.total-btn').innerText();
ok(!/Planned/.test(hdr), 'this month: no planned line (rent is next month) — ' + hdr.replace(/\n/g, ' | '));

// go to next month
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(500);
await p.click('[aria-label=Next]'); await p.waitForTimeout(1300);
hdr = await p.locator('.total-btn').innerText();
ok(/Planned in \w+ −400/.test(hdr), 'next month planned line: ' + hdr.replace(/\n/g, ' | '));
await p.click('[aria-label=Next]'); await p.waitForTimeout(1300);
const t2 = await p.locator('.screen').last().innerText();
ok(t2.includes('Rent') && t2.includes('PLANNED'), 'month+2 shows projected Rent as planned');
hdr = await p.locator('.total-btn').innerText();
ok(/−400/.test(hdr) && /−800|55,04|−4/.test(hdr), 'month+2 line: ' + hdr.replace(/\n/g, ' | '));
await p.screenshot({ path: OUT + '/r2-month2.png' });
await p.click('[aria-label=Next]'); await p.waitForTimeout(700);
ok(!(await p.locator('.screen').last().innerText()).includes('Rent'), 'after the end date: no more Rent');

// edit the projected month+2 entry: only this one → 450
await p.click('[aria-label=Previous]'); await p.waitForTimeout(800);
await p.locator('.list-row', { hasText: 'Rent' }).first().click(); await p.waitForTimeout(700);
await p.click('.key[aria-label=Backspace]'); await p.click('.key[aria-label=Backspace]'); await p.click('.key[aria-label=Backspace]');
for (const k of ['4', '5', '0']) await p.click(`.key[aria-label="${k}"]`);
await p.click('.key[aria-label=Save]'); await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/r3-scope.png' });
await p.getByText('Only this one').click(); await p.waitForTimeout(1300);
const t3 = await p.locator('.screen').last().innerText();
ok(t3.includes('450') && !t3.includes('−400'), 'only this one changed to 450');
await p.click('[aria-label=Previous]'); await p.waitForTimeout(800);
ok((await p.locator('.screen').last().innerText()).includes('400'), 'month+1 still 400');
// delete month+1: this and the next ones
await p.locator('.list-row', { hasText: 'Rent' }).first().click(); await p.waitForTimeout(700);
await p.click('.dateline [aria-label=Delete]'); await p.waitForTimeout(500);
await p.getByText('This and the next ones').click(); await p.waitForTimeout(1300);
ok(!(await p.locator('.screen').last().innerText()).includes('Rent'), 'this and next deleted (month+1)');
await p.click('[aria-label=Next]'); await p.waitForTimeout(1300);
ok((await p.locator('.screen').last().innerText()).includes('450'), 'the one changed separately (month+2) stays');
await p.click('[aria-label=Next]'); await p.waitForTimeout(1300);
ok(!(await p.locator('.screen').last().innerText()).includes('Rent'), 'month+3 gone');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
