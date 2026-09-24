import { Argument, Command, InvalidArgumentError, Option } from 'commander'
import {
  type CommandDeclaration,
  inputKey,
  RESERVED_NAMESPACES,
  type RegistryEntry,
  type Value,
  type ValueType,
} from '../../core/commands/declaration'
import { renderOutput } from '../../core/commands/view'
import { connectPlugin, explainNotConnected } from '../../core/plugins/connect'
import { callCommand, withSession } from '../../core/session'
import { cell } from '../../core/table'
import { helpSections } from '../help'

export const PLUGINS = 'PLUGINS'

// A plugin as the CLI knows it: from the session, or remembered from an earlier one.
export type KnownEntry = RegistryEntry & { previousExtensionId?: string }

const MAX_NAMESPACE_EXAMPLES = 4

// Commander's own .choices() replaces the parser, and with it the conversion
// to a number, so a choice is checked here.
function parse(type: ValueType, choices: Value[] | undefined, raw: string): Value {
  let value: Value = raw
  if (type === 'number') {
    value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value)) {
      throw new InvalidArgumentError('must be a number')
    }
  } else if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new InvalidArgumentError('must be true or false')
    value = raw === 'true'
  }
  if (choices && !choices.includes(value)) {
    throw new InvalidArgumentError(
      `must be one of: ${choices.map((c) => cell(String(c))).join(', ')}`,
    )
  }
  return value
}

// Commander calls a parser once per value, handing back what it returned last.
const parser =
  (type: ValueType, choices: Value[] | undefined, many: boolean) =>
  (raw: string, previous: unknown) =>
    many
      ? [...(Array.isArray(previous) ? previous : []), parse(type, choices, raw)]
      : parse(type, choices, raw)

// cell() shows nothing as `-`, which is right for a table and wrong for help.
const describe = (description = '', choices?: Value[]): string => {
  const described = choices ? `${description} (one of: ${choices.join(', ')})`.trim() : description
  return described && cell(described)
}

function verb(
  namespace: string,
  entry: KnownEntry,
  name: string,
  declaration: CommandDeclaration,
): Command {
  const positional = declaration.arguments ?? []
  const command = helpSections(
    new Command(name)
      .description(cell(declaration.description))
      .option('--json', 'machine-readable output'),
    { examples: declaration.examples?.map(cell) },
  )

  for (const { name: argument, type, description, variadic = false, choices } of positional) {
    command.addArgument(
      new Argument(
        `<${argument}${variadic ? '...' : ''}>`,
        describe(description, choices),
      ).argParser(parser(type, choices, variadic)),
    )
  }
  for (const [flag, declared] of Object.entries(declaration.options ?? {})) {
    const { type, description, repeatable = false, choices } = declared
    const option = new Option(
      type === 'boolean' ? `--${flag}` : `--${flag} <${type}>`,
      describe(description, choices),
    )
    if (type !== 'boolean') option.argParser(parser(type, choices, repeatable))
    if (declared.default !== undefined) option.default(declared.default)
    if (declared.required) option.makeOptionMandatory()
    command.addOption(option)
  }

  return command.action(async (...received: unknown[]) => {
    const { json, ...options } = command.opts()
    const input: Record<string, unknown> = { ...options }
    positional.forEach((argument, position) => {
      input[inputKey(argument.name)] = received[position]
    })
    await withSession(async (session) => {
      // A namespace goes to whichever extension declares it first in a session,
      // so the same words may reach another extension than last time.
      if (entry.previousExtensionId) {
        console.error(
          `note: "${namespace}" is now served by Chrome extension ${entry.extensionId}, not ${entry.previousExtensionId} as before; "tabbrew plugin forget ${namespace}" accepts that`,
        )
      }
      if (!(await connectPlugin(session, namespace, entry))) {
        console.error(explainNotConnected(namespace, entry))
        process.exitCode = 1
        return
      }
      const output = await callCommand(session, namespace, name, input, declaration.timeoutMs)
      const rendered = json ? JSON.stringify(output) : renderOutput(output, declaration.view)
      if (rendered !== null) console.log(rendered)
    })
  })
}

function noun(namespace: string, entry: KnownEntry): Command {
  const verbs = Object.entries(entry.commands)
  const command = helpSections(
    new Command(namespace).description(
      `${cell(entry.description)}${entry.connected ? '' : ' (not connected)'}\n(Chrome extension ${entry.extensionId})`,
    ),
    {
      examples: verbs
        .flatMap(([, declaration]) => declaration.examples?.slice(0, 1) ?? [])
        .slice(0, MAX_NAMESPACE_EXAMPLES)
        .map(cell),
      note: `All ${namespace} commands are a plugin's: written and served by Chrome extension ${entry.extensionId}, whose page has to be connected to the session.`,
    },
  )
  for (const [name, declaration] of verbs) {
    command.addCommand(verb(namespace, entry, name, declaration))
  }
  return command
}

export const buildPluginCommands = (registry: Record<string, KnownEntry>): Command[] =>
  Object.entries(registry)
    // A file anyone can write may name one; Commander throws on a name it has.
    .filter(([namespace]) => !RESERVED_NAMESPACES.includes(namespace))
    .map(([namespace, entry]) => noun(namespace, entry))
