import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { setUi } from '../lib/ui';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Mic, Sparkles } from 'lucide-react';
import { haptic } from '../lib/format';
import { toast } from './ui';
import { interpret, type Cmd } from '../lib/voice';
import { fullCtx, openFor, runVoice, understood, useVoiceCtx } from '../lib/voiceRun';

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
    r.onresult = e => {
      let all = '';
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      setHeard(all);
      finalText.current = all;
    };
    r.onerror = e => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for this app to talk');
      else if (e.error === 'no-speech') toast('Didn’t hear anything');
    };
    r.onend = () => { setListening(false); const t = finalText.current.trim(); if (t) cb.current(t); };
    rec.current = r;
    try { r.start(); setListening(true); haptic(8); } catch { setListening(false); }
  };
  useEffect(() => () => rec.current?.abort(), []);
  return { listening, heard, start, supported: !!SR };
}

/** "Type or say…" box. `onText` gets the phrase; voice/typed commands are handled by the caller. */
export function QuickEntry({ onText, autoListen = false, placeholder }: { onText: (text: string) => void; autoListen?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const submit = (t = text) => {
    const s = t.trim();
    if (!s) return;
    haptic(10);
    onText(s);
    setText('');
  };
  const { listening, heard, start: listen } = useListen(t => submit(t));
  useEffect(() => { if (listening) setText(heard); }, [heard, listening]);
  useEffect(() => {
    if (autoListen && SR) { const t = setTimeout(listen, 350); return () => clearTimeout(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`quick ${listening ? 'on' : ''}`}>
      <Sparkles size={17} className="quick-spark" />
      <input className="quick-input" value={text} placeholder={listening ? 'Listening…' : placeholder ?? 'Type or say: καφές 3,5 revolut'}
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

/** One handler for every place with a quick-entry box. Returns a function that takes the phrase. */
export function useVoiceHandler(fillTx: (c: Extract<Cmd, { kind: 'tx' }>) => void, onSaved?: () => void) {
  const ctx = useVoiceCtx();
  return (text: string) => {
    const cmds = interpret(text, fullCtx(ctx));
    if (!understood(cmds)) { toast('Didn’t catch that — try e.g. “καφές 3,5 revolut”'); return; }
    const open = runVoice(cmds);
    if (!open) onSaved?.();
    else if (open.kind === 'tx') fillTx(open);
    else openFor(open);
  };
}

/** Mic button (top bar): tap, say a command, done. Shows what it hears while listening. */
export function VoiceButton() {
  const onVoice = useVoiceHandler(c => setUi({ addTx: { prefill: { p: c.p, repeat: c.repeat, until: c.until } } }));
  const { listening, heard, start, supported } = useListen(onVoice);
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
