// Vendored from colevels/tabbrew (tabbrew-api/src/tabbrew-script + tabbrew-skill/runtime/src).
// Source of truth is tabbrew-api. Re-sync on any DSL grammar / phase-order change.
//
// Curated, Chrome-free copy: the snapshot *types* live here (not in a snapshot.ts)
// so the vendored parser.ts / simulate.ts never import chrome.* code — which keeps
// tabbrew-cli's zero-runtime-dependency, no-@types/chrome invariant intact.

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

// Snapshot types — upstream these live in tabbrew-skill/runtime/src/snapshot.ts,
// alongside the chrome.*-dependent snapshotter. Only the plain data shapes are
// vendored here so simulate.ts can run in Bun.
export type TabSnapshot = {
  id: number;
  index: number;
  pinned: boolean;
  title: string;
  url: string;
  windowId: number;
  groupId?: number;
  active?: boolean;
};

export type GroupSnapshot = {
  id: number;
  windowId: number;
  title: string;
  color?: string;
  tabCount: number;
};

export type WindowSnapshot = {
  id: number;
  focused: boolean;
  tabCount: number;
};

export type SnapshotPayload = {
  tabs: TabSnapshot[];
  groups: GroupSnapshot[];
  windows: WindowSnapshot[];
  allowCrossWindow: boolean;
};
