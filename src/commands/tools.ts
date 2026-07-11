import { $ } from "bun";
import { c } from "../ui";
import { which } from "../util";

/**
 * Demo of orchestrating an external tool: shell out to `git` via Bun's shell,
 * but only after confirming it's installed with which().
 */
export async function repoInfo(): Promise<void> {
  if (!which("git")) {
    console.error(c.red("✗ git is not installed or not on your PATH."));
    console.error("  Install it first: https://git-scm.com/downloads");
    process.exitCode = 1;
    return;
  }

  const inside = await $`git rev-parse --is-inside-work-tree`.quiet().nothrow();
  if (inside.exitCode !== 0 || inside.stdout.toString().trim() !== "true") {
    console.error(c.red("✗ Not inside a git repository."));
    console.error("  Run this from within a git working tree.");
    process.exitCode = 1;
    return;
  }

  const branch = (await $`git rev-parse --abbrev-ref HEAD`.quiet().text()).trim();
  const commit = (await $`git rev-parse --short HEAD`.quiet().text()).trim();
  const subject = (await $`git log -1 --pretty=%s`.quiet().text()).trim();
  const porcelain = await $`git status --porcelain`.quiet().text();
  const changed = porcelain.split("\n").filter((line) => line.trim().length > 0)
    .length;

  console.log(c.bold("Repo info (via git):"));
  console.log(`  branch:        ${branch}`);
  console.log(`  HEAD:          ${commit}  ${c.dim(subject)}`);
  console.log(`  changed files: ${changed}`);
}
