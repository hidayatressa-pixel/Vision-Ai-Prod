import { readFileSync } from 'node:fs';

const WEIGHTS = {
  centerContrast: 0.24,
  edgeDensity: 0.27,
  circularity: 0.24,
  brightness: 0.04,
  centerBrightness: 0.03,
  ringBrightness: 0.03,
  colorR: 0.02,
  colorG: 0.02,
  colorB: 0.02,
  saturation: 0.06,
  centerTexture: 0.12,
};


const productionSource = readFileSync(new URL('../src/vision/roiInspector.ts', import.meta.url), 'utf8');
const weightBlock = productionSource.match(/function signatureSimilarity[\\s\\S]*?const weights = \\{([\\s\\S]*?)\\n  \\};/);
if (!weightBlock) {
  console.error('Could not locate production signatureSimilarity weights.');
  process.exit(1);
}
for (const [key, value] of Object.entries(WEIGHTS)) {
  const escapedKey = key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\const reference = {');
  const match = weightBlock[1].match(new RegExp('\\\\b' + escapedKey + ':\\\\s*([0-9.]+)'));
  if (!match || Number(match[1]) !== value) {
    console.error(`Recognizer weight mismatch for ${key}: audit=${value}, production=${match ? match[1] : 'missing'}`);
    process.exit(1);
  }
}
console.log('Production signature weights match audit fixture.');

const reference = {
  brightness: 0.45,
  centerBrightness: 0.20,
  ringBrightness: 0.68,
  centerContrast: 0.90,
  edgeDensity: 0.55,
  circularity: 0.72,
  colorR: 0.30,
  colorG: 0.30,
  colorB: 0.30,
  saturation: 0.22,
  centerTexture: 0.72,
};

const cases = [
  ['normal', 'PRESENT', { ...reference }],
  ['position-shift', 'PRESENT', { ...reference, brightness: 0.50, centerBrightness: 0.25 }],
  ['rotation', 'PRESENT', { ...reference, circularity: 0.68, edgeDensity: 0.52 }],
  ['bright', 'PRESENT', { ...reference, brightness: 0.68, centerBrightness: 0.45, ringBrightness: 0.82 }],
  ['dark', 'PRESENT', { ...reference, brightness: 0.25, centerBrightness: 0.10, ringBrightness: 0.50 }],
  ['faded', 'PRESENT', { ...reference, edgeDensity: 0.46, circularity: 0.65, saturation: 0.15 }],
  ['minor-defect', 'PRESENT', { ...reference, edgeDensity: 0.43, circularity: 0.60 }],
  ['smooth-hole', 'REJECT', { ...reference, centerTexture: 0.08, edgeDensity: 0.57 }],
  ['reflection', 'REJECT', { brightness: 0.55, centerBrightness: 0.52, ringBrightness: 0.60, centerContrast: 0.18, edgeDensity: 0.15, circularity: 0.22, colorR: 0.48, colorG: 0.48, colorB: 0.48, saturation: 0.05, centerTexture: 0.04 }],
  ['washer', 'REJECT', { brightness: 0.44, centerBrightness: 0.42, ringBrightness: 0.72, centerContrast: 0.66, edgeDensity: 0.35, circularity: 0.42, colorR: 0.32, colorG: 0.32, colorB: 0.32, saturation: 0.10, centerTexture: 0.08 }],
  ['blur', 'REJECT', { ...reference, edgeDensity: 0.16, circularity: 0.40, centerTexture: 0.12 }],
  ['partial-occlusion', 'REJECT', { ...reference, edgeDensity: 0.28, circularity: 0.48, centerTexture: 0.20 }],
];

function similarity(a, b) {
  let distance = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    distance += Math.abs(a[key] - b[key]) * weight;
  }
  return Math.max(0, Math.min(1, 1 - distance));
}

const threshold = 0.60;
let failures = 0;
for (const [name, expected, candidate] of cases) {
  const score = similarity(reference, candidate);
  const centerTextureDelta = Math.abs(candidate.centerTexture - reference.centerTexture);
  const accepted = score >= threshold && centerTextureDelta <= 0.35;
  const pass = expected === 'PRESENT' ? accepted : !accepted;
  console.log(name.padEnd(18), score.toFixed(3), pass ? 'PASS' : 'FAIL');
  if (!pass) failures++;
}

if (failures > 0) {
  console.error(`Adversarial signature-fixture audit failed: ${failures} case(s)`);
  process.exit(1);
}

console.log(`Adversarial signature-fixture audit passed: ${cases.length} cases`);
