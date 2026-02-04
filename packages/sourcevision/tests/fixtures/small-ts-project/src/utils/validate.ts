import { formatName } from "./format.js";

export function validateName(name: string): boolean {
  return formatName(name).length > 0;
}
