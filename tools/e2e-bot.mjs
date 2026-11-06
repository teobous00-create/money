import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('http://localhost:5173/');
await p.waitForFunction(() => window.__money);
const r = await p.evaluate(async () => {
  const m = await import('/src/lib/botPlan.ts');
  const s = window.__money.getState();
  const plan = m.defaultPlan('2026-11-06');
  const v = m.planView({ ...s, prefs: { ...s.prefs, botPlan: plan } }, '2026-11-06');
  return { start: plan.a1.start, hits: v.hits, a2: v.accs.find(a => a.acc === 2)?.start };
});
console.log(JSON.stringify(r));
// UI
await p.evaluate(() => localStorage.setItem('money:tracker:tab', 'trading'));
const tracker = p.getByRole('button', { name: /tracker/i }).first();
if (await tracker.count()) await tracker.click();
await p.waitForTimeout(500);
const trading = p.getByText(/^Trading$/).first();
if (await trading.count()) await trading.click();
await p.waitForTimeout(800);
console.log('waiting card:', await p.getByText('Waiting for the bot').count());
await p.screenshot({ path: '/tmp/bot1.png' });
await p.getByRole('button', { name: 'I bought it' }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/bot2.png' });
await p.getByRole('button', { name: 'Start the plan' }).click();
await p.waitForTimeout(1200);
console.log('plan card:', await p.getByText('Bot plan').count(), 'bought:', await p.evaluate(() => window.__money.getState().prefs.botPlan?.bought));
await p.screenshot({ path: '/tmp/bot3.png' });
await p.getByRole('button', { name: 'Plan settings' }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/bot4.png', fullPage: false });
await b.close();

// linked strategy: started in the past, real balance above 4k → "Done" on the one-off withdrawal
{
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const p = await b2.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://localhost:5173/');
  await p.waitForFunction(() => window.__money);
  await p.evaluate(async () => {
    const { putMany, setPrefs } = window.__money;
    const m = await import('/src/lib/botPlan.ts');
    putMany('strategies', [{ id: 'agro', owner_id: 'local', name: 'Agro', color: '#0a7', goal: null, sort: 0, archived: false }]);
    const rows = []; let bal = 630, d = '2026-10-12';
    const f = await import('/src/lib/format.ts');
    while (d <= '2026-11-06') { if (m.isTradingDay(d)) { const pnl = Math.round(bal * 0.1 * 100) / 100; rows.push({ id: `agro:${d}`, owner_id: 'local', strategy_id: 'agro', date: d, pnl }); bal += pnl; } d = f.addDays(d, 1); }
    putMany('pnl', rows);
    const plan = m.defaultPlan('2026-10-10');
    setPrefs({ botPlan: { ...plan, bought: '2026-10-10', a1: { ...plan.a1, start: '2026-10-12', strategy: 'agro' } } });
  });
  await p.getByRole('button', { name: /tracker/i }).first().click();
  await p.waitForTimeout(400);
  await p.getByText(/^Trading$/).first().click();
  await p.waitForTimeout(1500);
  console.log('pace:', await p.getByText(/on plan|ahead|behind/).first().textContent());
  console.log('done btn:', await p.getByRole('button', { name: 'Done' }).count());
  await p.screenshot({ path: '/tmp/bot5.png' });
  await p.getByRole('button', { name: 'Done' }).first().click();
  await p.waitForTimeout(1200);
  const v = await p.evaluate(async () => { const m = await import('/src/lib/botPlan.ts'); const x = m.planView(window.__money.getState()); return { logged: x.plan.logged, hits: x.hits, accs: x.accs.map(a => [a.acc, a.start, a.actual]) }; });
  console.log(JSON.stringify(v));
  await p.screenshot({ path: '/tmp/bot6.png' });
  await b2.close();
}
