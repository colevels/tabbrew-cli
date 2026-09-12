import { rmSync, unlinkSync } from 'node:fs'
import { discover, HOST, STATE_DIR, stopSession } from '../session'
import type { SessionInfo } from '../session/protocol'
import { currentBinaryPath, isCompiledBinary, UpdateError } from '../update'

export type UninstallPlan = {
  session: SessionInfo | null
  stateDirectory: string
  // null when running from npm or a source checkout, which their own tools remove.
  binary: string | null
}

export async function describeUninstall(): Promise<UninstallPlan> {
  return {
    session: await discover(),
    stateDirectory: STATE_DIR,
    binary: isCompiledBinary() ? currentBinaryPath() : null,
  }
}

// Stops the session first so nothing is left writing into the state
// directory; a session that will not stop aborts before anything is removed.
export async function performUninstall(plan: UninstallPlan): Promise<void> {
  if (plan.session && !(await stopSession(plan.session))) {
    throw new UpdateError(
      `session on ${HOST}:${plan.session.port} · pid ${plan.session.pid} did not stop; nothing was removed`,
    )
  }
  rmSync(plan.stateDirectory, { recursive: true, force: true })
  if (!plan.binary) return
  try {
    unlinkSync(plan.binary)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') return
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new UpdateError(
        `cannot remove ${plan.binary}: permission denied; re-run with the right permissions or delete it by hand`,
      )
    }
    throw err
  }
}
