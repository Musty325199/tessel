import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { memoryStore } from './db/memory.js';
import { mongoStore } from './db/mongo.js';

const db = config.mongoUri ? await mongoStore(config.mongoUri) : memoryStore();
if (!config.mongoUri) console.warn('MONGODB_URI is not set: using in-memory storage. Everything is lost on restart.');

const { app, rooms } = createApp(db);
const server = createServer(app);
rooms.attach(server);
server.listen(config.port, () => console.log(`Tessel API listening on :${config.port}`));

// save open boards before the host stops the process
async function shutdown(sig: string) {
  console.log(`${sig}: saving open boards`);
  server.close();
  await rooms.flushAll();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
