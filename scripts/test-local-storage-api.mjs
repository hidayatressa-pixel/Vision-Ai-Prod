import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'vision-storage-api-'));
const token = 'test-token-' + 'a'.repeat(64);
const portServer = createServer();
await new Promise((resolve, reject) => {
  portServer.once('error', reject);
  portServer.listen(0, '127.0.0.1', resolve);
});
const port = portServer.address().port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

const child = spawn(process.execPath, ['server/local-storage-server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    VISION_SERVER_HOST: '127.0.0.1',
    VISION_SERVER_PORT: String(port),
    VISION_SERVER_TOKEN: token,
    VISION_SERVER_DATA_FILE: join(temporaryDirectory, 'store.json'),
    VISION_CORS_ORIGINS: 'http://localhost:3000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

const baseUrl = `http://127.0.0.1:${port}/api`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`API server exited early: ${childOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`, { headers });
      if (response.ok) return;
    } catch { /* Server may still be starting. */ }
    await delay(100);
  }
  throw new Error(`API server did not become ready: ${childOutput}`);
}

try {
  await waitForServer();

  const unauthorized = await fetch(`${baseUrl}/health`);
  assert.equal(unauthorized.status, 401, 'API must reject requests without a token');

  const health = await fetch(`${baseUrl}/health`, { headers });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const master = { id: 'master-test-1', productCode: 'TEST-01', productName: 'Test master' };
  const saveMaster = await fetch(`${baseUrl}/masters`, { method: 'POST', headers, body: JSON.stringify(master) });
  assert.equal(saveMaster.status, 200);
  const masters = await fetch(`${baseUrl}/masters`, { headers });
  assert.deepEqual(await masters.json(), [master]);

  const inspection = { id: 'inspection-test-1', timestamp: '2026-01-01T00:00:00.000Z', judgement: 'OK' };
  const saveInspection = await fetch(`${baseUrl}/inspections`, { method: 'POST', headers, body: JSON.stringify(inspection) });
  assert.equal(saveInspection.status, 200);
  const inspections = await fetch(`${baseUrl}/inspections?limit=10`, { headers });
  assert.deepEqual(await inspections.json(), [inspection]);

  const migration = await fetch(`${baseUrl}/migrate`, {
    method: 'POST', headers, body: JSON.stringify({ masters: [master], inspections: [inspection] }),
  });
  assert.equal(migration.status, 200, 'Identical records should make migration idempotent');

  const conflict = await fetch(`${baseUrl}/migrate`, {
    method: 'POST', headers, body: JSON.stringify({
      masters: [{ ...master, productName: 'Different name must not overwrite' }],
      inspections: [],
    }),
  });
  assert.equal(conflict.status, 409, 'Conflicting IDs must be rejected');
  const afterConflict = await fetch(`${baseUrl}/masters`, { headers });
  assert.equal((await afterConflict.json())[0].productName, 'Test master');

  const clearHistory = await fetch(`${baseUrl}/inspections`, { method: 'DELETE', headers });
  assert.equal(clearHistory.status, 204);
  const deleteMaster = await fetch(`${baseUrl}/masters/master-test-1`, { method: 'DELETE', headers });
  assert.equal(deleteMaster.status, 204);

  console.log('Local storage API integration test passed: auth, master/history CRUD, idempotent migration, and conflict protection.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
