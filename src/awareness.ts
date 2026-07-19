// The "awareness" payload tabbrew-cli installs into an AI agent's memory, plus
// the pure string helpers that weave a managed block into a CLAUDE.md-style file.
//
// Everything here is filesystem-free and bundled as string constants so it
// survives `bun build --compile` (no runtime file reads). Disk I/O lives in
// fsops.ts; orchestration in commands/init.ts.

/** The slim "how to use tabbrew-cli" doc written as TABBREW-CLI.md. */
export const TABBREW_CLI_MD = `# tabbrew-cli

\`tabbrew\` is a command-line tool installed on this machine for authenticating to
TabBrew (OAuth 2.0 device flow) and running agent-facing tools. Use it from the shell.

## When to use it
- The user asks to sign in to / check auth against / sign out of TabBrew.
- You need to confirm the active TabBrew identity before an authenticated action.
- The user asks for \`tabbrew tools\` output (e.g. repo-info).
- The user wants to send an HTML file (plan, report, viewer) to TabBrew so it
  opens from the sidepanel Docs view ("send this to tabbrew", "ส่งเข้า tabbrew").
- The user pastes their tabs (from the extension's **Copy AI Prompt** button) or sends
  them via the local bridge, and wants them organized/closed/grouped — generate a
  TabBrew Script, validate it with \`tabbrew tabs check\`, then \`tabbrew tabs push\` it
  for them to run (see **Managing tabs** below).

## Commands
- \`tabbrew login\`   — sign in via device flow (opens a browser; prints a code).
- \`tabbrew whoami\`  — verify the token and print the current user (exit 1 if logged out).
- \`tabbrew logout\`  — delete the stored token.
- \`tabbrew tools repo-info\` — report git repo stats.
- \`tabbrew docs push <file.html>\` — send an HTML file to the TabBrew Docs view.
  Local by default (registers the absolute path; opens as file://). Add \`--cloud\`
  to upload the content (≤ 2 MB) for cross-machine viewing, or \`--title "…"\` to set
  the Docs-list title (defaults to the doc's <title>, else the filename).
- \`tabbrew docs list\` — list the HTML docs on your account. Prefer \`--json\` for parsing:
  an array of \`{ id, title, filename, sizeBytes, kind: "gcs"|"local", localPath, createdAt,
  updatedAt }\` (ISO-8601 dates, raw byte counts; empty list is \`[]\`). The default table is
  for humans and is lossy — parse the JSON, not the table.
- \`tabbrew tabs check <file|->\` — validate a TabBrew Script you generated
  (line-numbered parse errors, exit 1 on any). Pass the script as a file or on stdin
  (accepts a whole \`\`\`tabbrew fenced block). Add \`--snapshot <file>\` (the Copy-AI-Prompt
  markdown, or a \`.json\` payload) for a simulated before/after preview; \`--json\` for
  machine output. Runs locally — no server, no browser.
- \`tabbrew tabs push <file|->\` — validate a script, then hand it to the extension to
  preview. Requires \`tabbrew tabs serve\` already running (\`--port\` must match if it
  isn't on the default 49227). This does **not** run the script: it lands in the
  extension's panel and the user clicks **Run** themselves.
- \`tabbrew tabs serve\` — start the local bridge (127.0.0.1 only) the extension exports
  its open tabs to and polls for pushed scripts. Long-running; it blocks until Ctrl+C,
  so start it in a background/second shell, never in the foreground of a task you
  need to finish.
- \`tabbrew tabs list\` — show the tabs the extension last exported (\`--json\` for the raw
  saved payload: \`{ savedAt, count, tabs }\`). Check \`savedAt\` before trusting the tab
  ids — it's a snapshot on disk and can be stale.
- \`tabbrew tabs prompt [--variant full|standard|compact]\` — print the interactive
  skill prompt (same one \`tabbrew init\` installs as a skill).

## Managing tabs (generate a TabBrew Script)
The DSL has six verbs, one per line: \`DEL\` \`PIN\` \`UNPIN\` \`GROUP\` \`UNGROUP\` \`MOVE\`.
Where the tabs come from — either works:
- The user pastes the extension's **Copy AI Prompt** output (\`# Goal / # Cross-window /
  # Windows / # Groups / # Tabs\` sections), or
- The bridge is running and the user clicked **Send to Claude Code**, so
  \`tabbrew tabs list\` shows the tabs directly.

Then:
1. Follow the installed \`tabbrew-tabs\` skill to generate a script — clarify a vague
   goal, list every \`DEL\` target and confirm before closing, emit one \`\`\`tabbrew block.
2. Validate it: save the script and the pasted snapshot to files, then
   \`tabbrew tabs check script.tbrew --snapshot snapshot.md\`. Fix any parse errors and
   review the preview (especially closes and dropped stale ids).
3. Get it in front of the user — \`tabbrew tabs push script.tbrew\` if the bridge is
   running, otherwise tell them to paste the script into the extension's developer mode.
4. Either way **they** click **Run**. Execution happens in the browser, never here —
   nothing the CLI does can change their tabs, so never report tabs as closed/grouped.

## Non-interactive / CI
Set \`TABBREW_TOKEN\` to authenticate without a login prompt (it wins over the stored
credential file). \`NO_COLOR\` disables ANSI. \`TABBREW_DEBUG\` prints stack traces.
Credentials live at \`~/.config/tabbrew/credentials.json\` (chmod 600).
`;

