// Vendored from colevels/tabbrew (tabbrew-skill/runtime/src/simulate.ts).
// Source of truth is tabbrew-api / tabbrew-extension. Re-sync on any phase-order
// or grammar change — this MUST mirror execute.ts's phase order exactly.
//
// Edits vs. upstream: (1) snapshot types are imported from ./types (upstream
// imports them from ./snapshot, which references chrome.*); (2) non-null
// assertions forced by `noUncheckedIndexedAccess: true`, each guarded by a
// preceding length/emptiness check, so behavior is identical to upstream.

import type { GroupSnapshot, Op, SnapshotPayload, TabSnapshot, WindowSnapshot } from "./types";

export type SimChange = "pinned" | "unpinned" | "grouped" | "ungrouped" | "moved" | "deleted";

export type SimTab = TabSnapshot & { changes: SimChange[] };

export type SimGroup = GroupSnapshot & { isNew?: boolean };

export type SimResult = {
  tabs: SimTab[];
  deleted: SimTab[];
  groups: SimGroup[];
  windows: WindowSnapshot[];
  droppedStaleIds: number[];
};

const cloneTab = (t: TabSnapshot): SimTab => ({ ...t, changes: [] });

const addChange = (t: SimTab, c: SimChange): void => {
  if (t.changes.indexOf(c) < 0) t.changes.push(c);
};

