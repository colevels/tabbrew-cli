// Builds @tabbrew/sdk into sdk/dist: one browser ESM file, plus declarations.
//
//   bun scripts/build-sdk.ts
//
// The consumer is another extension's bundler and its TypeScript, not Bun, so
// nothing here may assume either: no .ts in the package, no Bun globals in the
// declarations.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const dist = 'sdk/dist'
rmSync(dist, { recursive: true, force: true })

const built = await Bun.build({
  entrypoints: ['sdk/src/index.ts'],
  outdir: dist,
  format: 'esm',
  target: 'browser',
})
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}

await $`tsc -p sdk/tsconfig.build.json`

// The sources import without extensions, as the rest of the repo does, and
// tsc copies the specifiers as they are. TypeScript under node16/nodenext
// resolves a relative import in an ESM package only with its extension on.
const declarations = readdirSync(join(dist, 'types'), { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.d.ts'))
  .map((path) => join(dist, 'types', path))
for (const path of declarations) {
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replace(/(from '\.{1,2}\/[^']+)'/g, "$1.js'"))
}
