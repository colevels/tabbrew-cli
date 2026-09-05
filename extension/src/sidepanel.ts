import {
  discover,
  ensurePermission,
  formatUptime,
  HOST,
  hasPermission,
  PORTS,
  type SessionInfo,
} from './session'

// Well inside the session's idle window, so an open panel keeps it alive.
const POLL_MS = 3_000

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

const dot = el('dot')
const checked = el('checked')
const sections = {
  permission: el('permission'),
  missing: el('missing'),
  connected: el('connected'),
}

let lastChecked = 0
let polling: ReturnType<typeof setInterval> | null = null

function show(state: keyof typeof sections): void {
  for (const [name, section] of Object.entries(sections)) section.hidden = name !== state
  dot.classList.toggle('on', state === 'connected')
}

function render(session: SessionInfo | null): void {
  lastChecked = Date.now()
  if (!session) {
    show('missing')
    return
  }
  el('address').textContent = `${HOST}:${session.port}`
  el('pid').textContent = String(session.pid)
  el('version').textContent = `v${session.version}`
  el('uptime').textContent = formatUptime(session.uptimeMs)

  const mine = chrome.runtime.getManifest().version
  const mismatch = el('mismatch')
  mismatch.hidden = session.version === mine
  mismatch.textContent = `This panel is v${mine}; the session was started by tabbrew v${session.version}.`
  show('connected')
}

async function refresh(): Promise<void> {
  render(await discover())
}

// Closing the panel unloads this page, which is how polling stops.
function startPolling(): void {
  if (polling) return
  void refresh()
  polling = setInterval(() => void refresh(), POLL_MS)
}

el('ports').textContent = PORTS.map((port) => `${HOST}:${port}`).join(', ')

el<HTMLButtonElement>('connect').addEventListener('click', async () => {
  if (!(await ensurePermission())) return
  startPolling()
})

setInterval(() => {
  if (!lastChecked) return
  checked.hidden = false
  checked.textContent = `checked ${Math.round((Date.now() - lastChecked) / 1000)}s ago`
}, 1_000)

if (await hasPermission()) startPolling()
else show('permission')
