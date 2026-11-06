// URL=http://localhost:5173/ OUT=/tmp/shots node tools/e2e-pay-split.mjs   (dev server with VITE_LOCAL=1; dates are relative to today)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let fails = 0;
const ok = (c, m) => { fails += !c; console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); };
const OUT = process.env.OUT;
const shot = async n => { await p.waitForTimeout(500); if (OUT) await p.screenshot({ path: `${OUT}/${n}.png` }); };

await p.goto(process.env.URL); await p.waitForTimeout(900);

// ---- seed: accounts, categories with budgets and goals, two jobs, past spending, this month, a partner's goal entry, the pay
const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await p.evaluate((today) => {
  const { putMany, setPrefs } = window.__money;
  const A = (id, name, kind, opening) => ({ id, owner_id: '', name, kind, icon: 'wallet', color: '#5B5BD6', opening_balance: opening, credit_limit: kind === 'credit' ? 1000 : null, goal: null, archived: false, sort: 0 });
  putMany('accounts', [A('pir', 'Πειραιώς', 'regular', 200), A('eur', 'Eurobank', 'regular', 300), A('cash', 'Μετρητά', 'regular', 230),
    A('rev', 'Revolut Αποθεματικό', 'savings', 0), A('cc', 'Πιστωτική', 'credit', 0), A('ec', 'Eightcap', 'regular', 1000), A('sav', 'Αποταμιεύω', 'savings', 300)]);
  const C = (id, name, type, parent = null, owner = '') => ({ id, owner_id: owner, type, name, parent_id: parent, icon: 'circle', color: '#E8A33D', sort: 0, archived: false });
  putMany('categories', [C('daily', 'Καθημερινά', 'expense'), C('coffee', 'Καφές', 'expense', 'daily'), C('cig', 'Τσιγάρα', 'expense', 'daily'),
    C('home', 'Σπίτι', 'expense'), C('sm', 'Supermarket', 'expense', 'home'), C('del', 'Delivery', 'expense', 'home'), C('dog', 'Σκύλος', 'expense', 'home'),
    C('phone', 'Τηλέφωνο', 'expense'), C('goals', 'Στόχοι', 'expense'), C('dent', 'Οδοντίατρος', 'expense', 'goals'), C('bed', 'Κρεβάτι', 'expense', 'goals'),
    C('pda', 'PDA Salary', 'income'), C('pdab', 'PDA Bonus', 'income'), C('cake', 'Cake & Roll', 'income'), C('tips', 'Tips', 'income')]);
  putMany('jobs', [
    { id: 'j1', owner_id: '', name: 'Morning', kind: 'daily', pay: 'monthly', rates: [], color: '#E8A33D', salary_category_id: 'pda', bonus_category_id: 'pdab', tips_category_id: null, tips_account_id: null, sort: 0, archived: false },
    { id: 'j2', owner_id: '', name: 'Evening', kind: 'hourly', pay: 'semimonthly', rates: [], color: '#5B5BD6', salary_category_id: 'cake', bonus_category_id: null, tips_category_id: 'tips', tips_account_id: 'cash', sort: 1, archived: false }]);
  const addM = (iso, k) => { const [y, m] = iso.split('-').map(Number); const d = new Date(y, m - 1 + k, 10); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`; };
  let n = 0;
  const T = (type, date, amount, account, cat, owner = '', to = null) => ({ id: 't' + (++n), owner_id: owner, type, date, amount, account_id: account, to_account_id: to, category_id: cat, note: null, recurring_id: null, seq: n });
  const first = today.slice(0, 8) + '01';
  const soon = (() => { const [y, m, d] = today.split('-').map(Number); const x = new Date(y, m - 1, d + 3); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })();
  putMany('transactions', [
    T('expense', addM(today, -3), 60, 'cash', 'dog'), T('expense', addM(today, -2), 60, 'cash', 'dog'), T('expense', addM(today, -1), 60, 'cash', 'dog'),
    T('expense', first, 40, 'pir', 'coffee'), T('expense', first, 50, 'pir', 'cig'), T('expense', first, 100, 'pir', 'sm'), T('expense', first, 80, 'cc', 'del'),
    T('expense', first, 150, 'partner-acc', 'dent', 'partner'),     // the partner put 150 into the dentist goal
    T('income', today, 25, 'cash', 'tips'),                          // tips never bring the card up
    T('expense', addM(today, 1).slice(0, 8) + '03', 20, 'eur', 'phone'),   // planned for the 3rd of next month: counts
    T('expense', addM(today, 1).slice(0, 8) + '04', 15, 'pir', 'coffee'),  // planned on the 4th in a budgeted category: counts too
    T('expense', addM(today, 1).slice(0, 8) + '12', 40, 'eur', 'phone'),   // the 12th: doesn't
    { ...T('transfer', soon, 50, 'sav', null), to_account_id: 'cc' },       // planned: savings pay part of the card → less owed
    { ...T('transfer', soon, 20, 'eur', null), to_account_id: 'cc' },       // from an everyday account: still owed (it's that money)
  ]);
  const next20 = today.slice(8) <= '20' ? today.slice(0, 8) + '20' : addM(today, 1).slice(0, 8) + '20';
  putMany('recurring', [{ id: 'r1', owner_id: '', type: 'expense', amount: 30, account_id: 'eur', to_account_id: null, category_id: 'phone', note: 'Cosmote', freq: 'monthly', anchor_day: 20, next_date: next20, active: true, end_date: null, skip_dates: [] }]);
  setPrefs({ analytics: true, budgets: { daily: 120, sm: 350, del: 150 }, goals: { goals: 0, dent: 600, bed: 400 }, tradingAccounts: ['ec'] });
}, today);
await p.click('.nav-item:nth-child(3)'); await p.waitForTimeout(700);
ok(await p.getByText(/^Paid /).count() === 0, 'tips alone bring no card');

// ---- the pay
await p.evaluate((today) => window.__money.putMany('transactions', [{ id: 'pay1', owner_id: '', type: 'income', date: today, amount: 1100, account_id: 'pir', to_account_id: null, category_id: 'pda', note: 'Morning', recurring_id: null, seq: 99 }]), today);
await p.waitForTimeout(600);
ok(await p.getByText('Paid 1.100 € · PDA Salary').count() === 1, 'a card comes up for the pay');
await shot('ps1-card');

// what the app works out (the same function the card uses)
const split = await p.evaluate(async () => {
  const m = await import('/src/lib/paySplit.ts');
  const s = window.__money.getState();
  return m.computeSplit(s, m.waitingPays(s));
});
const dIn = (iso, k = 0) => { const [y, mo] = iso.split('-').map(Number); return new Date(y, mo + k, 0).getDate(); };
const dim = dIn(today), dimNext = dIn(today, 1), day = Number(today.slice(8));
const left = dim - day + 1;
const cosmote = day <= 20 || true ? 30 : 0;   // the 20th of this month, or of the next (only if it falls by the 5th — it doesn't)
const exp = {
  daily: 30,                                          // budget left this month, nothing of next month's budget
  home: 320,
  free: 60 * left / dim + (day <= 20 ? cosmote : 0),
  next: 35,                                           // only what's planned for the 1st–5th
};
const need = exp.daily + exp.home + exp.free + exp.next + 30 + 100;
const near = (a, b) => Math.abs(a - b) < 0.02;
ok(near(split.needs.find(x => x.id === 'daily')?.amount, exp.daily), `Καθημερινά pooled: 30 left → ${split.needs.find(x => x.id === 'daily')?.amount} (≈${exp.daily.toFixed(2)})`);
ok(near(split.needs.find(x => x.id === 'home')?.amount, exp.home), `Σπίτι: sub budgets pooled, card spending counted → ${split.needs.find(x => x.id === 'home')?.amount}`);
ok(near(split.needs.find(x => x.id === 'free')?.amount, exp.free), `no budget: dog average for the days left + Cosmote → ${split.needs.find(x => x.id === 'free')?.amount} (≈${exp.free.toFixed(2)})`);
ok(split.needs.find(x => x.id === 'next')?.amount === exp.next, `next month: only the entries planned for the 1st–5th → ${split.needs.find(x => x.id === 'next')?.amount}`);
ok(split.needs.find(x => x.id === 'card')?.amount === 30 && /50 € planned from Αποταμιεύω/.test(split.needs.find(x => x.id === 'card')?.label), `credit card owed less what savings will pay: ${JSON.stringify(split.needs.find(x => x.id === 'card'))}`);
ok(split.needs.find(x => x.id === 'margin')?.amount === 100, '100 € margin');
ok(near(split.needTotal, need), `needs ${split.needTotal} (≈${need.toFixed(2)})`);
ok(split.available === 1485, `available = everyday accounts incl. today's tips in cash (no trading, savings, card): ${split.available}`);
ok(split.toSplit === Math.floor(Math.min(1485 - split.needTotal, 1100)), `to split ${split.toSplit}`);
ok(split.source === 'pir', 'moved from the account the pay came into');
const mv = Object.fromEntries(split.moves.map(m => [m.key, m.amount]));
ok(mv.match === 150, 'matching: what the partner put in (150)');
ok(mv.reserve === split.toSplit - 150, `no active goal: the rest goes to the reserve (${mv.reserve})`);
ok(split.notes.some(n => /No active goal/.test(n)), 'says so');

// ---- rules: Κρεβάτι active (share)
await p.getByText('Paid 1.100 € · PDA Salary').click(); await p.waitForTimeout(600);
await shot('ps2-sheet');
await p.locator('.sheet').getByRole('button', { name: 'Rules' }).click(); await p.waitForTimeout(500);
ok(await p.locator('.sheet select').first().inputValue() === 'dent', 'matching goal guessed: Οδοντίατρος');
const row = p.locator('.sheet .list-row', { hasText: 'Κρεβάτι' });
await row.locator('.toggle').click(); await p.waitForTimeout(300);
await shot('ps3-rules');
await p.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click(); await p.waitForTimeout(600);
const t = await p.locator('.sheet').innerText();
ok(new RegExp(`put aside ${split.toSplit} €`, 'i').test(t), 'back on the split: put aside ' + split.toSplit);
const vals = await p.locator('.sheet .list-row input').evaluateAll(l => l.map(i => [i.getAttribute('aria-label'), i.value]));
const by = Object.fromEntries(vals);
ok(by['Οδοντίατρος · matching'] === '150' && by['Κρεβάτι'] === '400' && Number(by['Revolut Αποθεματικό']) === split.toSplit - 550,
  `match 150 → reserve 50 → Κρεβάτι share up to its 400 left → rest to the reserve: ${JSON.stringify(by)}`);
await shot('ps4-split');

// edit one amount, accept
await p.locator('.sheet .list-row input[aria-label="Κρεβάτι"]').fill('300');
await p.locator('.sheet').getByRole('button', { name: 'Accept' }).click(); await p.waitForTimeout(700);
const after = await p.evaluate(() => Object.values(window.__money.getState().transactions).filter(t => t.note?.startsWith('Pay split') && !t.deleted_at)
  .map(t => [t.type, t.amount, t.account_id, t.to_account_id ?? t.category_id]));
ok(after.length === 3 && after.some(x => x[0] === 'transfer' && x[2] === 'pir' && x[3] === 'rev') && after.some(x => x[0] === 'expense' && x[1] === 300 && x[3] === 'bed') && after.some(x => x[1] === 150 && x[3] === 'dent'),
  'accepted: a transfer to the reserve and two goal entries, the edited amount kept: ' + JSON.stringify(after));
ok(await p.getByText(/^Paid /).count() === 0, 'the card is gone');
await shot('ps5-done');
await p.getByRole('button', { name: 'Undo' }).click(); await p.waitForTimeout(600);
ok(await p.evaluate(() => Object.values(window.__money.getState().transactions).filter(t => t.note?.startsWith('Pay split') && !t.deleted_at).length) === 0, 'undo removes the entries');
ok(await p.getByText('Paid 1.100 € · PDA Salary').count() === 1, '…and brings the card back');

// dismiss
await p.locator('.lumen-card [aria-label=Dismiss]').first().click(); await p.waitForTimeout(500);
ok(await p.getByText(/^Paid /).count() === 0, 'dismissed: gone');

console.log('errors:', errors.length ? errors : 'none');
console.log(fails ? `${fails} FAILED` : 'all passed');
await b.close();
process.exit(fails ? 1 : 0);
