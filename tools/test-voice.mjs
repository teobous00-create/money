// node tools/test-parse.mjs <1Money.csv>  — checks the quick-entry parser against real categories/accounts
import { build } from 'rolldown';
import fs from 'node:fs';
import Papa from 'papaparse';
const out = '/tmp/claude-0/voice.mjs';
await build({ input: 'src/lib/voice.ts', output: { file: out, format: 'esm' }, logLevel: 'silent' });
const { interpret, complete } = await import(out + '?' + Date.now());
const rows = Papa.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''), { skipEmptyLines: true }).data.slice(1);
const accounts = new Map(), cats = new Map(), usage = new Map();
const acc = n => { n = n.trim(); if (!accounts.has(n)) accounts.set(n, { id: 'a:' + n, name: n, owner_id: 'me', kind: 'regular' }); return accounts.get(n); };
const cat = (type, full) => {
  const m = full.trim().match(/^(.*?)\s*\((.*)\)\s*$/);
  const top = (m ? m[1] : full).trim(), sub = m ? m[2].trim() : null;
  const tk = type + ':' + top;
  if (!cats.has(tk)) cats.set(tk, { id: tk, name: top, type, parent_id: null });
  if (!sub) return cats.get(tk);
  const sk = tk + '>' + sub;
  if (!cats.has(sk)) cats.set(sk, { id: sk, name: sub, type, parent_id: tk });
  return cats.get(sk);
};
for (const r of rows) {
  const [date, t, from, to] = r;
  if (!from || !to || !/Έξοδ|Έσοδ|Μεταφ/.test(t)) continue;
  const type = /Έξοδ|Expense/i.test(t) ? 'expense' : /Έσοδ|Income/i.test(t) ? 'income' : 'transfer';
  if (type === 'transfer') { acc(from); acc(to); continue; }
  acc(from);
  const c = cat(type, to);
  usage.set(c.id, (usage.get(c.id) ?? 0) + 1);
  if (c.parent_id) usage.set(c.parent_id, (usage.get(c.parent_id) ?? 0) + 1);
}
const ctx = { accounts: [...accounts.values()], categories: [...cats.values()], usage, learned: {}, today: '2026-10-27' };
const name = id => { const c = cats.get(id) ?? [...accounts.values()].find(a => a.id === id); if (!c) return null; const p = c.parent_id ? cats.get(c.parent_id).name + ' › ' : ''; return p + c.name; };
const show = r => `${r.type ?? '?'} ${r.amount ?? '?'}€ ${name(r.categoryId) ?? '-'} | ${name(r.accountId) ?? '-'}${r.toAccountId ? ' → ' + name(r.toAccountId) : ''} | ${r.date ?? '-'} | "${r.note}"`;
let fail = 0;

const morning = { id: 'j1', name: 'Morning', kind: 'daily', pay: 'monthly', rates: [{ from: '2026-01-01', day: 35 }], salary_category_id: 'income:PDA Salary', bonus_category_id: 'income:PDA Bonus' };
const evening = { id: 'j2', name: 'Evening', kind: 'hourly', pay: 'semimonthly', rates: [{ from: '2026-01-01', hour: 6 }], salary_category_id: 'income:Μισθός>Cake & Roll', tips_category_id: 'income:Μισθός>Tips' };
const ddg = { id: 's1', name: 'DEEP DIP GOLD' }, gs = { id: 's2', name: 'Gold Sniper' };
const vctx = { ...ctx, jobs: [morning, evening], strategies: [ddg, gs], hasShift: (j, d) => j === 'j2' && d === '2026-10-26' };
const desc = c => c.kind === 'tx' ? `tx ${show(c.p)}${c.repeat ? ' repeat ' + c.repeat : ''}${c.until ? ' until ' + c.until : ''}`
  : c.kind === 'shift' ? `shift ${c.job.name} ${c.date} h=${c.hours} tips=${c.tips} bonus=${c.bonus} base=${c.base}`
  : c.kind === 'pnl' ? `pnl ${c.strategy.name} ${c.date} ${c.value}` : `payout ${c.job.name} ${c.date} amount=${c.amount} bonus=${c.bonus}`;
