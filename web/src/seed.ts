import { createShape, doc, undo } from './store';
import { STICKY } from './palette';

/** A sample board so the first visit shows what Tessel is for. Stacked on phones, side by side on wide screens. */
export function seedBoard(stacked = false) {
  doc.transact(() => {
    const q = (s: Parameters<typeof createShape>[0]) => createShape(s, 'seed');
    q({ type: 'text', x: 0, y: -118, w: stacked ? 430 : 760, h: 60, text: stacked ? 'Tessel launch plan' : 'Launch plan for Tessel', size: 46, stroke: 'ink' });
    const pts: number[] = [];
    for (let i = 0; i <= 40; i++) pts.push(i * 9, 8 + Math.sin(i / 3.2) * 5, 0.5);
    q({ type: 'pen', x: 4, y: -52, w: 360, h: 18, points: pts, size: 5, stroke: '#2F5BFF' });

    q({ type: 'frame', x: 0, y: 0, w: 660, h: 440, text: 'Ideas from the team' });
    const ideas = ['Live cursors with everyone’s name', 'Keep working offline, sync when back', 'AI groups messy notes into themes', 'Templates to start fast', 'Restore any earlier version', 'Invite people with one link'];
    ideas.forEach((t, i) => q({ type: 'sticky', x: 30 + (i % 3) * 208, y: 52 + Math.floor(i / 3) * 192, w: 184, h: 170, text: t, color: STICKY[i % STICKY.length] }));

    const ox = stacked ? 0 : 740, oy = stacked ? 520 : 0;
    q({ type: 'frame', x: ox, y: oy, w: 660, h: 440, text: 'How one change travels' });
    const a = q({ type: 'rect', x: ox + 28, y: oy + 84, w: 172, h: 88, text: 'You move a note', color: '#FFFFFF' });
    const b = q({ type: 'diamond', x: ox + 266, y: oy + 64, w: 128, h: 128, text: 'Online?', color: '#FFE47A' });
    const c = q({ type: 'rect', x: ox + 460, y: oy + 84, w: 172, h: 88, text: 'Everyone sees it live', color: '#B6EBC6' });
    const d = q({ type: 'ellipse', x: ox + 242, y: oy + 296, w: 176, h: 100, text: 'Saved here, syncs later', color: '#B9DCFF' });
    const arrow = (f: string, t: string) => q({ type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: { id: f, x: 0, y: 0 }, to: { id: t, x: 0, y: 0 }, stroke: 'ink' });
    arrow(a, b); arrow(b, c); arrow(b, d);

    const tip = 'Double-tap any note to edit it. Pinch to zoom.';
    if (stacked) q({ type: 'sticky', x: 460, y: -150, w: 200, h: 130, text: tip, color: STICKY[5] });
    else q({ type: 'sticky', x: -250, y: 40, w: 200, h: 180, text: tip, color: STICKY[5] });
  }, 'seed');
  undo.clear();
}
