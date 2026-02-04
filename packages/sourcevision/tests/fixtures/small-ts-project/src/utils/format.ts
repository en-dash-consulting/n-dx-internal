export function formatName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
