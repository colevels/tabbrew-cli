// Cells and layout shared by the list tables. Widths are display widths, not
// character counts: a CJK title is twice as wide as its length.

// The full title stays in --json; a table caps it so one long title cannot
// push every other row off the screen.
export const TITLE_MAX = 60

// Cutting between the code points of an emoji cluster corrupts the glyph, so
// step one grapheme at a time and keep a column for the ellipsis.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export const clip = (text: string, max: number): string => {
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

// A title is whatever the page said it was; one control character would
// break the row it sits in, or the terminal.
export const cell = (text: string): string => text.replace(/\p{Cc}/gu, ' ') || '-'

// The table shows the host only; the full url stays in --json. `www.` is
// noise, but a deeper subdomain (mail.google.com) is what tells two tabs on
// one site apart. A non-http url with no host falls back to its scheme
// (about:blank, file:), and anything unparseable is shown as it came.
export const domain = (url: string): string => {
  try {
    const { hostname, protocol } = new URL(url)
    return hostname.replace(/^www\./, '') || protocol.replace(/:$/, '')
  } catch {
    return url
  }
}

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - Bun.stringWidth(text)))

// The last column is printed without padding, so the widest and most variable
// field belongs there: a long value extends its own row instead of pushing
// every other column sideways.
export function renderTable(columns: readonly string[], rows: string[][]): string {
  const all = [[...columns], ...rows]
  const widths = columns.map((_, column) =>
    Math.max(...all.map((cells) => Bun.stringWidth(cells[column] ?? ''))),
  )
  const last = columns.length - 1
  return all
    .map((cells) =>
      cells
        .map((text, column) => (column === last ? text : pad(text, widths[column] ?? 0)))
        .join('  '),
    )
    .join('\n')
}
