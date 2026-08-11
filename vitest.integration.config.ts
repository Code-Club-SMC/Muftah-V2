import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

const value = process.env.TEST_DATABASE_URL;
if (!value || !new URL(value).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must target a database ending in _test");
}
process.env.DATABASE_URL = value;

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/__tests__/integration/**/*.test.ts",
      "src/lib/sales/offline/**/*.integration.test.ts",
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
