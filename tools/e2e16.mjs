import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__aiMock = async (body) => {
    await new Promise(r => setTimeout(r, 200));
    if (typeof body.system === 'string') return { content: [{ type: 'text', text: 'review' }], stop_reason: 'end_turn' };
    const last = body.messages[body.messages.length - 1];
    const q = typeof last.content === 'string' ? last.content : null;
    if (q && /Tuesdays/.test(q)) return { content: [{ type: 'tool_use', id: 'c1', name: 'propose_changes', input: { summary: 'Evening, every Tuesday in November', changes: [{ op: 'add_shift', job: 'Evening', dates: ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'], hours: 5.5 }] } }], stop_reason: 'tool_use' };
    if (q && /delete/.test(q)) {
      const st = window.__money.getState();
      const t = Object.values(st.transactions).find(x => x.note === 'Netflix' && x.date === '2026-10-24');
      return { content: [{ type: 'tool_use', id: 'c2', name: 'propose_changes', input: { changes: [{ op: 'delete_transaction', id: t.id }, { op: 'add_transaction', type: 'expense', amount: 9.99, category: 'Σπίτι › Άλλα έξοδα', account: 'Revolut', date: '2026-10-24', note: 'Netflix basic' }, { op: 'set_budget', category: 'Nonexistent', amount: 50 }] } }], stop_reason: 'tool_use' };
    }
    if (Array.isArray(last.content)) {
      const r = JSON.parse(last.content[0].content);
      window.__lastTool = r;
      return { content: [{ type: 'text', text: `Prepared ${r.card_shown_to_him.length} changes — tap Apply.` }], stop_reason: 'end_turn' };
    }
    return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
  };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => console.log((c ? 'ok  ' : 'FAIL') + ' ' + m);
const OUT = process.env.OUT;
const top = () => p.locator('.sheet').last();
await p.goto(process.env.URL); await p.waitForTimeout(700);
await p.click('[aria-label=Settings]'); await p.waitForTimeout(400);
await p.getByText('Import from 1Money').click(); await p.waitForTimeout(400);
await p.setInputFiles('input[type=file]', process.env.CSV); await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Import', exact: true }).click(); await p.waitForTimeout(400);
await p.getByText('Go to accounts').click(); await p.waitForTimeout(600);
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(1200);
await p.click('[aria-label="Job settings"]'); await p.waitForTimeout(600);
await top().getByText('Evening').click(); await p.waitForTimeout(600);
await top().locator('.field', { hasText: 'Per hour' }).locator('input').fill('6');
await top().getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(600);
await p.goBack(); await p.waitForTimeout(600);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const pull = async () => { await touch('touchStart', 200, 330); for (let i = 1; i <= 12; i++) { await touch('touchMove', 200, 330 + 18 * i); await p.waitForTimeout(16); } await touch('touchEnd', 0, 0); await p.waitForTimeout(700); };
await pull();
const ask = async (t) => { await p.locator('.chat .quick-input').fill(t); await p.locator('.chat .quick-input').press('Enter'); await p.waitForTimeout(1200); };
await ask('Put 5.5 hours on all Tuesdays of November');
ok(await p.locator('.pcard .prow').count() === 4 && /Add shift · Evening · Tue 3 Nov · 5,50 h/.test(await p.locator('.pcard').innerText()), 'card lists the 4 Tuesdays');
ok(await p.evaluate(() => Object.values(window.__money.getState().shifts).filter(s => s.date.startsWith('2026-11')).length) === 0, 'nothing saved before Apply');
await p.screenshot({ path: `${OUT}/p1.png` });
await p.locator('.pcard').getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
ok(await p.evaluate(() => Object.values(window.__money.getState().shifts).filter(s => s.date.startsWith('2026-11') && !s.deleted_at && s.hours === 5.5).length) === 4, 'Apply saves the 4 shifts');
ok(/✓ Applied/.test(await p.locator('.pcard').innerText()), 'card says applied');
await p.locator('.toast button').click(); await p.waitForTimeout(500);
ok(await p.evaluate(() => Object.values(window.__money.getState().shifts).filter(s => s.date.startsWith('2026-11') && !s.deleted_at).length) === 0, 'Undo takes all 4 back');
ok(/Undone/.test(await p.locator('.pcard').innerText()), 'card says undone');
// delete + add + a bad one
await ask('delete the Netflix entry and add the cheaper plan');
const tool = await p.evaluate(() => window.__lastTool);
ok(tool.problems.length === 1 && /Nonexistent/.test(tool.problems[0]), 'unmatched category reported back to Claude: ' + tool.problems[0]);
ok(await p.locator('.pcard').last().locator('.prow').count() === 2, 'card has the 2 good changes');
await p.locator('.pcard').last().getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
const st = await p.evaluate(() => { const s = window.__money.getState(); const l = Object.values(s.transactions).filter(t => t.date === '2026-10-24' && /Netflix/.test(t.note ?? '') && !t.deleted_at); return l.map(t => `${t.note} ${t.amount}`); });
ok(JSON.stringify(st) === '["Netflix basic 9.99"]', 'old one deleted, new one added: ' + JSON.stringify(st));
await p.screenshot({ path: `${OUT}/p2.png` });
console.log('errors:', errors.length ? errors : 'none');
await b.close();
