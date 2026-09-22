import { defineConfig } from "vitest/config";

// Integration tests hit a real MySQL. Run explicitly with
// `npm run test:integration`, and on every push via the `install` CI job
// against a throwaway MySQL service container.
//
// They are required for CI green, and they earned it the first time they ran:
// they found that activeAdminCount() had been comparing against bare words
// (`role = admin`), so the check meant to stop an operator deleting the last
// administrator threw instead of refusing. Every unit test mocks the driver,
// which is precisely why that class of bug survives until something real
// executes the SQL.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.js"],
    testTimeout: 30000,
  },
});
