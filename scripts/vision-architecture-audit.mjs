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
const storageSettings = read('../src/components/settings/StorageServerSettings.tsx');
const settingsView = read('../src/components/settings/SettingsView.tsx');
const app = read('../src/App.tsx');
const pinGate = read('../src/components/auth/EngineeringPinGate.tsx');
const readme = read('../README.md');
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
  'YOLO position tolerance scales from master to camera resolution',
  yolo.includes('scaledMaxPositionOffsetPx') &&
    pipeline.includes('revision.masterWidth,\n                revision.masterHeight'),
  'Pixel and millimeter offsets must remain calibrated when camera resolution differs from the master image.'
);

check(
  'Ambiguous required ROI evidence is not OK',
  rules.includes('hasUncertainRequiredRoi') &&
    rules.includes("judgement: 'INVALID'"),
  'Insufficient vision evidence for a required ROI must not produce OK.'
);

check(
  'YOLO class support is explicit and missing parts are distinguishable',
  yolo.includes('supportsClass(className: string)') &&
    yolo.includes('const classSupported =') &&
    yolo.includes("evidence: 'ABSENT'") &&
    yolo.includes("evidence: 'UNCERTAIN'"),
  'A supported class with no ROI detection is different from a class the model cannot recognize.'
);

check(
  'Rule engine is part of the live inspection path',
  pipeline.includes('ruleEngine.evaluate') &&
    pipeline.includes('saveInspectionRecord'),
  'Live inspection must evaluate deterministic rules and persist the result.'
);

check(
  'Required ROI counts and abnormal-position counts are consistent',
  rules.includes('const requiredROIs') &&
    rules.includes('invalidRequiredCount') &&
    rules.includes('presentRequiredCount++') &&
    !rules.includes('presentScrewCount'),
  'Only required ROIs affect expected counts; a shifted present component must not also be counted as missing.'
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
    seed.includes('let revisions = source.revisions;') &&
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
  'Storage target menu does not pretend the internal server is active',
  storageSettings.includes('STORAGE_CONFIG_KEY') &&
    storageSettings.includes('Active persistence: IndexedDB (this station)') &&
    storageSettings.includes('Save configuration draft') &&
    !/\\bfetch\\s*\\(/.test(storageSettings) &&
    settingsView.includes("tab: 'STORAGE_SETUP'") &&
    app.includes('<StorageServerSettings'),
  'The UI may save a server profile, but must keep IndexedDB active until the approved internal API adapter is implemented.'
);

check(
  'Engineering PIN is not represented as production authentication',
  pinGate.includes('not production authentication') &&
    readme.includes('can be inspected or bypassed') &&
    readme.includes('not production authentication'),
  'A client-side PIN gate is only a UI convenience; production access needs managed authentication.'
);

check(
  'Architecture audit is registered in package scripts',
  packageJson.scripts['audit:vision-architecture'] === 'node scripts/vision-architecture-audit.mjs',
  'The architecture audit must be runnable in CI.'
);

assert.equal(checks.length, 14);
if (process.exitCode) process.exit(process.exitCode);
console.log(`Vision architecture contract audit passed: ${checks.length} checks.`);
