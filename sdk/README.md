# @tabbrew/sdk

The extension half of [tabbrew](https://github.com/colevels/tabbrew-cli): one
call that lets a page of your Chrome extension serve `tabbrew` CLI sessions, so
`tabbrew tabs list` and every other base command work against the browser your
extension runs in.

```bash
npm install @tabbrew/sdk
```

```ts
import { createOperators, serveSession } from '@tabbrew/sdk'

const controller = new AbortController()

void serveSession({
  operators: createOperators(chrome),
  signal: controller.signal,
  onStatus: (status) => console.log(status.state),
  onServed: (event) => console.log(event.operator, event.error ?? 'ok'),
})

// controller.abort() stops polling and serving.
```

`serveSession` finds a `tabbrew session` on `127.0.0.1`, holds its command
channel while one is up, and follows it across restarts. `createOperators`
implements every base operator against the `chrome.*` promise APIs. There are
no dependencies, and no wxt, React or Bun is needed; it ships as one ESM file
with type declarations.

The SDK is versioned in lockstep with the CLI: `@tabbrew/sdk` x.y.z speaks the
protocol of `tabbrew-cli` x.y.z.

## What your extension needs

- **Manifest V3**, with the `tabs` and `tabGroups` permissions.
- **Required** host permissions for the session's ports, not optional ones.
  The CLI opens your page by URL, without a user gesture, and such a page can
  never ask for a permission:

  ```json
  "host_permissions": ["http://127.0.0.1:49227/*", "http://127.0.0.1:49228/*"]
  ```

  `DEFAULT_PORTS` is that list; a manifest built in code can derive it.
- **An extension page** to call `serveSession` from: a tab, a side panel, a
  popup. Never the service worker. An open page *is* the connection: while it
  is open it serves, close it and nothing runs. There is deliberately no
  background polling.
- For `tabbrew session start` to open your extension, a page named
  `CONNECTION_PAGE` (`connection.html`) at the extension root, and
  `TABBREW_EXTENSION_ID` (or `extensionId` in `.tabbrew.json`) set to your
  extension's id on the CLI side.

## `serveSession(options)`

| Option | |
|---|---|
| `operators` | The operator table, normally `createOperators(chrome)`. |
| `signal` | Aborting it ends the call; the returned promise then settles. |
| `onStatus` | Called after **every** poll, the ones that find nothing included. |
| `onServed` | Called after each command: `{ at, operator, error? }`. |
| `ports` | Defaults to `DEFAULT_PORTS`. |
| `pollMs` | Defaults to 3000. The poll is also what keeps an idle session alive, and it has to stay inside the CLI's 5s wait for a page after it spawns a session. |
| `retryMs` | Defaults to 1000. |

`onStatus` receives one of:

```ts
| { state: 'searching'; at: number }
| { state: 'connected'; at: number; session: SessionInfo }
| { state: 'lost'; at: number }
```

`lost` is reported once, on the first poll after a session this call was
serving went away; `searching` follows. A page that exists only for the
connection can close itself on `lost`. `session` carries `port`, `pid`,
`version` and `uptimeMs`, fresh on every poll; `formatUptime` and `HOST` are
exported for showing them.

One page should serve at a time. When several pages of an extension can be
open together, elect one (a Web Lock works well) and call `serveSession` only
from the winner.

## `createOperators(chrome)`

Takes anything shaped like the slice of `chrome.*` the operators use
(`ChromeApi`): the global `chrome`, `browser` from wxt, or a plain object in a
test. It is typed loosely on purpose, so that neither needs a cast, whatever
the version of `@types/chrome`.

To serve only some operators, or to wrap one, spread the result:

```ts
const operators = { ...createOperators(chrome), closeTabs: myCloseTabs }
```

## Building from the repository

```bash
bun run build:sdk   # sdk/dist
```
