// group by day, and an answer even when lookups run out
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__n = 0;
  window.__aiMock = async (body) => {
    window.__n++;
    const last = body.messages[body.messages.length - 1];
    const lastText = Array.isArray(last.content) ? last.content.filter(x => x.type === 'text').map(x => x.text).join('') : last.content;
    if (/no more lookups/.test(lastText)) { window.__final = body.messages.length; return { content: [{ type: 'text', text: 'Με όσα βρήκα: tips σε 20 μέρες.' }], stop_reason: 'end_turn' }; }
    if (/κάθε μέρα/.test(String(lastText)) && window.__n === 1) return { content: [{ type: 'tool_use', id: 'd1', name: 'query_transactions', input: { type: 'income', category: 'Tips', from: '2026-10-01', to: '2026-10-31', group_by: 'day' } }], stop_reason: 'tool_use' };
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === 'd1') { window.__day = JSON.parse(last.content[0].content); }
    // keeps asking for more, never answers
    return { content: [{ type: 'tool_use', id: 'x' + window.__n, name: 'query_transactions', input: { from: '2026-10-01' } }], stop_reason: 'tool_use' };
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await touch('touchStart', 200, 330);
for (let i = 1; i <= 12; i++) { await touch('touchMove', 200, 330 + (220 * i) / 12); await p.waitForTimeout(16); }
await touch('touchEnd', 0, 0); await p.waitForTimeout(900);
await p.locator('.chat .quick-input').fill('Σύνδεσε τα tips κάθε μέρα με τις βάρδιες'); await p.locator('.chat .quick-input').press('Enter');
await p.waitForTimeout(3000);
const day = await p.evaluate(() => window.__day);
ok(day && day.groups.length > 3 && day.groups.every(g => /^\d{4}-\d{2}-\d{2}$/.test(g.key)) && day.groups[0].key < day.groups[1].key, `group by day: ${day?.groups.length} days, in order`);
ok(await p.evaluate(() => window.__n) === 13, '12 lookups, then one final answer: ' + await p.evaluate(() => window.__n));
const t = await p.locator('.chat').innerText();
ok(/Με όσα βρήκα/.test(t) && !/couldn’t finish/.test(t), 'answers with what it found instead of giving up');
ok(/\d+ Oct/.test(await p.locator('.qcard').first().innerText()), 'day groups shown as dates');
await p.screenshot({ path: `${process.env.OUT}/d1.png` });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
