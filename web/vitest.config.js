import { mergeConfig, defineConfig } from "vite";
import { defineConfig as defineTestConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

// REG-102 fix: no frontend test harness existed before this — this is the
// first jsdom/RTL setup in the project (server tests use Vitest+supertest
// against Node, not a DOM).
export default mergeConfig(
  viteConfig,
  defineTestConfig({
    test: {
      environment: "jsdom",
      setupFiles: "./tests/setup.js",
      // globals:true is required for @testing-library/react's automatic
      // per-test DOM cleanup (it detects a global `afterEach`) — without it,
      // each test's rendered tree leaks into the next test's DOM.
      globals: true,
    },
  })
);
