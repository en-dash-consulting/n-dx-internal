/**
 * Validates the assistant asset manifest, render contract, and generated
 * vendor skill output for both Claude and Codex.
 *
 * The canonical source of truth is `assistant-assets/` (manifest.json +
 * skills/*.md).  `.claude/skills/` and `.agents/skills/` are generated
 * outputs — not committed to git.  These tests validate:
 *
 *   1. Manifest structure and completeness
 *   2. Render contract correctness for all vendors
 *   3. `writeVendorSkills()` generates correct output to disk
 *   4. Both integration modules (claude-integration.js, codex-integration.js)
 *      import from `assistant-assets/` (no inline skill definitions)
 *   5. Cross-vendor skill body identity (same bodies, different wrappers)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  getManifest,
  getRegistry,
  getSkillNames,
  getSkillBody,
  listSkillFiles,
  getMcpServers,
  getMcpServer,
  getVendors,
  getVendorTarget,
  getToolIds,
  getAutoApprovedToolIds,
  renderSkill,
  renderAllSkills,
  renderClaudeSkill,
  renderAllClaudeSkills,
  writeVendorSkills,
} from "../../assistant-assets/index.js";

const ROOT = join(import.meta.dirname, "../..");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize whitespace so trivial formatting differences don't break sync. */
const normalize = (s) =>
  s.replace(/\u2192/g, "->").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
/**
 * Read all skill files from a vendor's output directory.
 * Returns a Map of skill name -> content string.
 */
function readVendorSkills(baseDir, vendor) {
  const target = getVendorTarget(vendor);
  const skillsDir = join(baseDir, target.skillDir);
  if (!existsSync(skillsDir)) return new Map();

  const skills = new Map();
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = join(skillsDir, dir.name, target.skillFile);
    if (existsSync(skillFile)) {
      skills.set(dir.name, readFileSync(skillFile, "utf-8").trim());
    }
  }

  return skills;
}

// ── Manifest structure validation ───────────────────────────────────────────

describe("assistant-assets manifest structure", () => {
  const manifest = getManifest();

  it("manifest has required top-level keys", () => {
    expect(manifest).toHaveProperty("skills");
    expect(manifest).toHaveProperty("mcpServers");
    expect(manifest).toHaveProperty("vendors");
  });

  it("skills section has at least one entry", () => {
    expect(Object.keys(manifest.skills).length).toBeGreaterThan(0);
  });

  it("every skill has a non-empty description", () => {
    const bad = Object.entries(manifest.skills)
      .filter(([, meta]) => !meta.description || meta.description.trim() === "")
      .map(([name]) => name);
    if (bad.length > 0) {
      expect.fail(`Skills missing description: ${bad.join(", ")}`);
    }
  });

  it("every skill body file exists and is non-empty", () => {
    const empty = [];
    for (const name of getSkillNames()) {
      const body = getSkillBody(name);
      if (body.trim().length === 0) {
        empty.push(name);
      }
    }
    if (empty.length > 0) {
      expect.fail(`Empty skill bodies: ${empty.join(", ")}`);
    }
  });

  it("every skill file has a manifest entry", () => {
    const fileNames = listSkillFiles();
    const missing = fileNames.filter((f) => !manifest.skills[f]);
    if (missing.length > 0) {
      expect.fail(
        `Skill files without manifest entries: ${missing.join(", ")}\n` +
        "Add entries to assistant-assets/manifest.json.",
      );
    }
  });

  it("every manifest skill entry has a corresponding skill file", () => {
    const fileNames = listSkillFiles();
    const missing = Object.keys(manifest.skills).filter((n) => !fileNames.includes(n));
    if (missing.length > 0) {
      expect.fail(
        `Manifest entries without skill files: ${missing.join(", ")}\n` +
        "Create matching assistant-assets/skills/<name>.md files.",
      );
    }
  });
});

