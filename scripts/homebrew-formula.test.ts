import { describe, expect, test } from 'bun:test'
import { parseChecksums, renderFormula } from './homebrew-formula'

const sha = (seed: string) => seed.repeat(64).slice(0, 64)
const checksums = `${sha('a')}  tabbrew-darwin-arm64
${sha('b')}  tabbrew-darwin-x64
${sha('c')}  tabbrew-linux-arm64
${sha('d')}  tabbrew-linux-x64
${sha('e')}  tabbrew-extension.zip
`

describe('renderFormula', () => {
  test('puts every target under its os/cpu block with the release url', () => {
    const formula = renderFormula('0.9.4', parseChecksums(checksums))
    // Homebrew reads the version from the url; an explicit `version` fails brew audit.
    expect(formula).not.toContain('version "')
    expect(formula).toMatch(
      /on_macos do\n\s+on_arm do\n\s+url "https:\/\/github.com\/colevels\/tabbrew-cli\/releases\/download\/v0.9.4\/tabbrew-darwin-arm64"\n\s+sha256 "a{64}"/,
    )
    expect(formula).toMatch(
      /on_linux do\n\s+on_arm do\n\s+url ".*tabbrew-linux-arm64"\n\s+sha256 "c{64}"/,
    )
    expect(formula).toMatch(/on_intel do\n\s+url ".*tabbrew-linux-x64"\n\s+sha256 "d{64}"/)
    expect(formula).not.toContain('extension.zip')
  })

  test('refuses a checksums file missing a target', () => {
    const partial = parseChecksums(checksums.replace(/.*tabbrew-linux-x64\n/, ''))
    expect(() => renderFormula('0.9.4', partial)).toThrow(/tabbrew-linux-x64/)
  })
})
