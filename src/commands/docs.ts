import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ApiError,
  htmlFileViewUrl,
  htmlFilesList,
  htmlFilesPost,
  type HtmlFileRow,
} from "../api";
import { config } from "../config";
import { BIN, c } from "../ui";
import {
  colWidth,
  formatBytes,
  formatDate,
  padEnd,
  padEndLink,
  truncate,
} from "../table";
import { openBrowser } from "../util";

// The cloud endpoint caps uploads at 2 MB (the server also enforces this with a
// 413); we check up front to fail fast with a friendlier message.
const MAX_CLOUD_BYTES = 2 * 1024 * 1024;
// Don't slurp an arbitrarily large local file just to sniff a <title>.
const TITLE_SNIFF_LIMIT = 512 * 1024;

export interface DocsPushOptions {
  cloud?: boolean;
  title?: string;
}

/**
 * `tabbrew docs push <file>` — make an HTML file appear in the TabBrew sidepanel
 * Docs view. Local mode (default) registers the file's absolute path so TabBrew
 * opens it as file://; --cloud uploads the content (≤ 2 MB) for cross-machine
 * viewing.
 */
export async function docsPush(
  file: string | undefined,
  opts: DocsPushOptions,
): Promise<void> {
  if (!file) {
    console.error(
      c.red("✗ No file given.") +
        ` Usage: tabbrew docs push <file.html> [--cloud] [--title "…"]`,
    );
    process.exitCode = 1;
    return;
  }

  const absPath = resolve(process.cwd(), file);
  if (!(await Bun.file(absPath).exists())) {
    console.error(c.red(`✗ File not found: ${absPath}`));
    process.exitCode = 1;
    return;
  }

  const ext = extname(absPath).toLowerCase();
  if (ext !== ".html" && ext !== ".htm") {
    console.error(
      c.yellow(
        `! ${basename(absPath)} doesn't look like HTML — the Docs view renders HTML.`,
      ),
    );
  }

  const title =
    opts.title?.trim() ||
    (await deriveTitle(absPath)) ||
    basename(absPath, ext) ||
    basename(absPath);

  if (opts.cloud) {
    await pushCloud(absPath, title);
  } else {
    await pushLocal(absPath, title);
  }
}

/** Local mode: register the absolute path only; the file stays on this machine. */
async function pushLocal(absPath: string, title: string): Promise<void> {
  await htmlFilesPost(config.endpoints.htmlLocal, {
    body: JSON.stringify({ path: absPath, title }),
    headers: { "content-type": "application/json" },
  });

  console.log(`${c.green("✓ Registered with TabBrew")} ${c.dim("(local)")}`);
  console.log(`  title: ${title}`);
  console.log(`  open:  TabBrew sidepanel → ${c.bold("Docs")}`);
  console.log(`  file:  ${pathToFileURL(absPath).href}`);
  console.log(
    c.dim(
      `  note:  opening from TabBrew needs "Allow access to file URLs" enabled for the extension.`,
    ),
  );
}

/** Cloud mode: upload the content to private storage and print the view URL. */
async function pushCloud(absPath: string, title: string): Promise<void> {
  const size = Bun.file(absPath).size;
  if (size > MAX_CLOUD_BYTES) {
    throw new ApiError(
      `${basename(absPath)} is ${(size / 1024 / 1024).toFixed(2)} MB — over the 2 MB cloud limit. ` +
        `Use local mode (drop --cloud) or slim the file.`,
      413,
    );
  }

  const bytes = await Bun.file(absPath).arrayBuffer();
  const name = basename(absPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "text/html" }), name);
  form.append("title", title);
  const result = await htmlFilesPost(config.endpoints.htmlUpload, { body: form });

  console.log(`${c.green("✓ Uploaded to TabBrew")} ${c.dim("(cloud)")}`);
  console.log(`  title: ${title}`);
  console.log(`  open:  TabBrew sidepanel → ${c.bold("Docs")}`);
  const url = result.data?.url;
  if (typeof url === "string" && url) {
    console.log(
      `  url:   ${url}  ${c.dim("(owner-only; requires being logged in to tabbrew.com)")}`,
    );
  }
}

export interface DocsListOptions {
  json?: boolean;
}

/**
 * The URL that opens a doc in a browser: a `local` doc is a `file://` path on this
 * machine (from the list DTO's `localPath`); a cloud (`gcs`) doc is the owner-only
 * tabbrew.com `/view` URL. Everything is derived from data `docs list` already
 * returns — no extra request.
 */
function viewUrl(row: HtmlFileRow): string {
  if (row.kind === "local" && row.localPath) {
    return pathToFileURL(row.localPath).href;
  }
  return htmlFileViewUrl(row.id);
}

