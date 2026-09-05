import { rmSync } from 'node:fs'
import pkg from '../package.json'

const dir = import.meta.dir
const out = `${dir}/dist`

rmSync(out, { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: [`${dir}/src/background.ts`, `${dir}/src/sidepanel.ts`],
  outdir: out,
  target: 'browser',
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// The extension carries the CLI's version so a mismatch in the panel means
// exactly one thing: the session was started by an older or newer tabbrew.
const manifest = (await Bun.file(`${dir}/manifest.json`).json()) as Record<string, unknown>
await Bun.write(
  `${out}/manifest.json`,
  `${JSON.stringify({ ...manifest, version: pkg.version }, null, 2)}\n`,
)
await Bun.write(`${out}/sidepanel.html`, Bun.file(`${dir}/sidepanel.html`))

console.log(`extension v${pkg.version} built to ${out}`)
