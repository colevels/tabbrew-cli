import { Argument, Command, InvalidArgumentError, Option } from 'commander'
import type {
  CommandDeclaration,
  Registry,
  RegistryEntry,
  ValueType,
} from '../../core/commands/declaration'
import { renderOutput } from '../../core/commands/view'
import { callCommand, withSession } from '../../core/session'
import { cell } from '../../core/table'
import { helpSections } from '../help'

export const PLUGIN_COMMANDS = 'PLUGIN COMMANDS'

const camelCase = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())

function parse(type: ValueType, raw: string): string | number | boolean {
  if (type === 'string') return raw
  if (type === 'number') {
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value))
      throw new InvalidArgumentError('must be a number')
    return value
  }
  if (raw === 'true' || raw === 'false') return raw === 'true'
  throw new InvalidArgumentError('must be true or false')
}

// Commander calls a parser once per value, handing back what it returned last.
const parser = (type: ValueType, many: boolean) => (raw: string, previous: unknown) =>
  many ? [...(Array.isArray(previous) ? previous : []), parse(type, raw)] : parse(type, raw)

function verb(namespace: string, name: string, declaration: CommandDeclaration): Command {
  const positional = declaration.arguments ?? []
  const command = new Command(name)
    .description(cell(declaration.description))
    .option('--json', 'machine-readable output')

  for (const { name: argument, type, description, variadic = false } of positional) {
    command.addArgument(
      new Argument(`<${argument}${variadic ? '...' : ''}>`, cell(description ?? '')).argParser(
        parser(type, variadic),
      ),
    )
  }
  for (const [flag, declared] of Object.entries(declaration.options ?? {})) {
    const { type, description, repeatable = false } = declared
    const option = new Option(
      type === 'boolean' ? `--${flag}` : `--${flag} <${type}>`,
      cell(description ?? ''),
    )
    if (type !== 'boolean') option.argParser(parser(type, repeatable))
    if (declared.default !== undefined) option.default(declared.default)
    if (declared.required) option.makeOptionMandatory()
    command.addOption(option)
  }

  return command.action(async (...received: unknown[]) => {
    const { json, ...options } = command.opts()
    const input: Record<string, unknown> = { ...options }
    positional.forEach((argument, at) => {
      input[camelCase(argument.name)] = received[at]
    })
    await withSession(async (session) => {
      const output = await callCommand(session, namespace, name, input)
      const rendered = json ? JSON.stringify(output) : renderOutput(output, declaration.view)
      if (rendered !== null) console.log(rendered)
    })
  })
}

function noun(namespace: string, entry: RegistryEntry): Command {
  const description = cell(entry.description) + (entry.connected ? '' : ' (not connected)')
  const command = helpSections(new Command(namespace).description(description), {
    note: `All ${namespace} commands come from a plugin: Chrome extension ${entry.extensionId}, whose page has to be connected to the session.`,
  })
  for (const [name, declaration] of Object.entries(entry.commands)) {
    command.addCommand(verb(namespace, name, declaration))
  }
  return command
}

export const buildPluginCommands = (registry: Registry): Command[] =>
  Object.entries(registry).map(([namespace, entry]) => noun(namespace, entry))
