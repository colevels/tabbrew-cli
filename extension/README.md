# TabBrew CLI Harness

This is the browser half of tabbrew-cli's **development harness**. It is not the
TabBrew product extension.

## What it is for

Every browser-facing feature of the CLI is implemented here in lockstep with its
command, so the protocol between the two can be exercised end to end in a real
Chrome before it is considered done. Today that is the session handshake: the
panel finds a `tabbrew session` on `127.0.0.1:49227` or `:49228`, polls
`GET /health`, and shows what it finds. Next come command channels such as
`tabbrew tabs list`, which will land here together with the CLI verb.

The shared wire contract lives in `src/core/session/protocol.ts` and is imported
by both the CLI and this extension, so the two sides cannot drift apart.
`wxt.config.ts` derives the manifest's `optional_host_permissions` from the same
port list.

The panel is a React app (`@wxt-dev/module-react`) with explicit imports; WXT
auto-imports are off. Each panel state is a component in
`src/entrypoints/sidepanel/App.tsx`.

## What it is not

- Not the product. The real TabBrew extension will live in its own repository
  and will be started once the CLI protocol has settled.
- Not published. Nothing here goes to the Chrome Web Store; load it unpacked.

## Design rule

The open side panel *is* the connection. While it is open it polls the session;
close it and nothing runs. There is deliberately no background polling, and the
service worker only makes the toolbar icon open the panel.

## Build and load

```bash
bun run build:ext   # production build to extension/dist/chrome-mv3
bun run dev:ext     # dev build with live reload
```

Then `chrome://extensions` → Developer mode → Load unpacked →
`extension/dist/chrome-mv3`. Click the toolbar icon to open the panel. The
panel-state table and the session commands are in the root README under
"Harness extension" and "Session".
