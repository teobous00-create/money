// node tools/test-parse.mjs <1Money.csv>  — checks the quick-entry parser against real categories/accounts
import { build } from 'rolldown';
import fs from 'node:fs';
import Papa from 'papaparse';
const out = '/tmp/claude-0/qp.mjs';
await build({ input: 'src/lib/quickparse.ts', output: { file: out, format: 'esm' }, logLevel: 'silent' });
const { parseQuick } = await import(out + '?' + Date.now());
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
const cases = [
  ['delivery 12,50 χθες revolut', /expense 12\.5€ Σπίτι › Delivery.* \| Revolut \| 2026-10-26/],
  ['καφές 3,5 revolut', /expense 3\.5€ .*Καφές \| Revolut/],
  ['supermarket 42 χθες μετρητά', /expense 42€ .*Supermarket \| Μετρητά \| 2026-10-26/],
  ['σπίτι supermarket 23,40', /expense 23\.4€ Σπίτι › Supermarket/],
  ['tips 15', /income 15€ .*Tips/],
  ['από revolut σε μετρητά 50', /transfer 50€ - \| Revolut → Μετρητά/],
  ['μεταφορικά 1,20 μετρό', /expense 1\.2€ Μεταφορικά › Μετρό/],
  ['τσιγάρα πέντε και πενήντα', /expense 5\.5€ .*Τσιγάρα/],
  ['δώρο 30 στις 15', /expense 30€ .*Δώρο.* \| 2026-10-15/],
  ['καφές με Γιώργο 4 Παρασκευή', /expense 4€ .*Καφές .* 2026-10-23 \| "με Γιώργο"/],
  ['12€ ποτά', /expense 12€ .*Ποτά/],
  ['claude 20', /expense 20€ Εφαρμογές › Claude/],
  ['σκύλος 18 και 3,5', /expense 21\.5€ .*Σκύλος/],
  ['ενοίκιο 400 1/11', /expense 400€ .*Ενοίκιο .* 2026-11-01/],
  ['delivery 12 ευρώ και 50 λεπτά', /expense 12\.5€ .*Delivery/],
  ['Αγόρασα καφέ 2 ευρώ', /expense 2€ .*Καφές/],
  ['πήρα tips 20', /income 20€ .*Tips/],
  ['Delivery 8€ με Revolut', /expense 8€ .*Delivery.*\| Revolut/],
  ['πληρώθηκα 300 cake & roll', /income 300€ Μισθός › Cake & Roll/],
  ['supermarket 15 προχθές', /expense 15€ .*Supermarket .* 2026-10-25/],
  ['φαγητό 9,80 eurobank', /expense 9\.8€ .*Φαγητό \| Eurobank/],
];
let fail = 0;
for (const [txt, re] of cases) { const s = show(parseQuick(txt, ctx)); const okk = re.test(s); if (!okk) fail++; console.log((okk ? 'ok  ' : 'FAIL') + ' ' + txt.padEnd(32) + ' → ' + s); }
const l = parseQuick('φούρνος 3', { ...ctx, learned: { 'φουρνοσ': 'expense:Διασκέδαση>Φαγητό' } });
console.log((l.categoryId === 'expense:Διασκέδαση>Φαγητό' && l.note === 'φούρνος' ? 'ok  ' : 'FAIL') + ' learned word: ' + show(l));
console.log(fail ? `${fail} failed` : 'all passed');
if (process.env.DBG) { console.log(ctx.categories.filter(c => /tips/i.test(c.name))); console.log(JSON.stringify(parseQuick(process.env.DBG, ctx))); }
