import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // chokidar-backed tests depend on real FS events, which macOS FSEvents
    // can delay beyond any reasonable timeout. Serialize files to reduce
    // contention; allow one retry for genuine timing hiccups.
    fileParallelism: false,
    retry: 1,
  },
});
