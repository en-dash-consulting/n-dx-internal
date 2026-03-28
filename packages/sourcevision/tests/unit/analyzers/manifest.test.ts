import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readManifest,
  writeManifest,
  updateManifestModule,
  updateManifestError,
  isAnalysisRunning,
  clearRunningModules,
} from "../../../src/analyzers/manifest.js";

describe("manifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("readManifest returns a fresh manifest when no file exists", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    const m = readManifest(tmpDir);

    expect(m.schemaVersion).toBe("1.0.0");
    expect(m.modules).toEqual({});
    expect(m.targetPath).toContain(tmpDir);
  });

  it("writeManifest + readManifest roundtrip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    const original = readManifest(tmpDir);
    original.modules.inventory = { status: "complete" };

    writeManifest(tmpDir, original);
    const loaded = readManifest(tmpDir);

    expect(loaded.modules.inventory).toEqual({ status: "complete" });
    expect(loaded.schemaVersion).toBe(original.schemaVersion);
  });

  it("updateManifestModule sets running status with startedAt", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    // Need a manifest file first
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestModule(tmpDir, "inventory", "running");
    const m = readManifest(tmpDir);

    expect(m.modules.inventory.status).toBe("running");
    expect(m.modules.inventory.startedAt).toBeDefined();
  });

  it("updateManifestModule sets complete status with completedAt and clears error", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    // First set an error
    updateManifestError(tmpDir, "inventory", "something broke");
    let m = readManifest(tmpDir);
    expect(m.modules.inventory.error).toBe("something broke");

    // Then mark complete — error should be cleared
    updateManifestModule(tmpDir, "inventory", "complete");
    m = readManifest(tmpDir);

    expect(m.modules.inventory.status).toBe("complete");
    expect(m.modules.inventory.completedAt).toBeDefined();
    expect(m.modules.inventory.error).toBeUndefined();
  });

  it("updateManifestError sets error status and message", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestError(tmpDir, "imports", "parse failure");
    const m = readManifest(tmpDir);

    expect(m.modules.imports.status).toBe("error");
    expect(m.modules.imports.error).toBe("parse failure");
    expect(m.modules.imports.completedAt).toBeDefined();
  });

  // ── Concurrency guard tests ─────────────────────────────────────────

  it("updateManifestModule stores pid when status is running", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestModule(tmpDir, "inventory", "running");
    const m = readManifest(tmpDir);

    expect(m.modules.inventory.pid).toBe(process.pid);
  });

  it("updateManifestModule clears pid when status is not running", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestModule(tmpDir, "inventory", "running");
    updateManifestModule(tmpDir, "inventory", "complete");
    const m = readManifest(tmpDir);

    expect(m.modules.inventory.pid).toBeUndefined();
  });

  it("updateManifestError clears pid", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestModule(tmpDir, "inventory", "running");
    updateManifestError(tmpDir, "inventory", "boom");
    const m = readManifest(tmpDir);

    expect(m.modules.inventory.pid).toBeUndefined();
    expect(m.modules.inventory.status).toBe("error");
  });

  describe("isAnalysisRunning", () => {
    it("returns false when no manifest exists", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      const result = isAnalysisRunning(tmpDir);

      expect(result.running).toBe(false);
      expect(result.modules).toEqual([]);
      expect(result.staleCleared).toBe(false);
    });

    it("returns false when no modules are running", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      const manifest = readManifest(tmpDir);
      manifest.modules.inventory = { status: "complete" };
      manifest.modules.imports = { status: "pending" };
      writeManifest(tmpDir, manifest);

      const result = isAnalysisRunning(tmpDir);

      expect(result.running).toBe(false);
      expect(result.modules).toEqual([]);
    });

    it("returns true when a module is running with the current process pid", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      writeManifest(tmpDir, readManifest(tmpDir));

      updateManifestModule(tmpDir, "inventory", "running");
      const result = isAnalysisRunning(tmpDir);

      expect(result.running).toBe(true);
      expect(result.modules).toEqual(["inventory"]);
    });

    it("clears stale locks from dead PIDs", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      const manifest = readManifest(tmpDir);
      // Use a PID that is guaranteed to not exist (very high number)
      manifest.modules.inventory = {
        status: "running",
        startedAt: new Date().toISOString(),
        pid: 999999999,
      };
      writeManifest(tmpDir, manifest);

      const result = isAnalysisRunning(tmpDir);

      expect(result.running).toBe(false);
      expect(result.modules).toEqual([]);
      expect(result.staleCleared).toBe(true);

      // Verify the manifest was updated
      const updated = readManifest(tmpDir);
      expect(updated.modules.inventory.status).toBe("error");
      expect(updated.modules.inventory.error).toContain("stale lock");
      expect(updated.modules.inventory.pid).toBeUndefined();
    });

    it("detects multiple running modules", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      writeManifest(tmpDir, readManifest(tmpDir));

      updateManifestModule(tmpDir, "inventory", "running");
      updateManifestModule(tmpDir, "imports", "running");
      const result = isAnalysisRunning(tmpDir);

      expect(result.running).toBe(true);
      expect(result.modules).toContain("inventory");
      expect(result.modules).toContain("imports");
    });
  });

  describe("clearRunningModules", () => {
    it("clears running modules owned by the current process", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      writeManifest(tmpDir, readManifest(tmpDir));

      updateManifestModule(tmpDir, "inventory", "running");
      updateManifestModule(tmpDir, "imports", "running");

      clearRunningModules(tmpDir);
      const m = readManifest(tmpDir);

      expect(m.modules.inventory.status).toBe("error");
      expect(m.modules.inventory.error).toContain("Process exited");
      expect(m.modules.inventory.pid).toBeUndefined();
      expect(m.modules.imports.status).toBe("error");
    });

    it("does not clear running modules owned by other processes", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      const manifest = readManifest(tmpDir);
      // Use PID 1 (init) which is always running but not ours
      manifest.modules.inventory = {
        status: "running",
        startedAt: new Date().toISOString(),
        pid: 1,
      };
      writeManifest(tmpDir, manifest);

      clearRunningModules(tmpDir);
      const m = readManifest(tmpDir);

      // Should not be cleared because it belongs to PID 1, not us
      expect(m.modules.inventory.status).toBe("running");
    });

    it("is a no-op when no manifest exists", async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
      // Should not throw
      clearRunningModules(tmpDir);
    });
  });
});
