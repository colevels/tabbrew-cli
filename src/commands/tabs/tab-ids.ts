export const parseTabId = (raw: string): number | null =>
  /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null

export const reject = (message: string): void => {
  console.error(message)
  process.exitCode = 1
}
