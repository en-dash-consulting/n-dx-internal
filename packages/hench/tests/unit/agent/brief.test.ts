import { describe, it, expect } from "vitest";
import { formatTaskBrief } from "../../../src/agent/brief.js";
import type { TaskBrief } from "../../../src/schema/v1.js";

describe("formatTaskBrief", () => {
  const minimalBrief: TaskBrief = {
    task: {
      id: "task-1",
      title: "Implement login form",
      level: "task",
      status: "pending",
    },
    parentChain: [],
    siblings: [],
    project: { name: "my-app" },
    workflow: "",
    recentLog: [],
  };

  it("formats minimal brief", () => {
    const output = formatTaskBrief(minimalBrief);
    expect(output).toContain("## Current Task");
    expect(output).toContain("Implement login form");
    expect(output).toContain("task-1");
    expect(output).toContain("pending");
    expect(output).toContain("my-app");
  });

  it("includes description when present", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        description: "Create a login form with email/password fields",
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Create a login form with email/password fields");
  });

  it("includes acceptance criteria", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      task: {
        ...minimalBrief.task,
        acceptanceCriteria: ["Form validates email format", "Shows error on invalid login"],
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("Acceptance Criteria:");
    expect(output).toContain("Form validates email format");
    expect(output).toContain("Shows error on invalid login");
  });

  it("includes parent chain", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      parentChain: [
        { id: "epic-1", title: "Authentication", level: "epic" },
        { id: "feat-1", title: "Login Flow", level: "feature", description: "User login" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Context (Parent Chain)");
    expect(output).toContain("Authentication");
    expect(output).toContain("Login Flow");
    expect(output).toContain("User login");
  });

  it("includes siblings", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      siblings: [
        { id: "t2", title: "Signup form", status: "completed" },
        { id: "t3", title: "Forgot password", status: "pending" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Sibling Tasks");
    expect(output).toContain("[x] Signup form");
    expect(output).toContain("[ ] Forgot password");
  });

  it("includes workflow", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      workflow: "1. Read code\n2. Make changes\n3. Test",
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Workflow");
    expect(output).toContain("1. Read code");
  });

  it("includes project commands", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      project: {
        name: "my-app",
        validateCommand: "npm run typecheck",
        testCommand: "npm test",
      },
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("`npm run typecheck`");
    expect(output).toContain("`npm test`");
  });

  it("includes recent log entries", () => {
    const brief: TaskBrief = {
      ...minimalBrief,
      recentLog: [
        { timestamp: "2025-01-01T00:00:00Z", event: "task_started", detail: "Starting work" },
      ],
    };
    const output = formatTaskBrief(brief);
    expect(output).toContain("## Recent Activity");
    expect(output).toContain("task_started");
    expect(output).toContain("Starting work");
  });
});
