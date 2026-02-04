export type { ScanResult, ScanOptions } from "./scanners.js";
export { scanTests, scanDocs, scanSourceVision, scanPackageJson } from "./scanners.js";

export type { ReconcileStats } from "./reconcile.js";
export { reconcile } from "./reconcile.js";

export type { Proposal, ProposalFeature, ProposalTask } from "./propose.js";
export { buildProposals } from "./propose.js";

export { similarity, deduplicateScanResults } from "./dedupe.js";

export { formatDiff } from "./diff.js";

export type { FileFormat, AddPromptOptions, QualityIssue } from "./reason.js";
export {
  DEFAULT_MODEL,
  MAX_RETRIES,
  CHUNK_CHAR_LIMIT,
  FEW_SHOT_EXAMPLE,
  reasonFromFile,
  reasonFromFiles,
  reasonFromScanResults,
  reasonFromDescription,
  reasonFromDescriptions,
  reasonFromIdeasFile,
  buildIdeasPrompt,
  readProjectContext,
  parseProposalResponse,
  extractJson,
  repairTruncatedJson,
  validateProposalQuality,
  buildAddPrompt,
  buildMultiAddPrompt,
  detectFileFormat,
  parseStructuredFile,
  mergeProposals,
  chunkScanResults,
  summarizeScanResults,
} from "./reason.js";
