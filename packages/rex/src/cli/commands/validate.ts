import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION, validateDocument, validateConfig } from "../../schema/index.js";
import { validateDAG } from "../../core/dag.js";
import { REX_DIR } from "./constants.js";
import type { PRDDocument } from "../../schema/index.js";

interface CheckResult {
  name: string;
  pass: boolean;
  errors: string[];
}

export async function cmdValidate(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const checks: CheckResult[] = [];

  // Check config.json schema
  try {
    const raw = await readFile(join(rexDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    if (result.ok) {
      checks.push({ name: "config.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "config.json schema",
        pass: false,
        errors: result.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  } catch (err) {
    checks.push({
      name: "config.json schema",
      pass: false,
      errors: [(err as Error).message],
    });
  }

  // Check prd.json schema
  let doc: PRDDocument | null = null;
  try {
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    if (result.ok) {
      doc = result.data as PRDDocument;
      checks.push({ name: "prd.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "prd.json schema",
        pass: false,
        errors: result.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  } catch (err) {
    checks.push({
      name: "prd.json schema",
      pass: false,
      errors: [(err as Error).message],
    });
  }

  // Check schema version
  if (doc) {
    if (doc.schema === SCHEMA_VERSION) {
      checks.push({ name: "schema version", pass: true, errors: [] });
    } else {
      checks.push({
        name: "schema version",
        pass: false,
        errors: [`Unknown schema "${doc.schema}", expected "${SCHEMA_VERSION}"`],
      });
    }
  }

  // DAG validation
  if (doc) {
    const dagResult = validateDAG(doc.items);
    if (dagResult.valid) {
      checks.push({ name: "DAG integrity", pass: true, errors: [] });
    } else {
      checks.push({
        name: "DAG integrity",
        pass: false,
        errors: dagResult.errors,
      });
    }
  }

  // Output results
  if (flags.format === "json") {
    console.log(JSON.stringify(checks, null, 2));
    return;
  }

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? "✓" : "✗";
    console.log(`${icon} ${check.name}`);
    if (!check.pass) {
      allPass = false;
      for (const err of check.errors) {
        console.log(`    ${err}`);
      }
    }
  }

  console.log("");
  if (allPass) {
    console.log("All checks passed.");
  } else {
    console.log("Validation failed.");
    process.exit(1);
  }
}
