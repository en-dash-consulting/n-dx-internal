import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rexRoot = resolve(import.meta.dirname, "../rex");

export default defineConfig({
  resolve: {
    alias: [
      // Map bare "rex" import to source public.ts barrel for vitest
      { find: /^rex$/, replacement: `${rexRoot}/src/public.ts` },
      // Map rex subpath imports to source .ts files for vitest
      { find: /^rex\/dist\/(.+)\.js$/, replacement: `${rexRoot}/src/$1.ts` },
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: { include: ["tests/**/*.test.ts"] },
});
