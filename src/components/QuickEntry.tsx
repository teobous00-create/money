import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Mic, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store';
import { addDays, haptic, todayISO } from '../lib/format';
import { loadLearned, parseQuick, type Parsed } from '../lib/quickparse';
import { toast } from './ui';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

/** "Type or say…" box: turns a phrase into a filled-in transaction. */
export function QuickEntry({ onParsed, autoListen = false }: { onParsed: (p: Parsed, text: string) => void; autoListen?: boolean }) {
  const accounts = useStore(s => s.accounts);
  const categories = useStore(s => s.categories);
  const txs = useStore(s => s.transactions);
  const me = useStore(s => s.user?.id);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const finalText = useRef('');

  const ctx = useMemo(() => {
    const live = Object.values(categories).filter(c => !c.deleted_at);
    const visible = live.filter(c => !c.archived && !(c.parent_id && categories[c.parent_id]?.archived));
    const since = addDays(todayISO(), -120);
    const usage = new Map<string, number>();
    for (const t of Object.values(txs)) {
      if (t.deleted_at || t.owner_id !== me || !t.category_id || t.date < since) continue;
      usage.set(t.category_id, (usage.get(t.category_id) ?? 0) + 1);
      const p = categories[t.category_id]?.parent_id;
      if (p) usage.set(p, (usage.get(p) ?? 0) + 1);
    }
    return { accounts: Object.values(accounts).filter(a => !a.deleted_at && !a.archived && a.owner_id === me), categories: visible, usage };
  }, [accounts, categories, txs, me]);

  const submit = (t = text) => {
    const s = t.trim();
    if (!s) return;
    const p = parseQuick(s, { ...ctx, learned: loadLearned(), today: todayISO() });
    if (p.amount === null && !p.categoryId && !p.accountId && !p.toAccountId) { toast('Didn’t catch that — try e.g. “coffee 3,5 revolut”'); return; }
    haptic(10);
    onParsed(p, s);
  };

  const listen = () => {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = 'el-GR';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = '';
    r.onresult = e => {
      let all = '';
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      setText(all);
      finalText.current = all;
    };
    r.onerror = e => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for this app to talk');
      else if (e.error === 'no-speech') toast('Didn’t hear anything');
    };
    r.onend = () => { setListening(false); if (finalText.current.trim()) submit(finalText.current); };
    rec.current = r;
    try { r.start(); setListening(true); haptic(8); } catch { setListening(false); }
  };

  useEffect(() => {
    if (autoListen && SR) { const t = setTimeout(listen, 350); return () => clearTimeout(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rec.current?.abort(), []);

  return (
    <div className={`quick ${listening ? 'on' : ''}`}>
      <Sparkles size={17} className="quick-spark" />
      <input className="quick-input" value={text} placeholder={listening ? 'Listening…' : 'Type or say: coffee 3,5 revolut'}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} enterKeyHint="go" />
      <AnimatePresence initial={false}>
        {text.trim() && !listening && (
          <motion.button key="go" className="quick-btn go" aria-label="Fill in" onClick={() => submit()}
            initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
            <ArrowRight size={19} />
          </motion.button>
        )}
      </AnimatePresence>
      {SR && (
        <button className={`quick-btn mic ${listening ? 'on' : ''}`} aria-label={listening ? 'Stop' : 'Speak'} onClick={listen}>
          {listening && <motion.span className="quick-pulse" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.1, repeat: Infinity }} />}
          <Mic size={19} />
        </button>
      )}
    </div>
  );
}
