import { useEffect, useState } from 'react';

/** The site lives under a sub-path on GitHub Pages (e.g. /tessel/). */
const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, '');

export type Route =
  | { name: 'home' }
  | { name: 'login'; mode: 'in' | 'up'; next: string }
  | { name: 'boards'; tab: 'all' | 'starred' | 'shared' | 'trash' }
  | { name: 'board'; id: string; k: string | null }
  | { name: 'try' }
  | { name: 'notfound' };

export function parseRoute(): Route {
  const path = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  const q = new URLSearchParams(location.search);
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'login' || parts[0] === 'signup') return { name: 'login', mode: parts[0] === 'signup' ? 'up' : 'in', next: q.get('next') || '' };
  if (parts[0] === 'boards') {
    const tab = (['starred', 'shared', 'trash'].includes(parts[1]) ? parts[1] : 'all') as 'all';
    return { name: 'boards', tab };
  }
  if (parts[0] === 'b' && parts[1]) return { name: 'board', id: parts[1], k: q.get('k') };
  if (parts[0] === 'try') return { name: 'try' };
  return { name: 'notfound' };
}

export const href = (p: string) => BASE + (p.startsWith('/') ? p : '/' + p);

export function go(p: string, replace = false) {
  const url = href(p);
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.dispatchEvent(new Event('tessel:route'));
  window.scrollTo(0, 0);
}

export function useRoute() {
  const [r, set] = useState(parseRoute);
  useEffect(() => {
    const f = () => set(parseRoute());
    window.addEventListener('popstate', f); window.addEventListener('tessel:route', f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('tessel:route', f); };
  }, []);
  return r;
}

/** An <a> that navigates inside the app without a page load. */
export function linkProps(p: string) {
  return {
    href: href(p),
    onClick: (e: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
      if (e.metaKey || e.ctrlKey || (e.button ?? 0) !== 0) return;
      e.preventDefault(); go(p);
    },
  };
}

/** GitHub Pages serves 404.html for deep links; it stores the path and sends people here. */
export function restoreDeepLink() {
  try {
    const saved = sessionStorage.getItem('tessel:redirect');
    if (saved) { sessionStorage.removeItem('tessel:redirect'); history.replaceState(null, '', saved); }
  } catch { /* storage blocked */ }
}
