/**
 * Finding the bridge on 127.0.0.1, and being sure it *is* the bridge.
 *
 * `tabs serve` may bind more than one port (see `config.serve.ports`), so both
 * the other end of this CLI (`tabs suggest`) and `serve` itself — deciding
 * whether a busy port is a peer or a stranger — need one honest answer to "is
 * there a TabBrew bridge here?".
 *
 * The identity check is the point. With a single fixed port, guessing wrong was
 * survivable: the request failed and the user was told nothing was listening.
 * With a fallback port, a foreign JSON service squatting on one of them would
 * otherwise be treated as the bridge — and `tabs suggest` would hand it a
 * script describing the user's tabs. The extension applies the same rule at its
 * end (`looksLikeBridge` in the extension's `lib/localServer.ts`); the two must
 * stay in agreement or one end will adopt a service the other rejects.
 */

/** Marker `GET /health` carries so a bridge is identifiable, not merely reachable. */
export const BRIDGE_SERVICE = "tabbrew-bridge";

/** A stranger holding the socket open must not hang the caller. */
const PROBE_TIMEOUT_MS = 1500;

export type BridgeHealth = {
  /** Which port answered. */
  port: number;
  /** Wire protocol the bridge speaks; 0 if it is too old to say. */
  protocol: number;
  /** Tab-state version it currently holds; 0 before any export. */
  tabsVersion: number;
  /** Whether a suggestion is queued and unclaimed; null if it didn't say. */
  hasPending: boolean | null;
};

/**
 * Ours, or just *something* on the port?
 *
 * `service` is the unambiguous answer and every bridge from this version on
 * sends it. Older bridges — a user who upgraded the extension but not the CLI —
 * don't, hence the shape test: `ok: true` plus a numeric `protocol`/`tabsVersion`,
 * which a generic `{"ok":true}` health endpoint does not carry.
 */
export function looksLikeBridge(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.service === BRIDGE_SERVICE) return true;
  return (
    b.ok === true &&
    (typeof b.protocol === "number" || typeof b.tabsVersion === "number")
  );
}

/** One port, one answer. Null covers every flavour of "not a bridge here". */
export async function probeBridge(port: number): Promise<BridgeHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!looksLikeBridge(body)) return null;
    return {
      port,
      protocol: typeof body?.protocol === "number" ? body.protocol : 0,
      tabsVersion: typeof body?.tabsVersion === "number" ? body.tabsVersion : 0,
      hasPending: typeof body?.hasPending === "boolean" ? body.hasPending : null,
    };
  } catch {
    return null;
  }
}

/**
 * First bridge in preference order, or null if none is up.
 *
 * Sequential on purpose, and the extension scans the same list the same way:
 * with two bridges running, "the default port" is a stable answer where
 * "whichever replied first" is a race that could point the CLI at one bridge
 * while Chrome is talking to the other.
 */
export async function discoverBridge(
  ports: readonly number[],
): Promise<BridgeHealth | null> {
  for (const port of ports) {
    const health = await probeBridge(port);
    if (health) return health;
  }
  return null;
}
