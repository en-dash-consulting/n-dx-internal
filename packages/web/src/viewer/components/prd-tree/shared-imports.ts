/**
 * Shared UI re-exports for prd-management-ui zone.
 *
 * Views classified in the prd-management-ui zone (analysis.ts, prd.ts)
 * need shared components from the dashboard-components zone (logos, types).
 * This barrel concentrates those cross-zone imports in one place, making
 * the dependency surface explicit and reducing bidirectional coupling.
 */

export { BrandedHeader } from "../logos.js";
export type { DetailItem } from "../../types.js";
