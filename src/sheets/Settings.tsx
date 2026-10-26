import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CloudCheck, CloudUpload, Download, LogOut, Repeat, Trash2, Upload, Smartphone, ChevronRight, CloudAlert, EyeOff } from 'lucide-react';
import { Sheet, Segmented, toast, ease } from '../components/ui';
import { setTheme, useTheme } from '../lib/theme';
import { useUi, setUi } from '../lib/ui';
import { useStore, signOut, sync, wipeMyData, discardFailed } from '../lib/store';
import { exportCsv } from '../lib/import1money';
import { REMOTE } from '../lib/supabase';
import { todayISO } from '../lib/format';

type BIP = Event & { prompt: () => Promise<void> };
let installEvent: BIP | null = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e as BIP; });

export function SettingsSheet() {
  const open = useUi(u => u.settings);
  const close = () => setUi({ settings: false });
  return <Sheet open={open} onClose={close} title="Settings">{open && <Body />}</Sheet>;
}

function Body() {
  const user = useStore(s => s.user);
  const profiles = useStore(s => s.profiles);
  const pending = useStore(s => s.pending);
  const failed = useStore(s => s.failed);
  const syncing = useStore(s => s.syncing);
  const online = useStore(s => s.online);
  const lastSync = useStore(s => s.lastSync);
  const recCount = useStore(s => Object.values(s.recurring).filter(r => !r.deleted_at && r.owner_id === s.user?.id).length);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [canInstall, setCanInstall] = useState(!!installEvent);
  useEffect(() => { const t = setInterval(() => setCanInstall(!!installEvent), 1000); return () => clearInterval(t); }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const name = (user && profiles[user.id]?.display_name) || 'Me';
  const theme = useTheme();

  const doExport = () => {
    const blob = new Blob([exportCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Money_${todayISO()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Exported');
  };

  const status = !REMOTE ? 'Stored on this device only' : failed ? `${failed} changes were rejected by the server` : !online ? `Offline · ${pending} changes waiting` : pending ? `Syncing ${pending} changes…` : syncing ? 'Syncing…' : lastSync ? 'All changes synced' : 'Connecting…';
  const StatusIcon = failed ? CloudAlert : pending || !online ? CloudUpload : CloudCheck;

  return (
    <div className="sheet-body">
      <div className="card row" style={{ marginBottom: 12 }}>
        <div className="avatar" style={{ width: 48, height: 48, fontSize: 19 }}>{name.slice(0, 1).toUpperCase()}</div>
        <div className="grow">
          <div className="bold">{name}</div>
          <div className="small muted ellipsis">{user?.email ?? 'Local mode'}</div>
        </div>
      </div>

      <div className="list">
        <button className="list-row" onClick={() => (failed ? discardFailed() : void sync())}>
          <StatusIcon size={22} style={{ color: failed ? 'var(--expense)' : pending || !online ? 'var(--warn)' : 'var(--accent)' }} />
          <span className="grow">{status}{failed > 0 && <div className="tiny muted">Tap to dismiss</div>}</span>
          {REMOTE && !failed && <span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sync now</span>}
        </button>
      </div>

      <div className="section">
        <div className="section-head"><span className="section-title">Appearance</span></div>
        <Segmented value={theme} onChange={setTheme} options={[{ value: 'system', label: 'Phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>

      <div className="section list">
        <button className="list-row" onClick={() => setUi({ recurring: true })}>
          <Repeat size={21} /><span className="grow">Recurring</span><span className="muted small">{recCount}</span><ChevronRight size={18} className="faint" />
        </button>
        <button className="list-row" onClick={() => setUi({ hidden: true })}>
          <EyeOff size={21} /><span className="grow">Hidden categories</span><ChevronRight size={18} className="faint" />
        </button>
        <button className="list-row" onClick={() => setUi({ importer: true })}>
          <Upload size={21} /><span className="grow">Import from 1Money</span><ChevronRight size={18} className="faint" />
        </button>
        <button className="list-row" onClick={doExport}>
          <Download size={21} /><span className="grow">Export CSV</span>
        </button>
        {!standalone && (
          <button className="list-row" onClick={async () => { if (installEvent) { await installEvent.prompt(); installEvent = null; } else toast('In Chrome: menu ⋮ → Add to Home screen / Install app'); }}>
            <Smartphone size={21} /><span className="grow">Install on this phone{canInstall ? '' : <div className="tiny muted">Chrome menu ⋮ → Install app</div>}</span>
          </button>
        )}
      </div>

      <div className="section list">
        {REMOTE && <button className="list-row" onClick={() => void signOut()}><LogOut size={21} /><span className="grow">Sign out</span></button>}
        <button className="list-row" style={{ color: 'var(--expense)' }} onClick={() => setConfirmWipe(v => !v)}><Trash2 size={21} /><span className="grow">Delete all my data</span></button>
      </div>
      <AnimatePresence>
        {confirmWipe && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease }} style={{ overflow: 'hidden' }}>
            <div className="small muted" style={{ padding: '12px 6px 8px' }}>Deletes all your accounts, categories, transactions and recurring entries (useful before a fresh import). Your partner's data isn't touched.</div>
            <button className="btn danger" onClick={() => { wipeMyData(); setConfirmWipe(false); toast('All your data was deleted'); }}>Yes, delete everything</button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="tiny faint" style={{ textAlign: 'center', marginTop: 20 }}>Money · v{__APP_VERSION__}</div>
    </div>
  );
}
