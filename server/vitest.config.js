import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // Live-DB/API integration tests are opt-in (require a real .env + network) —
    // excluded from the default `npm test` so CI never needs real credentials
    // for the unit suite. Run them explicitly with `npm run test:integration`.
    exclude: ["tests/integration/**", "node_modules/**"],
    // The unit suite must be hermetic. src/config.js hard-exits on a missing or
    // weak SESSION_SECRET, so without this 15 test files died with
    // "process.exit unexpectedly called with 1" on any machine that did not
    // happen to have a real .env lying next to the repo — which made the
    // comment above false and the suite unrunnable on a fresh clone.
    // This value is a test fixture and is never a real secret.
    env: {
      SESSION_SECRET: "test-only-session-secret-0123456789abcdef0123456789abcdef",
    },
  },
});
