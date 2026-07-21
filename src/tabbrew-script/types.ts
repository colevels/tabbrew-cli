// Vendored from colevels/tabbrew (tabbrew-api/src/tabbrew-script + tabbrew-skill/runtime/src).
// Source of truth is tabbrew-api. Re-sync on any DSL grammar change.
//
// Only the parse-side types are vendored. The snapshot shapes used to live here
// too, for a simulator this repo no longer has — the extension owns simulation
// and preview now, so nothing here needs to model a tab.

export type Op =
  | { verb: "DEL"; ids: number[] }
  | { verb: "PIN"; ids: number[] }
  | { verb: "UNPIN"; ids: number[] }
  | { verb: "UNGROUP"; ids: number[] }
  | { verb: "GROUP"; ids: number[]; name: string }
  | { verb: "GROUP"; ids: number[]; gid: number }
  | { verb: "MOVE"; id: number; index: number; windowId?: number };

export type ParseError = { line: number; raw: string; reason: string };

export type ParseResult = { ops: Op[]; errors: ParseError[] };
