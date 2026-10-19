import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const read = (): Theme => { try { return (localStorage.getItem('tessel:theme') as Theme) || 'system'; } catch { return 'system'; } };
let current: Theme = read();
const subs = new Set<(t: Theme) => void>();

export function applyTheme(t: Theme = current) {
  current = t;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('tessel:theme', t); } catch { /* blocked */ }
  subs.forEach((f) => f(t));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, set] = useState(current);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return [t, applyTheme];
}
