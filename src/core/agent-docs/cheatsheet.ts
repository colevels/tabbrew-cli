import { homedir } from 'node:os'
import type { Command } from 'commander'
import pkg from '../../../package.json'
import { HOST, IDLE_EXIT_MS, LOG_PATH, PORTS, PROJECT_CONFIG } from '../session'
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
    `A session connects this CLI to the TabBrew extension in Chrome so you can manage tabs from the terminal. It listens on ${HOST}:${PORTS.join('/')} and an extension page (the connection page the CLI opens, or the side panel) talks to it. Nothing works until a session is running and a page is connected.`,
    '',
    'WORKFLOW — check, then start, then work:',
    '1. `tabbrew session status --json` — is a session up? exit 0 = yes, exit 1 = no.',
    '2. `tabbrew session start` — start one in the background and open the connection page in Chrome (no-op if already running).',
    '3. Work: `tabbrew tabs list --json` lists every tab, window and group; `tabbrew windows list --json` summarises each window; `tabbrew groups list --json` lists every tab group; `tabbrew groups collapse <group...>` / `uncollapse` fold or expand groups by id; `tabbrew groups close <group...>` closes groups by moving them into a throwaway window and closing it, so Chrome keeps them saved;`tabbrew tabs create [url]` opens a tab in the background (add `--window`, `--after`/`--before` or `--group` to place it); `tabbrew tabs focus <tab>` selects a tab and raises its window to the front; `tabbrew tabs move <tab...> --after <tab>` / `--before <tab>` puts tabs next to another tab, in its window; `tabbrew tabs group <tab...> --to <group>` / `--window <window>` joins or creates a tab group (add `--title`/`--color`/`--collapse`/`--expand` to set them); `tabbrew tabs discard <tab...>` unloads tabs from memory without closing them; `tabbrew tabs close <tab...>` closes tabs outright, all in one call.',
    '4. `tabbrew session stop` — when done (optional; it also exits on its own when idle).',
    '',
    'RULES:',
    `- The session exits after ${idleMinutes} idle minutes; re-check status before assuming it is still up.`,
    `- Only ports ${PORTS.join(' and ')} are reachable from Chrome. Never set TABBREW_SESSION_PORTS outside tests.`,
    '- Browser commands need a connected page; "nothing is connected to the session" means run `tabbrew session open` and retry.',
    '- Prefer `--json` output when a command offers it; parse that, not the human text.',
    '- `tabs close` cannot be undone, and closing the last tab in a window closes the window; discard instead when the tab should survive.',
    '- Discarding may give a tab a new id; take the id from `tabs discard --json` or re-list before reusing one.',
    '- Windows are named by label (A, B, C, …) as shown by `tabbrew windows list`. A label is stable while a session runs and is reassigned by a new session, so re-list after `session start`.',
    `- Background output goes to ${log}; read it when start fails.`,
    '- After upgrading the tabbrew binary run `tabbrew session stop` then `start` so the new version serves.',
    '- Re-run `tabbrew init` after upgrading to refresh this block; do not edit it by hand.',
    `- \`${PROJECT_CONFIG}\` in the project picks which extension build \`session start\` opens; set it with \`tabbrew init --extension harness|<id>\` (\`store\` clears it), not by hand.`,
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