// Version-less FIND marker so a future v2 block is still located by indexOf and
// replaced in place (not duplicated). The emitted opening line carries the
// version; the end marker has a leading slash, so FIND is never a substring of
// END and indexOf(FIND) can never land on the closing marker.
const FIND = "<!-- tabbrew-cli-instructions";
const START = "<!-- tabbrew-cli-instructions v1 -->";
const END = "<!-- /tabbrew-cli-instructions -->";

export type BlockAction = "added" | "updated" | "unchanged";

/** Build the managed block that gets inserted into the instructions file. */
export function buildManagedBlock(importRef: string): string {
  return [
    START,
    "## tabbrew-cli (agent CLI)",
    "`tabbrew` is installed on this machine — it authenticates to TabBrew and exposes",
    "agent tools. Full usage:",
    "",
    importRef,
    END,
  ].join("\n");
}

function malformed(): Error {
  return new Error(
    `Malformed tabbrew-cli block: found "${FIND}" without a closing "${END}". ` +
      `Remove the stray marker by hand, then re-run.`,
  );
}

/**
 * Insert or replace the managed block. Idempotent: re-running with the same
 * block returns action "unchanged". Throws if an opening marker is present with
 * no matching close (we refuse to touch a file we can't safely edit).
 */
export function upsertManagedBlock(
  content: string,
  block: string,
): { content: string; action: BlockAction } {
  const startIdx = content.indexOf(FIND);
  if (startIdx === -1) {
    const trimmed = content.trim();
    const next = trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`;
    return { content: next, action: "added" };
  }

  const endIdx = content.indexOf(END, startIdx);
  if (endIdx === -1) throw malformed();

  const before = content.slice(0, startIdx).trimEnd();
  const after = content.slice(endIdx + END.length).trimStart();
  const next = [before, block, after].filter((p) => p.length > 0).join("\n\n") + "\n";
  return { content: next, action: next === content ? "unchanged" : "updated" };
}

/**
 * Remove the managed block. Returns removed=false when no block is present.
 * Throws on a malformed (unterminated) block. Callers should run the result
 * through collapseBlankLines.
 */
export function removeManagedBlock(content: string): {
  content: string;
  removed: boolean;
} {
  const startIdx = content.indexOf(FIND);
  if (startIdx === -1) return { content, removed: false };

  const endIdx = content.indexOf(END, startIdx);
  if (endIdx === -1) throw malformed();

  const next = content.slice(0, startIdx) + content.slice(endIdx + END.length);
  return { content: next, removed: true };
}

/** Collapse 3+ consecutive newlines to 2 and normalize a single trailing newline. */
export function collapseBlankLines(content: string): string {
  const collapsed = content.replace(/\n{3,}/g, "\n\n").trim();
  return collapsed.length ? collapsed + "\n" : "";
}
