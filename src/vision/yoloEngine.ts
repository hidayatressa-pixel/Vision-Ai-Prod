/**
 * Optional browser-side YOLO ONNX adapter.
 *
 * YOLO is supporting evidence only. The deterministic rule engine remains the
 * final OK/NG/INVALID authority. Supply a compatible YOLOv8-style ONNX model
 * through VITE_YOLO_MODEL_URL; no model weights are bundled in this repository.
 */
import * as ort from 'onnxruntime-web';
import type { InspectionROI, ToleranceConfig } from '../types/master';
import type { ROIInspectionResult } from '../types/inspection';

export interface YoloDetection {
  classId: number;
  label: string;
  confidence: number;
  /** Normalized center and dimensions, relative to the original frame. */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface YoloConfig {
  modelUrl: string;
  inputSize: number;
  confidenceThreshold: number;
  iouThreshold: number;
  labels: string[];
  screwClassNames: string[];
}

const DEFAULT_INPUT_SIZE = 640;
let sessionPromise: Promise<ort.InferenceSession> | null = null;

function readConfig(): YoloConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    modelUrl: (env.VITE_YOLO_MODEL_URL || '').trim(),
    inputSize: Number(env.VITE_YOLO_INPUT_SIZE) || DEFAULT_INPUT_SIZE,
    confidenceThreshold: Math.min(1, Math.max(0, Number(env.VITE_YOLO_CONFIDENCE) || 0.35)),
    iouThreshold: Math.min(1, Math.max(0, Number(env.VITE_YOLO_IOU) || 0.45)),
    labels: (env.VITE_YOLO_CLASS_NAMES || '').split(',').map((item) => item.trim()).filter(Boolean),
    screwClassNames: (env.VITE_YOLO_SCREW_CLASS_NAMES || 'screw,fastener,bolt').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
  };
}

