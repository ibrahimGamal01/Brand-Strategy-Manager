import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const config = [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "storage/**",
      "prisma/**",
      "sessions/**",
      "*.log",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {},
  },
];

export default config;
