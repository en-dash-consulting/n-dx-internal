import { User } from "../models/user.js";

export function sendWelcome(user: User): string {
  return `Welcome, ${user.name}!`;
}
