// The two user-facing failure kinds the `tabs` commands throw, in one module so
// the error boundary in index.ts can import them without depending on a command.
//
// They used to live inside the commands that threw them, which broke the moment
// one of those commands was deleted: `TabsBridgeError` was defined in
// `tabs-push.ts` but thrown by `tabs suggest`.

/** A bad input: missing script file, unreadable state file, empty stdin. */
export class TabsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabsInputError";
  }
}

/** The local `tabs serve` isn't reachable, or rejected what we sent it. */
export class TabsBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TabsBridgeError";
  }
}
