// Local test server whose "AI" is a fake, for UI checks without a Gemini key. Not used in production.
import { createServer } from 'node:http';
import { createApp } from './src/app.js';
import { memoryStore } from './src/db/memory.js';
const fake = async (prompt: string) => {
  if (prompt.includes('organise sticky notes')) {
    const ids = Array.from(prompt.matchAll(/^(\S+): /gm)).map((m) => m[1]);
    const h = Math.ceil(ids.length / 2);
    return { groups: [{ title: 'Quick wins', ids: ids.slice(0, h) }, { title: 'Bigger bets', ids: ids.slice(h) }] };
  }
  if (prompt.includes('Summarise')) return { title: 'What we agreed', points: ['Ship the board first', 'Add AI next', 'Test on phones'] };
  if (prompt.includes('flowchart')) return { nodes: [{ id: 'n1', label: 'Order placed', kind: 'start' }, { id: 'n2', label: 'Restaurant accepts?', kind: 'decision' }, { id: 'n3', label: 'Cook the food', kind: 'step' }, { id: 'n4', label: 'Rider delivers', kind: 'step' }, { id: 'n5', label: 'Refund customer', kind: 'end' }, { id: 'n6', label: 'Enjoy the meal', kind: 'end' }], edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3', label: 'Yes' }, { from: 'n2', to: 'n5', label: 'No' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n6' }] };
  return { ideas: ['Run a weekly demo', 'Invite early users', 'Track one key metric', 'Write a launch post', 'Collect feedback in-app'] };
};
const { app, rooms } = createApp(memoryStore(), { ai: fake });
const server = createServer(app); rooms.attach(server); server.listen(8787, () => console.log('fake-ai api on 8787'));
