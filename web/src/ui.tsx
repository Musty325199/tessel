import { useEffect, useRef, type ReactNode } from 'react';
import Icon, { Mark } from './icons';
import { useTheme } from './theme';
import { linkProps } from './router';

export function Logo({ to = '/', label = true }: { to?: string; label?: boolean }) {
  return (
    <a className="logo-link" {...linkProps(to)} aria-label="Tessel">
      <Mark size={24} />
      {label && <span className="wordmark">Tessel</span>}
    </a>
  );
}

/** A dialog that is a centred card on wide screens and a bottom sheet on phones. */
export function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, select')?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.({ preventScroll: true }); };
  }, [onClose]);
  return (
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={'sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="ib" onClick={onClose} aria-label="Close"><Icon n="close" size={20} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="seg" role="group" aria-label="Theme">
      {(['system', 'light', 'dark'] as const).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}</button>)}
    </div>
  );
}

export function Popover({ open, onClose, children, className = '' }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('[data-pop-trigger]')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', down));
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [open, onClose]);
  if (!open) return null;
  return <div ref={ref} className={'menu ' + className} role="menu">{children}</div>;
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return <span className="avatar-dot" style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>{(name.trim()[0] || '?').toUpperCase()}</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={label}><span /><span /><span /><span /></div>;
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
    t.remove(); return ok;
  }
}

/** Board screens fix the page in place so touches move the board, not the page. */
export function useLock() {
  useEffect(() => {
    document.documentElement.classList.add('lock');
    return () => document.documentElement.classList.remove('lock');
  }, []);
}
