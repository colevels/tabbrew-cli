import { readScriptInput } from "./tabs";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import {
  extractFencedTabbrewScript,
  renderParseErrors,
  summarizeOps,
} from "../tabbrew-script/render";
import { resolveServePort } from "./tabs-serve";
import { BIN, c } from "../ui";

/** The local `tabs serve` isn't reachable, or rejected the queued script. */
export class TabsPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabsPushError";
  }
}

export interface TabsPushOptions {
  port?: number;
}

interface QueueResponseBody {
  queuedAt?: string;
  error?: string;
  detail?: string;
}

/**
 * `tabbrew tabs push <file>` — validate a TabBrew Script (same parse step as
 * `tabs check`) and hand it to the local `tabs serve` bridge for the extension
 * to poll, preview, and run. Never executes anything itself: this process has no
 * access to the browser, which is exactly why the command isn't called `run`.
 */
export async function tabsPush(
  fileArg: string | undefined,
  opts: TabsPushOptions = {},
): Promise<void> {
  const raw = await readScriptInput(fileArg);
  const script = extractFencedTabbrewScript(raw);
  const { ops, errors } = parseTabbrewScript(script);

  if (errors.length > 0) {
    console.error(renderParseErrors(errors));
    process.exitCode = 1;
    return;
  }

  // Refuse locally rather than letting the server's empty-body guard answer with
  // "invalid_payload", which reads as a bridge failure when the real problem is
  // that nothing was passed in.
  if (ops.length === 0) {
    throw new TabsPushError(
      `That script has no operations to send. Write at least one op (DEL/PIN/UNPIN/GROUP/UNGROUP/MOVE), then \`${BIN} tabs push\` again.`,
    );
  }

  // Must match the port `tabs serve` bound to. Both resolve it the same way, so
  // `--port` and TABBREW_SERVE_PORT stay in step across the two commands.
  const port = resolveServePort(opts.port);
  const url = `http://127.0.0.1:${port}/script`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script }),
    });
  } catch {
    throw new TabsPushError(
      `Nothing is listening on 127.0.0.1:${port} — start the bridge with \`${BIN} tabs serve\` first` +
        (opts.port === undefined ? "." : ", or pass a matching --port."),
    );
  }

  const body = (await res.json().catch(() => null)) as QueueResponseBody | null;
  if (!res.ok) {
    throw new TabsPushError(
      `The bridge rejected the script: ${body?.error ?? `HTTP ${res.status}`}${body?.detail ? ` — ${body.detail}` : ""}`,
    );
  }

  const stats = summarizeOps(ops);
  console.log(
    `${c.green("✓ Sent")} ${c.dim(`(${stats.total} op${stats.total === 1 ? "" : "s"})`)} — open the TabBrew sidepanel ${c.dim("→")} Developer mode ${c.dim("→")} TabBrew Script to review it, then click ${c.bold("Run")}.`,
  );
  console.log(c.dim("  Nothing has changed in your browser yet."));
}
