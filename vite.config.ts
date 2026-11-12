/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Data build served by the app. When a new build is generated, change it here AND in tsconfig.app.json "paths".
const DATA_BUILD = "1.60.1.70888";

export default defineConfig({
  base: "/talentcalc/",
  plugins: [react()],
  resolve: {
    alias: {
      "@data": fileURLToPath(new URL(`./data/generated/${DATA_BUILD}`, import.meta.url)),
      "@manual": fileURLToPath(new URL("./data/manual", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1100 },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
