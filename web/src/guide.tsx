import { useEffect, useLayoutEffect, useState } from 'react';

/** A three-step tour shown the first time someone opens a board. Skippable, never shown again. */
const KEY = 'tessel:guide-seen';
const STEPS = [
  { sel: '[aria-label="Sticky note (S)"]', title: 'Add a note', text: 'Tap Note, then tap anywhere on the board. Double-tap a note to change its text.' },
  { sel: '.ai-tool', title: 'Let AI help', text: 'Sort all your notes into groups, sum up the board, or describe a process and get a flowchart.' },
  { sel: '.top .share', title: 'Bring your team in', text: 'Share a link and everyone works on the same board, with their cursors live on screen.' },
];

const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: show again next time */ } };

export function Guide() {
  const [on, setOn] = useState(false);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  // only steps whose button exists on this page (the practice board has no Share, for example)
  const [steps, setSteps] = useState(STEPS);

  useEffect(() => {
    if (seen()) return;
    const t = window.setTimeout(() => { setSteps(STEPS.filter((s) => document.querySelector(s.sel))); setOn(true); }, 700);
    return () => window.clearTimeout(t);
  }, []);

  const step = steps[i];
  useLayoutEffect(() => {
    if (!on || !step) return;
    const place = () => { const el = document.querySelector(step.sel); setBox(el ? el.getBoundingClientRect() : null); };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [on, step]);

  if (!on || !step || !box) return null;
  const finish = () => { markSeen(); setOn(false); };
  const vw = window.innerWidth, vh = window.innerHeight;
  const below = box.top + box.height / 2 < vh / 2; // button at the top: the card goes under it
  const cardW = Math.min(300, vw - 24);
  const left = Math.min(Math.max(12, box.left + box.width / 2 - cardW / 2), vw - cardW - 12);
  const arrow = Math.min(Math.max(18, box.left + box.width / 2 - left), cardW - 18);
  const pad = 6;

  return (
    <div className="guide" role="dialog" aria-label="Quick tour">
      <div className="guide-ring" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
      <div className={'guide-card' + (below ? ' below' : '')} style={{ left, width: cardW, ...(below ? { top: box.bottom + 14 } : { bottom: vh - box.top + 14 }), ['--arrow' as string]: arrow + 'px' }}>
        <span className="guide-step">{i + 1} of {steps.length}</span>
        <b>{step.title}</b>
        <p>{step.text}</p>
        <div className="guide-row">
          <button className="textbtn" onClick={finish}>Skip</button>
          <button className="btn primary" onClick={() => (i + 1 < steps.length ? setI(i + 1) : finish())}>{i + 1 < steps.length ? 'Next' : 'Got it'}</button>
        </div>
      </div>
    </div>
  );
}
