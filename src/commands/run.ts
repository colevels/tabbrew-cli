import { readScriptInput } from "./tabs";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import { extractFencedTabbrewScript, renderParseErrors, summarizeOps } from "../tabbrew-script/render";
import { config } from "../config";
import { c } from "../ui";

/** The local `tabbrew serve` isn't reachable, or rejected the queued script. */
export class RunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunError";
  }
}

interface QueueResponseBody {
  queuedAt?: string;
  error?: string;
  detail?: string;
}

/**
 * `tabbrew run <file>` — validate a TabBrew Script (same parse step as
 * `tabs check`) and queue it on the local `tabbrew serve` server for the
 * extension to poll, preview, and run. Never executes anything itself — this
 * process has no access to the browser.
 */
export async function run(fileArg: string | undefined): Promise<void> {
  const raw = await readScriptInput(fileArg);
  const script = extractFencedTabbrewScript(raw);
  const { ops, errors } = parseTabbrewScript(script);

  if (errors.length > 0) {
    console.error(renderParseErrors(errors));
    process.exitCode = 1;
    return;
  }

  const url = `http://127.0.0.1:${config.serve.port}/script`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script }),
    });
  } catch {
    throw new RunError(
      "tabbrew serve isn't running — start it with `tabbrew serve` first.",
    );
  }

  const body = (await res.json().catch(() => null)) as QueueResponseBody | null;
  if (!res.ok) {
    throw new RunError(
      `tabbrew serve rejected the script: ${body?.error ?? `HTTP ${res.status}`}${body?.detail ? ` — ${body.detail}` : ""}`,
    );
  }

  const stats = summarizeOps(ops);
  console.log(
    `${c.green("✓ Script queued")} ${c.dim(`(${stats.total} op(s))`)} — open the TabBrew sidepanel ${c.dim("→")} Developer mode ${c.dim("→")} TabBrew Script to review and run it.`,
  );
}
