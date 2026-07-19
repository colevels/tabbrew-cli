// Where `init` writes. One target (Claude Code) is registered today; the
// AgentTarget abstraction is the seam for adding Cursor/Codex/Gemini later
// without reshaping init.ts.

import { homedir } from "node:os";
import { join } from "node:path";

export type Scope = "local" | "global";

/** Directory name of the installed skill under the agent's skills/ dir. */
const SKILL_NAME = "tabbrew-tabs";

export interface AgentTarget {
  id: string;
  displayName: string;
  /** Filename of the always-loaded memory file (e.g. CLAUDE.md). */
  instructionsFile: string;
  /** Filename of the slim awareness doc the block imports. */
  awarenessFile: string;
  /** Directory (name) the skill is installed under: <skills>/<skillName>/. */
  skillName: string;
  /** Filename of the skill doc written into that directory. */
  skillFile: string;
  /** Directory both the instructions + awareness files live in for the scope. */
  resolveDir(scope: Scope): string;
  /** Directory the skill file lives in for the scope (may differ from resolveDir). */
  resolveSkillsDir(scope: Scope): string;
  /** The import line inserted into the instructions file. */
  importRef(awarenessFile: string, scope: Scope): string;
}

const claude: AgentTarget = {
  id: "claude",
  displayName: "Claude Code",
  instructionsFile: "CLAUDE.md",
  awarenessFile: "TABBREW-CLI.md",
  skillName: SKILL_NAME,
  skillFile: "SKILL.md",
  resolveDir(scope) {
    if (scope === "local") return process.cwd();
    const override = process.env.CLAUDE_CONFIG_DIR?.trim();
    return override && override.length ? override : join(homedir(), ".claude");
  },
  resolveSkillsDir(scope) {
    // Claude Code discovers skills under `.claude/skills/<name>/` for a project
    // and `<config>/skills/<name>/` globally. The local instructions file is the
    // bare cwd, so the skills dir needs its own `.claude/` segment here.
    const base =
      scope === "local"
        ? join(process.cwd(), ".claude")
        : process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
    return join(base, "skills", SKILL_NAME);
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
