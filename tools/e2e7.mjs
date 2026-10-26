import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: process.env.SCHEME || 'light' });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
const shot = async n => { await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${n}.png` }); };
const top = () => p.locator('.sheet').last();
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
ok(await p.locator('.nav-item').count() === 5, 'Tracker tab shown (5 tabs)');
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(1200);
ok((await p.locator('.screen').last().innerText()).includes('Morning') && (await p.locator('.screen').last().innerText()).includes('Evening'), 'default jobs created');
await shot('w0');
// set rates
await p.click('[aria-label="Job settings"]'); await p.waitForTimeout(600);
await top().getByText('Morning').click(); await p.waitForTimeout(600);
await top().locator('.field', { hasText: 'Per day' }).locator('input').fill('40');
await top().locator('.field', { hasText: 'Bonus per sale' }).locator('input').fill('2');
const salSel = top().locator('.field', { hasText: 'Salary goes to category' }).locator('select');
const opts = await salSel.locator('option').allInnerTexts();
const pda = opts.find(o => /PDA/.test(o)); if (pda) await salSel.selectOption({ label: pda });
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(600);
await top().getByText('Evening').click(); await p.waitForTimeout(600);
const ev = await top().innerText();
ok(/Cake & Roll/.test(await top().locator('.field', { hasText: 'Salary goes to category' }).locator('select').inputValue().then(v => top().locator(`option[value="${v}"]`).first().innerText())), 'Evening salary category guessed: Cake & Roll');
await top().locator('.field', { hasText: 'Per hour' }).locator('input').fill('6');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(600);
await p.goBack(); await p.waitForTimeout(700);
// log shifts on 20 and 21 Oct
const cell = n => p.locator('.cal-cell').filter({ has: p.locator('.cal-n', { hasText: new RegExp(`^${n}$`) }) }).first();
await cell(20).click(); await p.waitForTimeout(700);
await top().locator('.card', { hasText: 'Morning' }).locator('.toggle').click(); await p.waitForTimeout(300);
for (let i = 0; i < 3; i++) await top().locator('.card', { hasText: 'Morning' }).getByLabel('More').click();
for (let i = 0; i < 12; i++) await top().locator('.card', { hasText: 'Evening' }).getByLabel('More').click();
await top().locator('.card', { hasText: 'Evening' }).getByPlaceholder('0').fill('12');
await shot('w1-shift');
ok((await top().innerText()).includes('= 46 €') && (await top().innerText()).includes('= 36 €'), 'day pay preview: morning 46 €, evening 36 €');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(800);
await cell(21).click(); await p.waitForTimeout(700);
for (let i = 0; i < 10; i++) await top().locator('.card', { hasText: 'Evening' }).getByLabel('More').click();
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
const w = await p.locator('.screen').last().innerText();
await shot('w2-work');
ok(/46 €/.test(w) && /66 €/.test(w), 'owed: morning 46 €, evening 66 €');
// got paid evening
await p.locator('.card', { hasText: 'Evening' }).getByText('Got paid').click(); await p.waitForTimeout(700);
await shot('w3-pay');
await top().getByRole('button', { name: 'Save payment' }).click(); await p.waitForTimeout(900);
ok((await p.locator('.card', { hasText: 'Evening' }).innerText()).includes('0 €'), 'after payment evening owed 0 €');
// transactions: tips + salary present
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(900);
const tx = await p.locator('.screen').last().innerText();
ok(/Tips/.test(tx) && /\+12/.test(tx), 'tips 12 € added to income automatically');
ok(/Cake & Roll/.test(tx) && /\+66/.test(tx), 'salary 66 € added in Cake & Roll');

// ---------------- trading
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(800);
await p.locator('.seg button', { hasText: 'Trading' }).click(); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Add strategy' }).click(); await p.waitForTimeout(800);
await top().getByPlaceholder('e.g. DEEP DIP GOLD').fill('DEEP DIP GOLD');
await top().getByPlaceholder('No goal').fill('50');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
const enter = async (n, digits, negative) => {
  await cell(n).click(); await p.waitForTimeout(600);
  for (const k of digits) await top().locator(`.key[aria-label="${k}"]`).click();
  if (negative) await top().locator('.key[aria-label="pm"]').click();
  await top().locator('.key[aria-label="ok"]').click(); await p.waitForTimeout(600);
};
await enter(19, ['9', ',', '2', '7'], true);
await enter(20, ['8', ',', '9', '2'], true);
await enter(21, ['1', '2', ',', '5', '8'], false);
await enter(22, ['8', ',', '9', '9'], true);
await enter(23, ['1', ',', '7', '6'], false);
const t = await p.locator('.screen').last().innerText();
await shot('t1-calendar');
ok(/−12,84 €/.test(t), 'total P&L −12,84 € (same as your screenshot)');
ok(/50 €/.test(t), 'monthly goal 50 €');
// second strategy via picker, then All form
await p.locator('button', { hasText: 'DEEP DIP GOLD' }).last().click(); await p.waitForTimeout(600);
await top().getByRole('button', { name: 'New strategy' }).click(); await p.waitForTimeout(600);
await top().getByPlaceholder('e.g. DEEP DIP GOLD').fill('TimeSlot');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
await p.locator('button', { hasText: 'TIMESLOT' }).last().click().catch(() => {});
await p.waitForTimeout(400);
if (await p.locator('.sheet').count()) { await top().getByText('All strategies').click(); await p.waitForTimeout(600); }
else { await p.locator('button', { hasText: /TimeSlot/i }).last().click(); await p.waitForTimeout(600); await top().getByText('All strategies').click(); await p.waitForTimeout(600); }
await cell(23).click(); await p.waitForTimeout(700);
await top().locator('.card', { hasText: 'TimeSlot' }).locator('input').fill('5');
await top().locator('.card', { hasText: 'TimeSlot' }).locator('.pm').click();
await shot('t2-all-entry');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
const t2 = await p.locator('.screen').last().innerText();
ok(/−17,84 €/.test(t2) && /−3,24/.test(t2), 'all strategies: total −17,84 €, 23rd = −3,24');
await p.locator('.seg button', { hasText: 'Stats' }).click(); await p.waitForTimeout(1200);
const s = await p.locator('.screen').last().innerText();
await shot('t3-stats');
ok(/Profit factor/.test(s) && /BY STRATEGY/.test(s), 'stats with per-strategy table');
// analytics work card
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Analytics', exact: true }).click(); await p.waitForTimeout(1000);
const an = await p.locator('.screen').last().innerText();
await shot('a1-analytics');
ok(/Work/.test(an) && /Per hour with tips/.test(an) && /8 €/.test(an), 'analytics work card: per hour with tips 8 € (66+12)/11h... ');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
