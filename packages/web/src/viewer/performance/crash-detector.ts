/**
 * Re-export shim — crash-detector has moved to ../crash/crash-detector.ts.
 *
 * This file preserves backward-compatibility for any consumer that imported
 * directly from this path. New code should import from ../crash/index.js.
 */

export {
  detectCrash,
  saveNavigationState,
  clearSavedNavigationState,
  markRecoveryShown,
  wasRecoveryShown,
  getDetectionResult,
  clearCrashHistory,
  resetCrashDetector,
  type CrashDetectionResult,
  type SavedNavigationState,
} from "../crash/crash-detector.js";
