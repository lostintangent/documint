import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    platform: "browser",
    deps: {
      onlyBundle: ["lucide-react"],
    },
    dts: {
      emitDtsOnly: true,
      generator: "tsc",
    },
  },
  fmt: {
    ignorePatterns: ["test/goldens/**/*.md"],
  },
  lint: {
    plugins: ["react"],
    env: {
      browser: true,
      es2024: true,
      node: true,
    },
    globals: {
      Bun: "readonly",
    },
    rules: {
      "no-console": "off",
    },
    options: {
      denyWarnings: true,
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    "*": "vp check --fix",
  },
});
