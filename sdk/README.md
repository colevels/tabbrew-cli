# @tabbrew/sdk

The extension half of [tabbrew](https://github.com/colevels/tabbrew-cli): one
call that lets a page of your Chrome extension serve `tabbrew` CLI sessions, so
`tabbrew tabs list` and every other base command work against the browser your
extension runs in. It can also add commands of its own, called as
`tabbrew plugin <namespace> <command>`: see [Your own commands](#your-own-commands).

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
| `operators` | The operator table, normally `createOperators(chrome)`. Leave it out to add commands only. |
| `namespaces` | Your own commands: see [below](#your-own-commands). `operators`, `namespaces` or both. |
| `page` | The page of your extension the CLI may open when one of your commands finds none connected, as a path inside the extension (`'connection.html'`). The CLI remembers it between sessions. Without it the CLI only says the plugin is not connected. |
| `signal` | Aborting it ends the call; the returned promise then settles. |
| `onStatus` | Called after **every** poll, the ones that find nothing included. |
| `onServed` | Called after each operator: `{ at, operator, error? }`. |
| `onCommandServed` | Called after each command of yours: `{ at, namespace, command, error? }`. |
| `ports` | Defaults to `DEFAULT_PORTS`. |
| `pollMs` | Defaults to 3000. The poll is also what keeps an idle session alive, and it has to stay inside the CLI's 5s wait for a page after it spawns a session. |
| `retryMs` | Defaults to 1000. |

`onStatus` receives one of:

```ts
| { state: 'searching'; at: number }
| { state: 'connected'; at: number; session: SessionInfo; declared?: DeclareResponse }
| { state: 'lost'; at: number }
| { state: 'rejected'; at: number; session: SessionInfo; reason: Rejection }
```

`lost` is reported once, on the first poll after a session this call was
serving went away; `searching` follows. A page that exists only for the
connection can close itself on `lost`. `session` carries `port`, `pid`,
`version` and `uptimeMs`, fresh on every poll; `formatUptime` and `HOST` are
exported for showing them.

`rejected` only happens to a page that serves no operators, when this session
left it nothing to serve: `namespace_taken`, `bad_commands`, `forbidden`, or
`unsupported_session` for a session older than plugins. The page stops asking
that session; the next one is asked afresh. A page with operators is never
rejected: it keeps serving them whatever becomes of its commands.

One page should serve at a time. When several pages of an extension can be
open together, elect one (a Web Lock works well) and call `serveSession` only
from the winner.

## Your own commands

```ts
void serveSession({
  // operators: createOperators(chrome),   // only if you serve the base too
  page: 'cli.html',
  namespaces: {
    notes: {
      description: 'Notes attached to pages',
      commands: {
        list: {
          description: 'List notes',
          options: {
            tag: { type: 'string', repeatable: true, description: 'only notes with this tag' },
            limit: { type: 'number', default: 20 },
          },
          view: { rows: 'notes', columns: ['id', 'tags', 'title'], clip: { title: 50 } },
          examples: ['tabbrew plugin notes list --tag work'],
          run: async ({ tag, limit }) => ({ notes: await store.query(tag, limit) }),
        },
        add: {
          description: 'Add a note',
          arguments: [{ name: 'text', type: 'string' }],
          options: { 'tab-id': { type: 'number' } },
          view: { message: 'added note {id}' },
          run: ({ text, tabId }) => store.add(text, tabId),
        },
      },
    },
  },
  signal,
})
```

```
$ tabbrew plugin notes list --tag work
$ tabbrew plugin notes add "follow up" --tab-id 4211
$ tabbrew plugin notes add --help
```

You declare, the CLI does the rest: it builds the commands, checks and
converts what the user typed, and renders what `run` returned. Nothing is
installed on the user's machine, and there is no allowlist: any Chrome
extension may declare. The first one to declare a namespace holds it for the
life of the session.

- **Names** (`notes`, `list`, `tab-id`) are lowercase words joined by `-`.
  `list`, `open`, `forget` and `help` cannot be namespaces.
- **`run(input)`** gets arguments and options as one object, `tab-id` as
  `tabId`, a repeatable option as an array. Return plain data; throw to fail,
  and the message reaches the user. The CLI adds `--json` to every command.
- **Parameters** have a `type` of `string`, `number` or `boolean`, and may
  have `description` and `choices`. An argument may be `variadic` (last only);
  an option may be `required`, `repeatable` or have a `default`.
- **`view`** says how to print the output, where a path like `notes` or
  `author.name` looks into it: `{ message: 'added {id}' }`,
  `{ fields: ['id', 'title'] }`, `{ text: 'body' }` for text that keeps its
  lines, or `{ rows?, columns, clip? }` for a table. Without one the CLI goes
  by the shape of the output.
- **`timeoutMs`** defaults to 10 seconds and cannot exceed 60. A page serves
  one request at a time, so a slow command holds up every other.
- **`examples`** are shown in help only if they start with
  `tabbrew plugin <your namespace>` and carry no shell syntax.

What is wrong in a declaration is dropped alone and reported in
`status.declared`: a namespace you could not have under `rejected`, a command
with a wrong parameter under `dropped`. Check it while developing. Text is cut
to 500 characters.

In your own tests, `asExtension` from `@tabbrew/sdk/testing` makes the requests
of the test process look like your page's, which a session otherwise refuses:

```ts
import { asExtension } from '@tabbrew/sdk/testing'

const restore = asExtension('a'.repeat(32))
// serveSession(...) against a session, then
restore()
```

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