const vcases = [
  ['απογευματινή 6 ώρες tips 25', /^shift Evening 2026-10-27 h=6 tips=25 bonus=null/],
  ['πρωινή bonus 18', /^shift Morning 2026-10-27 h=null tips=null bonus=18/],
  ['χθες βράδυ 7 ώρες tips 30', /^shift Evening 2026-10-26 h=7 tips=30/],
  ['βράδυ έξι και μισή ώρες', /^shift Evening .* h=6\.5 tips=null/],
  ['πρωινή', /^shift Morning 2026-10-27 h=null tips=null bonus=null/],
  ['βάρδια 5 ώρες tips 12,50', /^shift Evening .* h=5 tips=12\.5/],
  ['απογευματινή 6', /^shift Evening .* h=6/],
  ['deep dip gold μείον 12,40', /^pnl DEEP DIP GOLD 2026-10-27 -12\.4$/],
  ['DDG συν 8', /^pnl DEEP DIP GOLD 2026-10-27 8$/],
  ['ddg -5,20 χθες', /^pnl DEEP DIP GOLD 2026-10-26 -5\.2$/],
  ['gold sniper 15', /^pnl Gold Sniper 2026-10-27 15$/],
  ['πληρώθηκα από την απογευματινή 320', /^payout Evening 2026-10-27 amount=320 bonus=null/],
  ['πρωινή μισθός 500 bonus 206', /^payout Morning .* amount=500 bonus=206/],
  ['πληρώθηκα 300 cake & roll', /^payout Evening .* amount=300/],
  ['πληρώθηκα από την πρωινή', /^payout Morning .* amount=null bonus=null/],
  ['netflix 12,49 κάθε μήνα', /^tx \? 12\.49€ .*"netflix" repeat monthly$/],
  ['claude 20 κάθε μήνα μέχρι Ιούνιο', /^tx expense 20€ Εφαρμογές › Claude .* repeat monthly until 2027-06-30/],
  ['ενοίκιο 400 μηνιαία', /^tx expense 400€ .*Ενοίκιο.* repeat monthly/],
  ['καφές το πρωί 2', /^tx expense 2€ .*Καφές/],
  ['tips 15', /^tx income 15€ Μισθός › Tips/],
  ['tips 30 χθες', /^shift Evening 2026-10-26 h=null tips=30/],
  ['3€ bonus σήμερα', /^shift Morning 2026-10-27 h=null tips=null bonus=3/],
  ['bonus 12 χθες', /^shift Morning 2026-10-26 .* bonus=12/],
  ['6 ώρες tips 20', /^shift Evening .* h=6 tips=20/],
];
for (const [txt, re] of vcases) { const cs = interpret(txt, vctx); const s = cs.map(desc).join(' || '); const okk = cs.length === 1 && re.test(s); if (!okk) fail++; console.log((okk ? 'ok  ' : 'FAIL') + ' ' + txt.padEnd(36) + ' → ' + s); }
const multi = [
  ['καφές 3, supermarket 20 και τσιγάρα 5,5', 3],
  ['χθες καφές 3, supermarket 20', 2],
  ['τσιγάρα πέντε και πενήντα', 1],
  ['delivery 12 και 3,5', 1],
  ['καφές 3 και μετά supermarket 20', 2],
];
for (const [txt, n] of multi) { const cs = interpret(txt, vctx); const okk = cs.length === n && cs.every(c => c.kind === 'tx' && complete(c)); if (!okk) fail++; console.log((okk ? 'ok  ' : 'FAIL') + ' ' + txt.padEnd(36) + ' → ' + cs.map(desc).join(' || ')); }
const y = interpret('χθες καφές 3, supermarket 20', vctx); if (!y.every(c => c.p.date === '2026-10-26')) { fail++; console.log('FAIL shared date'); } else console.log('ok   one date for all');
console.log(fail ? `${fail} failed` : 'all passed');
if (process.env.DBG) console.log(interpret(process.env.DBG, vctx).map(desc));