async function getSession(config: YoloConfig): Promise<ort.InferenceSession> {
  if (!config.modelUrl) throw new Error('YOLO model URL is not configured.');
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // Prefer WebGPU when available, then retry with the portable WASM provider.
      try {
        return await ort.InferenceSession.create(config.modelUrl, {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
        });
      } catch {
        return ort.InferenceSession.create(config.modelUrl, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
      }
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

interface LetterboxTransform {
  scale: number;
  padX: number;
  padY: number;
}

/**
 * Applies YOLO's standard aspect-ratio-preserving letterbox preprocessing.
 * The transform is returned so model-space boxes can be mapped back to the
 * original camera frame without coordinate drift.
 */
function makeInput(
  frame: ImageData,
  size: number
): { data: Float32Array; transform: LetterboxTransform } {
  if (frame.width <= 0 || frame.height <= 0) {
    throw new Error('YOLO input frame has invalid dimensions.');
  }

  const scale = Math.min(size / frame.width, size / frame.height);
  const resizedWidth = Math.max(1, Math.round(frame.width * scale));
  const resizedHeight = Math.max(1, Math.round(frame.height * scale));
  const padX = Math.floor((size - resizedWidth) / 2);
  const padY = Math.floor((size - resizedHeight) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context is unavailable for YOLO preprocessing.');

  const source = document.createElement('canvas');
  source.width = frame.width;
  source.height = frame.height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('Canvas 2D context is unavailable for YOLO input.');

  sourceContext.putImageData(frame, 0, 0);
  context.fillStyle = 'rgb(114, 114, 114)';
  context.fillRect(0, 0, size, size);
  context.drawImage(source, padX, padY, resizedWidth, resizedHeight);

  const pixels = context.getImageData(0, 0, size, size).data;
  const plane = size * size;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = pixels[i * 4] / 255;
    data[plane + i] = pixels[i * 4 + 1] / 255;
    data[2 * plane + i] = pixels[i * 4 + 2] / 255;
  }

  return { data, transform: { scale, padX, padY } };
}

function intersectionOverUnion(a: YoloDetection, b: YoloDetection): number {
  const ax1 = a.x - a.width / 2, ay1 = a.y - a.height / 2;
  const ax2 = a.x + a.width / 2, ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2, by1 = b.y - b.height / 2;
  const bx2 = b.x + b.width / 2, by2 = b.y + b.height / 2;
  const intersection = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1)) *
    Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Parses standard YOLOv8 detect output and maps letterboxed boxes to frame coordinates. */
function parseOutput(
  data: Float32Array,
  dims: readonly number[],
  frame: ImageData,
  config: YoloConfig,
  transform: LetterboxTransform
): YoloDetection[] {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`Unsupported YOLO output shape: [${dims.join(', ')}]. Expected a batch-1 YOLOv8 detection tensor.`);
  }

  const channelFirst = dims[1] <= 256 && dims[2] > dims[1];
  const channels = channelFirst ? dims[1] : dims[2];
  const candidates = channelFirst ? dims[2] : dims[1];
  if (channels < 5) {
    throw new Error('YOLO output must contain box coordinates and at least one class score.');
  }

  const at = (candidate: number, channel: number) =>
    channelFirst ? data[channel * candidates + candidate] : data[candidate * channels + channel];

  const results: YoloDetection[] = [];
  for (let i = 0; i < candidates; i++) {
    let classId = 0;
    let confidence = -Infinity;
    for (let cls = 4; cls < channels; cls++) {
      const score = at(i, cls);
      if (score > confidence) {
        confidence = score;
        classId = cls - 4;
      }
    }
    if (!Number.isFinite(confidence) || confidence < config.confidenceThreshold) continue;

    const cx = at(i, 0);
    const cy = at(i, 1);
    const width = Math.abs(at(i, 2));
    const height = Math.abs(at(i, 3));
    if (![cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;

    // ONNX raw YOLOv8 coordinates are in letterboxed input pixels.
    const centerX = (cx - transform.padX) / transform.scale;
    const centerY = (cy - transform.padY) / transform.scale;
    const boxWidth = width / transform.scale;
    const boxHeight = height / transform.scale;

    results.push({
      classId,
      label: config.labels[classId] || `class-${classId}`,
      confidence,
      x: Math.min(1, Math.max(0, centerX / frame.width)),
      y: Math.min(1, Math.max(0, centerY / frame.height)),
      width: Math.min(1, Math.max(0, boxWidth / frame.width)),
      height: Math.min(1, Math.max(0, boxHeight / frame.height)),
    });
  }

  const selected: YoloDetection[] = [];
  results.sort((a, b) => b.confidence - a.confidence);
  for (const candidate of results) {
    if (selected.some((kept) =>
      kept.classId === candidate.classId &&
      intersectionOverUnion(kept, candidate) > config.iouThreshold
    )) continue;
    selected.push(candidate);
    if (selected.length >= 300) break;
  }
  return selected;
}

export const yoloEngine = {
  isConfigured(): boolean {
    return Boolean(readConfig().modelUrl);
  },

  async detect(frame: ImageData): Promise<YoloDetection[]> {
    const config = readConfig();
    if (!config.modelUrl) return [];
    const session = await getSession(config);
    const inputName = session.inputNames[0];
    if (!inputName) throw new Error('YOLO ONNX model has no input tensor.');
    const prepared = makeInput(frame, config.inputSize);
    const tensor = new ort.Tensor('float32', prepared.data, [1, 3, config.inputSize, config.inputSize]);
    const output = await session.run({ [inputName]: tensor });
    const outputName = session.outputNames[0];
    const result = outputName ? output[outputName] : undefined;
    if (!result || !(result instanceof ort.Tensor) || !(result.data instanceof Float32Array)) {
      throw new Error('YOLO ONNX output is missing or is not a float32 detection tensor.');
    }
    return parseOutput(result.data, result.dims, frame, config, prepared.transform);
  },
};

/**
 * YOLO may only recover a classical detector's ABSENT/UNCERTAIN ROI when a
 * matching class detection lies inside that engineer-defined ROI tolerance.
 * It cannot create a new ROI, expand a boundary, or decide final judgement.
 */
export function applyYoloSupportingEvidence(
  results: ROIInspectionResult[],
  detections: YoloDetection[],
  rois: InspectionROI[],
  tolerance: ToleranceConfig,
  frameWidth: number,
  frameHeight: number
): ROIInspectionResult[] {
  if (frameWidth <= 0 || frameHeight <= 0) return results;

  const defaultScrewLabels = new Set(readConfig().screwClassNames);
  const frameScale = Math.min(frameWidth, frameHeight);
  const byId = new Map(rois.map((roi) => [roi.id, roi]));

  type CandidatePair = {
    resultIndex: number;
    detectionIndex: number;
    distancePx: number;
    toleranceRadiusPx: number;
  };

  const pairs: CandidatePair[] = [];
  results.forEach((result, resultIndex) => {
    const roi = byId.get(result.roiId);
    if (!roi?.isRequired) return;

    const expectedClass = (roi.objectClass || roi.objectType).trim().toLowerCase();
    const allowedLabels = new Set([expectedClass]);
    if (roi.objectType === 'screw' || defaultScrewLabels.has(expectedClass)) {
      defaultScrewLabels.forEach((label) => allowedLabels.add(label));
    }

    const toleranceRadiusPx = Math.max(
      roi.toleranceRadius * frameScale,
      tolerance.maxPositionOffsetPx
    );
    // Search beyond the pass tolerance so a shifted object can be identified
    // as present-but-abnormal instead of silently becoming "missing".
    const associationRadiusPx = Math.max(
      toleranceRadiusPx * 3,
      roi.radius * frameScale * 2,
      40
    );

    detections.forEach((detection, detectionIndex) => {
      if (
        !allowedLabels.has(detection.label.trim().toLowerCase()) ||
        detection.confidence < (roi.minConfidence ?? tolerance.minScrewConfidence)
      ) return;

      const distancePx = Math.hypot(
        (detection.x - result.expectedTransformedPosition.x) * frameWidth,
        (detection.y - result.expectedTransformedPosition.y) * frameHeight
      );
      if (distancePx <= associationRadiusPx) {
        pairs.push({ resultIndex, detectionIndex, distancePx, toleranceRadiusPx });
      }
    });
  });

  // Greedy one-to-one assignment: one detection cannot satisfy multiple ROIs.
  // Closest ROI/detection pairs are assigned first; confidence breaks ties.
  pairs.sort((a, b) =>
    a.distancePx - b.distancePx ||
    detections[b.detectionIndex].confidence - detections[a.detectionIndex].confidence
  );
  const assignedByResult = new Map<number, CandidatePair>();
  const usedDetections = new Set<number>();
  for (const pair of pairs) {
    if (assignedByResult.has(pair.resultIndex) || usedDetections.has(pair.detectionIndex)) continue;
    assignedByResult.set(pair.resultIndex, pair);
    usedDetections.add(pair.detectionIndex);
  }

  return results.map((result, resultIndex) => {
    const roi = byId.get(result.roiId);
    if (!roi?.isRequired) return result;

    const pair = assignedByResult.get(resultIndex);
    if (!pair) {
      // Non-screw classes require class-aware evidence. A lack of detection is
      // inconclusive, not proof of absence; let the rule engine report INVALID
      // / uncertainty according to its configured policy.
      if (roi.objectType !== 'screw') {
        const expectedClass = (roi.objectClass || roi.objectType).trim();
        return {
          ...result,
          isPresent: false,
          evidence: 'UNCERTAIN',
          status: 'WARNING',
          confidence: 0,
          failureReason: `YOLO did not confirm class "${expectedClass}" in ${roi.name}`,
        };
      }
      return result;
    }

    const detection = detections[pair.detectionIndex];
    const withinTolerance = pair.distancePx <= pair.toleranceRadiusPx;

    // Preserve the classical screw measurement when it already found a
    // plausible in-tolerance screw. YOLO can recover an uncertain/missing
    // screw, or identify a class-matched screw shifted outside tolerance.
    if (
      roi.objectType === 'screw' &&
      (result.isPresent || result.evidence === 'PRESENT') &&
      withinTolerance
    ) {
      return result;
    }

    return {
      ...result,
      actualDetectedPosition: { x: detection.x, y: detection.y },
      positionOffsetPx: Math.round(pair.distancePx * 10) / 10,
      positionOffsetMm: Math.round(
        (pair.distancePx / Math.max(1, tolerance.maxPositionOffsetPx)) *
        tolerance.maxPositionOffsetMm * 100
      ) / 100,
      isWithinTolerance: withinTolerance,
      confidence: Math.round(detection.confidence * 100) / 100,
      isPresent: true,
      evidence: 'PRESENT',
      status: withinTolerance ? 'PASS' : 'FAIL',
      failureReason: withinTolerance ? undefined : `${roi.name} Position Out of Tolerance`,
    };
  });
}
