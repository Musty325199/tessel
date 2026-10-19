/** Board templates shared by the web app and the server. Plain data: each side writes them into a Yjs doc. */
export type TShape = {
  id: string; type: 'sticky' | 'text' | 'rect' | 'ellipse' | 'diamond' | 'arrow' | 'pen' | 'image' | 'frame';
  x: number; y: number; w: number; h: number; z: number;
  color?: string; stroke?: string; text?: string; size?: number; points?: number[];
  from?: { id?: string; x: number; y: number }; to?: { id?: string; x: number; y: number }; src?: string;
  font?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; align?: 'left' | 'center' | 'right'; textColor?: string;
};

export const STICKY = ['#FFE47A', '#FFC3A0', '#B6EBC6', '#B9DCFF', '#D8C8FF', '#FFBDD0'];

export type TemplateInfo = { id: string; name: string; blurb: string };
export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank', name: 'Blank board', blurb: 'Start from nothing' },
  { id: 'brainstorm', name: 'Brainstorm', blurb: 'Collect ideas, then vote on the best' },
  { id: 'flowchart', name: 'Flowchart', blurb: 'Map out how a process works' },
  { id: 'retro', name: 'Team retro', blurb: 'What went well, what didn’t, what to try' },
  { id: 'kanban', name: 'Project board', blurb: 'To do, doing, done' },
  { id: 'mindmap', name: 'Mind map', blurb: 'Grow ideas out from one topic' },
  { id: 'week', name: 'Weekly planner', blurb: 'Plan the week day by day' },
];

let n = 0;
const sid = (p: string) => `${p}${(++n).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function buildTemplate(kind: string): TShape[] {
  const out: TShape[] = [];
  let z = 1;
  const add = (s: Omit<TShape, 'id' | 'z'>) => { const id = sid('t'); out.push({ ...s, id, z: s.type === 'frame' ? -1000 + z++ / 1000 : z++ }); return id; };
  const note = (x: number, y: number, text: string, color: string, w = 180, h = 160) => add({ type: 'sticky', x, y, w, h, text, color });
  const title = (x: number, y: number, text: string, w = 600) => add({ type: 'text', x, y, w, h: 56, text, size: 44, stroke: 'ink' });
  const frame = (x: number, y: number, w: number, h: number, text: string) => add({ type: 'frame', x, y, w, h, text });
  const arrow = (a: string, b: string) => add({ type: 'arrow', x: 0, y: 0, w: 0, h: 0, from: { id: a, x: 0, y: 0 }, to: { id: b, x: 0, y: 0 }, stroke: 'ink' });

  switch (kind) {
    case 'brainstorm': {
      title(0, -120, 'What should we build next?');
      frame(0, 0, 900, 420, 'Ideas');
      ['Add your idea here', 'One idea per note', 'Quantity first, judge later'].forEach((t, i) => note(30 + i * 210, 50, t, STICKY[i]));
      frame(0, 500, 900, 260, 'Top picks after voting');
      break;
    }
    case 'flowchart': {
      title(0, -120, 'How it works');
      const a = add({ type: 'ellipse', x: 0, y: 0, w: 170, h: 90, text: 'Start', color: '#B6EBC6' });
      const b = add({ type: 'rect', x: 250, y: 0, w: 180, h: 90, text: 'First step', color: '#FFFFFF' });
      const c = add({ type: 'diamond', x: 515, y: -20, w: 130, h: 130, text: 'Decision?', color: '#FFE47A' });
      const d = add({ type: 'rect', x: 740, y: 0, w: 180, h: 90, text: 'If yes', color: '#FFFFFF' });
      const e = add({ type: 'rect', x: 490, y: 200, w: 180, h: 90, text: 'If no', color: '#FFFFFF' });
      const f = add({ type: 'ellipse', x: 745, y: 200, w: 170, h: 90, text: 'Finish', color: '#FFC3A0' });
      arrow(a, b); arrow(b, c); arrow(c, d); arrow(c, e); arrow(d, f); arrow(e, f);
      break;
    }
    case 'retro': {
      title(0, -120, 'Sprint retro');
      [['Went well', STICKY[2]], ['Didn’t go well', STICKY[1]], ['Try next time', STICKY[3]]].forEach(([t, c], i) => {
        frame(i * 360, 0, 330, 560, t);
        note(i * 360 + 75, 50, 'Add a note', c);
      });
      break;
    }
    case 'kanban': {
      title(0, -120, 'Project board');
      ['To do', 'Doing', 'Done'].forEach((t, i) => frame(i * 340, 0, 310, 620, t));
      note(65, 50, 'First task', STICKY[0]); note(65, 230, 'Second task', STICKY[0]);
      note(405, 50, 'In progress', STICKY[3]); note(745, 50, 'Finished task', STICKY[2]);
      break;
    }
    case 'mindmap': {
      const c = add({ type: 'ellipse', x: 0, y: 0, w: 220, h: 110, text: 'Main topic', color: '#D8C8FF' });
      const pos = [[-340, -200], [340, -200], [-340, 200], [340, 200]];
      pos.forEach(([x, y], i) => { const b = add({ type: 'rect', x: x + 20, y: y + 10, w: 180, h: 90, text: `Idea ${i + 1}`, color: STICKY[i] }); arrow(c, b); });
      break;
    }
    case 'week': {
      title(0, -120, 'This week');
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach((d, i) => frame(i * 250, 0, 230, 520, d));
      note(25, 50, 'Plan for Monday', STICKY[0]);
      break;
    }
    case 'lobby': {
      // the live board on the landing page, shared by everyone visiting right now
      title(0, -110, 'Everyone here is on this board', 640);
      note(0, 0, 'Drag me around. Others see it move.', STICKY[0], 190, 170);
      note(220, 0, 'Double-tap to write something', STICKY[2], 190, 170);
      note(440, 0, 'Say hi to whoever is here 👋', STICKY[4], 190, 170);
      const a = add({ type: 'rect', x: 40, y: 250, w: 170, h: 84, text: 'An idea', color: '#FFFFFF' });
      const b = add({ type: 'ellipse', x: 420, y: 245, w: 180, h: 94, text: 'A plan', color: '#B9DCFF' });
      arrow(a, b);
      break;
    }
    default: break;
  }
  return out;
}
