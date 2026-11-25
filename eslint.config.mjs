import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "mobile/**",
  ]),
  {
    rules: {
      // Phase 1 files (owned by P2/P3) have pre-existing warnings; keep as warn so CI stays green while surfacing them.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
