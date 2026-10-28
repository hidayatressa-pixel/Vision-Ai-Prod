import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const checks = [];

function check(name, condition, detail) {
  if (!condition) {
    console.error(`FAIL  ${name}: ${detail}`);
    process.exitCode = 1;
    return;
  }
  checks.push(name);
  console.log(`PASS  ${name}`);
}

const yolo = read('../src/vision/yoloEngine.ts');
const rules = read('../src/vision/ruleEngine.ts');
const pipeline = read('../src/hooks/useInspectionPipeline.ts');
const db = read('../src/services/db.ts');
const seed = read('../src/services/sampleData.ts');
const internalAdapter = read('../src/services/storage/InternalServerStorageAdapter.ts');
const packageJson = JSON.parse(read('../package.json'));

check(
  'YOLO preprocessing preserves aspect ratio',
  yolo.includes('const scale = Math.min(size / frame.width, size / frame.height)') &&
    yolo.includes("context.fillStyle = 'rgb(114, 114, 114)'") &&
    yolo.includes('(cx - transform.padX) / transform.scale'),
  'Inference must use letterboxing and map output boxes back to the original frame.'
);

check(
  'YOLO ROI association is one-to-one',
  yolo.includes('Greedy one-to-one assignment') &&
    yolo.includes('usedDetections.has(pair.detectionIndex)') &&
    yolo.includes('associationRadiusPx'),
  'A single detection must not satisfy multiple required ROIs.'
);

check(
  'Shifted detections can fail position tolerance',
  yolo.includes('status: withinTolerance ? \'PASS\' : \'FAIL\'') &&
    yolo.includes('Position Out of Tolerance'),
  'Class-matched detections outside tolerance must not be silently accepted.'
);

check(
  'Ambiguous required ROI evidence is not OK',
  rules.includes('hasUncertainRequiredRoi') &&
    rules.includes("judgement: 'INVALID'"),
  'Insufficient vision evidence for a required ROI must not produce OK.'
);

check(
  'Rule engine is part of the live inspection path',
  pipeline.includes('ruleEngine.evaluate') &&
    pipeline.includes('saveInspectionRecord'),
  'Live inspection must evaluate deterministic rules and persist the result.'
);

check(
  'IndexedDB is the local-first persistence layer',
  db.includes("indexedDB.open(MASTER_DB_NAME, MASTER_DB_VERSION)") &&
    db.includes('await this.saveLocalHistory(localRecord)') &&
    db.includes("VITE_ENABLE_SUPABASE_SYNC === 'true'"),
  'Local persistence must precede optional cloud sync.'
);

check(
  'Example seeding preserves existing master revisions',
  seed.includes('Preserve product ID, metadata, revision IDs, and historical revisions') &&
    seed.includes('revisions: source.revisions') &&
    !seed.includes('dbService.deleteMaster('),
  'Seed initialization must not delete masters or collapse revision history.'
);

check(
  'Internal server adapter remains a no-network stub',
  internalAdapter.includes('No network requests are made') &&
    !/\bfetch\s*\(/.test(internalAdapter),
  'Do not guess the company API endpoint or send unapproved requests.'
);

check(
  'Architecture audit is registered in package scripts',
  packageJson.scripts['audit:vision-architecture'] === 'node scripts/vision-architecture-audit.mjs',
  'The architecture audit must be runnable in CI.'
);

assert.equal(checks.length, 9);
if (process.exitCode) process.exit(process.exitCode);
console.log(`Vision architecture contract audit passed: ${checks.length} checks.`);
