// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { BatchImportPanel } from "../../../src/viewer/components/prd-tree/batch-import-panel.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

/** Flush microtasks and Preact batched updates. */
async function flush() {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => queueMicrotask(r));
}

describe("BatchImportPanel", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the initial panel with title and drop zone", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-title")?.textContent).toBe("Batch Import");
    expect(root.querySelector(".batch-import-subtitle")).toBeTruthy();
    expect(root.querySelector(".batch-import-dropzone")).toBeTruthy();
  });

  it("renders the drop zone with file browse button", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const browseBtn = root.querySelector(".batch-import-browse-btn");
    expect(browseBtn).toBeTruthy();
    expect(browseBtn?.textContent).toBe("browse");
  });

  it("renders the add text entry button", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const addBtn = root.querySelector(".batch-import-add-text-btn");
    expect(addBtn).toBeTruthy();
    expect(addBtn?.textContent).toContain("Add text entry");
  });

  it("adds a text entry when add button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const addBtn = root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn");
    addBtn?.click();
    await flush();

    // Should now show the queue with one item
    expect(root.querySelector(".batch-import-queue")).toBeTruthy();
    expect(root.querySelector(".batch-import-queue-title")?.textContent).toContain("1 item");
    expect(root.querySelector(".batch-import-item-textarea")).toBeTruthy();
  });

  it("does not show process button when no valid items exist", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-process-btn")).toBeNull();
  });

  it("does not show queue when no items added", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("has hidden file input that accepts multiple file types", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const fileInput = root.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).toBeTruthy();
    expect(fileInput?.multiple).toBe(true);
    expect(fileInput?.accept).toContain(".txt");
    expect(fileInput?.accept).toContain(".md");
    expect(fileInput?.accept).toContain(".json");
    expect(fileInput?.style.display).toBe("none");
  });

  it("renders format badge for text entries", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add a text entry
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const badge = root.querySelector(".batch-import-format-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe("TEXT");
  });

  it("provides format selector for each item", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const select = root.querySelector<HTMLSelectElement>(".batch-import-format-select");
    expect(select).toBeTruthy();
    expect(select?.options.length).toBe(3);
    expect(select?.options[0]?.value).toBe("text");
    expect(select?.options[1]?.value).toBe("markdown");
    expect(select?.options[2]?.value).toBe("json");
  });

  it("has remove button for each item", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    const removeBtn = root.querySelector(".batch-import-remove-btn");
    expect(removeBtn).toBeTruthy();
    expect(removeBtn?.getAttribute("aria-label")).toBe("Remove item");
  });

  it("removes item when remove button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add an item
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();
    expect(root.querySelector(".batch-import-queue")).toBeTruthy();

    // Remove it
    root.querySelector<HTMLButtonElement>(".batch-import-remove-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("clears all items when clear all button is clicked", async () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    // Add two items
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();
    root.querySelector<HTMLButtonElement>(".batch-import-add-text-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue-title")?.textContent).toContain("2 items");

    // Clear all
    root.querySelector<HTMLButtonElement>(".batch-import-clear-btn")?.click();
    await flush();

    expect(root.querySelector(".batch-import-queue")).toBeNull();
  });

  it("shows supported file types hint in drop zone", () => {
    const root = renderToDiv(h(BatchImportPanel, { onPrdChanged: vi.fn() }));

    const hint = root.querySelector(".batch-import-dropzone-hint");
    expect(hint?.textContent).toContain(".txt");
    expect(hint?.textContent).toContain(".md");
    expect(hint?.textContent).toContain(".json");
  });
});
