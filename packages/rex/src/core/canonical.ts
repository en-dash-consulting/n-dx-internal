import type { PRDItem, Priority } from "../schema/index.js";

export function toCanonicalJSON(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortItems(items: PRDItem[]): PRDItem[] {
  const sorted = [...items].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.priority ?? "medium"];
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
  return sorted.map((item) => {
    if (item.children && item.children.length > 0) {
      return { ...item, children: sortItems(item.children) };
    }
    return item;
  });
}
