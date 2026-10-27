import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__say = '';
  window.__asked = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() { setTimeout(() => { const t = window.__say; this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 200); }
    stop() {} abort() {}
  };
  window.__aiMock = async (body) => {
    const last = body.messages[body.messages.length - 1];
    if (typeof last.content === 'string') window.__asked.push(last.content);
    await new Promise(r => setTimeout(r, 300));
    if (typeof last.content === 'string' && /επαφές/.test(last.content)) return { content: [{ type: 'text', text: 'Αυτόν τον μήνα έκανες **0 επαφές**.' }], stop_reason: 'end_turn', remaining: 59 };
    if (typeof last.content === 'string' && /διέγραψε/.test(last.content))
      return { content: [{ type: 'tool_use', id: 'p1', name: 'propose_changes', input: { summary: 'Swap the coffee', changes: [{ op: 'add_transaction', type: 'expense', amount: 3, category: 'Supermarket', account: 'Revolut', date: '2026-10-27' }] } }], stop_reason: 'tool_use', remaining: 58 };
    return { content: [{ type: 'text', text: 'Έτοιμο — δες την κάρτα.' }], stop_reason: 'end_turn', remaining: 57 };
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
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(800);
const mic = async (t, wait = 1400) => { await p.evaluate(s => { window.__say = s; }, t); await p.click('[aria-label="Speak a command"]'); await p.waitForTimeout(wait); };
// no "Type or say" box anywhere
await p.click('[aria-label="Add transaction"]'); await p.waitForTimeout(800);
ok(await p.locator('.quick-input').count() === 0, 'no Say box in +');
await p.goBack(); await p.waitForTimeout(500);
await p.click('.nav-item:nth-child(5)'); await p.waitForTimeout(1000);
ok(await p.locator('.quick-input').count() === 0, 'no Say box in Tracker');
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(700);
// a question → small window with the answer
await mic('πόσες επαφές έχω κάνει αυτόν τον μήνα', 300);
ok(await p.locator('.sheet .dots').count() === 1, 'window opens, waiting for the answer');
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/a1.png` });
ok(/0 επαφές/.test(await top().innerText()) && /πόσες επαφές/.test(await top().innerText()), 'answer shown with the question');
ok(JSON.parse(await p.evaluate(() => localStorage.getItem('money:chat'))).length === 2, 'kept in the chat history');
// continue in chat
await top().getByRole('button', { name: 'Continue in chat' }).click(); await p.waitForTimeout(900);
ok(await p.locator('.chat').count() === 1 && /0 επαφές/.test(await p.locator('.chat').innerText()), 'Continue in chat → full chat with it');
await p.screenshot({ path: `${OUT}/a2.png` });
await p.goBack(); await p.waitForTimeout(800);
ok(await p.locator('.chat').count() === 0, 'back closes chat');
// a command it knows → saved straight away, no AI
const n0 = await p.evaluate(() => window.__asked.length);
await mic('καφές 3 revolut');
ok(/Revolut 3 €/.test(await p.locator('.toast').innerText().catch(() => '')) && await p.evaluate(() => window.__asked.length) === n0, 'command saved directly, AI not used');
// something it can't parse → AI in the window, with Apply card
await mic('διέγραψε τον χθεσινό καφέ και βάλε έναν σήμερα', 1600);
await p.screenshot({ path: `${OUT}/a3.png` });
ok(await p.evaluate(() => window.__asked.length) === n0 + 1, 'not understood → sent to AI');
ok(await top().getByRole('button', { name: 'Apply' }).count() === 1, 'Apply card in the window');
await top().getByRole('button', { name: 'Apply' }).click(); await p.waitForTimeout(600);
ok(/Applied/.test(await top().innerText()), 'applied');
ok(JSON.parse(await p.evaluate(() => localStorage.getItem('money:chat'))).at(-1).proposal.status === 'applied', 'status saved in history');
await p.goBack(); await p.waitForTimeout(600);
// app-icon shortcut → top mic listens right away
await p.evaluate(() => { localStorage.setItem('money:voice-auto', '1'); });
await p.goto(process.env.URL + '?a=voice'); await p.waitForTimeout(400);
await p.evaluate(() => { window.__say = 'τσιγάρα 5 μετρητά'; });
await p.waitForTimeout(1600);
ok(await p.locator('.nav-item.on').innerText() === 'Transactions', 'shortcut → Transactions');
ok(/5 €/.test(await p.locator('.toast').innerText().catch(() => '')), 'shortcut listened and saved: ' + await p.locator('.toast').innerText().catch(() => ''));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
