import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readManifest,
  writeManifest,
  updateManifestModule,
  updateManifestError,
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
});
