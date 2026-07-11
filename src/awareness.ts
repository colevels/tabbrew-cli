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

## Commands
- \`tabbrew login\`   — sign in via device flow (opens a browser; prints a code).
- \`tabbrew whoami\`  — verify the token and print the current user (exit 1 if logged out).
- \`tabbrew logout\`  — delete the stored token.
- \`tabbrew tools repo-info\` — report git repo stats.
- \`tabbrew docs push <file.html>\` — send an HTML file to the TabBrew Docs view.
  Local by default (registers the absolute path; opens as file://). Add \`--cloud\`
  to upload the content (≤ 2 MB) for cross-machine viewing, or \`--title "…"\` to set
  the Docs-list title (defaults to the doc's <title>, else the filename).

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
