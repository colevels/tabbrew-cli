import { homedir } from 'node:os'
import type { Command } from 'commander'
import pkg from '../../../package.json'
import { HOST, IDLE_EXIT_MS, LOG_PATH, PORTS } from '../session'
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
    `A session connects this CLI to the TabBrew side panel in Chrome so you can manage tabs from the terminal. It listens on ${HOST}:${PORTS.join('/')} and the side panel talks to it. Nothing works until a session is running.`,
    '',
    'WORKFLOW — check, then start, then work:',
    '1. `tabbrew session status --json` — is a session up? exit 0 = yes, exit 1 = no.',
    '2. `tabbrew session start` — start one in the background (no-op if already running).',
    '3. Open the TabBrew panel in Chrome (toolbar icon), then work: `tabbrew tabs list --json` lists every tab, window and group; `tabbrew windows list --json` summarises each window; `tabbrew groups list --json` lists every tab group; `tabbrew groups collapse <group...>` / `uncollapse` fold or expand groups by id; `tabbrew tabs move <tab...> --after <tab>` / `--before <tab>` puts tabs next to another tab, in its window; `tabbrew tabs discard <tab...>` unloads tabs from memory without closing them.',
    '4. `tabbrew session stop` — when done (optional; it also exits on its own when idle).',
    '',
    'RULES:',
    `- The session exits after ${idleMinutes} idle minutes; re-check status before assuming it is still up.`,
    `- Only ports ${PORTS.join(' and ')} are reachable from Chrome. Never set TABBREW_SESSION_PORTS outside tests.`,
    '- Browser commands need the panel open; "no TabBrew panel is listening" means open it and retry.',
    '- Prefer `--json` output when a command offers it; parse that, not the human text.',
    '- Discarding may give a tab a new id; take the id from `tabs discard --json` or re-list before reusing one.',
    '- Windows are named by label (A, B, C, …) as shown by `tabbrew windows list`. A label is stable while a session runs and is reassigned by a new session, so re-list after `session start`.',
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
