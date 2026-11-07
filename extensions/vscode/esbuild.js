const esbuild = require("esbuild");

// VS Code loads the extension as a CommonJS Node module and the webview as a browser ES module.
const options = { bundle: true, minify: true, logLevel: "silent" };

Promise.all([
  esbuild.build({
    ...options,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    format: "cjs",
    platform: "node",
    external: ["vscode"],
  }),
  esbuild.build({
    ...options,
    entryPoints: ["src/webview/main.tsx"],
    outfile: "dist/webview/main.js",
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  }),
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
