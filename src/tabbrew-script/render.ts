// CLI-native — NOT a vendored mirror. Everything here is owned by tabbrew-cli:
//   - extractFencedTabbrewScript: mirror of tabbrew-api/src/lib/extract.ts (minus
//     the Anthropic dependency) so `tabs suggest` tolerates a whole ```tabbrew
//     message, not just a bare script
//   - the op summary and the parse-error renderer
//
// It deliberately does NOT render tabs. The extension ships its own rendered
// snapshot in the payload it POSTs, and `tabs list` prints that verbatim — so
// there is no second renderer here to drift from it.

import { c } from "../ui";
import type { Op, ParseError } from "./types";

// ── fenced-block extraction (mirror of extract.ts) ──────────────────────────

const FENCE_LINE = /^\s*```/;

export const extractFencedTabbrewScript = (text: string): string => {
  const fenced = text.match(/```(?:tabbrew|dsl)?\s*\n([\s\S]*?)\n?```/i);
  if (fenced) return fenced[1]!.trim();
  return text
    .split(/\r?\n/)
    .filter((line) => !FENCE_LINE.test(line))
    .join("\n")
    .trim();
};

// ── op summary ──────────────────────────────────────────────────────────────

export type OpStats = {
  total: number;
  byVerb: Record<string, number>;
  delCount: number;
  affectedCount: number;
};

export const summarizeOps = (ops: Op[]): OpStats => {
  const byVerb: Record<string, number> = {};
  const affected = new Set<number>();
  let delCount = 0;
  for (const op of ops) {
    byVerb[op.verb] = (byVerb[op.verb] ?? 0) + 1;
    if (op.verb === "MOVE") {
      affected.add(op.id);
    } else {
      for (const id of op.ids) affected.add(id);
      if (op.verb === "DEL") delCount += op.ids.length;
    }
  }
  return { total: ops.length, byVerb, delCount, affectedCount: affected.size };
};

// ── renderers (colored strings; caller console.logs) ────────────────────────

export const renderParseErrors = (errors: ParseError[]): string => {
  const head = c.red(`✗ ${errors.length} parse error${errors.length === 1 ? "" : "s"}:`);
  const body = errors.map((e) => {
    const src = e.raw.trim() || "(blank line)";
    return `  ${c.dim(`line ${e.line}:`)} ${src}\n            ${c.yellow("→ " + e.reason)}`;
  });
  return [head, ...body].join("\n");
};