// Phase order mirrors execute.ts: DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE.
// Result is "directionally correct" — pinned-first / group-contiguous is enforced,
// but exact post-move indices can drift slightly from Chrome's actual behavior
// (Chrome's group-relocation rules aren't fully reproduced here).
export const simulateBatch = (payload: SnapshotPayload, ops: Op[]): SimResult => {
  const liveIds = new Set<number>();
  for (const t of payload.tabs) liveIds.add(t.id);

  const dropped: number[] = [];
  const filterIds = (ids: number[]): number[] => {
    const out: number[] = [];
    for (const id of ids) {
      if (liveIds.has(id)) out.push(id);
      else dropped.push(id);
    }
    return out;
  };

  const dels: number[] = [];
  const pins: number[] = [];
  const unpins: number[] = [];
  const ungroups: number[] = [];
  const groupsByName = new Map<string, number[]>();
  const groupsByGid = new Map<number, number[]>();
  const moves: { id: number; index: number; windowId?: number }[] = [];

  for (const op of ops) {
    switch (op.verb) {
      case "DEL":
        dels.push(...filterIds(op.ids));
        break;
      case "PIN":
        pins.push(...filterIds(op.ids));
        break;
      case "UNPIN":
        unpins.push(...filterIds(op.ids));
        break;
      case "UNGROUP":
        ungroups.push(...filterIds(op.ids));
        break;
      case "GROUP":
        if ("gid" in op) {
          groupsByGid.set(op.gid, [...(groupsByGid.get(op.gid) ?? []), ...filterIds(op.ids)]);
        } else {
          groupsByName.set(op.name, [...(groupsByName.get(op.name) ?? []), ...filterIds(op.ids)]);
        }
        break;
      case "MOVE":
        if (liveIds.has(op.id)) moves.push({ id: op.id, index: op.index, windowId: op.windowId });
        else dropped.push(op.id);
        break;
    }
  }

  const tabs: SimTab[] = payload.tabs.map(cloneTab);
  const tabById = new Map<number, SimTab>();
  for (const t of tabs) tabById.set(t.id, t);

  const groups: SimGroup[] = payload.groups.map((g) => ({ ...g }));

  // DEL
  for (const id of dels) {
    const t = tabById.get(id);
    if (t) {
      addChange(t, "deleted");
      tabById.delete(id);
    }
  }

  // UNPIN
  for (const id of unpins) {
    const t = tabById.get(id);
    if (t && t.pinned) {
      t.pinned = false;
      addChange(t, "unpinned");
    }
  }

  // UNGROUP
  for (const id of ungroups) {
    const t = tabById.get(id);
    if (t && t.groupId !== undefined) {
      t.groupId = undefined;
      addChange(t, "ungrouped");
    }
  }

  // GROUP (named) — synthesize a negative gid so it can't collide with a real one
  let nextSyntheticGid = -1;
  for (const [name, rawIds] of Array.from(groupsByName.entries())) {
    const ids = rawIds.filter((id) => tabById.has(id));
    if (ids.length === 0) continue;
    const first = tabById.get(ids[0]!) as SimTab;
    const synth = nextSyntheticGid--;
    groups.push({
      id: synth,
      windowId: first.windowId,
      title: name,
      tabCount: ids.length,
      isNew: true,
    });
    for (const id of ids) {
      const t = tabById.get(id) as SimTab;
      t.groupId = synth;
      addChange(t, "grouped");
    }
  }

  // GROUP (existing gid)
  for (const [gid, ids] of Array.from(groupsByGid.entries())) {
    for (const id of ids) {
      const t = tabById.get(id);
      if (t) {
        t.groupId = gid;
        addChange(t, "grouped");
      }
    }
  }

  // PIN
  for (const id of pins) {
    const t = tabById.get(id);
    if (t && !t.pinned) {
      t.pinned = true;
      addChange(t, "pinned");
    }
  }

  // MOVE — bucket by destination window, then splice into the target window's
  // ordered list. Mirrors execute.ts: bucket sorted by index, all tabs
  // inserted contiguously starting at the smallest target index (or end if -1).
  type Bucket = { id: number; index: number };
  const buckets = new Map<number, Bucket[]>();
  for (const m of moves) {
    const t = tabById.get(m.id);
    if (!t) continue;
    const targetWindowId = m.windowId ?? t.windowId;
    const arr = buckets.get(targetWindowId) ?? [];
    arr.push({ id: m.id, index: m.index });
    buckets.set(targetWindowId, arr);
  }

  // Pass 1: update windowId on cross-window moves and stamp 'moved'
  for (const [winId, bucket] of Array.from(buckets.entries())) {
    for (const m of bucket) {
      const t = tabById.get(m.id);
      if (!t) continue;
      if (t.windowId !== winId) t.windowId = winId;
      addChange(t, "moved");
    }
  }

  // Pass 2: rebuild ordered tab list per window
  const allWindowIds = new Set<number>();
  for (const t of Array.from(tabById.values())) allWindowIds.add(t.windowId);

  const orderedTabs: SimTab[] = [];
  for (const winId of Array.from(allWindowIds)) {
    const inWindow = Array.from(tabById.values())
      .filter((t) => t.windowId === winId)
      .sort((a, b) => a.index - b.index);

    const bucket = buckets.get(winId);
    if (bucket && bucket.length > 0) {
      const sorted = bucket.slice().sort((a, b) => a.index - b.index);
      const startIdx = sorted[0]!.index;
      const movedIds = new Set(sorted.map((m) => m.id));
      const movedTabs = sorted.map((m) => tabById.get(m.id)).filter((t): t is SimTab => Boolean(t));
      const remaining = inWindow.filter((t) => !movedIds.has(t.id));
      const insertAt =
        startIdx < 0 ? remaining.length : Math.min(Math.max(startIdx, 0), remaining.length);
      const next = [...remaining.slice(0, insertAt), ...movedTabs, ...remaining.slice(insertAt)];
      inWindow.splice(0, inWindow.length, ...next);
    }

    // Enforce Chrome layout invariants for the preview: pinned tabs always first,
    // then unpinned tabs clustered by groupId in order of first appearance.
    const pinned = inWindow.filter((t) => t.pinned);
    const unpinned = inWindow.filter((t) => !t.pinned);
    const groupClusters = new Map<number | "none", SimTab[]>();
    for (const t of unpinned) {
      const key: number | "none" = t.groupId ?? "none";
      const arr = groupClusters.get(key) ?? [];
      arr.push(t);
      groupClusters.set(key, arr);
    }
    const finalUnpinned: SimTab[] = [];
    for (const arr of Array.from(groupClusters.values())) finalUnpinned.push(...arr);

    const finalList = [...pinned, ...finalUnpinned];
    for (let i = 0; i < finalList.length; i++) finalList[i]!.index = i;
    orderedTabs.push(...finalList);
  }

  const deleted = tabs.filter((t) => t.changes.indexOf("deleted") >= 0);

  // Recompute counts; drop empty groups
  const tabCountByGroup = new Map<number, number>();
  for (const t of orderedTabs) {
    if (t.groupId !== undefined) {
      tabCountByGroup.set(t.groupId, (tabCountByGroup.get(t.groupId) ?? 0) + 1);
    }
  }
  const finalGroups = groups
    .map((g) => ({ ...g, tabCount: tabCountByGroup.get(g.id) ?? 0 }))
    .filter((g) => g.tabCount > 0);

  const tabCountByWindow = new Map<number, number>();
  for (const t of orderedTabs) {
    tabCountByWindow.set(t.windowId, (tabCountByWindow.get(t.windowId) ?? 0) + 1);
  }
  const finalWindows = payload.windows.map((w) => ({
    ...w,
    tabCount: tabCountByWindow.get(w.id) ?? 0,
  }));

  return {
    tabs: orderedTabs,
    deleted,
    groups: finalGroups,
    windows: finalWindows,
    droppedStaleIds: dropped,
  };
};
