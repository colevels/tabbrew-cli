// What an extension declares to the session and what the CLI builds plugin
// commands from, in a form that runs in the browser as well as in Bun: no node
// imports.

export const COMMANDS_VERSION = 1

// No empty segment: Commander camel-cases an option name segment by segment.
export const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

// The verbs that share `tabbrew plugin` with the namespaces.
export const RESERVED_NAMESPACES: readonly string[] = ['list', 'open', 'forget', 'help']

export const MAX_COMMAND_TIMEOUT_MS = 60_000
const MIN_COMMAND_TIMEOUT_MS = 1_000

export type ValueType = 'string' | 'number' | 'boolean'
export type Value = string | number | boolean

export interface ArgumentDeclaration {
  name: string
  type: ValueType
  description?: string
  variadic?: boolean
  choices?: Value[]
}

export interface OptionDeclaration {
  type: ValueType
  description?: string
  default?: Value
  required?: boolean
  repeatable?: boolean
  choices?: Value[]
}

export type View =
  | { rows?: string; columns: string[]; clip?: Record<string, number> }
  | { fields: string[] }
  | { message: string }
  | { text: string }

export interface CommandDeclaration {
  description: string
  arguments?: ArgumentDeclaration[]
  options?: Record<string, OptionDeclaration>
  view?: View
  examples?: string[]
  timeoutMs?: number
}

export interface NamespaceDeclaration {
  description: string
  commands: Record<string, CommandDeclaration>
}

export interface Declaration {
  commandsVersion: number
  // The base operators this page serves; empty for a page that only adds commands.
  operators: string[]
  namespaces: Record<string, NamespaceDeclaration>
  // The extension page the CLI may open when the plugin is not connected.
  page?: string
}

export type NamespaceRejection = 'namespace_taken' | 'reserved' | 'bad_commands'

export interface DeclareResponse {
  owner: string
  commandsVersion: number
  accepted: string[]
  rejected: Record<string, NamespaceRejection>
  // Commands left out of an accepted namespace, as `namespace.command`.
  dropped: string[]
}

export interface RegistryEntry {
  extensionId: string
  page?: string
  description: string
  connected: boolean
  commands: Record<string, CommandDeclaration>
}

export type Registry = Record<string, RegistryEntry>

export interface ParsedDeclaration {
  declaration: Declaration
  invalidNamespaces: string[]
  dropped: string[]
}

// A declaration is held in memory for the life of the session, cached on disk
// and printed in help, so one extension must not be able to make any of them
// unbounded.
const MAX_NAMESPACES = 16
const MAX_COMMANDS = 64
const MAX_PARAMETERS = 32
const MAX_EXAMPLES = 8
const MAX_TEXT = 500
const MAX_NAME = 40

// Overrides that reorder what a terminal shows; help is read by people and by
// agents, and neither should see text other than what was declared.
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g

// Reaches a shell on Windows, where the CLI opens a page through `cmd /c start`.
const PAGE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

const OPERATOR = /^[A-Za-z]{1,64}$/

const EXTENSION_ID = /^[a-p]{32}$/

