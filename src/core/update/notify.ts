import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { YAML } from 'bun'
import { STATE_DIR } from '../session/config'
import { noUpdateCheck, UPDATE_CHECK_INTERVAL_MS } from './config'
import { checkForUpdate, type UpdateInfo } from './index'

export const STATE_PATH = join(STATE_DIR, 'state.yml')

type State = { lastCheckedAt?: number; lastKnownLatest?: string }

// A stale or hand-edited file must never keep a command from running, so
// anything unreadable reads as "never checked".
function readState(): State {
  try {
    const value: unknown = YAML.parse(readFileSync(STATE_PATH, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as State) : {}
  } catch {
    return {}
  }
}

function writeState(state: State): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_PATH, YAML.stringify(state, null, 2))
  } catch {
    // Permission errors etc. must never break the command that triggered the check.
  }
}

// Throttled to UPDATE_CHECK_INTERVAL_MS: a network failure still refreshes
// lastCheckedAt so a flaky connection backs off instead of retrying every run.
export async function checkForUpdateThrottled(): Promise<UpdateInfo | null> {
  if (noUpdateCheck()) return null
  const state = readState()
  const now = Date.now()
  if (state.lastCheckedAt && now - state.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return null
  try {
    const info = await checkForUpdate()
    writeState({ lastCheckedAt: now, lastKnownLatest: info.latest })
    return info
  } catch {
    writeState({ ...state, lastCheckedAt: now })
    return null
  }
}

export async function notifyIfUpdateAvailable(): Promise<void> {
  try {
    const info = await checkForUpdateThrottled()
    if (info?.updateAvailable) {
      console.error(`🍵  tabbrew ${info.current} → ${info.latest} available — run "tabbrew update"`)
    }
  } catch {
    // Never let the notifier crash the command that triggered it.
  }
}
