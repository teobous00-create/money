// her account: top mic, commands + one short answer, no chat
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__say = ''; window.__bodies = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { const t = window.__say; this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 200); }
    stop() {} abort() {}
  };
  window.__aiMock = async (body) => {
    window.__bodies.push(JSON.parse(JSON.stringify(body)));
    const last = body.messages[body.messages.length - 1];
    await new Promise(r => setTimeout(r, 200));
    if (typeof last.content === 'string' && /διέγραψε/.test(last.content))
      return { content: [{ type: 'tool_use', id: 'p1', name: 'propose_changes', input: { changes: [{ op: 'add_transaction', type: 'expense', amount: 4, category: 'Supermarket', account: 'Revolut', date: '2026-10-27' }] } }], stop_reason: 'tool_use' };
    if (Array.isArray(last.content)) return { content: [{ type: 'text', text: 'Πάτα Apply.' }], stop_reason: 'end_turn' };
    return { content: [{ type: 'text', text: 'Έδωσες 120 € σε delivery.' }], stop_reason: 'end_turn' };
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
await p.evaluate(() => window.__money.setPrefs({ analytics: false }));   // be her
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
ok(await p.locator('.nav-item').count() === 4, 'no Tracker for her');
ok(await p.locator('[aria-label="Speak a command"]').count() === 1 && await p.locator('[aria-label=Search]').count() === 0, 'mic instead of search');
await p.click('[aria-label="Add transaction"]'); await p.waitForTimeout(800);
ok(await p.locator('.quick-input').count() === 0, 'no Say box in +');
await p.goBack(); await p.waitForTimeout(500);
const mic = async (t, wait = 1200) => { await p.evaluate(s => { window.__say = s; }, t); await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(wait); };
await mic('καφές 3 revolut');
ok(/Revolut 3 €/.test(await p.locator('.toast').innerText().catch(() => '')) && await p.evaluate(() => window.__bodies.length) === 0, 'plain entry saved, no AI');
await mic('πόσα έδωσα σε delivery');
await p.screenshot({ path: `${OUT}/l1.png` });
ok(/120 €/.test(await top().innerText()) && await top().getByRole('button', { name: 'Continue in chat' }).count() === 0, 'short answer, no Continue in chat');
const b1 = await p.evaluate(() => window.__bodies[0]);
ok(/voice assistant/.test(b1.system[0].text) && b1.system.length === 2 && b1.tools.map(t => t.name).join() === 'query_transactions,propose_changes', 'her rules, no About me, only transactions + changes tools');
ok(await p.evaluate(() => !localStorage.getItem('money:chat')), 'nothing kept as a chat');
await p.goBack(); await p.waitForTimeout(500);
await mic('διέγραψε τον καφέ και βάλε 4');
{ const n = await p.evaluate(() => window.__bodies.map(b => b.messages.length)); ok(n.at(-2) === 1, 'no earlier messages sent ' + n); }
await top().getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
ok(/Applied/.test(await top().innerText()), 'command applied from the card');
await p.goBack(); await p.waitForTimeout(500);
// no pull-down chat
await p.mouse.move(200, 300); await p.mouse.down(); await p.mouse.move(200, 600, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(800);
ok(await p.locator('.chat').count() === 0, 'pull-down does not open a chat');
console.log('errors:', errors.length ? errors : 'none');
await b.close();
