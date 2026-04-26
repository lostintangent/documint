// Ambient module declaration for CSS imports. Loaded globally via
// `tsconfig.json`'s `typeRoots: ["./types"]` + `types: ["css"]` —
// this directory is treated as a type package by both `tsc` and the
// declaration bundler used in `build:prod`, so the declaration is in
// scope without needing a triple-slash reference at the import site.
//
// Bun's bundler resolves `import css from "./foo.css" with { type: "text" }`
// at build time and inlines the file contents as a string. This declaration
// teaches TypeScript the same shape.
declare module "*.css" {
  const content: string;
  export default content;
}
