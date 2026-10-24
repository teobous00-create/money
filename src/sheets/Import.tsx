import { useState } from 'react';
import { motion } from 'motion/react';
import { FileUp, Check } from 'lucide-react';
import { Sheet, toast, ease } from '../components/ui';
import { useUi, setUi } from '../lib/ui';
import { useStore, wipeMyData, sync } from '../lib/store';
import { parse1Money, type ImportPreview } from '../lib/import1money';
import { money, shortDate } from '../lib/format';
import { REMOTE } from '../lib/supabase';

export function ImportSheet() {
  const open = useUi(u => u.importer);
  const close = () => setUi({ importer: false });
  return <Sheet open={open} onClose={close} title="Import from 1Money" z={1} full>{open && <Body close={close} />}</Sheet>;
}

function Body({ close }: { close: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const pending = useStore(s => s.pending);
  const me = useStore(s => s.user?.id);
  const existing = useStore(s => Object.values(s.transactions).filter(t => !t.deleted_at && t.owner_id === s.user?.id).length);
  const [replace, setReplace] = useState(true);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    try { setPreview(parse1Money(await f.text())); } catch (e) { setErr((e as Error).message); }
  };
  const run = () => {
    if (!preview || !me) return;
    if (existing && replace) wipeMyData();
    preview.commit();
    setDone(true);
    void sync();
    toast(`Imported ${preview.txCount} transactions`);
  };

  if (done) {
    return (
      <div className="sheet-body" style={{ textAlign: 'center', paddingTop: 30 }}>
        <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}
          className="logo" style={{ margin: '0 auto 16px', borderRadius: '50%' }}><Check size={34} strokeWidth={2.6} /></motion.div>
        <div className="bold" style={{ fontSize: 20 }}>Import complete</div>
        <div className="muted small" style={{ marginTop: 6 }}>
          {REMOTE ? (pending ? `Uploading… ${pending} changes left` : 'Everything is synced to the cloud.') : 'Saved on this device.'}
        </div>
        {REMOTE && pending > 0 && <div className="bar" style={{ margin: '14px 30px 0' }}><motion.div style={{ background: 'var(--accent)' }} animate={{ width: ['10%', '90%'] }} transition={{ duration: 2.5, repeat: Infinity, repeatType: 'reverse' }} /></div>}
        <p className="small muted" style={{ marginTop: 22, textAlign: 'left' }}>
          Next: open each credit card and savings account in the Accounts tab to set its type, credit limit or goal, and adjust icons and colors.
        </p>
        <button className="btn" style={{ marginTop: 10 }} onClick={() => { close(); setUi({ settings: false, tab: 'accounts' }); }}>Go to accounts</button>
      </div>
    );
  }

  return (
    <div className="sheet-body">
      {!preview ? (
        <>
          <p className="small muted" style={{ margin: '0 4px 14px' }}>
            In 1Money, export your data as CSV (Settings → Export), then pick the file here. Categories, subcategories, accounts, transfers and notes come across, and every account balance will match 1Money exactly.
          </p>
          <label className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 30, border: '2px dashed var(--surface-3)', boxShadow: 'none', cursor: 'pointer' }}>
            <FileUp size={30} style={{ color: 'var(--accent)' }} />
            <span className="bold">Choose CSV file</span>
            <input type="file" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0])} />
          </label>
          {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
        </>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
          <div className="stat-row" style={{ marginTop: 0 }}>
            <div className="stat"><div className="l">Transactions</div><div className="v">{preview.txCount}</div></div>
            <div className="stat"><div className="l">Expense cat.</div><div className="v">{preview.expenseCats}</div></div>
            <div className="stat"><div className="l">Income cat.</div><div className="v">{preview.incomeCats}</div></div>
          </div>
          <div className="small muted" style={{ margin: '10px 4px' }}>{shortDate(preview.from)} {preview.from.slice(0, 4)} → {shortDate(preview.to)} {preview.to.slice(0, 4)}</div>
          <div className="section-head"><span className="section-title">Accounts</span></div>
          <div className="list">
            {preview.accounts.filter(a => !a.archived).map(a => (
              <div key={a.name} className="list-row"><span className="grow ellipsis">{a.name}</span><span className="num bold">{money(a.balance ?? 0)}</span></div>
            ))}
            {preview.accounts.some(a => a.archived) && (
              <div className="list-row small muted">+ {preview.accounts.filter(a => a.archived).length} old accounts go to Archive (history kept)</div>
            )}
          </div>
          {existing > 0 && (
            <div className="list" style={{ marginTop: 12 }}>
              <button className="list-row" onClick={() => setReplace(true)}>
                <span className="grow">Replace my current data<div className="tiny muted">Recommended — avoids duplicates ({existing} existing)</div></span>{replace && <Check size={20} style={{ color: 'var(--accent)' }} />}
              </button>
              <button className="list-row" onClick={() => setReplace(false)}>
                <span className="grow">Add on top</span>{!replace && <Check size={20} style={{ color: 'var(--accent)' }} />}
              </button>
            </div>
          )}
          <button className="btn" style={{ marginTop: 16 }} onClick={run}>Import</button>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setPreview(null)}>Choose another file</button>
        </motion.div>
      )}
    </div>
  );
}
