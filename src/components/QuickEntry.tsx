import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setUi, useUi } from '../lib/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Mic } from 'lucide-react';
import { haptic } from '../lib/format';
import { toast } from './ui';
import { interpret, isQuestion, wantsAI } from '../lib/voice';
import { openFor, runVoice, understood, voiceCtxNow } from '../lib/voiceRun';
import { tryLocalAsk, tryLocalEdit } from '../lib/localCmd';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const SR = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

/** Speech-to-text (Chrome's own recognition, Greek). `onFinal` gets what you said. */
export function useListen(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const rec = useRef<Rec | null>(null);
  const finalText = useRef('');
  const cb = useRef(onFinal);
  cb.current = onFinal;
  const timers = useRef<{ quiet?: ReturnType<typeof setTimeout>; max?: ReturnType<typeof setTimeout> }>({});
  const clear = () => { clearTimeout(timers.current.quiet); clearTimeout(timers.current.max); };
  const start = () => {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = 'el-GR';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = '';
    setHeard('');
    // stops by itself: 1 s after the last words, 5 s if nothing is said, 15 s at most
    const quiet = (ms: number) => { clearTimeout(timers.current.quiet); timers.current.quiet = setTimeout(() => r.stop(), ms); };
    r.onresult = e => {
      let all = '';
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      setHeard(all);
      finalText.current = all;
      if (all.trim()) quiet(1000);
    };
    r.onerror = e => {
      clear();
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for this app to talk');
      else if (e.error === 'no-speech') toast('Didn’t hear anything');
    };
    r.onend = () => { clear(); setListening(false); const t = finalText.current.trim(); if (t) cb.current(t); };
    rec.current = r;
    try { r.start(); setListening(true); haptic(8); quiet(5000); timers.current.max = setTimeout(() => r.stop(), 15000); } catch { setListening(false); }
  };
  useEffect(() => () => { clear(); rec.current?.abort(); }, []);
  return { listening, heard, start, supported: !!SR };
}

/** Mic button (top bar): tap, say a command, done. Shows what it hears while listening. */
export function VoiceButton() {
  const onVoice = (text: string) => {
    if (tryLocalAsk(text) || tryLocalEdit(text)) return;             // simple sums and fixes to the last entry: on the phone
    if (isQuestion(text)) { setUi({ ask: text }); return; }           // a question → the AI, in a small window
    const cmds = interpret(text, voiceCtxNow());
    if (!understood(cmds) || wantsAI(text, cmds)) { setUi({ ask: text }); return; }   // not a plain new entry → let the AI handle it
    const open = runVoice(cmds);
    if (!open) return;
    if (open.kind === 'tx') setUi({ addTx: { prefill: { p: open.p, repeat: open.repeat, until: open.until } } });
    else openFor(open);
  };
  const { listening, heard, start, supported } = useListen(onVoice);
  const now = useUi(u => !!u.listenNow);
  useEffect(() => {   // app-icon shortcut "Say entry": start listening right away
    if (!now || !supported) return;
    const t = setTimeout(() => { setUi({ listenNow: false }); start(); }, 400);
    return () => clearTimeout(t);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!supported) return null;
  return (
    <>
      <button className={`iconbtn voice-btn ${listening ? 'on' : ''}`} aria-label={listening ? 'Stop' : 'Speak a command'} onClick={start}>
        {listening && <motion.span className="quick-pulse" style={{ borderRadius: 999 }} initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 1.1, repeat: Infinity }} />}
        <Mic size={22} />
      </button>
      {createPortal(
        <AnimatePresence>
          {listening && (
            <motion.div className="voice-pill" initial={{ opacity: 0, y: -10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <span className="voice-dot" />
              <span className="grow">{heard || 'Listening…'}</span>
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}
