import { defineConfig } from "vitest/config";

// Integration tests hit the real MySQL DB + live APIs via APP/.env.
// Run explicitly: npm run test:integration. Never required for CI green.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.js"],
    testTimeout: 30000,
  },
});
