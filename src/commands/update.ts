import { c, BIN } from "../ui";
import { checkForUpdate, performUpdate } from "../update";

export interface UpdateCommandOptions {
  check?: boolean;
  json?: boolean;
}

/**
 * `tabbrew update` — replace the installed binary with the latest GitHub
 * Release. `--check` only reports whether a newer version exists (always exits 0;
 * `--json` for scripting). The full form downloads, verifies the checksum, and
 * swaps the binary in place with no prompt.
 */
export async function update(opts: UpdateCommandOptions): Promise<void> {
  if (opts.check) {
    const info = await checkForUpdate();
    if (opts.json) {
      console.log(JSON.stringify(info));
      return;
    }
    if (info.updateAvailable) {
      console.log(`Update available: ${info.current} → ${c.green(info.latest)}`);
      console.log(c.dim(`Run \`${BIN} update\` to upgrade.`));
    } else {
      console.log(c.dim(`${BIN} is up to date (${info.current}).`));
    }
    return;
  }

  const { info, replaced } = await performUpdate();
  if (replaced) {
    console.log(
      `${c.green("✓")} Updated ${BIN} ${info.current} → ${c.green(info.latest)}`,
    );
  } else {
    console.log(c.dim(`${BIN} is already up to date (${info.current}).`));
  }
}
