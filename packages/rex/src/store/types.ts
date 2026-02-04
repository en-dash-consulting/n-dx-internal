import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";

export interface StoreCapabilities {
  adapter: string;
  supportsTransactions: boolean;
  supportsWatch: boolean;
}

export interface PRDStore {
  loadDocument(): Promise<PRDDocument>;
  saveDocument(doc: PRDDocument): Promise<void>;
  getItem(id: string): Promise<PRDItem | null>;
  addItem(item: PRDItem, parentId?: string): Promise<void>;
  updateItem(id: string, updates: Partial<PRDItem>): Promise<void>;
  removeItem(id: string): Promise<void>;
  loadConfig(): Promise<RexConfig>;
  saveConfig(config: RexConfig): Promise<void>;
  appendLog(entry: LogEntry): Promise<void>;
  readLog(limit?: number): Promise<LogEntry[]>;
  loadWorkflow(): Promise<string>;
  saveWorkflow(content: string): Promise<void>;
  capabilities(): StoreCapabilities;
}
