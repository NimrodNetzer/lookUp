import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    // Exclude Playwright e2e tests — those run via `npm run test:e2e`, not Vitest
    exclude: ["e2e/**", "node_modules/**"],
  },
});