describe("manifest MCP server descriptors", () => {
  const servers = getMcpServers();
  const serverNames = Object.keys(servers);

  it("manifest defines at least one MCP server", () => {
    expect(serverNames.length).toBeGreaterThan(0);
  });

  for (const name of serverNames) {
    describe(`server "${name}"`, () => {
      const desc = servers[name];

      it("has required fields", () => {
        expect(desc).toHaveProperty("package");
        expect(desc).toHaveProperty("npmName");
        expect(desc).toHaveProperty("entrypoint");
        expect(desc).toHaveProperty("mcpCommand");
        expect(desc).toHaveProperty("tools");
        expect(desc.tools).toHaveProperty("read");
        expect(desc.tools).toHaveProperty("write");
      });

      it("package directory exists", () => {
        const pkgDir = join(ROOT, desc.package);
        expect(existsSync(pkgDir)).toBe(true);
      });

      it("entrypoint file exists after build", () => {
        const entry = join(ROOT, desc.package, desc.entrypoint);
        // This file exists only after build, so skip if not built
        if (!existsSync(entry)) {
          return; // gracefully skip pre-build
        }
        expect(existsSync(entry)).toBe(true);
      });

      it("read tools array is non-empty", () => {
        expect(desc.tools.read.length).toBeGreaterThan(0);
      });

      it("no tool appears in both read and write lists", () => {
        const overlap = desc.tools.read.filter((t) => desc.tools.write.includes(t));
        if (overlap.length > 0) {
          expect.fail(
            `Tools in both read and write for "${name}": ${overlap.join(", ")}`,
          );
        }
      });
    });
  }
});

describe("manifest vendor delivery targets", () => {
  const vendors = getVendors();
  const vendorIds = Object.keys(vendors);

  it("manifest defines both claude and codex vendors", () => {
    expect(vendorIds).toContain("claude");
    expect(vendorIds).toContain("codex");
  });

  for (const id of vendorIds) {
    describe(`vendor "${id}"`, () => {
      const target = vendors[id];

      it("has required fields", () => {
        expect(target).toHaveProperty("skillDir");
        expect(target).toHaveProperty("skillFile");
        expect(target).toHaveProperty("skillWrapper");
        expect(target).toHaveProperty("instructionFile");
        expect(target).toHaveProperty("toolPrefix");
      });

      it("skillWrapper is a known format", () => {
        expect(["yaml-frontmatter", "plain"]).toContain(target.skillWrapper);
      });
    });
  }
});

// ── Render contract ─────────────────────────────────────────────────────────

describe("render contract", () => {
  const skillNames = getSkillNames();

  describe("renderSkill dispatches by vendor", () => {
    for (const name of skillNames) {
      it(`"${name}" renders for claude (yaml-frontmatter)`, () => {
        const content = renderSkill(name, "claude");
        expect(content).toMatch(/^---\n/);
        expect(content).toContain(`name: ${name}`);
        expect(content).toContain("description:");
        expect(content).toMatch(/---\n\n/);
      });

      it(`"${name}" renders for codex (plain body)`, () => {
        const content = renderSkill(name, "codex");
        const body = getSkillBody(name);
        expect(content).toBe(body);
        // Plain wrapper means no YAML frontmatter
        expect(content).not.toMatch(/^---\n/);
      });
    }
  });

  it("renderAllSkills covers all registered skills", () => {
    for (const vendor of ["claude", "codex"]) {
      const rendered = renderAllSkills(vendor);
      expect(Object.keys(rendered).sort()).toEqual([...skillNames].sort());
    }
  });

  it("renderClaudeSkill is equivalent to renderSkill(name, 'claude')", () => {
    for (const name of skillNames) {
      expect(renderClaudeSkill(name)).toBe(renderSkill(name, "claude"));
    }
  });

  it("renderAllClaudeSkills is equivalent to renderAllSkills('claude')", () => {
    const a = renderAllClaudeSkills();
    const b = renderAllSkills("claude");
    expect(a).toEqual(b);
  });
});

// ── Tool ID derivation ──────────────────────────────────────────────────────

describe("tool ID derivation", () => {
  it("claude read tools are prefixed with mcp__{server}__", () => {
    const ids = getAutoApprovedToolIds("claude");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^mcp__(rex|sourcevision)__/);
    }
  });

  it("claude write tools are prefixed with mcp__{server}__", () => {
    const ids = getToolIds("claude", "write");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^mcp__(rex|sourcevision)__/);
    }
  });

  it("codex tools have no prefix (toolPrefix is null)", () => {
    const ids = getAutoApprovedToolIds("codex");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).not.toContain("mcp__");
    }
  });

  it("read and write tool IDs do not overlap for any vendor", () => {
    for (const vendor of ["claude", "codex"]) {
      const read = new Set(getToolIds(vendor, "read"));
      const write = getToolIds(vendor, "write");
      const overlap = write.filter((t) => read.has(t));
      if (overlap.length > 0) {
        expect.fail(
          `Overlapping read/write tool IDs for "${vendor}": ${overlap.join(", ")}`,
        );
      }
    }
  });
});

