import { InspectionROI, MasterProduct, ReferenceImage } from '../types/master';

const MASTER_ASSET_BASE = `${import.meta.env.BASE_URL}master/reflector-assy-hl-gjra`;
const BUILT_IN_MASTER_IMAGE = `${MASTER_ASSET_BASE}/Master.jpeg`;
const BUILT_IN_REFERENCE_IMAGES = Array.from({ length: 8 }, (_, index) => {
  const fileName = index === 0 ? 'Ref%201.jpeg' : `ref%20${index + 1}.jpeg`;
  return `${MASTER_ASSET_BASE}/${fileName}`;
});

// Actual reflector layout from the production photo:
// 4 screws across the upper brackets, 2 screws in the center, 2 screws below.
// The Master Setup editor remains the final calibration authority; these are
// only the initial seed positions and can be dragged to the exact master image.
const eightScrewROIs: InspectionROI[] = [
  [0.30, 0.3333], [0.43, 0.3333], [0.57, 0.3333], [0.70, 0.3333],
  [0.38, 0.4667], [0.62, 0.4667],
  [0.42, 0.7000], [0.58, 0.7000],
].map(([x, y], index) => ({
  id: `roi-screw-${index + 1}`,
  name: `Screw #${index + 1}`,
  objectType: 'screw',
  x, y,
  radius: 0.04,
  toleranceRadius: 0.035,
  minConfidence: 0.65,
  isRequired: true,
}));

const anchors = [
  { id: 'anchor-A', name: 'Anchor A (Top-Left)', x: 0.25, y: 0.2667, searchRadius: 0.12, patchRadius: 24, description: 'Alignment fiducial A' },
  { id: 'anchor-B', name: 'Anchor B (Top-Right)', x: 0.75, y: 0.2667, searchRadius: 0.12, patchRadius: 24, description: 'Alignment fiducial B' },
  { id: 'anchor-C', name: 'Anchor C (Bottom-Left)', x: 0.25, y: 0.7333, searchRadius: 0.12, patchRadius: 24, description: 'Alignment fiducial C' },
  { id: 'anchor-D', name: 'Anchor D (Bottom-Right)', x: 0.75, y: 0.7333, searchRadius: 0.12, patchRadius: 24, description: 'Alignment fiducial D' },
];

const referenceImages: ReferenceImage[] = Array.from({ length: 8 }, (_, index) => ({
  id: `ref-${index + 1}`,
  label: `Reference ${index + 1}`,
  roiId: eightScrewROIs[index].id,
  imageUrl: BUILT_IN_REFERENCE_IMAGES[index],
  description: 'Built-in Production golden reference.'
}));

export const SEED_PRODUCT_A: MasterProduct = {
  id: 'prd-reflector-assy-hl-gjra',
  productCode: 'PRD-REFLECTOR-ASSY-HL-GJRA',
  productName: 'Reflector Assy HL GJRA',
  description: 'Production inspection master for an 8-screw assembly.',
  activeRevisionId: 'rev-01-8screw',
  isActive: true,
  createdAt: '2026-10-05T08:00:00Z',
  updatedAt: '2026-10-05T08:00:00Z',
  createdBy: 'System',
  revisions: [{
    id: 'rev-01-8screw',
    masterId: 'prd-reflector-assy-hl-gjra',
    revisionCode: 'REV-01',
    revisionNote: 'Initial production configuration · 8 screws',
    expectedObjectCount: 8,
    // Dimensions are populated from the actual uploaded master image.
    // Do not use a synthetic 800x600 calibration canvas.
    masterWidth: 0,
    masterHeight: 0,
    masterImageUrl: BUILT_IN_MASTER_IMAGE,
    detectionZone: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
    anchors: anchors.map((anchor) => ({ ...anchor })),
    inspectionROIs: eightScrewROIs.map((roi) => ({ ...roi })),
    referenceImages: referenceImages.map((reference) => ({ ...reference })),
    tolerance: {
      maxPositionOffsetMm: 2.5,
      maxPositionOffsetPx: 25,
      maxRotationToleranceDeg: 12,
      minAlignmentConfidence: 0.6,
      minScrewConfidence: 0.65,
      stabilizationDelayMs: 500,
      stabilizationMotionThreshold: 8,
      partRemovalThreshold: 12,
      detectionZonePresenceThreshold: 18,
    },
    createdAt: '2026-10-05T08:00:00Z',
    updatedAt: '2026-10-05T08:00:00Z',
    createdBy: 'System',
  }],
};

const getImageDimensions = (imageUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    if (!imageUrl) {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = imageUrl;
  });

