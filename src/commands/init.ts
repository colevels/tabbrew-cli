import { mkdir, rmdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { c } from "../ui";
import { resolveAgent, type AgentTarget, type Scope } from "../agents";
import {
  TABBREW_CLI_MD,
  buildManagedBlock,
  collapseBlankLines,
  removeManagedBlock,
  upsertManagedBlock,
} from "../awareness";
import { TABS_SKILL } from "../tabbrew-script/skills";
import {
  atomicWrite,
  backupFile,
  readFileOrNull,
  removeFileIfExists,
  writeIfChanged,
} from "../fsops";

export interface InitOptions {
  global?: boolean;
  dryRun?: boolean;
  uninstall?: boolean;
  yes?: boolean;
  agent?: string;
  /** Skip installing the tabbrew-tabs skill. */
  noSkill?: boolean;
}

/** One skill to write: where it goes and what goes in it. */
interface SkillPlan {
  name: string;
  dir: string;
  path: string;
  content: string;
}

interface Paths {
  target: AgentTarget;
  scope: Scope;
  dir: string;
  awarenessPath: string;
  instructionsPath: string;
  skills: SkillPlan[];
  /** Skill dirs from an older version to delete; see AgentTarget.legacySkillNames. */
  legacySkillDirs: string[];
}

export async function init(opts: InitOptions): Promise<void> {
  const target = resolveAgent(opts.agent ?? "claude");
  const scope: Scope = opts.global ? "global" : "local";
  const dir = target.resolveDir(scope);
  const paths: Paths = {
    target,
    scope,
    dir,
    awarenessPath: join(dir, target.awarenessFile),
    instructionsPath: join(dir, target.instructionsFile),
    skills: target.skillNames.map((name) => {
      const skillDir = target.resolveSkillsDir(scope, name);
      return {
        name,
        dir: skillDir,
        path: join(skillDir, target.skillFile),
        content: TABS_SKILL,
      };
    }),
    legacySkillDirs: target.legacySkillNames.map((name) =>
      target.resolveSkillsDir(scope, name),
    ),
  };

  if (opts.uninstall) return uninstall(paths, opts);
  return install(paths, opts);
}

/**
 * Delete skills an older tabbrew-cli installed. This is cleanup, not
 * uninstallation: `tabbrew-auto` tells the agent to run `tabbrew tabs watch`,
 * which no longer exists, so leaving it behind is worse than leaving nothing.
 * Best-effort and quiet — a skill the user never had is not news.
 */
async function removeLegacySkills(
  target: AgentTarget,
  dirs: string[],
): Promise<string[]> {
  const removed: string[] = [];
  for (const dir of dirs) {
    if (await removeFileIfExists(join(dir, target.skillFile))) removed.push(dir);
    await rmdir(dir).catch(() => {});
  }
  return removed;
}

/** What removeLegacySkills *would* remove — so --dry-run reports the same set. */
async function planLegacySkills(
  target: AgentTarget,
  dirs: string[],
): Promise<string[]> {
  const found: string[] = [];
  for (const dir of dirs) {
    if ((await readFileOrNull(join(dir, target.skillFile))) !== null) found.push(dir);
  }
  return found;
}

async function install(paths: Paths, opts: InitOptions): Promise<void> {
  const { target, scope, dir, awarenessPath, instructionsPath, skills, legacySkillDirs } =
    paths;
  const dryRun = !!opts.dryRun;

  const installSkills = !opts.noSkill;

  const currentAwareness = await readFileOrNull(awarenessPath);
  const currentClaude = await readFileOrNull(instructionsPath);

  const block = buildManagedBlock(target.importRef(target.awarenessFile, scope));
  const { content: nextClaude } = upsertManagedBlock(currentClaude ?? "", block); // may throw on malformed

  const awarenessAction = plan(currentAwareness, TABBREW_CLI_MD);
  const claudeAction = plan(currentClaude, nextClaude);

  if (dryRun) {
    const lines = [
      statusLine(target.awarenessFile, awarenessPath, awarenessAction),
      statusLine(target.instructionsFile, instructionsPath, claudeAction),
    ];
    for (const skill of skills) {
      lines.push(
        statusLine(
          skill.name,
          skill.path,
          installSkills
            ? plan(await readFileOrNull(skill.path), skill.content)
            : "skipped (--no-skill)",
        ),
      );
    }
    for (const dir of await planLegacySkills(target, legacySkillDirs)) {
      lines.push(statusLine(basename(dir), dir, "removed"));
    }
    console.log(lines.join("\n"));
    console.log(c.dim("[dry-run] Nothing written."));
    return;
  }

  // Prompt only before modifying an existing instructions file we don't own.
  if (currentClaude !== null && claudeAction === "updated" && !opts.yes) {
    if (!confirm(`Modify ${instructionsPath}? A ${target.instructionsFile}.bak backup is written first.`)) {
      console.log(c.yellow("Aborted — no files were changed."));
      process.exitCode = 1;
      return;
    }
  }

  await mkdir(dir, { recursive: true });

  const lines: string[] = [];

  // Awareness doc first so the @import never points at a missing file.
  lines.push(statusLine(target.awarenessFile, awarenessPath, await writeIfChanged(awarenessPath, TABBREW_CLI_MD)));

  if (currentClaude !== null && claudeAction === "updated") {
    if (await backupFile(instructionsPath)) {
      lines.push(`  ${c.dim("backup")}    ${c.dim(instructionsPath + ".bak")}`);
    }
  }
  lines.push(statusLine(target.instructionsFile, instructionsPath, await writeIfChanged(instructionsPath, nextClaude)));

  // The skill lives in its own skills/<name>/ dir.
  for (const skill of skills) {
    if (!installSkills) {
      lines.push(statusLine(skill.name, skill.path, "skipped (--no-skill)"));
      continue;
    }
    await mkdir(skill.dir, { recursive: true });
    lines.push(statusLine(skill.name, skill.path, await writeIfChanged(skill.path, skill.content)));
  }

  // Unconditional: an orphaned tabbrew-auto would keep telling the agent to run
  // a command that's gone, whether or not this run installed anything.
  for (const removed of await removeLegacySkills(target, legacySkillDirs)) {
    lines.push(statusLine(basename(removed), removed, "removed"));
  }

  console.log(lines.join("\n"));
  console.log("");
  console.log(`${c.green("✓")} tabbrew-cli awareness installed for ${c.bold(target.displayName)} ${c.dim(`(${scope})`)}.`);
  if (installSkills) {
    console.log(
      c.dim(`  ${c.bold("tabbrew-tabs")} — read the tabs, propose a change, let them accept or deny.`),
    );
  }
  console.log(c.dim(`  ${target.displayName} picks it up on its next run.`));
}

async function uninstall(paths: Paths, opts: InitOptions): Promise<void> {
  const { target, scope, awarenessPath, instructionsPath, skills, legacySkillDirs } =
    paths;
  const dryRun = !!opts.dryRun;

  const currentAwareness = await readFileOrNull(awarenessPath);
  const currentClaude = await readFileOrNull(instructionsPath);

  // Compute the CLAUDE.md outcome up front (may throw on a malformed block).
  let nextClaude: string | null = null;
  let blockRemoved = false;
  if (currentClaude !== null) {
    const res = removeManagedBlock(currentClaude);
    blockRemoved = res.removed;
    if (res.removed) nextClaude = collapseBlankLines(res.content);
  }
  const claudeEmpties = nextClaude !== null && nextClaude.length === 0;

  if (dryRun) {
    const claudeStatus =
      currentClaude === null ? "absent" : !blockRemoved ? "no block" : claudeEmpties ? "delete (empty)" : "updated";
    const lines = [
      statusLine(target.instructionsFile, instructionsPath, claudeStatus),
      statusLine(target.awarenessFile, awarenessPath, currentAwareness === null ? "absent" : "removed"),
    ];
    for (const skill of skills) {
      const current = await readFileOrNull(skill.path);
      lines.push(statusLine(skill.name, skill.path, current === null ? "absent" : "removed"));
    }
    for (const dir of await planLegacySkills(target, legacySkillDirs)) {
      lines.push(statusLine(basename(dir), dir, "removed"));
    }
    console.log(lines.join("\n"));
    console.log(c.dim("[dry-run] Nothing written."));
    return;
  }

  const lines: string[] = [];

  if (!blockRemoved) {
    lines.push(statusLine(target.instructionsFile, instructionsPath, "no block"));
  } else {
    await backupFile(instructionsPath); // it existed — back it up before mutating
    if (claudeEmpties) {
      await removeFileIfExists(instructionsPath);
      lines.push(statusLine(target.instructionsFile, instructionsPath, "removed"));
    } else {
      await atomicWrite(instructionsPath, nextClaude as string);
      lines.push(statusLine(target.instructionsFile, instructionsPath, "updated"));
    }
  }

  const removedDoc = await removeFileIfExists(awarenessPath);
  lines.push(statusLine(target.awarenessFile, awarenessPath, removedDoc ? "removed" : "absent"));

  for (const skill of skills) {
    const removedSkill = await removeFileIfExists(skill.path);
    lines.push(statusLine(skill.name, skill.path, removedSkill ? "removed" : "absent"));
    // Best-effort: drop the now-empty skills/<name>/ dir. Silently ignores a
    // non-empty dir (ENOTEMPTY) or an already-absent one.
    if (removedSkill) await rmdir(skill.dir).catch(() => {});
  }

  for (const removed of await removeLegacySkills(target, legacySkillDirs)) {
    lines.push(statusLine(basename(removed), removed, "removed"));
  }

  console.log(lines.join("\n"));
  console.log("");
  console.log(`${c.green("✓")} tabbrew-cli awareness removed for ${c.bold(target.displayName)} ${c.dim(`(${scope})`)}.`);
}

/** Intended action for a file, comparing current content against the target. */
function plan(current: string | null, next: string): "created" | "updated" | "unchanged" {
  if (current === null) return "created";
  return current === next ? "unchanged" : "updated";
}

/** One reporting line: colored mark + padded filename + dim path + status word. */
function statusLine(name: string, path: string, status: string): string {
  const changed = new Set(["created", "updated", "removed"]);
  const mark =
    status === "created" ? c.green("+") : status === "removed" ? c.green("-") : status === "updated" ? c.green("~") : c.dim("=");
  const word = changed.has(status) ? status : c.dim(status);
  return `  ${mark} ${name.padEnd(14)} ${c.dim(path)}  ${word}`;
}

/** Yes/No prompt, default No. Non-TTY / EOF → No (safe for pipes and CI). */
function confirm(question: string): boolean {
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${question} [y/N]`);
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}
