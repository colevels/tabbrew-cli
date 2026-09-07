// Windows are addressed by a short label (A, B, ... Z, AA, ...) instead of
// Chrome's numeric id. The session assigns them, so a label means the same
// window for every CLI call while the session lives.

export function windowLabel(index: number): string {
  let label = ''
  let rest = index
  do {
    label = String.fromCharCode(65 + (rest % 26)) + label
    rest = Math.floor(rest / 26) - 1
  } while (rest >= 0)
  return label
}

export interface WindowLabels {
  stamp(output: unknown): unknown
}

const isWindowList = (value: unknown): value is { id: number }[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'object' && item !== null && typeof item.id === 'number')

// A closed window's label is never reused: a stale `--window C` must fail,
// not land on whichever window came next.
export function createWindowLabels(): WindowLabels {
  const labels = new Map<number, string>()
  return {
    stamp(output) {
      if (typeof output !== 'object' || output === null) return output
      const { windows } = output as { windows?: unknown }
      if (!isWindowList(windows)) return output
      for (const id of windows.map((window) => window.id).sort((a, b) => a - b)) {
        if (!labels.has(id)) labels.set(id, windowLabel(labels.size))
      }
      return {
        ...output,
        windows: windows.map((window) => ({ ...window, label: labels.get(window.id) })),
      }
    },
  }
}
