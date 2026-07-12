import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ApiError, htmlFilesList, htmlFilesPost } from "../api";
import { config } from "../config";
import { c } from "../ui";

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
  await htmlFilesPost(config.endpoints.htmlLocal, () => ({
    body: JSON.stringify({ path: absPath, title }),
    headers: { "content-type": "application/json" },
  }));

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

  // Read once; the request body is rebuilt per auth attempt from these bytes.
  const bytes = await Bun.file(absPath).arrayBuffer();
  const name = basename(absPath);
  const result = await htmlFilesPost(config.endpoints.htmlUpload, () => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "text/html" }), name);
    form.append("title", title);
    return { body: form };
  });

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

  // Hand-padded columns (no table lib in this repo). Colors wrap whole lines
  // only — never inside a padded cell — so ANSI escapes can't skew alignment.
  const view = rows.map((r) => ({
    id: String(r.id),
    title: truncate(r.title?.trim() || r.filename || "(untitled)", 48),
    kind: r.kind,
    size: formatBytes(r.sizeBytes),
    created: formatDate(r.createdAt),
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
  }): string =>
    [
      padEnd(v.id, widths.id),
      padEnd(v.title, widths.title),
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
  console.log(c.dim(`  ${rows.length} doc${rows.length === 1 ? "" : "s"}`));
}

function colWidth(
  header: string,
  rows: Array<Record<string, string>>,
  key: string,
): number {
  return Math.max(header.length, ...rows.map((r) => r[key]!.length));
}

function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
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
