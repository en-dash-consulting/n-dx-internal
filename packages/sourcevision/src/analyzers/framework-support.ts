/**
 * Supported language and framework tiers for SourceVision analysis.
 *
 * Tier 1: Full analysis — inventory, import graph, zones, routes, components.
 * Tier 2: Detection only — inventory and basic import scanning, no deep analysis.
 */

export interface SupportedLanguage {
  /** Language name as it appears in inventory (e.g., "TypeScript", "Go"). */
  name: string;
  /** Tier 1 = full analysis pipeline, Tier 2 = detection and basic inventory only. */
  tier: 1 | 2;
  /** What analysis capabilities are available for this language. */
  capabilities: string[];
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {
    name: "TypeScript",
    tier: 1,
    capabilities: [
      "inventory",
      "import-graph",
      "zone-detection",
      "route-detection",
      "component-catalog",
      "classifications",
      "framework-detection",
    ],
  },
  {
    name: "JavaScript",
    tier: 1,
    capabilities: [
      "inventory",
      "import-graph",
      "zone-detection",
      "route-detection",
      "component-catalog",
      "classifications",
      "framework-detection",
    ],
  },
  {
    name: "Go",
    tier: 1,
    capabilities: [
      "inventory",
      "import-graph",
      "zone-detection",
      "server-route-detection",
      "framework-detection",
    ],
  },
  {
    name: "Python",
    tier: 2,
    capabilities: ["inventory", "framework-detection"],
  },
  {
    name: "Rust",
    tier: 2,
    capabilities: ["inventory"],
  },
  {
    name: "Java",
    tier: 2,
    capabilities: ["inventory"],
  },
];

/**
 * Get framework-specific analysis capabilities for a detected framework.
 * Returns what SourceVision can do given that framework was detected.
 */
export function getFrameworkCapabilities(frameworkId: string): string[] {
  const capMap: Record<string, string[]> = {
    "react-router-v7": ["file-based-routing", "route-tree", "loader/action-detection", "layout-hierarchy"],
    "nextjs": ["file-based-routing", "route-tree", "api-routes", "server-components"],
    "nuxt": ["file-based-routing", "route-tree", "composables"],
    "sveltekit": ["file-based-routing", "route-tree", "server-routes"],
    "astro": ["file-based-routing", "route-tree", "island-components"],
    "express": ["server-route-detection", "middleware-chain"],
    "hono": ["server-route-detection"],
    "koa": ["server-route-detection"],
    "go-chi": ["server-route-detection", "middleware-chain"],
    "go-gin": ["server-route-detection"],
    "go-echo": ["server-route-detection"],
    "go-fiber": ["server-route-detection"],
    "go-gorilla-mux": ["server-route-detection"],
    "go-net-http": ["server-route-detection"],
  };
  return capMap[frameworkId] ?? [];
}
