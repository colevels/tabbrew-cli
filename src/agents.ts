// Where `init` writes. One target (Claude Code) is registered today; the
// AgentTarget abstraction is the seam for adding Cursor/Codex/Gemini later
// without reshaping init.ts.

import { homedir } from "node:os";
import { join } from "node:path";

export type Scope = "local" | "global";

/**
 * The skill `init` installs. One, now: a one-off request and a watch loop are
 * the same three steps (read `tabs list` → write a script → `tabs suggest`), so
 * the two skills that used to disagree about confirming a `DEL` in chat have
 * nothing left to disagree about — the panel's Accept button is the confirmation
 * either way.
 */
export const SKILL_TABS = "tabbrew-tabs";

/**
 * Skills earlier versions installed that are now wrong, not just outdated:
 * `tabbrew-auto` tells the agent to run `tabbrew tabs watch`, which no longer
 * exists. `init` removes these on both install and uninstall, so upgrading isn't
 * left to the user noticing an orphaned directory.
 */
export const LEGACY_SKILLS = ["tabbrew-auto"] as const;

export interface AgentTarget {
  id: string;
  displayName: string;
  /** Filename of the always-loaded memory file (e.g. CLAUDE.md). */
  instructionsFile: string;
  /** Filename of the slim awareness doc the block imports. */
  awarenessFile: string;
  /** Directory names the skills are installed under: <skills>/<name>/. */
  skillNames: readonly string[];
  /** Skill dirs a previous version installed, removed on install and uninstall. */
  legacySkillNames: readonly string[];
  /** Filename of the skill doc written into each of those directories. */
  skillFile: string;
  /** Directory both the instructions + awareness files live in for the scope. */
  resolveDir(scope: Scope): string;
  /** Directory one named skill lives in for the scope (may differ from resolveDir). */
  resolveSkillsDir(scope: Scope, skillName: string): string;
  /** The import line inserted into the instructions file. */
  importRef(awarenessFile: string, scope: Scope): string;
}

const claude: AgentTarget = {
  id: "claude",
  displayName: "Claude Code",
  instructionsFile: "CLAUDE.md",
  awarenessFile: "TABBREW-CLI.md",
  skillNames: [SKILL_TABS],
  legacySkillNames: LEGACY_SKILLS,
  skillFile: "SKILL.md",
  resolveDir(scope) {
    if (scope === "local") return process.cwd();
    const override = process.env.CLAUDE_CONFIG_DIR?.trim();
    return override && override.length ? override : join(homedir(), ".claude");
  },
  resolveSkillsDir(scope, skillName) {
    // Claude Code discovers skills under `.claude/skills/<name>/` for a project
    // and `<config>/skills/<name>/` globally. The local instructions file is the
    // bare cwd, so the skills dir needs its own `.claude/` segment here.
    const base =
      scope === "local"
        ? join(process.cwd(), ".claude")
        : process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
    return join(base, "skills", skillName);
  },
  importRef(awarenessFile) {
    // Claude Code resolves @relative imports relative to the importing file's
    // own directory, so a relative ref is correct in both scopes (the awareness
    // doc is always a sibling). Codex, when added, will need an absolute path
    // here instead (it resolves @ relative to CWD).
    return `@${awarenessFile}`;
  },
};

export const agents: Record<string, AgentTarget> = { claude };

/** Look up a target by id, or throw listing the supported ids. */
export function resolveAgent(id: string): AgentTarget {
  const target = agents[id];
  if (!target) {
    throw new Error(
      `Unknown --agent "${id}". Supported: ${Object.keys(agents).join(", ")}.`,
    );
  }
  return target;
}
