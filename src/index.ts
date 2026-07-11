#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { whoami } from "./commands/whoami";
import { repoInfo } from "./commands/tools";
import { docsPush } from "./commands/docs";
import { init } from "./commands/init";
import { AuthError } from "./auth";
import { ApiError, NotAuthenticatedError, TokenExpiredError } from "./api";
import { c, printHelp, VERSION } from "./ui";

async function route(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      // init flags (parseArgs is strict, so every accepted flag must be declared)
      global: { type: "boolean", short: "g" },
      "dry-run": { type: "boolean" },
      uninstall: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      agent: { type: "string" },
      // docs push flags
      cloud: { type: "boolean" },
      title: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  const [command, sub] = positionals;

  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help || command === "help" || command === undefined) {
    printHelp();
    return;
  }

  switch (command) {
    case "login":
      return login();
    case "logout":
      return logout();
    case "whoami":
      return whoami();
    case "init":
      return init({
        global: values.global,
        dryRun: values["dry-run"],
        uninstall: values.uninstall,
        yes: values.yes,
        agent: values.agent,
      });
    case "tools":
      if (sub === "repo-info") return repoInfo();
      console.error(
        `Unknown tools subcommand: ${sub ?? "(none)"}. Try: tabbrew tools repo-info`,
      );
      process.exitCode = 1;
      return;
    case "docs":
      if (sub === "push")
        return docsPush(positionals[2], {
          cloud: values.cloud,
          title: values.title,
        });
      console.error(
        `Unknown docs subcommand: ${sub ?? "(none)"}. Try: tabbrew docs push <file.html>`,
      );
      process.exitCode = 1;
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exitCode = 1;
  }
}

// Single friendly error boundary — users never see a raw stack trace.
route().catch((err: unknown) => {
  const known =
    err instanceof AuthError ||
    err instanceof ApiError ||
    err instanceof NotAuthenticatedError ||
    err instanceof TokenExpiredError;

  if (known) {
    console.error(`\n${c.red("✗")} ${(err as Error).message}`);
  } else if (err instanceof Error) {
    console.error(`\n${c.red("✗")} ${err.message}`);
    if (process.env.TABBREW_DEBUG) console.error(err.stack);
  } else {
    console.error(`\n${c.red("✗")} An unexpected error occurred.`);
  }
  process.exitCode = 1;
});
