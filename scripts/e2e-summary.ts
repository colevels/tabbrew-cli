// Turns the e2e run into a GitHub job summary: one row per test from bun's
// JUnit output, then the Chrome state tables the suite recorded, and the
// session/Chrome logs when something failed.
//
//   bun scripts/e2e-summary.ts <junit.xml> <report.md> [log...]
//
// Writes to $GITHUB_STEP_SUMMARY, or stdout when unset.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [junitPath, reportPath, ...logPaths] = process.argv.slice(2)
if (!junitPath || !reportPath) {
  console.error('usage: e2e-summary.ts <junit.xml> <report.md> [log...]')
  process.exit(2)
}

const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

const decode = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')

const attribute = (tag: string, name: string): string =>
  decode(new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? '')

interface Case {
  name: string
  seconds: number
  failure: string | null
}

// Self-closing testcases passed; the others wrap a <failure> or <skipped>.
const CASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g
function parseCases(xml: string): Case[] {
  const cases: Case[] = []
  for (const match of xml.matchAll(CASE)) {
    const [, head = '', body = ''] = match
    const failure = /<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body)
    cases.push({
      name: attribute(head, 'name'),
      seconds: Number(attribute(head, 'time')) || 0,
      // bun writes only a type; the message is in the step log.
      failure: failure
        ? decode(failure[2]?.trim() || '') ||
          attribute(failure[1] ?? '', 'message') ||
          `${attribute(failure[1] ?? '', 'type') || 'failed'} (see the test step log)`
        : null,
    })
  }
  return cases
}

const xml = read(junitPath)
const cases = parseCases(xml)
const failed = cases.filter((c) => c.failure !== null)
const lines: string[] = []

if (cases.length === 0) {
  lines.push('## e2e against a real Chrome', '', '⚠️ No test results were produced.')
} else {
  const verdict = failed.length === 0 ? '✅' : '❌'
  lines.push(
    `## ${verdict} e2e against a real Chrome`,
    '',
    `${cases.length - failed.length} passed, ${failed.length} failed`,
    '',
    '| | Test | Time |',
    '| --- | --- | ---: |',
    ...cases.map(
      (c) => `| ${c.failure === null ? '✅' : '❌'} | ${c.name} | ${c.seconds.toFixed(2)}s |`,
    ),
    '',
  )
  for (const c of failed) {
    lines.push(
      `<details><summary>❌ ${c.name}</summary>`,
      '',
      '```',
      c.failure ?? '',
      '```',
      '',
      '</details>',
      '',
    )
  }
}

const report = read(reportPath).trim()
if (report) {
  lines.push(
    '<details><summary>Chrome state after each step</summary>',
    '',
    report,
    '',
    '</details>',
    '',
  )
}

// A job summary cannot embed artifact files, so the screenshots are only named here.
const shotsDir = process.env.E2E_SHOTS_DIR
const shots =
  shotsDir && existsSync(shotsDir)
    ? readdirSync(shotsDir)
        .filter((f) => f.endsWith('.png'))
        .sort()
    : []
if (shots.length > 0) {
  lines.push(
    `Screenshots of the Xvfb screen, in the \`e2e-chrome\` artifact:`,
    '',
    ...shots.map((f) => `- \`${f}\``),
    '',
  )
}

if (failed.length > 0 || cases.length === 0) {
  for (const path of logPaths) {
    const log = read(path).trim()
    if (!log) continue
    lines.push(
      `<details><summary>${basename(path)}</summary>`,
      '',
      '```',
      log,
      '```',
      '',
      '</details>',
      '',
    )
  }
}

const out = `${lines.join('\n')}\n`
const summary = process.env.GITHUB_STEP_SUMMARY
if (summary) appendFileSync(summary, out)
else process.stdout.write(out)
// The PR comment reuses the same markdown.
if (process.env.E2E_SUMMARY_OUT) writeFileSync(process.env.E2E_SUMMARY_OUT, out)
