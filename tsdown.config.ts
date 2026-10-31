import { defineConfig } from "tsdown";

// Bun bundles the JavaScript (scripts/build/build.ts). tsdown only rolls the
// public types into the single dist/index.d.ts, inlining lucide-react's types
// because the icons are bundled rather than declared as a dependency.
export default defineConfig({
  platform: "browser",
  deps: {
    onlyBundle: ["lucide-react"],
  },
  dts: {
    emitDtsOnly: true,
    generator: "tsc",
  },
});
