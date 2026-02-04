/**
 * Thin abstraction over the Notion API for rex sync.
 *
 * Consumers inject a concrete implementation (live or mock) into the
 * NotionStore adapter.  This keeps HTTP concerns out of the store layer
 * and makes the adapter fully testable without network calls.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface NotionAdapterConfig {
  /** Notion integration token (secret_xxx or ntn_xxx). */
  token: string;
  /** ID of the Notion database that holds the PRD. */
  databaseId: string;
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface NotionClient {
  /** Retrieve database metadata (properties, schema). */
  getDatabase(databaseId: string): Promise<any>;

  /** Query all pages in a database (handles pagination internally). */
  queryDatabase(databaseId: string): Promise<any[]>;

  /** Retrieve a single page by ID. */
  getPage(pageId: string): Promise<any>;

  /** Create a page with properties, parent, and optional child blocks. */
  createPage(params: {
    parent: { database_id?: string; page_id?: string };
    properties: Record<string, any>;
    children?: any[];
  }): Promise<any>;

  /** Update an existing page's properties. */
  updatePage(
    pageId: string,
    properties: Record<string, any>,
  ): Promise<any>;

  /** Archive (soft-delete) a page. */
  archivePage(pageId: string): Promise<void>;

  /** Retrieve child blocks of a page (for description / acceptance criteria). */
  getBlockChildren(pageId: string): Promise<any[]>;
}

// ---------------------------------------------------------------------------
// Live implementation — calls the Notion REST API directly
// ---------------------------------------------------------------------------

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class LiveNotionClient implements NotionClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const url = `${NOTION_API}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Notion API ${method} ${path} failed (${res.status}): ${text}`,
      );
    }
    // 204 No Content (e.g. archive) returns no body
    if (res.status === 204) return undefined;
    return res.json();
  }

  async getDatabase(databaseId: string): Promise<any> {
    return this.request("GET", `/databases/${databaseId}`);
  }

  async queryDatabase(databaseId: string): Promise<any[]> {
    const pages: any[] = [];
    let cursor: string | undefined;

    do {
      const body: any = {};
      if (cursor) body.start_cursor = cursor;

      const res = await this.request(
        "POST",
        `/databases/${databaseId}/query`,
        body,
      );
      pages.push(...(res.results ?? []));
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    return pages;
  }

  async getPage(pageId: string): Promise<any> {
    return this.request("GET", `/pages/${pageId}`);
  }

  async createPage(params: {
    parent: { database_id?: string; page_id?: string };
    properties: Record<string, any>;
    children?: any[];
  }): Promise<any> {
    return this.request("POST", "/pages", params);
  }

  async updatePage(
    pageId: string,
    properties: Record<string, any>,
  ): Promise<any> {
    return this.request("PATCH", `/pages/${pageId}`, { properties });
  }

  async archivePage(pageId: string): Promise<void> {
    await this.request("PATCH", `/pages/${pageId}`, { archived: true });
  }

  async getBlockChildren(pageId: string): Promise<any[]> {
    const blocks: any[] = [];
    let cursor: string | undefined;

    do {
      const path = `/blocks/${pageId}/children${cursor ? `?start_cursor=${cursor}` : ""}`;
      const res = await this.request("GET", path);
      blocks.push(...(res.results ?? []));
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
