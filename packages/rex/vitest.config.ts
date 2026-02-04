import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^(.+)\.js$/, replacement: "$1.ts" }] },
  test: { include: ["tests/**/*.test.ts"] },
});
