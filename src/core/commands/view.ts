// How a plugin command's output reaches the terminal. Everything here came
// from an extension, so nothing is printed without passing through cell(), or
// for text that keeps its lines, the same rule with the line break let through.

import { cell, clip, renderTable } from '../table'
import type { View } from './declaration'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isScalar = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value)

const isFlat = (value: unknown): value is Json =>
  isObject(value) && Object.values(value).every((entry) => isScalar(entry) || isList(entry))

const isList = (value: unknown): value is unknown[] => Array.isArray(value) && value.every(isScalar)

const at = (value: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) => (isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined),
      value,
    )

const plain = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (isScalar(value)) return String(value)
  return isList(value) ? value.map(plain).join(', ') : JSON.stringify(value)
}

const text = (value: unknown): string => cell(plain(value))

const heading = (key: string): string =>
  cell(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]/g, ' ')).toUpperCase()

const table = (rows: unknown[], columns: string[], widths: Record<string, number> = {}): string =>
  renderTable(
    columns.map(heading),
    rows.map((row) =>
      columns.map((column) => {
        const width = widths[column]
        return width === undefined ? text(at(row, column)) : clip(text(at(row, column)), width)
      }),
    ),
  )

const fields = (output: unknown, keys: string[]): string =>
  renderTable(
    ['FIELD', 'VALUE'],
    keys.map((key) => [heading(key), text(at(output, key))]),
  )

function byShape(output: unknown): string | null {
  if (output === null || output === undefined) return null
  if (isScalar(output)) return text(output)
  if (Array.isArray(output)) {
    if (output.length === 0) return null
    if (output.every(isFlat)) return table(output, [...new Set(output.flatMap(Object.keys))])
    if (output.every(isScalar)) return output.map(text).join('\n')
  } else if (isFlat(output)) {
    const keys = Object.keys(output)
    return keys.length === 0 ? null : fields(output, keys)
  }
  // JSON.stringify escapes control characters itself.
  return JSON.stringify(output, null, 2)
}

// null means "print nothing", which is what a command with nothing to say does.
export function renderOutput(output: unknown, view?: View): string | null {
  if (!view) return byShape(output)
  if ('message' in view) {
    return cell(view.message).replace(/\{([^{}]+)\}/g, (_, path: string) =>
      text(at(output, path.trim())),
    )
  }
  if ('text' in view) return plain(at(output, view.text)).replace(/[^\P{Cc}\n]/gu, ' ') || null
  if ('fields' in view) return fields(output, view.fields)
  const rows = view.rows === undefined ? output : at(output, view.rows)
  if (!Array.isArray(rows)) return byShape(output)
  return rows.length === 0 ? null : table(rows, view.columns, view.clip)
}
