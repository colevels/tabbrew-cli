import type { Argument, Command, Help, HelpConfiguration } from 'commander'
import pkg from '../../package.json'

type Sections = { examples?: string[]; note?: string }
type Row = [term: string, text: string]

const sections = new WeakMap<Command, Sections>()

export const helpSections = (cmd: Command, extra: Sections): Command => {
  sections.set(cmd, extra)
  return cmd
}

// The root note is about picking a top-level command, so only the root screen shows it;
// a group's note covers every verb beneath it.
const note = (cmd: Command): string | undefined =>
  sections.get(cmd)?.note ?? (cmd.parent?.parent ? note(cmd.parent) : undefined)

const LEARN_MORE = [
  'Use `tabbrew <command> <subcommand> --help` for more information about a command.',
  `Read the manual at ${pkg.homepage}`,
]

const argTerm = (arg: Argument): string => {
  const name = arg.name() + (arg.variadic ? '...' : '')
  return arg.required ? `<${name}>` : `[${name}]`
}

const placeholder = (cmd: Command): string => {
  if (!cmd.commands.length) return cmd.registeredArguments.map(argTerm).join(' ')
  return cmd.commands.some((sub) => sub.commands.length) ? '<command> <subcommand>' : '<command>'
}

const usage = (cmd: Command): string => {
  const path: string[] = []
  for (let c: Command | null = cmd; c; c = c.parent) path.unshift(c.name())
  return [...path, placeholder(cmd), '[flags]'].filter(Boolean).join(' ')
}

const rows = (
  helper: Help,
  items: Row[],
  width = Math.max(0, ...items.map(([term]) => term.length)),
): string[] => items.map(([term, text]) => helper.formatItem(term, width, text, helper))

const section = (heading: string, lines: string[]): string[] =>
  lines.length ? [[heading, ...lines].join('\n')] : []

const configuration: HelpConfiguration = {
  formatHelp: (cmd, helper) => {
    const { examples = [] } = sections.get(cmd) ?? {}
    // gh does not list its help command
    const subs = helper.visibleCommands(cmd).filter((sub) => cmd.commands.includes(sub))
    const subWidth = Math.max(0, ...subs.map((sub) => sub.name().length + 1))
    const groups = helper.groupItems(
      [...cmd.commands],
      subs,
      (sub) => sub.helpGroup() || 'COMMANDS',
    )
    // gh lists --version last
    const flags = helper
      .visibleOptions(cmd)
      .sort((a, b) => Number(a.long === '--version') - Number(b.long === '--version'))
    const extra = note(cmd)
    const learnMore = extra ? [...LEARN_MORE, extra] : LEARN_MORE
    const blocks = [
      helper.boxWrap(cmd.description(), helper.helpWidth ?? 80),
      ...section('USAGE', [`  ${usage(cmd)}`]),
      ...[...groups].flatMap(([heading, cmds]) =>
        section(
          heading,
          rows(
            helper,
            cmds.map((sub): Row => [`${sub.name()}:`, helper.subcommandDescription(sub)]),
            subWidth,
          ),
        ),
      ),
      ...section(
        'ARGUMENTS',
        rows(
          helper,
          helper
            .visibleArguments(cmd)
            .map((arg): Row => [argTerm(arg), helper.argumentDescription(arg)]),
        ),
      ),
      ...section(
        'FLAGS',
        rows(
          helper,
          flags.map(
            (o): Row => [`${o.short ? '' : '    '}${o.flags}`, helper.optionDescription(o)],
          ),
        ),
      ),
      ...section(
        'EXAMPLES',
        examples.map((line) => `  $ ${line}`),
      ),
      ...section(
        'LEARN MORE',
        learnMore.map((line) => `  ${line}`),
      ),
    ]
    return `${blocks.join('\n\n')}\n`
  },
}

// addCommand() does not copy help settings from the parent, so every node is configured directly.
export const installHelp = (cmd: Command): void => {
  cmd.configureHelp(configuration).helpOption('-h, --help', 'show help for command')
  for (const sub of cmd.commands) installHelp(sub)
}
