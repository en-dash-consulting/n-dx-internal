import { describe, it, expect } from "vitest";
import { parseProposalResponse } from "../../../src/analyze/reason.js";

describe("parseProposalResponse", () => {
  it("parses valid JSON array into proposals", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          {
            title: "Login",
            tasks: [
              { title: "Validate email", priority: "high" },
              { title: "Handle errors" },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("Auth");
    expect(proposals[0].epic.source).toBe("llm");
    expect(proposals[0].features).toHaveLength(1);
    expect(proposals[0].features[0].title).toBe("Login");
    expect(proposals[0].features[0].source).toBe("llm");
    expect(proposals[0].features[0].tasks).toHaveLength(2);
    expect(proposals[0].features[0].tasks[0].title).toBe("Validate email");
    expect(proposals[0].features[0].tasks[0].priority).toBe("high");
    expect(proposals[0].features[0].tasks[0].source).toBe("llm");
    expect(proposals[0].features[0].tasks[0].sourceFile).toBe("");
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n[{"epic":{"title":"UI"},"features":[{"title":"Dark mode","tasks":[]}]}]\n```';

    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("UI");
  });

  it("strips code fences without json language tag", () => {
    const raw = '```\n[{"epic":{"title":"API"},"features":[]}]\n```';

    const proposals = parseProposalResponse(raw);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("API");
  });

  it("preserves optional fields", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Core" },
        features: [
          {
            title: "Cache",
            description: "Add caching layer",
            tasks: [
              {
                title: "Redis integration",
                description: "Set up Redis client",
                acceptanceCriteria: ["Connection pooling", "Retry on failure"],
                priority: "critical",
                tags: ["infra", "perf"],
              },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);
    const task = proposals[0].features[0].tasks[0];

    expect(proposals[0].features[0].description).toBe("Add caching layer");
    expect(task.description).toBe("Set up Redis client");
    expect(task.acceptanceCriteria).toEqual(["Connection pooling", "Retry on failure"]);
    expect(task.priority).toBe("critical");
    expect(task.tags).toEqual(["infra", "perf"]);
  });

  it("rejects invalid priority values", () => {
    const json = JSON.stringify([
      {
        epic: { title: "X" },
        features: [
          {
            title: "Y",
            tasks: [{ title: "Z", priority: "ultra" }],
          },
        ],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects missing epic title", () => {
    const json = JSON.stringify([
      {
        epic: {},
        features: [],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects missing task title", () => {
    const json = JSON.stringify([
      {
        epic: { title: "E" },
        features: [
          {
            title: "F",
            tasks: [{ description: "no title" }],
          },
        ],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects non-array input", () => {
    const json = JSON.stringify({
      epic: { title: "Single" },
      features: [],
    });

    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("handles empty array", () => {
    const proposals = parseProposalResponse("[]");

    expect(proposals).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseProposalResponse("not json")).toThrow();
  });

  it("handles multiple epics", () => {
    const json = JSON.stringify([
      { epic: { title: "A" }, features: [] },
      { epic: { title: "B" }, features: [{ title: "B1", tasks: [] }] },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(2);
    expect(proposals[0].epic.title).toBe("A");
    expect(proposals[1].epic.title).toBe("B");
    expect(proposals[1].features).toHaveLength(1);
  });
});
