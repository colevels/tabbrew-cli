# TabBrew CLI Harness

This is the browser half of tabbrew-cli's **development harness**. It is not the
TabBrew product extension.

## What it is for

Every browser-facing feature of the CLI is implemented here in lockstep with its
command, so the protocol between the two can be exercised end to end in a real
Chrome before it is considered done. Today that is the session handshake and the
command channel behind `tabbrew tabs list`, `tabbrew windows list`, `tabbrew groups list`, `tabbrew groups collapse`/`uncollapse`/`close`, `tabbrew windows create` and `tabbrew tabs create`/`focus`/`move`/`group`/`ungroup`/`discard`/`reload`: an extension page finds a `tabbrew session`
on `127.0.0.1:49227` or `:49228`, polls `GET /health`, and while a session
answers it holds a long-poll on `GET /requests/next`, runs each request it
claims against `chrome.*` (`src/utils/operators.ts`), and posts the result to
`POST /requests/<id>/result`. Every new verb lands here alongside its CLI
command.

The shared wire contract lives in `src/core/session/protocol.ts` and is imported
by both the CLI and this extension, so the two sides cannot drift apart.
`wxt.config.ts` derives the manifest's `host_permissions` from the same port
list and pins the manifest `key` from the same file, so the extension id is the
one the CLI computes.

The app is React (`@wxt-dev/module-react`) with explicit imports; WXT
auto-imports are off. Each state is a component in `src/components/App.tsx`,
mounted by two entrypoints: `connection.html`, the tab the CLI opens, and
`sidepanel.html`, behind the toolbar icon.

## What it is not

- Not the product. The real TabBrew extension will live in its own repository
  and will be started once the CLI protocol has settled.
- Not published to the Chrome Web Store. Each GitHub Release carries the build
  as `tabbrew-extension.zip`; load it unpacked.

## Design rule

An open extension page *is* the connection. While it is open it polls the
session and serves its commands; close it and nothing runs. There is
deliberately no background polling: the long-poll is held by a page, never the
worker, and the service worker only makes the toolbar icon open the side panel.

The CLI cannot open a side panel (Chrome wants a user gesture), so it opens
`connection.html` in a tab instead, by URL. That is why the id is pinned and
the host permissions are required rather than optional: a page opened without
a gesture could never ask for them. A second connection page yields to the
first, and a connection page whose session stops closes itself.

## Build and load

```bash
bun run build:ext   # production build to extension/dist/chrome-mv3
bun run dev:ext     # dev build with live reload
```

Then `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/chrome-mv3`. A build loaded before the `key` was pinned has a
different id; remove it and load again. The CLI opens the Web Store extension
by default, so set `TABBREW_EXTENSION_ID` to the id Chrome shows, or run
`tabbrew init --extension harness` once in the checkout to keep it in
`.tabbrew.json`;
`tabbrew session start` then opens the connection page, and the toolbar icon
opens the side panel. The page-state table
and the session commands are in the root README under "Harness extension",
"Session" and "Tabs".
