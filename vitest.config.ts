import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// vitest.config.ts REPLACES vite.config.ts (no merge): import and merge it so the
// react() plugin and the rest of the Vite config apply to the jsdom UI tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      setupFiles: ["./tests/setup.ts"],
      // environmentMatchGlobs is deprecated/removed in current vitest — use projects.
      // extends: true on BOTH projects: inline projects do NOT inherit root test
      // options (setupFiles!) without it — without this the setup guard silently
      // never runs.
      projects: [
        {
          extends: true,
          test: {
            name: "server",
            environment: "node",
            include: ["tests/server/**/*.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["tests/ui/**/*.test.tsx"],
          },
        },
      ],
    },
  }),
);
