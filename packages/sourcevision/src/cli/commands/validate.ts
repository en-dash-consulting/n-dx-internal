import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { SV_DIR } from "./constants.js";
import {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
} from "../../schema/index.js";
import { DATA_FILES } from "../../schema/data-files.js";

export function cmdValidate(dir: string): void {
  const svDir = join(resolve(dir), SV_DIR);

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${resolve(dir)}`);
    console.error("Run 'sourcevision init' first.");
    process.exit(1);
  }

  const modules: Array<{
    name: string;
    file: string;
    validate: (data: unknown) => { ok: boolean; errors?: unknown };
  }> = [
    { name: "manifest", file: DATA_FILES.manifest, validate: validateManifest },
    { name: "inventory", file: DATA_FILES.inventory, validate: validateInventory },
    { name: "imports", file: DATA_FILES.imports, validate: validateImports },
    { name: "zones", file: DATA_FILES.zones, validate: validateZones },
    { name: "components", file: DATA_FILES.components, validate: validateComponents },
  ];

  let allValid = true;

  for (const mod of modules) {
    const filePath = join(svDir, mod.file);
    if (!existsSync(filePath)) {
      console.log(`  [skip] ${mod.file} — not found`);
      continue;
    }

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      const result = mod.validate(data);

      if (result.ok) {
        console.log(`  [pass] ${mod.file}`);
      } else {
        console.log(`  [fail] ${mod.file}`);
        console.log(`         ${JSON.stringify(result.errors, null, 2)}`);
        allValid = false;
      }
    } catch (err) {
      console.log(`  [fail] ${mod.file} — ${err instanceof Error ? err.message : err}`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log("\nAll modules valid.");
  } else {
    console.log("\nValidation failed for one or more modules.");
    process.exit(1);
  }
}
