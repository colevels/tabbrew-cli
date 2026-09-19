// What an extension declares to the session and what the CLI builds commands
// from, in a form that runs in the browser as well as in Bun: no node imports.

export const COMMANDS_VERSION = 1

export const NAME = /^[a-z][a-z0-9-]*$/

export type ValueType = 'string' | 'number' | 'boolean'

export interface OptionDeclaration {
  type: ValueType
  description?: string
  default?: string | number | boolean
  required?: boolean
  repeatable?: boolean
}

export interface ArgumentDeclaration {
  name: string
  type: ValueType
  description?: string
  variadic?: boolean
}

export type View =
  | { rows?: string; columns: string[]; clip?: Record<string, number> }
  | { fields: string[] }
  | { message: string }

export interface CommandDeclaration {
  description: string
  arguments?: ArgumentDeclaration[]
  options?: Record<string, OptionDeclaration>
  view?: View
}

export interface Declaration {
  commandsVersion: number
  namespace: string
  description: string
  commands: Record<string, CommandDeclaration>
}

export interface RegistryEntry {
  extensionId: string
  description: string
  connected: boolean
  commands: Record<string, CommandDeclaration>
}

export type Registry = Record<string, RegistryEntry>

// A declaration is held in memory for the life of the session and printed in
// help, so one extension must not be able to make either unbounded.
const MAX_COMMANDS = 64
const MAX_PARAMETERS = 32
const MAX_TEXT = 500

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT

const isOptionalText = (value: unknown): boolean => value === undefined || isText(value)

const isOptionalFlag = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean'

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && NAME.test(value)

const isValueType = (value: unknown): value is ValueType =>
  value === 'string' || value === 'number' || value === 'boolean'

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= MAX_PARAMETERS && value.every(isText)

const isArgument = (value: unknown): boolean =>
  isObject(value) &&
  isName(value.name) &&
  isValueType(value.type) &&
  isOptionalText(value.description) &&
  isOptionalFlag(value.variadic)

const isOption = (value: unknown): boolean =>
  isObject(value) &&
  isValueType(value.type) &&
  isOptionalText(value.description) &&
  isOptionalFlag(value.required) &&
  isOptionalFlag(value.repeatable) &&
  (value.default === undefined || typeof value.default === value.type)

function isView(value: unknown): boolean {
  if (!isObject(value)) return false
  if ('message' in value) return isText(value.message)
  if ('fields' in value) return isTextList(value.fields)
  return (
    isTextList(value.columns) &&
    isOptionalText(value.rows) &&
    (value.clip === undefined ||
      (isObject(value.clip) &&
        Object.values(value.clip).every((width) => Number.isInteger(width) && Number(width) > 1)))
  )
}

function isCommand(value: unknown): boolean {
  if (!isObject(value) || !isText(value.description)) return false
  const { arguments: positional, options, view } = value
  if (positional !== undefined) {
    if (!Array.isArray(positional) || positional.length > MAX_PARAMETERS) return false
    if (!positional.every(isArgument)) return false
    // Commander takes a variadic argument only in last place.
    if (positional.slice(0, -1).some((argument) => (argument as ArgumentDeclaration).variadic)) {
      return false
    }
  }
  if (options !== undefined) {
    if (!isObject(options) || Object.keys(options).length > MAX_PARAMETERS) return false
    // The flags every built command already carries.
    const free = (name: string): boolean => isName(name) && name !== 'json' && name !== 'help'
    if (!Object.entries(options).every(([name, option]) => free(name) && isOption(option))) {
      return false
    }
  }
  return view === undefined || isView(view)
}

export function parseDeclaration(value: unknown): Declaration | null {
  if (!isObject(value)) return null
  const { commandsVersion, namespace, description, commands } = value
  if (commandsVersion !== COMMANDS_VERSION) return null
  if (!isName(namespace) || !isText(description) || !isObject(commands)) return null
  const entries = Object.entries(commands)
  if (entries.length === 0 || entries.length > MAX_COMMANDS) return null
  if (!entries.every(([name, command]) => isName(name) && isCommand(command))) return null
  return value as unknown as Declaration
}