/**
 * `tabbrew docs list` — show the HTML docs registered/uploaded to the TabBrew
 * Docs view (id, title, kind, size, created). Authenticated with the same OAuth
 * login token as `whoami`. `--json` prints the raw array.
 */
export async function docsList(opts: DocsListOptions): Promise<void> {
  const rows = await htmlFilesList();

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(
      c.dim("No docs yet.") +
        ` Push one with: ${c.bold("tabbrew docs push <file.html>")}`,
    );
    return;
  }

  // Hand-padded columns (no table lib in this repo). Padding is measured by
  // terminal display width (Bun.stringWidth), not string length, so CJK/emoji
  // (width 2) and Thai/combining marks (width 0) don't skew the columns. Colors
  // still wrap whole lines only, never inside a padded cell.
  const view = rows.map((r) => ({
    id: String(r.id),
    title: truncate(r.title?.trim() || r.filename || "(untitled)", 48),
    kind: r.kind,
    size: formatBytes(r.sizeBytes),
    created: formatDate(r.createdAt),
    // Full open URL; the title cell is wrapped in an OSC 8 link to it below.
    url: viewUrl(r),
  }));

  const widths = {
    id: colWidth("ID", view, "id"),
    title: colWidth("TITLE", view, "title"),
    kind: colWidth("KIND", view, "kind"),
    size: colWidth("SIZE", view, "size"),
  };
  const line = (v: {
    id: string;
    title: string;
    kind: string;
    size: string;
    created: string;
    url?: string;
  }): string =>
    [
      padEnd(v.id, widths.id),
      // Link the title to its open URL (data rows only; the header passes no url).
      // Padding is measured on the plain title, then applied outside the link so
      // the OSC 8 escape bytes never skew column alignment.
      padEndLink(v.title, widths.title, v.url),
      padEnd(v.kind, widths.kind),
      padEnd(v.size, widths.size),
      v.created, // last column needs no trailing padding
    ].join("  ");

  console.log(
    c.dim(
      line({ id: "ID", title: "TITLE", kind: "KIND", size: "SIZE", created: "CREATED" }),
    ),
  );
  for (const v of view) console.log(line(v));
  console.log("");
  // Only hint the interactive affordances on a TTY, so piped/scripted output
  // stays quiet. (`docs open` still works everywhere.)
  if (process.stdout.isTTY) {
    console.log(
      c.dim(`  ⌘/Ctrl-click a title to open, or: ${BIN} docs open <id>`),
    );
  }
  console.log(c.dim(`  ${rows.length} doc${rows.length === 1 ? "" : "s"}`));
}

/**
 * `tabbrew docs open <id>` — open one of your pushed docs in the default browser.
 * Resolves the doc from the list (there is no GET-by-id route) and opens its
 * `file://` (local) or tabbrew.com `/view` (cloud) URL via `openBrowser`.
 */
export async function docsOpen(idArg: string | undefined): Promise<void> {
  const id = Number(idArg);
  if (!idArg || !Number.isInteger(id) || id <= 0) {
    console.error(
      c.red("✗ Invalid or missing id.") +
        ` Usage: ${BIN} docs open <id>  ${c.dim(`(ids are shown by \`${BIN} docs list\`)`)}`,
    );
    process.exitCode = 1;
    return;
  }

  const row = (await htmlFilesList()).find((r) => r.id === id);
  if (!row) {
    console.error(
      c.red(`✗ No doc with id ${id}.`) +
        ` Run ${c.bold(`${BIN} docs list`)} to see your docs.`,
    );
    process.exitCode = 1;
    return;
  }

  const url = viewUrl(row);
  const title = row.title?.trim() || row.filename || `doc ${id}`;
  const opened = await openBrowser(url);
  console.log(
    opened
      ? `${c.green("✓ Opening")} ${c.bold(title)} ${c.dim("in your browser…")}`
      : `${c.yellow("! Couldn't open a browser automatically.")} Open this URL:`,
  );
  console.log(`  ${url}`);
  if (row.kind !== "local") {
    console.log(
      c.dim("  (cloud doc — renders only in a browser signed in to tabbrew.com)"),
    );
  }
}

/** Best-effort: pull a title from the document's <title> tag; null if unavailable. */
async function deriveTitle(absPath: string): Promise<string | null> {
  try {
    if (Bun.file(absPath).size > TITLE_SNIFF_LIMIT) return null;
    const text = await Bun.file(absPath).text();
    const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = match?.[1]?.replace(/\s+/g, " ").trim();
    return title || null;
  } catch {
    return null;
  }
}
