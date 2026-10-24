import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const p = await (await b.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true })).newPage();
const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
await p.goto(process.env.URL); await p.waitForTimeout(800);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
console.log('screens initially', await p.locator('.screen').count());
for (let i = 0; i < 4; i++) { await p.click(i % 2 ? '[aria-label=Previous]' : '[aria-label=Next]'); await p.waitForTimeout(1500); console.log('after next', i, await p.locator('.screen').count(), await p.locator('[data-motion-pop-id]').count()); }
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(1500);
console.log('after tab', await p.locator('.screen').count());
console.log(errs.slice(0, 5));
await b.close();
