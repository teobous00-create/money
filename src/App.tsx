import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Wallet, Shapes, ReceiptText, ChartColumn, Pencil, CalendarCheck } from 'lucide-react';
import { useStore, setPeriod } from './lib/store';
import { useUi, setUi, type UiState } from './lib/ui';
import { useHeaderTotalBase, usePlanned } from './lib/calc';
import { todayISO } from './lib/format';
import { label, shift, type PeriodMode } from './lib/period';
import { num } from './lib/format';
import { Money, ToastHost, softSpring, ease } from './components/ui';
import { AuthScreen } from './screens/Auth';
import { VoiceButton } from './components/QuickEntry';
import { PullHint, usePullToChat } from './components/PullToChat';
import { isDragging } from './components/Sortable';
import { AccountsScreen } from './screens/Accounts';
import { CategoriesScreen } from './screens/Categories';
import { TransactionsScreen } from './screens/Transactions';
import { OverviewScreen } from './screens/Overview';
// loaded when first needed, so the app opens faster
const TrackerScreen = lazy(() => import('./screens/Tracker').then(m => ({ default: m.TrackerScreen })));
const ChatPanel = lazy(() => import('./components/Chat').then(m => ({ default: m.ChatPanel })));
const AskSheet = lazy(() => import('./components/Chat').then(m => ({ default: m.AskSheet })));
const ImportSheet = lazy(() => import('./sheets/Import').then(m => ({ default: m.ImportSheet })));
import { AddTransactionSheet } from './sheets/AddTransaction';
import { AccountSheet } from './sheets/AccountEdit';
import { CategorySheet } from './sheets/CategoryEdit';
import { CategoryDetailSheet } from './sheets/CategoryDetail';
import { SettingsSheet } from './sheets/Settings';
import { FilterSheet } from './sheets/Filter';
import { PeriodSheet } from './sheets/PeriodPicker';
import { RecurringSheet } from './sheets/Recurring';
import { HiddenSheet } from './sheets/Hidden';

const MODE_SHORT: Record<PeriodMode, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year', all: 'All' };

export default function App() {
  const phase = useStore(s => s.phase);
  return (
    <MotionConfig reducedMotion="user">
      {phase === 'loading' ? <div /> : phase === 'auth' ? <AuthScreen /> : <Shell />}
    </MotionConfig>
  );
}

/** App-icon shortcuts (long-press the icon): ?a=voice | expense | shift */
function useShortcut() {
  const analytics = useStore(s => !!s.prefs.analytics);
  useEffect(() => {
    const a = new URLSearchParams(location.search).get('a');
    if (!a) { if (analytics) setUi({ tab: 'transactions' }); return; }   // your account always opens on Transactions
    history.replaceState(null, '', location.pathname);
    if (a === 'voice') setUi(analytics ? { tab: 'transactions', listenNow: true } : { addTx: { voice: true } });   // your account: the top mic
    else if (a === 'expense') setUi({ addTx: { type: 'expense' } });
    else if (a === 'shift' && analytics) setUi({ tab: 'tracker', shiftDay: todayISO() });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function Shell() {
  const tab = useUi(u => u.tab);
  const dir = useUi(u => u.tabDir);
  useShortcut();
  const ai = useStore(s => !!s.prefs.analytics);   // the chat is only on your account
  const chat = useUi(u => !!u.chat);
  const ask = useUi(u => u.ask);
  const [chatEver, setChatEver] = useState(false);
  const [askEver, setAskEver] = useState(false);
  useEffect(() => { if (chat) setChatEver(true); }, [chat]);
  useEffect(() => { if (ask) setAskEver(true); }, [ask]);
  const pull = usePullToChat(ai && !chat, () => setUi({ chat: true }), isDragging);
  return (
    <div className="app">
      <TopBar />
      <AnimatePresence initial={false}>
        {tab !== 'accounts' && tab !== 'tracker' && (
          <motion.div key="pb" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease }} style={{ overflow: 'hidden', flex: 'none' }}>
            <PeriodBar />
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} {...pull.handlers}>
        <PullHint pull={pull.pull} ready={pull.ready} />
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div key={tab} custom={dir} style={{ position: 'absolute', inset: 0, display: 'flex' }}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d * 28 }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: d * -28 }),
            }}
            initial="enter" animate="center" exit="exit" transition={{ duration: 0.26, ease }}>
            {tab === 'accounts' && <AccountsScreen />}
            {tab === 'categories' && <Swipe><CategoriesScreen /></Swipe>}
            {tab === 'transactions' && <Swipe><TransactionsScreen /></Swipe>}
            {tab === 'overview' && <Swipe><OverviewScreen /></Swipe>}
            {tab === 'tracker' && <Suspense fallback={null}><TrackerScreen /></Suspense>}
          </motion.div>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {(tab === 'transactions' || tab === 'overview') && (
          <motion.button key="fab" className="fab" aria-label="Add transaction"
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
            whileTap={{ scale: 0.92 }} transition={softSpring} onClick={() => setUi({ addTx: {} })}>
            <Plus size={28} strokeWidth={2.2} />
          </motion.button>
        )}
      </AnimatePresence>
      <BottomNav />
      {ai && chatEver && <Suspense fallback={null}><ChatPanel open={chat} onClose={() => setUi({ chat: false })} /></Suspense>}
      {ai && askEver && <Suspense fallback={null}><AskSheet /></Suspense>}
      <ToastHost />
      <Sheets />
    </div>
  );
}