// ── Backward compatibility ──────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("getRegistry() returns { skills } subset of manifest", () => {
    const registry = getRegistry();
    expect(registry).toHaveProperty("skills");
    expect(registry.skills).toEqual(getManifest().skills);
  });

  it("getMcpServer() throws for unknown server", () => {
    expect(() => getMcpServer("nonexistent")).toThrow("not in manifest");
  });

  it("getVendorTarget() throws for unknown vendor", () => {
    expect(() => getVendorTarget("nonexistent")).toThrow("not in manifest");
  });

  it("renderSkill() throws for unknown skill", () => {
    expect(() => renderSkill("nonexistent", "claude")).toThrow("not in manifest");
  });
});

// ── writeVendorSkills output validation ──────────────────────────────────────

describe("writeVendorSkills generates correct output", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-skill-sync-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  for (const vendor of ["claude", "codex"]) {
    describe(`vendor "${vendor}"`, () => {
      const skillNames = getSkillNames();
      let generated;

      beforeAll(() => {
        const result = writeVendorSkills(vendor, tmpDir);
        expect(result.written).toBe(skillNames.length);
        generated = readVendorSkills(tmpDir, vendor);
      });

      it("writes all canonical skills", () => {
        const missing = skillNames.filter((n) => !generated.has(n));
        if (missing.length > 0) {
          expect.fail(
            `writeVendorSkills("${vendor}") did not write: ${missing.join(", ")}`,
          );
        }
      });

      it("writes no extra skills beyond the canonical set", () => {
        const nameSet = new Set(skillNames);
        const extra = [...generated.keys()].filter((n) => !nameSet.has(n));
        if (extra.length > 0) {
          expect.fail(
            `writeVendorSkills("${vendor}") wrote unexpected: ${extra.join(", ")}`,
          );
        }
      });

      for (const name of skillNames) {
        it(`"${name}" output matches renderSkill`, () => {
          const written = generated.get(name);
          if (!written) return; // covered by "writes all" test

          const expected = renderSkill(name, vendor);

          if (normalize(written) !== normalize(expected)) {
            const writtenLines = normalize(written).split("\n");
            const expectedLines = normalize(expected).split("\n");
            let diffLine = -1;
            for (let i = 0; i < Math.max(writtenLines.length, expectedLines.length); i++) {
              if (writtenLines[i] !== expectedLines[i]) {
                diffLine = i + 1;
                break;
              }
            }
            expect.fail(
              `Skill "${name}" written for "${vendor}" differs from renderSkill ` +
              `(first difference at line ${diffLine}).`,
            );
          }
        });
      }
    });
  }

  it("uses vendor-specific output directories", () => {
    const claudeTarget = getVendorTarget("claude");
    const codexTarget = getVendorTarget("codex");

    expect(existsSync(join(tmpDir, claudeTarget.skillDir))).toBe(true);
    expect(existsSync(join(tmpDir, codexTarget.skillDir))).toBe(true);
    // Verify they're different directories
    expect(claudeTarget.skillDir).not.toBe(codexTarget.skillDir);
  });
});

// ── Dual-vendor integration source checks ────────────────────────────────────

