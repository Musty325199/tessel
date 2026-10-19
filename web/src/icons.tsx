const P: Record<string, JSX.Element> = {
  select: <path d="M5 3.5l13 6.2-5.6 1.7 3.6 6.4-2.4 1.4-3.6-6.4L5.6 17z" strokeLinejoin="round" />,
  hand: <path d="M8 11V5.5a1.5 1.5 0 013 0V10m0-5.5V4a1.5 1.5 0 013 0v6m0-4.5a1.5 1.5 0 013 0V12m0-4a1.5 1.5 0 013 0v5.5c0 4-2.7 7-6.6 7-2.4 0-3.9-.9-5.4-2.7L4.6 14.6a1.5 1.5 0 012.3-1.9L8 14" strokeLinecap="round" strokeLinejoin="round" />,
  sticky: <><path d="M4.5 4.5h15v10l-5 5h-10z" strokeLinejoin="round" /><path d="M19.5 14.5h-5v5" strokeLinejoin="round" /></>,
  text: <path d="M5 6.5V5h14v1.5M12 5v14m-3 0h6" strokeLinecap="round" strokeLinejoin="round" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="2.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="7" />,
  diamond: <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" strokeLinejoin="round" />,
  shapes: <><rect x="3.5" y="10" width="9.5" height="9.5" rx="2" /><circle cx="15.5" cy="8.5" r="5" /></>,
  arrow: <path d="M5 19L19 5m0 0h-8m8 0v8" strokeLinecap="round" strokeLinejoin="round" />,
  pen: <><path d="M14.5 5.5l4 4L9 19H5v-4z" strokeLinejoin="round" /><path d="M12.5 7.5l4 4" /></>,
  eraser: <><path d="M9 19.5h10M4.6 14.3l8.7-8.7a2 2 0 012.8 0l2.3 2.3a2 2 0 010 2.8L11 18.1a2 2 0 01-2.8 0l-3.6-3.8z" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 9.9l5.1 5.1" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 15.5l-4.5-4.5-8.5 8" strokeLinejoin="round" /></>,
  frame: <path d="M7 3.5v17M17 3.5v17M3.5 7h17M3.5 17h17" strokeLinecap="round" />,
  undo: <path d="M9 7L5 11l4 4M5 11h9.5a4.5 4.5 0 010 9H12" strokeLinecap="round" strokeLinejoin="round" />,
  redo: <path d="M15 7l4 4-4 4m4-4H9.5a4.5 4.5 0 000 9H12" strokeLinecap="round" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  minus: <path d="M5 12h14" strokeLinecap="round" />,
  trash: <path d="M5 7h14M10 7V5h4v2m-7.5 0l.8 12h9.4l.8-12M10.5 10.5v5.5m3-5.5v5.5" strokeLinecap="round" strokeLinejoin="round" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 00-2-2h-7a2 2 0 00-2 2v7a2 2 0 002 2h2" /></>,
  front: <><path d="M12 3.5l8 4-8 4-8-4z" strokeLinejoin="round" /><path d="M4 12l8 4 8-4M4 16.5l8 4 8-4" strokeLinecap="round" strokeLinejoin="round" opacity=".45" /></>,
  more: <><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  share: <><circle cx="17.5" cy="6" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="18" r="2.5" /><path d="M8.7 10.8l6.6-3.6M8.7 13.2l6.6 3.6" /></>,
  fit: <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9m6 0h3.5A1.5 1.5 0 0120 5.5V9m0 6v3.5a1.5 1.5 0 01-1.5 1.5H15m-6 0H5.5A1.5 1.5 0 014 18.5V15" strokeLinecap="round" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2m0 15v2M4.6 4.6L6 6m12 12l1.4 1.4M2.5 12h2m15 0h2M4.6 19.4L6 18M18 6l1.4-1.4" strokeLinecap="round" /></>,
  moon: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" strokeLinejoin="round" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />,
  reset: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7" strokeLinecap="round" strokeLinejoin="round" />,
  download: <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" strokeLinecap="round" strokeLinejoin="round" />,
};

export default function Icon({ n, size = 22 }: { n: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      {P[n]}
    </svg>
  );
}

export function Mark({ size = 26 }: { size?: number }) {
  // four tiles that only make a square when they come together
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M2 2h11v11H2z" fill="#2F5BFF" />
      <path d="M15 2h11L15 13z" fill="#FF5A4E" />
      <path d="M2 15h11L2 26z" fill="#FFB020" />
      <circle cx="20.5" cy="20.5" r="5.5" fill="#12B5A6" />
    </svg>
  );
}
