import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "data", "tools", "docs", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["*.config.ts", "e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine is pure TS: no React, no store, no UI, no JSON loaders (types from @/data/types are fine).
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-dom",
            "zustand",
            "zustand/*",
            "@/ui/*",
            "@/state/*",
            "@data/*",
            "@/data/index",
            "@/data/load*",
          ],
        },
      ],
    },
  },
);
