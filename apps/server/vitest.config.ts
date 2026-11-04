import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres database.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
