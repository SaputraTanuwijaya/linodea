// @ts-expect-error node:url is a Node builtin
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Dedicated Vitest config (not the Tauri-tuned vite.config.ts, which carries dev
// server / HMR settings irrelevant to tests). Only the `@` alias is shared so
// tests resolve app imports the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
