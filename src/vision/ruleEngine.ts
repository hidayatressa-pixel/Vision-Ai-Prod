/**
 * Deterministic Inspection Rule Engine
 * Evaluates counts, presence, tolerances, extra objects, and alignment.
 * Distinguishes Product NG from System/Inspection Error.
 */

import {
  AlignmentResult,
  DefectItem,
  ExtraDetectedObject,
  JudgementResult,
  ROIInspectionResult,
} from '../types/inspection';
import { MasterRevision } from '../types/master';

export interface RuleEvaluationResult {
  judgement: JudgementResult;
  primaryReason: string;
  defects: DefectItem[];
  expectedCount: number;
  detectedCount: number;
}

export class RuleEngine {
  /**
   * Deterministic evaluation of all inspection criteria
   */
  public evaluate(
    revision: MasterRevision,
    alignment: AlignmentResult,
    roiResults: ROIInspectionResult[],
    extraObjects: ExtraDetectedObject[]
  ): RuleEvaluationResult {
    const defects: DefectItem[] = [];

    // Configuration is part of inspection safety. A required screw without a
    // usable golden reference would silently fall back to geometry-only
    // detection, which is not acceptable for the production trial.
    const requiredROIs = revision.inspectionROIs.filter((roi) => roi.isRequired);
    const requiredScrewROIs = requiredROIs.filter((roi) => roi.objectType === 'screw');
    const referenceByRoi = new Map(
      revision.referenceImages
        .filter((reference) => Boolean(reference.imageUrl))
        .map((reference) => [reference.roiId || reference.id, reference])
    );
    const missingReferences = requiredScrewROIs.filter(
      (roi) => !referenceByRoi.has(roi.id)
    );
    const invalidRequiredCount =
      requiredROIs.length === 0 || revision.expectedObjectCount !== requiredROIs.length;

    if (
      revision.masterWidth <= 0 ||
      revision.masterHeight <= 0 ||
      !revision.masterImageUrl ||
      missingReferences.length > 0 ||
      invalidRequiredCount
    ) {
      const missing = missingReferences.map((roi) => roi.name).join(', ');
      const reason = [
        revision.masterWidth <= 0 || revision.masterHeight <= 0 ? 'master dimensions are not calibrated' : '',
        !revision.masterImageUrl ? 'master image is missing' : '',
        missing ? `golden reference missing for: ${missing}` : '',
        invalidRequiredCount
          ? `expected object count (${revision.expectedObjectCount}) must equal required ROI count (${requiredROIs.length})`
          : '',
      ].filter(Boolean).join('; ');

      defects.push({
        code: 'MASTER_CONFIGURATION_INVALID',
        message: `Master configuration is not trial-safe: ${reason}`,
        expected: 'Calibrated master image, references for required screw ROIs, and a consistent required ROI count',
        actual: 'Configuration incomplete or inconsistent',
      });

      return {
        judgement: 'INVALID',
        primaryReason: defects[0].message,
        defects,
        expectedCount: revision.expectedObjectCount,
        detectedCount: 0,
      };
    }

    // 1. Alignment is a prerequisite for a valid product judgement.
    // Failure to locate the reference does NOT prove the product is defective.
    // It is an INVALID inspection result; infrastructure/runtime failures are
    // handled separately by the pipeline/PLC watchdog.
    if (!alignment.success) {
      defects.push({
        code: 'ALIGNMENT_FAILED',
        message: alignment.errorMessage || 'Alignment Failed — Reference fiducials not found or confidence too low',
        expected: `${revision.anchors.length} anchors`,
        actual: `${alignment.matchedAnchorCount} anchors`,
      });

      return {
        judgement: 'INVALID',
        primaryReason: alignment.errorMessage || 'Inspection Invalid: reference fiducials could not be confirmed',
        defects,
        expectedCount: revision.expectedObjectCount,
        detectedCount: 0,
      };
    }

    // 2. Evaluate required component ROIs. Optional ROIs must not affect
    // required-part counts or create missing-part defects.
    let presentRequiredCount = 0;
    const requiredRoiIds = new Set(requiredROIs.map((roi) => roi.id));

    for (const roiResult of roiResults) {
      if (!requiredRoiIds.has(roiResult.roiId)) continue;

      if (!roiResult.isPresent) {
        if (roiResult.status === 'FAIL' && roiResult.evidence !== 'UNCERTAIN') {
          defects.push({
            code: 'MISSING_PART',
            roiId: roiResult.roiId,
            roiName: roiResult.roiName,
            message: `${roiResult.roiName} Missing`,
            expected: 'Required component present',
            actual: `Absent (confidence ${(roiResult.confidence * 100).toFixed(0)}%)`,
          });
        }
        continue;
      }

      // Count a detected component even when its position is defective. A
      // shifted component is present-but-NG, not both shifted and missing.
      presentRequiredCount++;

      if (!roiResult.isWithinTolerance) {
        defects.push({
          code: 'POSITION_OUT_OF_TOLERANCE',
          roiId: roiResult.roiId,
          roiName: roiResult.roiName,
          message: `${roiResult.roiName} Position Out of Tolerance (+${roiResult.positionOffsetMm}mm)`,
          expected: `< ${revision.tolerance.maxPositionOffsetMm}mm`,
          actual: `${roiResult.positionOffsetMm}mm (${roiResult.positionOffsetPx}px)`,
        });
      }
    }

    // 3. Extra Detected Objects Check
    if (extraObjects.length > 0) {
      for (const extra of extraObjects) {
        defects.push({
          code: 'EXTRA_OBJECT_DETECTED',
          message: `Extra Object/Screw Detected (Confidence ${(extra.confidence * 100).toFixed(0)}%)`,
          expected: 'No extra objects',
          actual: `Detected at (${(extra.position.x * 100).toFixed(1)}%, ${(extra.position.y * 100).toFixed(1)}%)`,
        });
      }
    }

    // 4. Object Count Rule
    const expectedCount = revision.expectedObjectCount;
    const totalDetected = presentRequiredCount + extraObjects.length;

    if (totalDetected !== expectedCount) {
      if (totalDetected < expectedCount && !defects.some((d) => d.code === 'MISSING_PART')) {
        defects.push({
          code: 'INCORRECT_COUNT',
          message: `Component count mismatch: expected ${expectedCount}, detected ${totalDetected}`,
          expected: expectedCount,
          actual: totalDetected,
        });
      } else if (totalDetected > expectedCount && !defects.some((d) => d.code === 'EXTRA_OBJECT_DETECTED')) {
        defects.push({
          code: 'EXTRA_OBJECT_DETECTED',
          message: `Extra component detected: expected ${expectedCount}, found ${totalDetected}`,
          expected: expectedCount,
          actual: totalDetected,
        });
      }
    }

    // 5. Final Judgement
    // Ambiguous required-ROI evidence is not proof of a product defect.
    const hasUncertainRequiredRoi = roiResults.some(
      (roi) =>
        roi.evidence === 'UNCERTAIN' &&
        !roi.isPresent &&
        revision.inspectionROIs.find((configured) => configured.id === roi.roiId)?.isRequired
    );

    if (hasUncertainRequiredRoi) {
      return {
        judgement: 'INVALID',
        primaryReason: 'Inspection Invalid: vision evidence was insufficient to confirm one or more required ROIs',
        defects,
        expectedCount,
        detectedCount: presentRequiredCount,
      };
    }

    if (defects.length === 0) {
      return {
        judgement: 'OK',
        primaryReason: `All ${expectedCount}/${expectedCount} required components inspected OK (tolerance passed)`,
        defects: [],
        expectedCount,
        detectedCount: presentRequiredCount,
      };
    }

    // There are defects -> NG
    // Primary reason is the first/most critical defect
    const primaryDefect = defects[0];

    return {
      judgement: 'NG',
      primaryReason: primaryDefect.message,
      defects,
      expectedCount,
      detectedCount: presentRequiredCount,
    };
  }
}

export const ruleEngine = new RuleEngine();
