import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const HOST = process.env.VISION_SERVER_HOST || '0.0.0.0';
const PORT = Number(process.env.VISION_SERVER_PORT || 8787);
const DATA_FILE = resolve(process.env.VISION_SERVER_DATA_FILE || './data/vision-store.json');
const ACCESS_TOKEN = process.env.VISION_SERVER_TOKEN || '';
const ALLOWED_ORIGINS = new Set((process.env.VISION_CORS_ORIGINS || 'http://localhost:3000,http://localhost:4173').split(',').map((value) => value.trim()).filter(Boolean));
const MAX_BODY_BYTES = 25 * 1024 * 1024;

if (ACCESS_TOKEN.length < 32) {
  console.error('VISION_SERVER_TOKEN must be set to a random secret of at least 32 characters.');
  process.exit(1);
}

let store = { schemaVersion: 1, masters: [], inspections: [], updatedAt: new Date().toISOString() };
let writeQueue = Promise.resolve();
let mutationQueue = Promise.resolve();

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.masters) || !Array.isArray(parsed.inspections)) {
      throw new Error('Stored database has an unsupported schema.');
    }
    store = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await persistStore(store);
  }
}

async function persistStore(nextStore) {
  const snapshot = JSON.stringify({ ...nextStore, updatedAt: new Date().toISOString() });
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    const temporary = `${DATA_FILE}.tmp`;
    await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, DATA_FILE);
  });
  await writeQueue;
}

async function updateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const next = mutator(store);
    await persistStore(next);
    store = next;
    return next;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

function equalToken(candidate) {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ACCESS_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Request body exceeds 25 MB.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}

function upsertById(existing, incoming) {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      throw Object.assign(new Error('Every stored record must have a non-empty string id.'), { statusCode: 400 });
    }
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function mergeMigrationRecords(existing, incoming) {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const additions = [];
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      throw Object.assign(new Error('Every migrated record must have a non-empty string id.'), { statusCode: 400 });
    }
    const current = existingById.get(item.id);
    if (current && JSON.stringify(current) !== JSON.stringify(item)) {
      throw Object.assign(new Error(`Migration conflict for id "${item.id}". Existing server data was not overwritten.`), { statusCode: 409 });
    }
    if (!current) {
      existingById.set(item.id, item);
      additions.push(item);
    }
  }
  return [...existing, ...additions];
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Vision-Station');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  if (path === '/health' && req.method === 'GET') {
    if (!equalToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) {
      send(res, 401, { error: 'Unauthorized' }); return;
    }
    send(res, 200, { ok: true, service: 'vision-local-storage', version: '1.0.0' }); return;
  }

  if (!equalToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) {
    send(res, 401, { error: 'Unauthorized' }); return;
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { error: 'Origin is not allowed. Configure VISION_CORS_ORIGINS.' }); return;
  }

  try {
    if (path === '/masters' && req.method === 'GET') {
      send(res, 200, store.masters); return;
    }
    if (path === '/masters' && req.method === 'POST') {
      const master = await readJson(req);
      if (!master || typeof master.id !== 'string' || !master.id.trim()) { send(res, 400, { error: 'Master id is required.' }); return; }
      await updateStore((current) => ({ ...current, masters: upsertById(current.masters, [master]) }));
      send(res, 200, { ok: true }); return;
    }
    if (path.startsWith('/masters/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/masters/'.length));
      await updateStore((current) => ({ ...current, masters: current.masters.filter((master) => master.id !== id) }));
      send(res, 204); return;
    }
    if (path === '/inspections' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 500), 5000));
      send(res, 200, [...store.inspections].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit)); return;
    }
    if (path === '/inspections' && req.method === 'POST') {
      const record = await readJson(req);
      if (!record || typeof record.id !== 'string' || !record.id.trim()) { send(res, 400, { error: 'Inspection id is required.' }); return; }
      await updateStore((current) => ({ ...current, inspections: upsertById(current.inspections, [record]) }));
      send(res, 200, { ok: true }); return;
    }
    if (path === '/inspections' && req.method === 'DELETE') {
      await updateStore((current) => ({ ...current, inspections: [] }));
      send(res, 204); return;
    }
    if (path === '/migrate' && req.method === 'POST') {
      const snapshot = await readJson(req);
      if (!snapshot || !Array.isArray(snapshot.masters) || !Array.isArray(snapshot.inspections)) {
        send(res, 400, { error: 'Migration payload must contain masters and inspections arrays.' }); return;
      }
      await updateStore((current) => ({
        ...current,
        masters: mergeMigrationRecords(current.masters, snapshot.masters),
        inspections: mergeMigrationRecords(current.inspections, snapshot.inspections),
      }));
      send(res, 200, { mastersImported: snapshot.masters.length, inspectionsImported: snapshot.inspections.length }); return;
    }
    send(res, 404, { error: 'Route not found.' });
  } catch (error) {
    send(res, error.statusCode || 500, { error: error.message || 'Internal server error.' });
  }
});

await loadStore();
server.listen(PORT, HOST, () => {
  console.log(`Vision local storage API listening on http://${HOST}:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
