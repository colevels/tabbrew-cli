import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

export const CLAUDE_MD = 'CLAUDE.md'
export const CLAUDE_DIR_MD = '.claude/CLAUDE.md'
export const AGENTS_MD = 'AGENTS.md'
export const CURSOR_RULES = '.cursorrules'

// Every file a preset can write. Discovery and removal derive from this list so
// "where init writes" and "where init looks" cannot drift apart.
export const KNOWN: readonly string[] = [CLAUDE_MD, CLAUDE_DIR_MD, AGENTS_MD, CURSOR_RULES]

export const AGENTS = ['claude', 'cursor', 'codex', 'all'] as const
export type Agent = (typeof AGENTS)[number]

type Preset = { search: readonly string[]; create: readonly string[] }

const PRESETS: Record<Exclude<Agent, 'all'>, Preset> = {
  claude: { search: [CLAUDE_MD, CLAUDE_DIR_MD], create: [CLAUDE_MD] },
  cursor: { search: [CURSOR_RULES, AGENTS_MD], create: [CURSOR_RULES] },
  codex: { search: [AGENTS_MD], create: [AGENTS_MD] },
}

export type Targets = { inject: string[]; create: string[] }

export function discover(cwd: string): string[] {
  return KNOWN.filter((rel) => existsSync(join(cwd, rel)))
}

export function resolveTargets(cwd: string, agent?: Agent): Targets {
  if (!agent || agent === 'all') {
    const existing = discover(cwd)
    if (existing.length) return { inject: existing, create: [] }
    return { inject: [], create: agent === 'all' ? [CLAUDE_MD, AGENTS_MD] : [CLAUDE_MD] }
  }
  const preset = PRESETS[agent]
  const found = preset.search.find((rel) => existsSync(join(cwd, rel)))
  return found ? { inject: [found], create: [] } : { inject: [], create: [...preset.create] }
}

export function header(rel: string): string {
  return `# ${basename(rel, extname(rel))}\n\nProject-specific guidance for AI coding agents.`
}
