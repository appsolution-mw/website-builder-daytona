import { defineConfig } from "vitest/config";
import { resolve } from "path";

// @wbd/broker is a workspace symlink. Its dependencies (@openai/codex-sdk)
// are not hoisted to the root node_modules because they are only direct deps
// of the broker sub-package. When Vite transforms broker source files it
// resolves from the project root, so it can't find those IDs. We point them
// directly at the pnpm content store entries that pnpm installed for the
// broker.
const pnpm = resolve(__dirname, "node_modules/.pnpm");

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname),
      "@openai/codex-sdk": resolve(
        pnpm,
        "@openai+codex-sdk@0.122.0/node_modules/@openai/codex-sdk",
      ),
    },
  },
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