export async function initSeedDataIfEmpty() {
  const { dbService } = await import('./db');
  const existing = await dbService.getAllMasters();

  const isReflector = (master: MasterProduct) => {
    const name = (master.productName || '').trim().toLowerCase();
    const code = (master.productCode || '').trim().toLowerCase();
    return (
      master.id === SEED_PRODUCT_A.id ||
      name === SEED_PRODUCT_A.productName.toLowerCase() ||
      code === SEED_PRODUCT_A.productCode.toLowerCase() ||
      code.includes('reflector-assy-hl-gjra') ||
      name.includes('reflector assy hl gjra')
    );
  };

  const reflectorMasters = existing.filter(isReflector);
  if (reflectorMasters.length === 0) {
    // Seed only when no example exists. Never delete or overwrite user products.
    await dbService.saveMaster(SEED_PRODUCT_A);
    return;
  }

  const completeness = (master: MasterProduct) => {
    const revision =
      master.revisions.find((item) => item.id === master.activeRevisionId) ||
      master.revisions[0];
    if (!revision) return 0;
    return (
      (revision.masterImageUrl ? 1000 : 0) +
      (revision.referenceImages?.filter((item) => Boolean(item.imageUrl)).length || 0) * 100 +
      (revision.anchors?.length === 4 ? 20 : 0) +
      (revision.inspectionROIs?.length === 8 ? 20 : 0)
    );
  };

  // Choose the most complete existing example, but preserve its identity and
  // every revision. Inspection history may reference these IDs.
  const source = [...reflectorMasters].sort((a, b) => {
    const scoreDiff = completeness(b) - completeness(a);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b.id === SEED_PRODUCT_A.id) - Number(a.id === SEED_PRODUCT_A.id);
  })[0];

  const currentRevision =
    source.revisions.find((item) => item.id === source.activeRevisionId) ||
    source.revisions[0];

  let revisions = source.revisions;
  let activeRevisionId = currentRevision?.id || source.activeRevisionId;

  if (!currentRevision) {
    const seedRevision = SEED_PRODUCT_A.revisions[0];
    const revisionId = activeRevisionId || `rev-seed-${source.id}`;
    revisions = [{
      ...seedRevision,
      id: revisionId,
      masterId: source.id,
      anchors: seedRevision.anchors.map((item) => ({ ...item })),
      inspectionROIs: seedRevision.inspectionROIs.map((item) => ({ ...item })),
      referenceImages: seedRevision.referenceImages.map((item) => ({ ...item })),
    }];
    activeRevisionId = revisionId;
  } else {
    const needsImageDimensions =
      !currentRevision.masterWidth || !currentRevision.masterHeight;
    const resolvedMasterImageUrl =
      currentRevision.masterImageUrl?.trim() || BUILT_IN_MASTER_IMAGE;
    const nativeDimensions = needsImageDimensions
      ? await getImageDimensions(resolvedMasterImageUrl)
      : { width: currentRevision.masterWidth, height: currentRevision.masterHeight };

    const isActiveExampleRevision = (revision: MasterRevision) =>
      revision.id === currentRevision.id;

    revisions = source.revisions.map((revision) => {
      if (!isActiveExampleRevision(revision)) return revision;

      const inspectionROIs = revision.inspectionROIs?.length
        ? revision.inspectionROIs
        : SEED_PRODUCT_A.revisions[0].inspectionROIs.map((item) => ({ ...item }));

      const anchors = revision.anchors?.length
        ? revision.anchors
        : SEED_PRODUCT_A.revisions[0].anchors.map((item) => ({ ...item }));

      // Built-in golden images are used only when the existing example has no
      // references at all and still has the original eight screw ROIs. Partial
      // or custom reference sets are left untouched.
      const isEightScrewExample =
        inspectionROIs.length === 8 &&
        inspectionROIs.every((roi) => roi.objectType === 'screw');
      const referenceImages = revision.referenceImages?.length
        ? revision.referenceImages
        : isEightScrewExample
          ? SEED_PRODUCT_A.revisions[0].referenceImages.map((item, index) => ({
              ...item,
              roiId: inspectionROIs[index]?.id || item.roiId,
            }))
          : [];

      return {
        ...revision,
        masterId: source.id,
        masterImageUrl: resolvedMasterImageUrl,
        masterWidth: nativeDimensions.width || revision.masterWidth || 0,
        masterHeight: nativeDimensions.height || revision.masterHeight || 0,
        inspectionROIs,
        anchors,
        referenceImages,
        expectedObjectCount: Number.isInteger(revision.expectedObjectCount) &&
          revision.expectedObjectCount > 0
          ? revision.expectedObjectCount
          : inspectionROIs.filter((roi) => roi.isRequired).length,
        detectionZone: revision.detectionZone || SEED_PRODUCT_A.revisions[0].detectionZone,
        tolerance: revision.tolerance || SEED_PRODUCT_A.revisions[0].tolerance,
      };
    });
  }

  const updatedMaster: MasterProduct = {
    ...source,
    // Preserve product ID, metadata, revision IDs, and historical revisions.
    activeRevisionId,
    revisions,
  };

  if (JSON.stringify(updatedMaster) !== JSON.stringify(source)) {
    await dbService.saveMaster(updatedMaster);
  }

  // Do not delete, rename, or rewrite any other master records during seeding.
}