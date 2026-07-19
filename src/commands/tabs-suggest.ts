import { config } from "../config";
import { readFileOrNull } from "../fsops";
import { readScriptInput, TabsInputError } from "./tabs";
import { parseTabbrewScript } from "../tabbrew-script/parser";
import {
  extractFencedTabbrewScript,
  renderParseErrors,
  summarizeOps,
} from "../tabbrew-script/render";
import { pingBridge, resolveServePort } from "./tabs-serve";
import { TabsPushError } from "./tabs-push";
import { BIN, c } from "../ui";

export interface TabsSuggestOptions {
  port?: number;
  /** Required: the plain-language sentence the user actually reads. */
  note?: string;
  /** Seconds to wait for accept/deny. 0 (via --no-wait) returns immediately. */
  wait?: number;
  noWait?: boolean;
  json?: boolean;
}

interface QueueResponse {
  id?: string;
  queuedAt?: string;
  error?: string;
  detail?: string;
}

interface VerdictResponse {
  id?: string;
  decision?: string;
  reason?: string | null;
  opCount?: number | null;
  at?: string;
}

const DEFAULT_WAIT_S = 300;
const MAX_WAIT_S = 300;

/**
 * `tabbrew tabs suggest <file> --note "…"` — the auto-mode sibling of
 * `tabs push`. Three things make it a separate command rather than two flags on
 * push:
 *
 *  1. `--note` is REQUIRED. A suggestion the user didn't ask for has to explain
 *     itself in their own language, and making that structural is the only way
 *     it reliably happens. `tabs push` stays note-free for the manual flow.
 *  2. It waits for the answer by default, so the agent loop learns whether the
 *     user accepted, and why they didn't.
 *  3. "push" is a fire-and-forget verb; this one is a proposal.
 *
 * Like push, it cannot change a single tab — the extension previews it and the
 * user applies it.
 */
export async function tabsSuggest(
  fileArg: string | undefined,
  opts: TabsSuggestOptions = {},
): Promise<void> {
  const note = (opts.note ?? "").trim();
  if (!note) {
    throw new TabsInputError(
      `\`${BIN} tabs suggest\` needs --note "<what this does, in the user's own words>" — ` +
        `it's the only thing they see before deciding. Use \`${BIN} tabs push\` for a bare script.`,
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

  if (ops.length === 0) {
    throw new TabsPushError(
      `That script has no operations to send. Write at least one op (DEL/PIN/UNPIN/GROUP/UNGROUP/MOVE), then \`${BIN} tabs suggest\` again.`,
    );
  }

  const port = resolveServePort(opts.port);
  const basedOn = await lastSeenVersion();

  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/suggestion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ script, note, basedOn }),
    });
  } catch {
    throw new TabsPushError(
      `Nothing is listening on 127.0.0.1:${port} — start the bridge with \`${BIN} tabs serve\` first` +
        (opts.port === undefined ? "." : ", or pass a matching --port."),
    );
  }

  const body = (await res.json().catch(() => null)) as QueueResponse | null;
  if (!res.ok) {
    throw new TabsPushError(
      `The bridge rejected the suggestion: ${body?.error ?? `HTTP ${res.status}`}${body?.detail ? ` — ${body.detail}` : ""}`,
    );
  }

  const id = body?.id ?? "";
  const stats = summarizeOps(ops);
  const waitS = opts.noWait ? 0 : Math.min(opts.wait ?? DEFAULT_WAIT_S, MAX_WAIT_S);

  if (waitS <= 0) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, id, decision: null, opCount: stats.total }, null, 2));
      return;
    }
    console.log(
      `${c.green("✓ Sent")} ${c.dim(`(${stats.total} op${stats.total === 1 ? "" : "s"})`)} — waiting for the user in the TabBrew sidepanel.`,
    );
    console.log(c.dim("  Nothing has changed in your browser yet."));
    return;
  }

  if (!opts.json) {
    console.log(
      `${c.dim("→ Sent")} ${c.dim(`(${stats.total} op${stats.total === 1 ? "" : "s"})`)} — waiting up to ${waitS}s for Accept or Deny…`,
    );
  }

  const verdict = await waitForDecision(port, id, waitS);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          id,
          decision: verdict?.decision ?? null,
          reason: verdict?.reason ?? null,
          opCount: verdict?.opCount ?? null,
          sentOps: stats.total,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Deliberately never a non-zero exit: "the user said no" is an answer, not a
  // failure, and an agent that treats it as one will retry instead of listen.
  if (!verdict) {
    console.log(
      c.yellow("… No answer yet.") +
        ` The suggestion is still waiting — the user may not have the TabBrew sidepanel open.`,
    );
    return;
  }
  if (verdict.decision === "accepted") {
    const n = verdict.opCount ?? stats.total;
    console.log(`${c.green("✓ Accepted")} ${c.dim(`— ${n} op${n === 1 ? "" : "s"} applied.`)}`);
    return;
  }
  if (verdict.decision === "stale") {
    console.log(
      `${c.yellow("↺ Out of date")} ${c.dim("— those tabs changed before it could run. Re-read the tabs and suggest again.")}`,
    );
    return;
  }
  if (verdict.decision === "failed") {
    // Accepted by the user, refused by the browser. Distinct from a denial:
    // they wanted this, so fix the script rather than dropping the idea.
    console.log(`${c.red("✗ Accepted, but it didn't run")}${verdict.reason ? ` — ${verdict.reason}` : "."}`);
    console.log(c.dim("  The tabs are unchanged. Re-read them before trying again."));
    return;
  }
  console.log(`${c.red("✗ Denied")}${verdict.reason ? ` — ${verdict.reason}` : ""}`);
  console.log(c.dim("  Nothing changed. Don't re-send this one."));
}

/**
 * Long-poll for the verdict, re-issuing the request if the server's own wait
 * ceiling is shorter than ours. Any transport hiccup ends the wait rather than
 * spinning — the suggestion is still queued, and the caller can ask again.
 */
async function waitForDecision(
  port: number,
  id: string,
  waitS: number,
): Promise<VerdictResponse | null> {
  const deadline = Date.now() + waitS * 1000;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const url = `http://127.0.0.1:${port}/decision?id=${encodeURIComponent(id)}&wait=${remaining}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      // A dropped connection isn't an answer. Only give up if the bridge is
      // actually gone — otherwise keep waiting with the time that's left, since
      // the suggestion is still sitting on the user's screen.
      if (!(await pingBridge(port))) return null;
      continue;
    }
    if (res.status === 204) continue;
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as VerdictResponse | null;
    if (body?.decision) return body;
    return null;
  }
}

/** The tab-state version this suggestion was reasoned about, for staleness. */
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
