// Text-asset imports. Bun's bundler inlines `import x from "./x.md" with { type: "text" }`
// at compile time (a bundle-time string, not a runtime FS read — so it survives
// `bun build --compile`, matching the filesystem-free rule the awareness doc relies on).
// This ambient declaration is what makes `tsc --noEmit` accept the import.
declare module "*.md" {
  const content: string;
  export default content;
}
