import { describe, it, expect } from "vitest";
import { buildFunctionRows } from "../../../src/viewer/views/functions-catalog.js";
import type { CallGraph, FunctionNode, CallEdge } from "../../../src/schema/v1.js";

function makeFn(overrides: Partial<FunctionNode> & { file: string; qualifiedName: string }): FunctionNode {
  return {
    name: overrides.qualifiedName.split(".").pop()!,
    line: 1,
    column: 0,
    isExported: false,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<CallEdge> & { callerFile: string; caller: string; calleeFile: string; callee: string }): CallEdge {
  return {
    type: "direct",
    line: 1,
    column: 0,
    ...overrides,
  };
}

function makeCallGraph(functions: FunctionNode[], edges: CallEdge[]): CallGraph {
  return {
    functions,
    edges,
    summary: {
      totalFunctions: functions.length,
      totalCalls: edges.length,
      filesWithCalls: new Set(edges.map((e) => e.callerFile)).size,
      mostCalled: [],
      mostCalling: [],
      cycleCount: 0,
    },
  };
}

describe("buildFunctionRows", () => {
  it("returns empty array for empty call graph", () => {
    const cg = makeCallGraph([], []);
    const result = buildFunctionRows(cg, new Map());
    expect(result).toEqual([]);
  });

  it("builds rows with correct incoming/outgoing counts", () => {
    const fns: FunctionNode[] = [
      makeFn({ file: "src/a.ts", qualifiedName: "fnA" }),
      makeFn({ file: "src/b.ts", qualifiedName: "fnB" }),
      makeFn({ file: "src/b.ts", qualifiedName: "fnC" }),
    ];
    const edges: CallEdge[] = [
      makeEdge({ callerFile: "src/a.ts", caller: "fnA", calleeFile: "src/b.ts", callee: "fnB" }),
      makeEdge({ callerFile: "src/a.ts", caller: "fnA", calleeFile: "src/b.ts", callee: "fnC" }),
      makeEdge({ callerFile: "src/b.ts", caller: "fnB", calleeFile: "src/b.ts", callee: "fnC" }),
    ];
    const cg = makeCallGraph(fns, edges);

    const rows = buildFunctionRows(cg, new Map());

    const fnA = rows.find((r) => r.qualifiedName === "fnA")!;
    expect(fnA.outgoing).toBe(2);
    expect(fnA.incoming).toBe(0);

    const fnB = rows.find((r) => r.qualifiedName === "fnB")!;
    expect(fnB.outgoing).toBe(1);
    expect(fnB.incoming).toBe(1);

    const fnC = rows.find((r) => r.qualifiedName === "fnC")!;
    expect(fnC.outgoing).toBe(0);
    expect(fnC.incoming).toBe(2);
  });

  it("assigns zone info from fileToZone map", () => {
    const fns: FunctionNode[] = [
      makeFn({ file: "src/a.ts", qualifiedName: "fnA" }),
      makeFn({ file: "src/b.ts", qualifiedName: "fnB" }),
      makeFn({ file: "src/unzoned.ts", qualifiedName: "fnU" }),
    ];
    const cg = makeCallGraph(fns, []);
    const fileToZone = new Map([
      ["src/a.ts", { id: "zone-auth", name: "Auth", color: "#f00" }],
      ["src/b.ts", { id: "zone-billing", name: "Billing", color: "#0f0" }],
    ]);

    const rows = buildFunctionRows(cg, fileToZone);

    const fnA = rows.find((r) => r.qualifiedName === "fnA")!;
    expect(fnA.zoneName).toBe("Auth");
    expect(fnA.zoneId).toBe("zone-auth");
    expect(fnA.zoneColor).toBe("#f00");

    const fnB = rows.find((r) => r.qualifiedName === "fnB")!;
    expect(fnB.zoneName).toBe("Billing");

    const fnU = rows.find((r) => r.qualifiedName === "fnU")!;
    expect(fnU.zoneName).toBe("Unzoned");
    expect(fnU.zoneId).toBe("__unzoned__");
  });

  it("skips edges with null calleeFile", () => {
    const fns: FunctionNode[] = [
      makeFn({ file: "src/a.ts", qualifiedName: "fnA" }),
    ];
    const edges: CallEdge[] = [
      makeEdge({ callerFile: "src/a.ts", caller: "fnA", calleeFile: null as unknown as string, callee: "external" }),
    ];
    const cg = makeCallGraph(fns, edges);

    const rows = buildFunctionRows(cg, new Map());
    expect(rows[0].outgoing).toBe(0);
    expect(rows[0].incoming).toBe(0);
  });

  it("produces one row per function", () => {
    const fns: FunctionNode[] = [
      makeFn({ file: "src/a.ts", qualifiedName: "fn1" }),
      makeFn({ file: "src/a.ts", qualifiedName: "fn2" }),
      makeFn({ file: "src/b.ts", qualifiedName: "fn3" }),
    ];
    const cg = makeCallGraph(fns, []);
    const rows = buildFunctionRows(cg, new Map());
    expect(rows).toHaveLength(3);
  });

  it("handles functions with same name in different files", () => {
    const fns: FunctionNode[] = [
      makeFn({ file: "src/a.ts", qualifiedName: "init" }),
      makeFn({ file: "src/b.ts", qualifiedName: "init" }),
    ];
    const edges: CallEdge[] = [
      makeEdge({ callerFile: "src/a.ts", caller: "init", calleeFile: "src/b.ts", callee: "init" }),
    ];
    const cg = makeCallGraph(fns, edges);

    const rows = buildFunctionRows(cg, new Map());
    const aInit = rows.find((r) => r.file === "src/a.ts")!;
    const bInit = rows.find((r) => r.file === "src/b.ts")!;

    expect(aInit.outgoing).toBe(1);
    expect(aInit.incoming).toBe(0);
    expect(bInit.outgoing).toBe(0);
    expect(bInit.incoming).toBe(1);
  });
});