function TopBar() {
  const { total, count } = useHeaderTotalBase();
  const period = useStore(s => s.period);
  const tabNow = useUi(u => u.tab);
  const view = tabNow === 'accounts' ? { mode: 'month' as const, anchor: todayISO() } : period;
  const plan = usePlanned(view);
  const when = view.mode === 'month' ? new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(view.anchor)) : '';
  const endWord = view.mode === 'month' ? 'end of month' : view.mode === 'all' ? 'in a year' : view.mode === 'year' ? 'end of year' : view.mode === 'week' ? 'end of week' : 'end of day';
  const user = useStore(s => s.user);
  const profiles = useStore(s => s.profiles);
  const pending = useStore(s => s.pending);
  const failed = useStore(s => s.failed);
  const tab = useUi(u => u.tab);
  const analytics = useStore(s => !!s.prefs.analytics);
  const name = (user && profiles[user.id]?.display_name) || user?.email || 'Me';
  const right: Record<UiState['tab'], ReactNode> = {
    accounts: <button className="iconbtn" aria-label="Add account" onClick={() => setUi({ account: {} })}><Plus size={24} /></button>,
    categories: <button className="iconbtn" aria-label="New category" onClick={() => setUi({ category: {} })}><Pencil size={20} /></button>,
    // your account: a mic for voice commands; others keep search
    transactions: analytics ? <VoiceButton /> : <button className="iconbtn" aria-label="Search" onClick={() => setUi({ search: true })}><Search size={22} /></button>,
    overview: <span />,
    tracker: <span />,
  };
  return (
    <div className="topbar">
      <button className="iconbtn" aria-label="Settings" onClick={() => setUi({ settings: true })}>
        <div className="avatar">{name.slice(0, 1).toUpperCase()}{(pending > 0 || failed > 0) && <span className="sync-dot" style={failed ? { background: 'var(--expense)' } : undefined} />}</div>
      </button>
      <button className="total-btn" onClick={() => setUi({ filter: true })}>
        <span className="total-label">{count} {count === 1 ? 'account' : 'accounts'} <ChevronDown size={14} /></span>
        <Money value={total} className={`total-value ${total < 0 ? 'neg' : ''}`} />
        <AnimatePresence initial={false}>
          {plan.show && plan.inPeriod !== 0 && (
            <motion.span className="tiny muted num" style={{ whiteSpace: 'nowrap' }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              Planned{when ? ` in ${when}` : ''} {plan.inPeriod > 0 ? '+' : '−'}{num(Math.abs(plan.inPeriod))} € · {endWord}: {num(plan.endBalance)} €
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <div style={{ justifySelf: 'end' }}>{right[tab]}</div>
    </div>
  );
}

function PeriodBar() {
  const period = useStore(s => s.period);
  return (
    <div className="periodbar">
      <motion.button className="iconbtn" whileTap={{ scale: 0.9 }} aria-label="Previous" disabled={period.mode === 'all'}
        onClick={() => setPeriod(shift(period, -1))} style={{ opacity: period.mode === 'all' ? 0.3 : 1 }}>
        <ChevronLeft size={24} />
      </motion.button>
      <motion.button className="period-pill" whileTap={{ scale: 0.97 }} onClick={() => setUi({ periodPicker: true })}>
        <span className="mode">{MODE_SHORT[period.mode]}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={label(period)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
            {label(period)}
          </motion.span>
        </AnimatePresence>
        <ChevronDown size={16} className="faint" />
      </motion.button>
      <motion.button className="iconbtn" whileTap={{ scale: 0.9 }} aria-label="Next" disabled={period.mode === 'all'}
        onClick={() => setPeriod(shift(period, 1))} style={{ opacity: period.mode === 'all' ? 0.3 : 1 }}>
        <ChevronRight size={24} />
      </motion.button>
    </div>
  );
}

/** Horizontal swipe changes the period; the content slides in from the swipe direction. */
function Swipe({ children }: { children: ReactNode }) {
  const period = useStore(s => s.period);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastDir = useRef(0);
  const onStart = (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, t: Date.now() }; };
  const onEnd = (e: React.TouchEvent) => {
    const s = start.current; start.current = null;
    if (!s || period.mode === 'all' || isDragging()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s.t < 600) {
      const d = dx < 0 ? 1 : -1;
      lastDir.current = d;
      setPeriod(shift(period, d as 1 | -1));
    }
  };
  const key = period.mode + period.anchor;
  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }} onTouchStart={onStart} onTouchEnd={onEnd}>
      <AnimatePresence initial={false} custom={lastDir.current} mode="popLayout">
        <motion.div key={key} custom={lastDir.current} style={{ flex: 1, display: 'flex', width: '100%' }}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: d * 40 }),
            center: { opacity: 1, x: 0 },
            exit: (d: number) => ({ opacity: 0, x: d * -40 }),
          }}
          initial="enter" animate="center" exit="exit" transition={{ duration: 0.24, ease }}
          onAnimationComplete={() => { lastDir.current = 0; }}>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function BottomNav() {
  const tab = useUi(u => u.tab);
  const tracker = useStore(s => !!s.prefs.analytics);
  const items: Array<[UiState['tab'], string, typeof Wallet]> = [
    ['accounts', 'Accounts', Wallet], ['categories', 'Categories', Shapes],
    ['transactions', 'Transactions', ReceiptText], ['overview', 'Overview', ChartColumn],
  ];
  if (tracker) items.push(['tracker', 'Tracker', CalendarCheck]);
  useEffect(() => { if (!tracker && tab === 'tracker') setUi({ tab: 'categories' }); }, [tracker, tab]);
  return (
    <nav className={`nav ${tracker ? 'five' : ''}`}>
      {items.map(([id, text, I]) => (
        <motion.button key={id} className={`nav-item ${tab === id ? 'on' : ''}`} whileTap={{ scale: 0.94 }} onClick={() => setUi({ tab: id })}>
          <I size={22} strokeWidth={tab === id ? 2.2 : 1.8} />
          {text}
        </motion.button>
      ))}
      <div className="nav-ind" style={{ left: `calc(10px + (100% - 20px) * ${Math.max(0, items.findIndex(x => x[0] === tab)) + 0.5} / ${items.length})` }} />
    </nav>
  );
}

function Sheets() {
  // the importer is rarely used: load it the first time it's opened, then keep it
  const importer = useUi(u => u.importer);
  const [importerEver, setImporterEver] = useState(false);
  useEffect(() => { if (importer) setImporterEver(true); }, [importer]);
  return (
    <>
      <AddTransactionSheet />
      <AccountSheet />
      <CategorySheet />
      <CategoryDetailSheet />
      <SettingsSheet />
      <FilterSheet />
      <PeriodSheet />
      <RecurringSheet />
      {importerEver && <Suspense fallback={null}><ImportSheet /></Suspense>}
      <HiddenSheet />
    </>
  );
}
