import { h, Fragment } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { Finding } from "../external.js";
import { FindingsList, BarChart } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { BrandedHeader } from "../components/logos.js";

interface ArchitectureProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  navigateTo?: NavigateTo;
}

export function ArchitectureView({ data, onSelect, navigateTo }: ArchitectureProps) {
  const { zones, imports } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.architecture) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u{1F512}"),
      h("h2", null, "Architecture"),
      h("p", null, "Requires enrichment pass 2 (current: ", enrichmentPass, ")"),
      h("p", { class: "locked-hint" },
        "Run ", h("code", null, "sourcevision analyze"), " again to unlock."
      )
    );
  }

  const findings = (zones?.findings ?? []).filter(
    (f: Finding) => f.type === "pattern" || f.type === "relationship"
  );

  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /pattern|architect|relationship|layer|boundary|abstract/i.test(s)
      )
    : [];

  const patterns = findings.filter((f) => f.type === "pattern");
  const relationships = findings.filter((f) => f.type === "relationship");

  // Zone health overview
  const zoneHealthData = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z) => ({
      label: z.name,
      value: z.files.length,
      color: z.cohesion >= 0.6 ? "var(--green)" : z.cohesion >= 0.4 ? "var(--orange)" : "var(--red)",
    }));
  }, [zones]);

  // Cross-zone traffic summary
  const crossingCount = zones?.crossings?.length ?? 0;
  const biDirectional = findings.filter((f) => /bidirectional/i.test(f.text)).length;

  // Hub files: most imported files across the codebase
  const hubFilesData = useMemo(() => {
    if (!imports) return [];
    const hubs = imports.summary.mostImported.filter((f) => f.count > 3);
    if (hubs.length === 0) return [];
    return hubs
      .slice(0, 15)
      .map((f) => ({
        label: shortFilePath(f.path),
        value: f.count,
        color: f.count > 10 ? "var(--red)" : f.count > 5 ? "var(--orange)" : "var(--green)",
      }));
  }, [imports]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Architecture"),
    ),
    h("p", { class: "section-sub" },
      `${findings.length} findings from ${zones?.zones.length ?? 0} zones`
    ),

    // Summary stats
    h("div", { class: "stat-grid" },
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(patterns.length)),
        h("div", { class: "label" }, "Patterns")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(relationships.length)),
        h("div", { class: "label" }, "Relationships")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: "value" }, String(crossingCount)),
        h("div", { class: "label" }, "Cross-Zone Imports")
      ),
      h("div", { class: "stat-card" },
        h("div", { class: `value${biDirectional > 0 ? " text-orange" : ""}` },
          String(biDirectional)),
        h("div", { class: "label" }, "Bidirectional Couplings")
      ),
    ),

    // Zone health bar chart
    zoneHealthData.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm" }, "Zone Sizes"),
          h("p", { class: "section-sub" }, "Files per zone. Green = high cohesion, orange = moderate, red = low."),
          h(BarChart, { data: zoneHealthData }),
        )
      : null,

    // Hub files bar chart
    hubFilesData.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm mt-24" }, "Hub Files"),
          h("p", { class: "section-sub" }, "Most-imported files. Red = high coupling risk (>10 importers), orange = moderate (>5)."),
          h(BarChart, { data: hubFilesData }),
        )
      : null,

    h(FindingsList, {
      findings,
      legacyInsights,
      groupBy: "type",
      searchable: true,
    })
  );
}

function shortFilePath(path: string): string {
  const parts = path.split("/");
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : path;
}