const SHELL_FREE = /^[^;&|`$<>\\\n\r]*$/

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.replace(BIDI_CONTROLS, '').slice(0, MAX_TEXT) : undefined

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_NAME && NAME.test(value)

const isValueType = (value: unknown): value is ValueType =>
  value === 'string' || value === 'number' || value === 'boolean'

const isChoices = (value: unknown, type: ValueType): value is Value[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= MAX_PARAMETERS &&
  value.every((choice) => typeof choice === type && (type !== 'string' || text(choice) === choice))

const textList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARAMETERS) return undefined
  const list = value.map(text)
  return list.every((entry) => entry !== undefined) ? (list as string[]) : undefined
}

// The key a parameter arrives under in a command's input, as Commander names it.
export const inputKey = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())

function parseArgument(value: unknown): ArgumentDeclaration | null {
  if (!isObject(value) || !isName(value.name) || !isValueType(value.type)) return null
  if (value.choices !== undefined && !isChoices(value.choices, value.type)) return null
  return {
    name: value.name,
    type: value.type,
    description: text(value.description),
    variadic: value.variadic === true ? true : undefined,
    choices: value.choices,
  }
}

function parseOption(value: unknown): OptionDeclaration | null {
  if (!isObject(value) || !isValueType(value.type)) return null
  if (value.default !== undefined && typeof value.default !== value.type) return null
  if (value.choices !== undefined && !isChoices(value.choices, value.type)) return null
  return {
    type: value.type,
    description: text(value.description),
    default: value.default as Value | undefined,
    required: value.required === true ? true : undefined,
    repeatable: value.repeatable === true ? true : undefined,
    choices: value.choices,
  }
}

function parseView(value: unknown): View | undefined {
  if (!isObject(value)) return undefined
  const message = text(value.message)
  if (message !== undefined) return { message }
  const body = text(value.text)
  if (body !== undefined) return { text: body }
  const fields = textList(value.fields)
  if (fields) return { fields }
  const columns = textList(value.columns)
  if (!columns) return undefined
  const clip = isObject(value.clip)
    ? Object.fromEntries(
        Object.entries(value.clip)
          // Too narrow for an ellipsis otherwise.
          .filter(([, width]) => Number.isInteger(width) && Number(width) > 1)
          .slice(0, MAX_PARAMETERS),
      )
    : undefined
  return { rows: text(value.rows), columns, clip: clip as Record<string, number> | undefined }
}

// A parameter that is wrong drops its command, because a command missing one
// does something other than what its author wrote; presentation that is wrong
// is left out and the command stays.
function parseCommand(namespace: string, value: unknown): CommandDeclaration | null {
  if (!isObject(value)) return null
  const description = text(value.description)
  if (description === undefined) return null

  const keys: string[] = []
  let positional: ArgumentDeclaration[] | undefined
  if (value.arguments !== undefined) {
    if (!Array.isArray(value.arguments) || value.arguments.length > MAX_PARAMETERS) return null
    positional = []
    for (const entry of value.arguments) {
      const argument = parseArgument(entry)
      if (!argument) return null
      positional.push(argument)
      keys.push(inputKey(argument.name))
    }
    // Commander takes a variadic argument only in last place.
    if (positional.slice(0, -1).some((argument) => argument.variadic)) return null
  }

  let options: Record<string, OptionDeclaration> | undefined
  if (value.options !== undefined) {
    if (!isObject(value.options)) return null
    const entries = Object.entries(value.options)
    if (entries.length > MAX_PARAMETERS) return null
    options = {}
    for (const [name, entry] of entries) {
      const option = parseOption(entry)
      if (!option || !isName(name)) return null
      options[name] = option
      keys.push(inputKey(name))
    }
  }

  // `json` and `help` are the flags every built command already carries, and
  // two parameters under one key would overwrite each other in the input.
  if (keys.includes('json') || keys.includes('help')) return null
  if (new Set(keys).size !== keys.length) return null

  const prefix = `tabbrew plugin ${namespace}`
  const examples = Array.isArray(value.examples)
    ? value.examples
        .map(text)
        .filter(
          (example): example is string =>
            example !== undefined &&
            (example === prefix || example.startsWith(`${prefix} `)) &&
            SHELL_FREE.test(example),
        )
        .slice(0, MAX_EXAMPLES)
    : []

  const timeoutMs =
    typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? Math.min(
          MAX_COMMAND_TIMEOUT_MS,
          Math.max(MIN_COMMAND_TIMEOUT_MS, Math.round(value.timeoutMs)),
        )
      : undefined

  return {
    description,
    arguments: positional,
    options,
    view: parseView(value.view),
    examples: examples.length > 0 ? examples : undefined,
    timeoutMs,
  }
}

function parseCommands(
  namespace: string,
  value: unknown,
): { commands: Record<string, CommandDeclaration>; left: string[] } {
  const commands: Record<string, CommandDeclaration> = {}
  const left: string[] = []
  for (const [name, entry] of isObject(value) ? Object.entries(value) : []) {
    const command =
      isName(name) && Object.keys(commands).length < MAX_COMMANDS
        ? parseCommand(namespace, entry)
        : null
    if (command) commands[name] = command
    else left.push(`${namespace}.${name.slice(0, MAX_NAME)}`)
  }
  return { commands, left }
}

const parsePage = (value: unknown): string | undefined =>
  typeof value === 'string' && PAGE.test(value) && !value.includes('..') && !value.includes('//')
    ? value
    : undefined

// Lenient on purpose: a newer extension must keep working against an older
// CLI, so an unknown field is left behind and only what is wrong is dropped.
// Everything returned is rebuilt, never the caller's object, so nothing
// undeclared reaches the registry, the cache or a fingerprint.
export function parseDeclaration(value: unknown): ParsedDeclaration | null {
  if (!isObject(value)) return null
  const { commandsVersion } = value
  if (!Number.isInteger(commandsVersion) || Number(commandsVersion) < 1) return null

  const invalidNamespaces: string[] = []
  const dropped: string[] = []
  const namespaces: Record<string, NamespaceDeclaration> = {}
  const declared = isObject(value.namespaces) ? Object.entries(value.namespaces) : []
  for (const [name, entry] of declared.slice(0, MAX_NAMESPACES)) {
    const description = isObject(entry) ? text(entry.description) : undefined
    if (!isName(name) || !isObject(entry) || description === undefined) {
      invalidNamespaces.push(name.slice(0, MAX_NAME))
      continue
    }
    const { commands, left } = parseCommands(name, entry.commands)
    if (Object.keys(commands).length === 0) {
      invalidNamespaces.push(name)
      continue
    }
    namespaces[name] = { description, commands }
    dropped.push(...left.slice(0, MAX_COMMANDS))
  }

  const operators = Array.isArray(value.operators)
    ? value.operators.filter(
        (name): name is string => typeof name === 'string' && OPERATOR.test(name),
      )
    : []
  return {
    declaration: {
      commandsVersion: COMMANDS_VERSION,
      operators: [...new Set(operators)].slice(0, MAX_COMMANDS),
      namespaces,
      page: parsePage(value.page),
    },
    invalidNamespaces,
    dropped,
  }
}

// What the CLI reads back, from a session of another version or from a file
// anyone can write: held to the same rules as a declaration, never trusted.
export function parseRegistry(value: unknown): Registry {
  const registry: Registry = {}
  for (const [namespace, entry] of isObject(value) ? Object.entries(value) : []) {
    if (!isName(namespace) || RESERVED_NAMESPACES.includes(namespace) || !isObject(entry)) continue
    const description = text(entry.description)
    const { extensionId } = entry
    const { commands } = parseCommands(namespace, entry.commands)
    if (description === undefined || Object.keys(commands).length === 0) continue
    if (typeof extensionId !== 'string' || !EXTENSION_ID.test(extensionId)) continue
    registry[namespace] = {
      extensionId,
      page: parsePage(entry.page),
      description,
      connected: entry.connected === true,
      commands,
    }
  }
  return registry
}
