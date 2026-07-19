// Vendored from colevels/tabbrew (tabbrew-api/src/tabbrew-script/parser.ts +
// tabbrew-skill/runtime/src/parser.ts). Source of truth is tabbrew-api.
// Re-sync on any DSL grammar change. The only edits vs. upstream are non-null
// assertions (`!`) forced by tabbrew-cli's `noUncheckedIndexedAccess: true`
// tsconfig — each is guarded by a preceding length/format check, so behavior is
// identical to upstream.

import type { Op, ParseError, ParseResult } from "./types";

const VERBS_IDS_ONLY = new Set(["DEL", "PIN", "UNPIN", "UNGROUP"]);

const toInt = (token: string): number | null => {
  if (!/^-?\d+$/.test(token)) return null;
  const n = parseInt(token, 10);
  return Number.isFinite(n) ? n : null;
};

const toPositiveInt = (token: string): number | null => {
  const n = toInt(token);
  if (n === null || n <= 0) return null;
  return n;
};

const parseLine = (raw: string): { op?: Op; error?: string } => {
  const stripped = raw.replace(/\\"/g, "").trim();
  if (!stripped || stripped.startsWith("#")) return {};

  const quoteMatch = stripped.match(/"([^"]*)"\s*$/);
  const name = quoteMatch ? quoteMatch[1] : undefined;
  const head = quoteMatch ? stripped.slice(0, quoteMatch.index).trim() : stripped;

  const tokens = head.split(/\s+/);
  const verb = tokens[0]?.toUpperCase();
  const args = tokens.slice(1);

  if (!verb) return { error: "empty line after strip" };

  if (VERBS_IDS_ONLY.has(verb)) {
    if (name !== undefined) return { error: `${verb} does not take a quoted name` };
    if (args.length === 0) return { error: `${verb} needs at least one id` };
    const ids: number[] = [];
    for (const a of args) {
      const id = toInt(a);
      if (id === null) return { error: `invalid id "${a}"` };
      ids.push(id);
    }
    return { op: { verb: verb as "DEL" | "PIN" | "UNPIN" | "UNGROUP", ids } };
  }

  if (verb === "GROUP") {
    if (name !== undefined) {
      if (args.length === 0) return { error: "GROUP needs at least one id before the name" };
      if (!name.trim()) return { error: "GROUP name cannot be empty" };
      const ids: number[] = [];
      for (const a of args) {
        const id = toInt(a);
        if (id === null) return { error: `invalid id "${a}"` };
        ids.push(id);
      }
      return { op: { verb: "GROUP", ids, name } };
    }
    if (args.length < 2) return { error: 'GROUP needs at least one id and a "name" or @<gid> last token' };
    const last = args[args.length - 1]!;
    if (last.startsWith("@")) {
      const gid = toPositiveInt(last.slice(1));
      if (gid === null) return { error: `invalid group id "${last}" — expected @<positive integer>` };
      const idTokens = args.slice(0, -1);
      if (idTokens.length === 0) return { error: "GROUP needs at least one id before @<gid>" };
      const ids: number[] = [];
      for (const a of idTokens) {
        const id = toInt(a);
        if (id === null) return { error: `invalid id "${a}"` };
        ids.push(id);
      }
      return { op: { verb: "GROUP", ids, gid } };
    }
    return { error: 'GROUP last token must be a quoted "name" or @<gid>' };
  }

  if (verb === "MOVE") {
    if (name !== undefined) return { error: "MOVE does not take a quoted name" };
    if (args.length !== 2 && args.length !== 3) {
      return { error: "MOVE expects: MOVE <id> <index> [@win=<wid>]" };
    }
    const id = toInt(args[0]!);
    const index = toInt(args[1]!);
    if (id === null) return { error: `invalid id "${args[0]}"` };
    if (index === null) return { error: `invalid index "${args[1]}"` };
    if (args.length === 2) return { op: { verb: "MOVE", id, index } };
    const m = /^@win=(\d+)$/.exec(args[2]!);
    if (!m) return { error: `MOVE third arg must match @win=<wid>, got "${args[2]}"` };
    const windowId = toPositiveInt(m[1]!);
    if (windowId === null) return { error: `invalid window id "${args[2]}"` };
    return { op: { verb: "MOVE", id, index, windowId } };
  }

  return { error: `unknown verb "${verb}"` };
};

export const parseTabbrewScript = (input: string): ParseResult => {
  const ops: Op[] = [];
  const errors: ParseError[] = [];
  const lines = input.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const { op, error } = parseLine(raw);
    if (error) errors.push({ line: i + 1, raw, reason: error });
    if (op) ops.push(op);
  });
  return { ops, errors };
};
