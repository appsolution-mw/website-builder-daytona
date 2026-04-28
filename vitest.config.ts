import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.ts"],
    setupFiles: ["./lib/test-setup.ts"],
    // DB-touching suites share the same Postgres tables and use deleteMany() for
    // cleanup. Run files sequentially so concurrent suites don't truncate each
    // other's rows mid-run.
    fileParallelism: false,
  },
});