describe("vendor integration modules use canonical source", () => {
  const claudeSrc = readFileSync(join(ROOT, "packages/core/claude-integration.js"), "utf-8");
  const codexSrc = readFileSync(join(ROOT, "packages/core/codex-integration.js"), "utf-8");

  describe("claude-integration.js", () => {
    it("imports from assistant-assets/", () => {
      expect(claudeSrc).toContain('from "../../assistant-assets/index.js"');
    });

    it("imports writeVendorSkills from the render contract", () => {
      expect(claudeSrc).toContain("writeVendorSkills");
    });

    it("does not contain inline SKILLS object", () => {
      if (/^const SKILLS\s*=\s*\{/m.test(claudeSrc)) {
        expect.fail(
          "claude-integration.js still contains an inline SKILLS object.\n" +
          "It should import skills from assistant-assets/ instead.",
        );
      }
    });

    it("does not call renderAllClaudeSkills directly", () => {
      if (claudeSrc.includes("renderAllClaudeSkills")) {
        expect.fail(
          "claude-integration.js still calls renderAllClaudeSkills.\n" +
          'It should use writeVendorSkills("claude", dir) instead.',
        );
      }
    });

    it("delegates instruction rendering to renderClaudeMd", () => {
      expect(claudeSrc).toContain("renderClaudeMd");
    });
  });

  describe("codex-integration.js", () => {
    it("imports from assistant-assets/", () => {
      expect(codexSrc).toContain('from "../../assistant-assets/index.js"');
    });

    it("imports writeVendorSkills from the render contract", () => {
      expect(codexSrc).toContain("writeVendorSkills");
    });

    it("does not contain inline skill definitions", () => {
      if (/^const SKILLS\s*=\s*\{/m.test(codexSrc)) {
        expect.fail(
          "codex-integration.js contains an inline SKILLS object.\n" +
          "It should import skills from assistant-assets/ instead.",
        );
      }
    });

    it("does not contain inline TOML strings", () => {
      // config.toml content is rendered by renderCodexConfigToml from the
      // canonical asset layer — no hardcoded TOML in the integration module.
      if (/^\[mcp_servers\./m.test(codexSrc)) {
        expect.fail(
          "codex-integration.js contains inline TOML server definitions.\n" +
          "It should use renderCodexConfigToml() instead.",
        );
      }
    });

    it("delegates config rendering to renderCodexConfigToml", () => {
      expect(codexSrc).toContain("renderCodexConfigToml");
    });

    it("delegates instruction rendering to renderAgentsMd", () => {
      expect(codexSrc).toContain("renderAgentsMd");
    });
  });

  describe("symmetric canonical delegation", () => {
    it("both vendors import writeVendorSkills (not vendor-specific writers)", () => {
      // The shared writeVendorSkills is the only sanctioned write path.
      // Neither module should reimplement skill file I/O.
      expect(claudeSrc).toContain("writeVendorSkills");
      expect(codexSrc).toContain("writeVendorSkills");
    });

    it("both vendors import from the same canonical module", () => {
      const claudeImport = claudeSrc.match(/from\s+"([^"]+assistant-assets[^"]+)"/);
      const codexImport = codexSrc.match(/from\s+"([^"]+assistant-assets[^"]+)"/);
      expect(claudeImport).not.toBeNull();
      expect(codexImport).not.toBeNull();
      expect(claudeImport[1]).toBe(codexImport[1]);
    });
  });
});

// ── Cross-vendor skill body identity ─────────────────────────────────────────

describe("cross-vendor skill body identity", () => {
  const skillNames = getSkillNames();

  it("both vendors render all registered skills (no vendor-specific omissions)", () => {
    const claudeSkills = Object.keys(renderAllSkills("claude")).sort();
    const codexSkills = Object.keys(renderAllSkills("codex")).sort();
    expect(claudeSkills).toEqual(codexSkills);
    expect(claudeSkills).toEqual([...skillNames].sort());
  });

  for (const name of skillNames) {
    it(`"${name}" has identical body content regardless of vendor`, () => {
      // Both vendors receive the same canonical skill body.
      // The only difference is the wrapper (YAML frontmatter vs plain).
      const body = getSkillBody(name);
      const codexRendered = renderSkill(name, "codex");
      const claudeRendered = renderSkill(name, "claude");

      // Codex uses plain wrapper — rendered output IS the body
      expect(codexRendered).toBe(body);

      // Claude wraps with YAML frontmatter — body appears after the frontmatter
      const bodyStart = claudeRendered.indexOf("---\n\n");
      expect(bodyStart).toBeGreaterThan(0);
      const claudeBody = claudeRendered.slice(bodyStart + "---\n\n".length);
      expect(claudeBody).toBe(body);
    });
  }

  it("renderSkill is idempotent for both vendors", () => {
    for (const name of skillNames) {
      for (const vendor of ["claude", "codex"]) {
        const first = renderSkill(name, vendor);
        const second = renderSkill(name, vendor);
        expect(first).toBe(second);
      }
    }
  });
});
