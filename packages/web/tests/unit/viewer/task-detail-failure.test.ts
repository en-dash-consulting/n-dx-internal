// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function makeItem(overrides: Partial<PRDItemData> = {}): PRDItemData {
  return {
    id: "test-item-1",
    title: "Test Item",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

function click(el: Element | null) {
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function keyDown(el: Element | null, key: string) {
  act(() => {
    el?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function inputValue(el: Element | null, value: string) {
  if (!el) return;
  act(() => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TaskDetail failure reason input", () => {
  it("shows reason input form when Failing button is clicked", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));

    expect(root.querySelector(".task-failure-input-form")).not.toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("submitting with a reason calls onUpdate with status and failureReason", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));

    const input = root.querySelector(".task-failure-input");
    inputValue(input, "Tests are broken");

    click(root.querySelector(".task-failure-submit-btn"));

    expect(onUpdate).toHaveBeenCalledWith("test-item-1", {
      status: "failing",
      failureReason: "Tests are broken",
    });
  });

  it("pressing Escape hides the form without calling onUpdate", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));
    expect(root.querySelector(".task-failure-input-form")).not.toBeNull();

    keyDown(root.querySelector(".task-failure-input"), "Escape");

    expect(root.querySelector(".task-failure-input-form")).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("pressing Enter submits the form when reason is non-empty", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));
    const input = root.querySelector(".task-failure-input");
    inputValue(input, "CI pipeline fails");
    keyDown(input, "Enter");

    expect(onUpdate).toHaveBeenCalledWith("test-item-1", {
      status: "failing",
      failureReason: "CI pipeline fails",
    });
  });

  it("submit button is disabled when reason is empty", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));

    const submitBtn = root.querySelector(".task-failure-submit-btn") as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn.disabled).toBe(true);
  });

  it("clicking other status buttons works immediately without showing a form", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-in_progress'));

    expect(onUpdate).toHaveBeenCalledWith("test-item-1", { status: "in_progress" });
    expect(root.querySelector(".task-failure-input-form")).toBeNull();
  });

  it("shows existing failure reason with edit button when item is failing", () => {
    const item = makeItem({
      status: "failing",
      failureReason: "Integration tests fail",
    });
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    expect(root.textContent).toContain("Integration tests fail");

    const editBtn = root.querySelector(".task-failure-edit-btn");
    expect(editBtn).not.toBeNull();
    expect(editBtn?.textContent).toBe("Edit");
  });

  it("clicking edit on existing failure reason opens input pre-populated", () => {
    const item = makeItem({
      status: "failing",
      failureReason: "Integration tests fail",
    });
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector(".task-failure-edit-btn"));

    const input = root.querySelector(".task-failure-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Integration tests fail");
  });

  it("cancel button dismisses the form", () => {
    const item = makeItem();
    const onUpdate = vi.fn();
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });

    click(root.querySelector('.task-status-btn.prd-status-failing'));
    expect(root.querySelector(".task-failure-input-form")).not.toBeNull();

    click(root.querySelector(".task-failure-cancel-btn"));
    expect(root.querySelector(".task-failure-input-form")).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not show edit button when onUpdate is not provided", () => {
    const item = makeItem({
      status: "failing",
      failureReason: "Something broke",
    });
    const root = document.createElement("div");
    act(() => { render(h(TaskDetail, { item, allItems: [item] }), root); });

    expect(root.textContent).toContain("Something broke");
    expect(root.querySelector(".task-failure-edit-btn")).toBeNull();
  });
});
