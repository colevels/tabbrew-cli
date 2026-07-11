import { $ } from "bun";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown when a request exceeds its deadline. */
export class TimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms / 1000}s`);
    this.name = "TimeoutError";
  }
}

/** fetch() that aborts after `timeoutMs` and reports a clear TimeoutError. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new TimeoutError(url, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve an executable on PATH. Thin wrapper around Bun.which for testability. */
export function which(cmd: string): string | null {
  return Bun.which(cmd);
}

/** Read a response body as text without throwing; capped so we never dump pages. */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300).trim();
  } catch {
    return "";
  }
}

/**
 * Best-effort: open a URL in the user's default browser.
 * Never throws — returns false if we couldn't launch anything.
 */
export async function openBrowser(url: string): Promise<boolean> {
  // Opt-out for headless / CI environments.
  if (process.env.TABBREW_NO_BROWSER) return false;
  try {
    if (process.platform === "darwin") {
      if (!which("open")) return false;
      await $`open ${url}`.quiet().nothrow();
    } else if (process.platform === "win32") {
      await $`cmd /c start "" ${url}`.quiet().nothrow();
    } else {
      if (!which("xdg-open")) return false;
      await $`xdg-open ${url}`.quiet().nothrow();
    }
    return true;
  } catch {
    return false;
  }
}
