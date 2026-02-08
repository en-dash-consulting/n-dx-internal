/**
 * PDF report generator for sourcevision analysis data.
 *
 * Produces a structured PDF with project overview, zone architecture,
 * import graph summary, and findings.
 */

import PDFDocument from "pdfkit";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Components,
} from "../schema/index.js";

export interface PdfReportData {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  zones: Zones;
  components?: Components;
}

// ── Layout constants ────────────────────────────────────────────────────────

const PAGE_MARGIN = 50;
const COLORS = {
  title: "#1a1a2e" as const,
  heading: "#16213e" as const,
  body: "#333333" as const,
  muted: "#888888" as const,
  accent: "#0f3460" as const,
  divider: "#cccccc" as const,
  good: "#27ae60" as const,
  warn: "#f39c12" as const,
  critical: "#e74c3c" as const,
};

/**
 * Generate a PDF report from sourcevision analysis data.
 * Returns the PDF as a Buffer.
 */
export async function generatePdfReport(data: PdfReportData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    info: {
      Title: `Sourcevision Report — ${projectName(data.manifest)}`,
      Author: "Sourcevision",
      Creator: "Sourcevision",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // ── Title page ────────────────────────────────────────────────────────

  doc.fontSize(28).fillColor(COLORS.title).text("Sourcevision Report", {
    align: "center",
  });
  doc.moveDown(0.5);
  doc.fontSize(18).fillColor(COLORS.accent).text(projectName(data.manifest), {
    align: "center",
  });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(`Generated: ${new Date(data.manifest.analyzedAt).toLocaleString()}`, {
      align: "center",
    });

  const gitParts = [
    data.manifest.gitBranch,
    data.manifest.gitSha?.slice(0, 7),
  ].filter(Boolean);
  if (gitParts.length) {
    doc.text(`Git: ${gitParts.join(" @ ")}`, { align: "center" });
  }

  doc.moveDown(2);
  divider(doc);
  doc.moveDown(1);

  // ── Project Overview ──────────────────────────────────────────────────

  sectionHeading(doc, "Project Overview");

  const { summary } = data.inventory;
  const topLangs = Object.entries(summary.byLanguage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([lang, count]) => `${lang} (${count})`)
    .join(", ");

  bodyText(doc, `Total files: ${summary.totalFiles}`);
  bodyText(doc, `Total lines: ${summary.totalLines.toLocaleString()}`);
  bodyText(doc, `Languages: ${topLangs}`);
  bodyText(doc, `Import edges: ${data.imports.summary.totalEdges}`);
  bodyText(
    doc,
    `External packages: ${data.imports.summary.totalExternal}`
  );
  if (data.imports.summary.circularCount > 0) {
    bodyText(
      doc,
      `Circular dependencies: ${data.imports.summary.circularCount}`
    );
  }
  if (data.components) {
    bodyText(
      doc,
      `Components: ${data.components.summary.totalComponents}`
    );
    bodyText(
      doc,
      `Route modules: ${data.components.summary.totalRouteModules}`
    );
  }

  doc.moveDown(1);

  // ── Zones ─────────────────────────────────────────────────────────────

  if (data.zones.zones.length > 0) {
    sectionHeading(doc, "Architecture Zones");

    for (const zone of data.zones.zones) {
      ensureSpace(doc, 60);
      doc
        .fontSize(11)
        .fillColor(COLORS.heading)
        .text(`${zone.name}`, { continued: true })
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(
          `  (${zone.files.length} files, cohesion: ${zone.cohesion.toFixed(2)}, coupling: ${zone.coupling.toFixed(2)})`
        );

      if (zone.description) {
        doc.fontSize(9).fillColor(COLORS.body).text(zone.description, {
          indent: 10,
        });
      }
      doc.moveDown(0.3);
    }

    if (data.zones.unzoned.length > 0) {
      doc
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text(`Unzoned files: ${data.zones.unzoned.length}`);
    }

    doc.moveDown(1);
  }

  // ── Most Imported Files ───────────────────────────────────────────────

  if (data.imports.summary.mostImported.length > 0) {
    sectionHeading(doc, "Most Imported Files");

    for (const item of data.imports.summary.mostImported.slice(0, 10)) {
      ensureSpace(doc, 15);
      doc
        .fontSize(9)
        .fillColor(COLORS.body)
        .text(`${item.path}`, { continued: true })
        .fillColor(COLORS.muted)
        .text(`  (${item.count} imports)`);
    }

    doc.moveDown(1);
  }

  // ── Circular Dependencies ─────────────────────────────────────────────

  if (data.imports.summary.circulars.length > 0) {
    sectionHeading(doc, "Circular Dependencies");

    for (const circ of data.imports.summary.circulars.slice(0, 10)) {
      ensureSpace(doc, 15);
      doc
        .fontSize(9)
        .fillColor(COLORS.critical)
        .text(circ.cycle.join(" → "));
    }

    doc.moveDown(1);
  }

  // ── Findings ──────────────────────────────────────────────────────────

  const findings = data.zones.findings ?? [];
  const warnAndCritical = findings.filter(
    (f) => f.severity === "warning" || f.severity === "critical"
  );

  if (warnAndCritical.length > 0) {
    sectionHeading(doc, "Findings");

    for (const f of warnAndCritical.slice(0, 20)) {
      ensureSpace(doc, 15);
      const color =
        f.severity === "critical" ? COLORS.critical : COLORS.warn;
      const label = f.severity === "critical" ? "CRITICAL" : "WARNING";
      doc
        .fontSize(9)
        .fillColor(color)
        .text(`[${label}] `, { continued: true })
        .fillColor(COLORS.body)
        .text(f.text);
    }

    doc.moveDown(1);
  }

  // ── Footer ────────────────────────────────────────────────────────────

  divider(doc);
  doc.moveDown(0.5);
  doc
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      `Generated by Sourcevision v${data.manifest.toolVersion}`,
      { align: "center" }
    );

  // ── Finalize ──────────────────────────────────────────────────────────

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function projectName(manifest: Manifest): string {
  return manifest.targetPath.split("/").pop() || "project";
}

function sectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  doc.fontSize(14).fillColor(COLORS.heading).text(text);
  doc.moveDown(0.3);
}

function bodyText(doc: PDFKit.PDFDocument, text: string): void {
  doc.fontSize(10).fillColor(COLORS.body).text(text);
}

function divider(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .strokeColor(COLORS.divider)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .stroke();
}

/** Add a new page if less than `minSpace` points remain. */
function ensureSpace(doc: PDFKit.PDFDocument, minSpace: number): void {
  if (doc.y + minSpace > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
  }
}
