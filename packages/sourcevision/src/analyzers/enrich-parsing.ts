/**
 * JSON parsing and finding extraction for AI enrichment responses.
 */

import type {
  Zone,
  Finding,
  FindingType,
} from "../schema/index.js";

// ── JSON parsing ─────────────────────────────────────────────────────────────

export function tryParseJSON(response: string): any | null {
  // Direct parse
  try {
    const parsed = JSON.parse(response);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  // Extract from markdown fences
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  // Find largest JSON object in response
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  // Find JSON array → wrap as {zones: [...]}
  const arrayMatch = response.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return { zones: parsed, insights: [] };
    } catch {}
  }

  return null;
}

// ── Finding extraction ───────────────────────────────────────────────────────

/**
 * Extract findings from AI response. Handles both new `findings` format
 * and legacy `insights` strings. Falls back to converting insights to findings.
 */
export function extractFindings(
  parsed: any,
  passNumber: number,
  expectedTypes: FindingType[]
): Finding[] {
  const findings: Finding[] = [];
  const defaultType = expectedTypes[0] ?? "observation";
  const validTypes: FindingType[] = ["observation", "pattern", "relationship", "anti-pattern", "suggestion"];
  const validSeverities = ["info", "warning", "critical"];

  const parseFinding = (f: any, fallbackScope: string) => {
    if (f && typeof f === "object" && typeof f.text === "string") {
      const type: FindingType = validTypes.includes(f.type) ? f.type : defaultType;
      findings.push({
        type,
        pass: passNumber,
        scope: typeof f.scope === "string" ? f.scope : fallbackScope,
        text: f.text,
        ...(validSeverities.includes(f.severity) ? { severity: f.severity } : {}),
        ...(Array.isArray(f.related) ? { related: f.related.filter((r: any) => typeof r === "string") } : {}),
      });
    }
  };

  // New format: parsed has a top-level "findings" array
  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings) parseFinding(f, "global");
  }

  // Also extract from per-zone findings in zones array
  if (Array.isArray(parsed.zones)) {
    for (const z of parsed.zones) {
      if (!z || typeof z !== "object") continue;
      const zoneId = z.id ?? z.algorithmicId ?? "unknown";
      if (Array.isArray(z.findings)) {
        for (const f of z.findings) parseFinding(f, zoneId);
      }
    }
  }

  // Legacy fallback: convert insights strings to findings
  if (findings.length === 0) {
    // Global insights
    if (Array.isArray(parsed.insights)) {
      for (const s of parsed.insights) {
        if (typeof s === "string") {
          findings.push({
            type: defaultType,
            pass: passNumber,
            scope: "global",
            text: s,
          });
        }
      }
    }
    // Per-zone insights
    if (Array.isArray(parsed.zones)) {
      for (const z of parsed.zones) {
        if (!z || typeof z !== "object") continue;
        const zoneId = z.id ?? z.algorithmicId ?? "unknown";
        const insightsArr = z.insights ?? z.newInsights;
        if (Array.isArray(insightsArr)) {
          for (const s of insightsArr) {
            if (typeof s === "string") {
              findings.push({
                type: defaultType,
                pass: passNumber,
                scope: zoneId,
                text: s,
              });
            }
          }
        }
      }
    }
  }

  return findings;
}

// ── Zone ID deduplication ────────────────────────────────────────────────────

/** Ensure no two zones share the same ID (appends -2, -3, etc.) */
export function deduplicateZoneIds(zones: Zone[]): void {
  const usedIds = new Set<string>();
  for (const zone of zones) {
    if (usedIds.has(zone.id)) {
      let suffix = 2;
      while (usedIds.has(`${zone.id}-${suffix}`)) suffix++;
      zone.id = `${zone.id}-${suffix}`;
    }
    usedIds.add(zone.id);
  }
}

// ── Result type ──────────────────────────────────────────────────────────────

export interface EnrichResult {
  /** Zones with AI-assigned IDs/names/descriptions */
  zones: Zone[];
  /** Only the NEW per-zone AI insights from this pass */
  newZoneInsights: Map<string, string[]>;
  /** Only the NEW global AI insights from this pass */
  newGlobalInsights: string[];
  /** Structured findings from this pass */
  newFindings: Finding[];
  /** Pass number (1-based) */
  pass: number;
  /** Updated findings with reassessed severities from meta-evaluation */
  _updatedFindings?: Finding[];
}
