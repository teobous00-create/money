import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__calls = [];
  window.__aiMock = async (body) => {
    window.__calls.push(body);
    await new Promise(r => setTimeout(r, 400));
    if (typeof body.system === 'string') return { content: [{ type: 'text', text: '• Αποταμίευσες 239,04 € (μέσος όρος 71,58 €).\n• Μεγαλύτερη κατηγορία: Σπίτι.' }], stop_reason: 'end_turn', remaining: 58 };
    const last = body.messages[body.messages.length - 1];
    if (last.content === 'Continue exactly where you stopped. Do not repeat anything.') return { content: [{ type: 'text', text: ' and this is the rest.' }], stop_reason: 'end_turn', remaining: 50 };
    if (typeof last.content === 'string' && /both jobs/.test(last.content)) return { content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'w1', name: 'query_work', input: { from: '2026-10-01' } }], stop_reason: 'tool_use', remaining: 49 };
    if (Array.isArray(last.content) && last.content[0]?.tool_use_id === 'w1') {
      const prev = body.messages[body.messages.length - 2];
      window.__emptySent = prev.content.some(b => b.type === 'text' && !b.text.trim());
      window.__work = JSON.parse(last.content[0].content);
      return { content: [{ type: 'text', text: `Both jobs on ${window.__work.count_both} days.` }], stop_reason: 'end_turn', remaining: 48 };
    }
    if (typeof last.content === 'string' && /long one/.test(last.content)) {
      window.__sawMemo = body.messages.some(m => typeof m.content === 'string' && m.content.includes('[Looked up: Delivery'));
      return { content: [{ type: 'text', text: 'This answer was cut' }], stop_reason: 'max_tokens', remaining: 51 };
    }
    if (window.__limit) { const e = new Error('limit'); e.code = 'limit'; throw Object.assign(new (class extends Error {})('limit'), { code: 'limit' }); }
    if (typeof last.content === 'string') return { content: [{ type: 'text', text: 'Κοιτάζω…' }, { type: 'tool_use', id: 't1', name: 'query_transactions', input: { category: 'Delivery', from: '2026-01-01', group_by: 'month' } }], stop_reason: 'tool_use', remaining: 59 };
    const res = JSON.parse(last.content[0].content);
    window.__toolResult = res;
    return { content: [{ type: 'text', text: `Φέτος έδωσες **${res.total} €** σε delivery, σε ${res.count} παραγγελίες.` }], stop_reason: 'end_turn', remaining: 58 };
  };
});
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
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(900);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function pullDown(dist = 220) {
  await touch('touchStart', 200, 330);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', 200, 330 + (dist * i) / 12); await p.waitForTimeout(16); }
  await p.screenshot({ path: `${OUT}/c0-pull.png` });
  await touch('touchEnd', 0, 0); await p.waitForTimeout(700);
}
await pullDown(60);
ok(await p.locator('.chat').count() === 0, 'a small pull does not open it');
await pullDown();
ok(await p.locator('.chat').count() === 1, 'pull down opens the chat');
await p.screenshot({ path: `${OUT}/c1.png` });
await p.locator('.chat .quick-input').fill('Πόσα έδωσα σε delivery φέτος;');
await p.locator('.chat .quick-input').press('Enter'); await p.waitForTimeout(250);
ok(await p.locator('.chat .dots').count() === 1, 'typing dots while it thinks');
await p.waitForTimeout(1400);
const tr = await p.evaluate(() => window.__toolResult);
const ans = await p.locator('.chat .bubble.ai').last().innerText();
ok(tr && tr.count > 100 && tr.total > 500, `the phone computed it: ${tr?.total} € over ${tr?.count}`);
ok(ans.includes(String(tr.total)), 'answer uses the computed number');
ok(await p.locator('.chat .qcard').count() === 1 && (await p.locator('.chat .qbar').count()) >= 3, 'card with the exact numbers and monthly bars');
const sys = await p.evaluate(() => window.__calls[0].system[2].text);
ok(/ACCOUNTS/.test(sys) && /MONTHS/.test(sys) && /Σπίτι/.test(sys) && !/Netflix/.test(sys), 'summary sent, not single entries (no notes)');
ok(!/left today/.test(await p.locator('.chat-head').innerText()), 'your account: no daily count shown (no limit)');
await p.screenshot({ path: `${OUT}/c2.png` });
// follow-up: remembers what it looked up; a cut answer is continued automatically
await p.locator('.chat .quick-input').fill('and a long one please');
await p.locator('.chat .quick-input').press('Enter'); await p.waitForTimeout(1500);
ok(await p.evaluate(() => window.__sawMemo) === true, 'follow-up carries the numbers it found before');
ok((await p.locator('.chat .bubble.ai').last().innerText()).trim() === 'This answer was cut and this is the rest.', 'cut answer continued and joined');
await p.locator('.chat .quick-input').fill('Which days did I work both jobs this month?');
await p.locator('.chat .quick-input').press('Enter'); await p.waitForTimeout(1500);
ok(await p.evaluate(() => window.__emptySent) === false && 'days_with_both_jobs' in (await p.evaluate(() => window.__work)), 'work tool answered; no empty text block sent (the error you saw)');
ok(/Both jobs on \d+ days/.test(await p.locator('.chat .bubble.ai').last().innerText()), 'answer shown');
await p.locator('[aria-label="New chat"]').click(); await p.waitForTimeout(300);
await p.locator('.chat .quick-input').fill('Πόσα έδωσα σε delivery φέτος;');
await p.locator('.chat .quick-input').press('Enter'); await p.waitForTimeout(1800);
// close by dragging up, reopen: history kept
const g = await p.locator('.chat-grip').boundingBox();
await p.mouse.move(g.x + g.width / 2, g.y + 10); await p.mouse.down();
for (let i = 1; i <= 10; i++) { await p.mouse.move(g.x + g.width / 2, g.y + 10 - i * 30); await p.waitForTimeout(16); }
await p.mouse.up(); await p.waitForTimeout(800);
ok(await p.locator('.chat').count() === 0, 'drag up closes it');
await pullDown();
ok(await p.locator('.chat .bubble').count() === 2, 'conversation kept');
await p.goBack(); await p.waitForTimeout(700);
ok(await p.locator('.chat').count() === 0, 'back button closes it');
// review card
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(800);
await p.locator('.seg button', { hasText: 'Analytics' }).click(); await p.waitForTimeout(300);
ok(await p.locator('.review-skel').count() === 1, 'review: placeholder while writing');
await p.waitForTimeout(900);
ok(/Αποταμίευσες 239,04/.test(await p.locator('.review').innerText()), 'review written');
const facts = await p.evaluate(() => window.__calls.find(c => typeof c.system === 'string').messages[0].content);
ok(/saved 239,04/.test(facts) && /Not over/.test(facts), 'facts computed by the app (saved 239,04, month not over)');
await p.screenshot({ path: `${OUT}/c3.png` });
const before = await p.evaluate(() => window.__calls.length);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(500);
await p.click('.nav-item:nth-child(4)'); await p.waitForTimeout(900);
ok(await p.evaluate(() => window.__calls.length) === before && /Αποταμίευσες/.test(await p.locator('.review').innerText()), 'saved: not written again');
// previous month: its own review
await p.locator('[aria-label=Previous]').click(); await p.waitForTimeout(1500);
ok(await p.evaluate(() => window.__calls.length) === before + 1 && /September 2026/.test(await p.locator('.review').innerText()), 'September gets its own review');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
