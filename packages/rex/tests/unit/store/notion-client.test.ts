import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveNotionClient } from "../../../src/store/notion-client.js";

describe("LiveNotionClient", () => {
  let client: LiveNotionClient;
  const token = "secret_test_token";

  beforeEach(() => {
    client = new LiveNotionClient(token);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: unknown) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  describe("getDatabase", () => {
    it("calls GET /databases/:id with correct headers", async () => {
      const dbData = { id: "db-123", properties: {} };
      mockFetch(200, dbData);

      const result = await client.getDatabase("db-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/databases/db-123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
          }),
        }),
      );
      expect(result).toEqual(dbData);
    });

    it("throws on non-OK response", async () => {
      mockFetch(404, { message: "Not found" });

      await expect(client.getDatabase("bad-id")).rejects.toThrow(
        /Notion API GET \/databases\/bad-id failed \(404\)/,
      );
    });
  });

  describe("queryDatabase", () => {
    it("returns all pages from a single response", async () => {
      const pages = [{ id: "p1" }, { id: "p2" }];
      mockFetch(200, { results: pages, has_more: false });

      const result = await client.queryDatabase("db-123");
      expect(result).toEqual(pages);
    });

    it("paginates through multiple responses", async () => {
      mockFetch(200, {
        results: [{ id: "p1" }],
        has_more: true,
        next_cursor: "cursor-abc",
      });
      mockFetch(200, {
        results: [{ id: "p2" }],
        has_more: false,
      });

      const result = await client.queryDatabase("db-123");
      expect(result).toEqual([{ id: "p1" }, { id: "p2" }]);
      expect(fetch).toHaveBeenCalledTimes(2);

      // Second call should include start_cursor
      const secondCallBody = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
      );
      expect(secondCallBody.start_cursor).toBe("cursor-abc");
    });
  });

  describe("getPage", () => {
    it("calls GET /pages/:id", async () => {
      const pageData = { id: "page-123", properties: {} };
      mockFetch(200, pageData);

      const result = await client.getPage("page-123");
      expect(result).toEqual(pageData);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/pages/page-123",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  describe("createPage", () => {
    it("calls POST /pages with parent and properties", async () => {
      const created = { id: "new-page" };
      mockFetch(200, created);

      const result = await client.createPage({
        parent: { database_id: "db-123" },
        properties: { Name: { title: [{ text: { content: "Test" } }] } },
      });

      expect(result).toEqual(created);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/pages",
        expect.objectContaining({ method: "POST" }),
      );

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.parent).toEqual({ database_id: "db-123" });
      expect(body.properties.Name).toBeDefined();
    });

    it("includes children when provided", async () => {
      mockFetch(200, { id: "new-page" });

      await client.createPage({
        parent: { database_id: "db-123" },
        properties: {},
        children: [{ object: "block", type: "paragraph" }],
      });

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.children).toHaveLength(1);
    });
  });

  describe("updatePage", () => {
    it("calls PATCH /pages/:id with properties", async () => {
      const updated = { id: "page-123" };
      mockFetch(200, updated);

      const result = await client.updatePage("page-123", {
        Name: { title: [{ text: { content: "Updated" } }] },
      });

      expect(result).toEqual(updated);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.notion.com/v1/pages/page-123",
        expect.objectContaining({ method: "PATCH" }),
      );

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.properties.Name).toBeDefined();
    });
  });

  describe("archivePage", () => {
    it("calls PATCH /pages/:id with archived: true", async () => {
      mockFetch(200, { id: "page-123", archived: true });

      await client.archivePage("page-123");

      const body = JSON.parse(
        (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
      );
      expect(body.archived).toBe(true);
    });
  });

  describe("getBlockChildren", () => {
    it("returns all blocks from a single response", async () => {
      const blocks = [
        { type: "paragraph", paragraph: {} },
        { type: "heading_2", heading_2: {} },
      ];
      mockFetch(200, { results: blocks, has_more: false });

      const result = await client.getBlockChildren("page-123");
      expect(result).toEqual(blocks);
    });

    it("paginates through multiple responses", async () => {
      mockFetch(200, {
        results: [{ type: "paragraph" }],
        has_more: true,
        next_cursor: "block-cursor",
      });
      mockFetch(200, {
        results: [{ type: "heading_2" }],
        has_more: false,
      });

      const result = await client.getBlockChildren("page-123");
      expect(result).toEqual([{ type: "paragraph" }, { type: "heading_2" }]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
