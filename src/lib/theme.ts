import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'money:theme';
const COLOR = { light: '#f5f4f0', dark: '#0d0f12' };
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const ls = new Set<() => void>();

function read(): Theme {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}
let current = read();

function apply() {
  const root = document.documentElement;
  if (current === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', current);
  const dark = current === 'dark' || (current === 'system' && mq.matches);
  // status bar colour follows the app, not only the phone
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? COLOR.dark : COLOR.light;
  document.head.appendChild(meta);
}
apply();
mq.addEventListener?.('change', () => { if (current === 'system') apply(); });

export function setTheme(t: Theme) {
  current = t;
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* ignore */ }
  apply();
  ls.forEach(f => f());
}

export const useTheme = () => useSyncExternalStore(f => { ls.add(f); return () => ls.delete(f); }, () => current);
