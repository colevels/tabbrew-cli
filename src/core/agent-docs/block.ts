export const MARKER_START = '<!-- TABBREW:START -->'
export const MARKER_END = '<!-- TABBREW:END -->'

type Span = { start: number; end: number }

// END is only searched after START so the two can never cross, and a file with
// two STARTs (or a START with no END) is refused rather than guessed at: a
// wrong guess would duplicate or drop the user's own text.
export function findBlock(content: string): Span | null {
  const start = content.indexOf(MARKER_START)
  if (start === -1) return null
  const afterStart = start + MARKER_START.length
  if (content.indexOf(MARKER_START, afterStart) !== -1) {
    throw new Error(
      `malformed agent docs block: more than one "${MARKER_START}"; fix the file by hand and re-run`,
    )
  }
  const end = content.indexOf(MARKER_END, afterStart)
  if (end === -1) {
    throw new Error(
      `malformed agent docs block: "${MARKER_START}" without "${MARKER_END}"; fix the file by hand and re-run`,
    )
  }
  return { start, end: end + MARKER_END.length }
}

export function inject(content: string, block: string): string {
  const span = findBlock(content)
  if (span) return content.slice(0, span.start) + block + content.slice(span.end)
  const body = content.trimEnd()
  return body ? `${body}\n\n${block}\n` : `${block}\n`
}

export function remove(content: string): string | null {
  const span = findBlock(content)
  if (!span) return null
  const before = content.slice(0, span.start).trimEnd()
  const after = content.slice(span.end).trim()
  const parts = [before, after].filter(Boolean)
  return parts.length ? `${parts.join('\n\n')}\n` : ''
}
