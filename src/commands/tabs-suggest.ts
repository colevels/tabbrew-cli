import { resolve } from "node:path";
import { config } from "../config";
import { readFileOrNull } from "../fsops";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import {
  extractFencedTabbrewScript,
  renderParseErrors,
} from "../tabbrew-script/render";
import { TabsBridgeError, TabsInputError } from "./tabs-errors";
import { BIN, c } from "../ui";

export interface TabsSuggestOptions {
  /** Required: the plain-language sentence the user actually reads. */
  note?: string;
  json?: boolean;
}

interface QueueResponse {
  id?: string;
  queuedAt?: string;
  error?: string;
  detail?: string;
}

/**
 * `tabbrew tabs suggest <file> --note "…"` — validate a TabBrew Script and put
 * it in front of the user.
 *
 * `--note` is REQUIRED. A suggestion the user didn't ask for has to explain
 * itself in their own language, and making that structural is the only way it
 * reliably happens.
 *
 * This returns as soon as the bridge has the script. It does not wait for an
 * answer: the extension polls on its own timer, the user answers whenever they
 * look at the panel, and `tabs serve` records the verdict in the state file for
 * the next `tabs list` to report. An agent that blocked here would be holding a
 * socket open across a human decision.
 *
 * It cannot change a single tab. The extension previews the script and the user
 * applies it — so never report tabs as closed or grouped from here.
 */
export async function tabsSuggest(
  fileArg: string | undefined,
  opts: TabsSuggestOptions = {},
): Promise<void> {
  const note = (opts.note ?? "").trim();
  if (!note) {
    throw new TabsInputError(
      `\`${BIN} tabs suggest\` needs --note "<what this does, in the user's own words>" — ` +
        `it's the only thing they see before deciding.`,
    );
  }

  const raw = await readScriptInput(fileArg);
  const script = extractFencedTabbrewScript(raw);
  const { ops, errors } = parseTabbrewScript(script);

  if (errors.length > 0) {
    console.error(renderParseErrors(errors));
    process.exitCode = 1;
    return;
  }

  // Refuse locally rather than letting the bridge's empty-body guard answer with
  // "invalid_payload", which reads as a bridge failure when the real problem is
  // that nothing was passed in.
  if (ops.length === 0) {
    throw new TabsInputError(
      `That script has no operations to send. Write at least one op (DEL/PIN/UNPIN/GROUP/UNGROUP/MOVE), then \`${BIN} tabs suggest\` again.`,
    );
  }

  const port = config.serve.port;
  const basedOn = await lastSeenVersion();

  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/suggestion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script, note, basedOn, opCount: ops.length }),
    });
  } catch {
    throw new TabsBridgeError(
      `Nothing is listening on 127.0.0.1:${port} — start the bridge with \`${BIN} tabs serve\` first.`,
    );
  }

  const body = (await res.json().catch(() => null)) as QueueResponse | null;
  if (!res.ok) {
    throw new TabsBridgeError(
      `The bridge rejected the suggestion: ${body?.error ?? `HTTP ${res.status}`}${body?.detail ? ` — ${body.detail}` : ""}`,
    );
  }

  const id = body?.id ?? "";

  if (opts.json) {
    console.log(
      JSON.stringify({ ok: true, id, opCount: ops.length, basedOn }, null, 2),
    );
    return;
  }

  console.log(
    `${c.green("✓ Sent")} ${c.dim(`(${ops.length} op${ops.length === 1 ? "" : "s"})`)} — it's waiting for Accept or Deny in the TabBrew sidepanel.`,
  );
  console.log(
    c.dim(
      `  Nothing has changed in your browser yet. Run \`${BIN} tabs list\` later to see what they decided.`,
    ),
  );
}

/** Read the script from a file argument, or from stdin for `-` / no argument. */
async function readScriptInput(fileArg: string | undefined): Promise<string> {
  if (fileArg && fileArg !== "-") {
    const abs = resolve(process.cwd(), fileArg);
    const f = Bun.file(abs);
    if (!(await f.exists())) throw new TabsInputError(`Script file not found: ${abs}`);
    return await f.text();
  }
  if (process.stdin.isTTY) {
    throw new TabsInputError(
      `No script given. Pass a file (${BIN} tabs suggest plan.txt --note "…") or pipe one (… | ${BIN} tabs suggest - --note "…").`,
    );
  }
  return await Bun.stdin.text();
}

/**
 * The tab-state version this suggestion was reasoned about. The extension
 * compares it against what it sees now, and warns the user before they Accept a
 * plan written against tabs that have since moved.
 */
async function lastSeenVersion(): Promise<number> {
  const text = await readFileOrNull(config.serve.outPath);
  if (text === null) return 0;
  try {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    return typeof v === "number" && v >= 0 ? v : 0;
  } catch {
    return 0;
  }
}
