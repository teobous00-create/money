import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wallet } from 'lucide-react';
import { signIn, signUp } from '../lib/store';
import { Segmented, ease } from '../components/ui';

export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (mode === 'in') await signIn(email, password);
      else await signUp(email, password, name);
    } catch (x) {
      const m = (x as Error).message || 'Something went wrong';
      setErr(/invalid login/i.test(m) ? 'Wrong email or password.' : m);
      if (/confirmation email/.test(m)) setMode('in');
    } finally { setBusy(false); }
  };

  return (
    <motion.form className="auth" onSubmit={submit} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
      <motion.div className="logo" initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}>
        <Wallet size={32} />
      </motion.div>
      <h1 style={{ margin: '0 0 4px', fontSize: 28, letterSpacing: '-0.02em' }}>Money</h1>
      <p className="muted" style={{ margin: '0 0 24px' }}>Your accounts, your categories, and a joint account you share.</p>
      <Segmented value={mode} onChange={v => { setMode(v); setErr(''); }} style={{ marginBottom: 18 }}
        options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]} />
      <AnimatePresence initial={false}>
        {mode === 'up' && (
          <motion.div className="field" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease }}>
            <label>Your name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Teo" autoComplete="name" />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="field">
        <label>Email</label>
        <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
      </div>
      <div className="field">
        <label>Password</label>
        <input className="input" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
      </div>
      {err && <div className="err">{err}</div>}
      <motion.button className="btn" disabled={busy} whileTap={{ scale: 0.98 }} type="submit">
        {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
      </motion.button>
    </motion.form>
  );
}
