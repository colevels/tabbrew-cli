import type { Snapshot, TabSnapshot } from '../operators/contract'

// TITLE last: it is the widest and most variable field, and the last column is
// the one printed without padding, so a long title extends its own row instead
// of pushing every other column sideways.
const COLUMNS = ['TAB', 'WINDOW', 'GROUP', 'FLAGS', 'URL', 'TITLE'] as const

// The full title stays in --json; the table caps it so one long title cannot
// push every other row off the screen.
const TITLE_MAX = 60

// By display width, not character count: a CJK title is twice as wide as its
// length, and cutting between the code points of an emoji cluster corrupts the
// glyph, so step one grapheme at a time and keep a column for the ellipsis.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const clip = (text: string, max: number): string => {
  if (Bun.stringWidth(text) <= max) return text
  let width = 0
  let out = ''
  for (const { segment } of graphemes.segment(text)) {
    const next = Bun.stringWidth(segment)
    if (width + next > max - 1) break
    out += segment
    width += next
  }
  return `${out}…`
}

const flags = (tab: TabSnapshot): string => {
  const set = [
    tab.active && 'active',
    tab.pinned && 'pinned',
    tab.audible && 'audible',
    tab.muted && 'muted',
    tab.discarded && 'discarded',
    tab.status === 'loading' && 'loading',
  ].filter((flag): flag is string => typeof flag === 'string')
  return set.length ? set.join(',') : '-'
}

// A title is whatever the page said it was; one control character would
// break the row it sits in, or the terminal.
const cell = (text: string): string => text.replace(/\p{Cc}/gu, ' ') || '-'

// The table shows the host only; the full url stays in --json. `www.` is
// noise, but a deeper subdomain (mail.google.com) is what tells two tabs on
// one site apart. A non-http url with no host falls back to its scheme
// (about:blank, file:), and anything unparseable is shown as it came.
const domain = (url: string): string => {
  try {
    const { hostname, protocol } = new URL(url)
    return hostname.replace(/^www\./, '') || protocol.replace(/:$/, '')
  } catch {
    return url
  }
}

const row = (tab: TabSnapshot): string[] => [
  String(tab.id),
  String(tab.windowId),
  tab.groupId === -1 ? '-' : String(tab.groupId),
  flags(tab),
  cell(domain(tab.url)),
  clip(cell(tab.title), TITLE_MAX),
]

const byPlace = (a: TabSnapshot, b: TabSnapshot): number =>
  a.windowId - b.windowId || a.index - b.index

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - Bun.stringWidth(text)))

export function formatTabTable(snapshot: Snapshot): string {
  const rows = [[...COLUMNS], ...[...snapshot.tabs].sort(byPlace).map(row)]
  const widths = COLUMNS.map((_, column) =>
    Math.max(...rows.map((cells) => Bun.stringWidth(cells[column] ?? ''))),
  )
  const last = COLUMNS.length - 1
  return rows
    .map((cells) =>
      cells
        .map((text, column) => (column === last ? text : pad(text, widths[column] ?? 0)))
        .join('  '),
    )
    .join('\n')
}
