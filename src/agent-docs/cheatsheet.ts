import { homedir } from 'node:os'
import type { Command } from 'commander'
import pkg from '../../package.json'
import { HOST, IDLE_EXIT_MS, LOG_PATH, PORTS } from '../session/config'
import { MARKER_END, MARKER_START } from './block'

export function render(program: Command): string {
  const idleMinutes = Math.round(IDLE_EXIT_MS / 60_000)
  const log = LOG_PATH.replace(homedir(), '~')
  return [
    MARKER_START,
    `TabBrew CLI v${pkg.version}`,
    'CLI: run every command as `tabbrew <cmd>`. Non-interactive; safe for agents, CI and scripts.',
    '',
    'WHAT IT IS:',
    `TabBrew links this terminal to Chrome. A background session listens on ${HOST}:${PORTS.join('/')} and the TabBrew browser extension talks to it. Nothing works until a session is running.`,
    '',
    'WORKFLOW — check, then start, then work:',
    '1. `tabbrew session status --json` — is a session up? exit 0 = yes, exit 1 = no.',
    '2. `tabbrew session start` — start one in the background (no-op if already running).',
    '3. Do the browser work through the TabBrew extension.',
    '4. `tabbrew session stop` — when done (optional; it also exits on its own when idle).',
    '',
    'RULES:',
    `- The session exits after ${idleMinutes} idle minutes; re-check status before assuming it is still up.`,
    `- Only ports ${PORTS.join(' and ')} are reachable from Chrome. Never set TABBREW_SESSION_PORTS outside tests.`,
    '- Prefer `--json` output when a command offers it; parse that, not the human text.',
    `- Background output goes to ${log}; read it when start fails.`,
    '- After upgrading the tabbrew binary run `tabbrew session stop` then `start` so the new version serves.',
    '- Re-run `tabbrew init` after upgrading to refresh this block; do not edit it by hand.',
    '',
    'COMMANDS:',
    ...commandLines(program),
    MARKER_END,
  ].join('\n')
}

type Row = { usage: string; description: string }

function commandLines(program: Command): string[] {
  const rows: Row[] = []
  for (const cmd of program.commands) collect(cmd, `${program.name()} ${cmd.name()}`, rows)
  const width = Math.max(0, ...rows.map((row) => row.usage.length))
  return rows.map((row) => `  ${row.usage.padEnd(width)}  ${row.description}`)
}

function collect(cmd: Command, prefix: string, rows: Row[]): void {
  if (cmd.commands.length === 0) {
    const args = cmd.registeredArguments.map((a) =>
      a.required ? `<${a.name()}>` : `[${a.name()}]`,
    )
    const flags = cmd.options.map((o) => `[${o.flags}]`)
    rows.push({ usage: [prefix, ...args, ...flags].join(' '), description: cmd.description() })
    return
  }
  for (const sub of cmd.commands) collect(sub, `${prefix} ${sub.name()}`, rows)
}
