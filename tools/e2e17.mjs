import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__say = '';
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { const t = window.__say; this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 200); }
    stop() {} abort() {}
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
const top = () => p.locator('.sheet').last();
// speak through the top mic (on Transactions), then come back to where we were
const mic = async (t, wait = 1000) => {
  const back = await p.locator('.nav-item.on').evaluate(e => [...e.parentNode.querySelectorAll('.nav-item')].indexOf(e) + 1);
  if (back !== 3) { await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(600); }
  await p.evaluate(s => { window.__say = s; }, t);
  await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(wait);
  if (back !== 3 && !(await p.locator('.sheet').count())) { await p.click(`.nav-item:nth-child(${back})`); await p.waitForTimeout(700); }
};
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(1200);
await p.click('[aria-label="Job settings"]'); await p.waitForTimeout(600);
await top().getByText('Morning').click(); await p.waitForTimeout(600);
await top().locator('.field', { hasText: 'Usual day pay' }).locator('input').fill('40');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(900);
await top().getByText('Morning').click(); await p.waitForTimeout(600);
ok(await top().locator('.field', { hasText: 'Target: contacts a day' }).locator('input').inputValue() === '15' && await top().locator('.field', { hasText: 'Bonus € per contact' }).locator('input').inputValue() === '1', 'rule set once: 15 a day, 1 € per contact');
await p.goBack(); await p.waitForTimeout(500); await p.goBack(); await p.waitForTimeout(700);
const cell = n => p.locator('.cal-cell').filter({ has: p.locator('.cal-n', { hasText: new RegExp(`^${n}$`) }) }).first();
const log = async (n, contacts) => {
  await cell(n).click(); await p.waitForTimeout(700);
  const card = top().locator('.card', { hasText: 'Morning' });
  if (!(await card.locator('.toggle.on').count())) await card.locator('.toggle').click();
  await p.waitForTimeout(250);
  if (contacts != null) await card.locator('.field', { hasText: 'Contacts' }).locator('input').fill(String(contacts));
  await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(800);
};
await log(20, 18); await log(21, 10);
let card = await p.locator('.card', { hasText: 'Morning' }).first().innerText();
ok(/Contacts · October\s*28\s*\/\s*30/.test(card) && /bonus 0 €/.test(card), 'avg 14 < 15 → bonus 0 for now: ' + card.replace(/\n/g, ' | '));
ok(/80 € \+ 0 €/.test(card), 'owed: salary 80 € + bonus 0 €');
await log(22, 20);
card = await p.locator('.card', { hasText: 'Morning' }).first().innerText();
ok(/48\s*\/\s*45/.test(card) && /\+48 € pending/.test(card) && /bonus 48 €/.test(card), 'avg 16 → 48 € bonus, pending until the month ends: ' + card.replace(/\n/g, ' | '));
ok(/120 € \+ 0 €/.test(card), 'not owed yet: 120 € + 0 €');
ok((await cell(20).innerText()).includes('18'), 'calendar shows the day\'s contacts');
// two planned days → what you need on them
await log(29, null); await log(30, null);
card = await p.locator('.card', { hasText: 'Morning' }).first().innerText();
ok(/48\s*\/\s*75/.test(card) && /need 13,50 a day on the 2 planned days/.test(card), 'planned days: target 75, need 13,5 a day: ' + card.replace(/\n/g, ' | '));
await p.screenshot({ path: `${OUT}/t1.png` });
// voice: "πρωινή 18 επαφές" today
await mic('πρωινή 18 επαφές');
ok(/Morning · 18 contacts/.test(await p.locator('.toast').innerText()), 'voice: ' + await p.locator('.toast').innerText());
card = await p.locator('.card', { hasText: 'Morning' }).first().innerText();
ok(/66\s*\/\s*90/.test(card), 'today counted: 66 / 90');
// month plan line
const plan = await p.locator('.card', { hasText: 'expected' }).innerText();
ok(/Bonus: 66 contacts, avg 16,50/.test(plan), 'month plan shows the bonus status: ' + plan.replace(/\n/g, ' | '));
await p.screenshot({ path: `${OUT}/t2.png`, fullPage: true });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
