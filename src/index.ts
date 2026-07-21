#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { whoami } from "./commands/whoami";
import { repoInfo } from "./commands/tools";
import { docsPush, docsList, docsOpen } from "./commands/docs";
import { tabsList } from "./commands/tabs-list";
import { TabsBridgeError, TabsInputError } from "./commands/tabs-errors";
import { init } from "./commands/init";
import { update } from "./commands/update";
import { tabsServe, ServeError } from "./commands/tabs-serve";
import { tabsSuggest } from "./commands/tabs-suggest";
import { AuthError } from "./auth";
import { ApiError, NotAuthenticatedError, TokenExpiredError } from "./api";
import { UpdateError } from "./update";
import { assertFlagsAllowed, findCommand, UsageError } from "./registry";
import { c, printCommandHelp, printHelp, VERSION } from "./ui";

async function route(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      all: { type: "boolean" },
      // parseArgs is strict and takes one flat table, so every flag any command
      // accepts must be declared here. Which command may actually use each one
      // is enforced separately, from the registry — see assertFlagsAllowed.
      global: { type: "boolean", short: "g" },
      "dry-run": { type: "boolean" },
      uninstall: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      agent: { type: "string" },
      "no-skill": { type: "boolean" },
      cloud: { type: "boolean" },
      title: { type: "string" },
      json: { type: "boolean" },
      check: { type: "boolean" },
      out: { type: "string" },
      note: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  const [command, sub] = positionals;

  if (values.version) {
    console.log(VERSION);
    return;
  }
  const cmd = findCommand(positionals);
  if (values.help || command === "help" || command === undefined) {
    // Asking for help *about a command* gets that command's help — both
    // `tabbrew tabs push --help` and `tabbrew help tabs push`. Bare `--help`,
    // `help`, `help --all`, an unknown command, and `help` itself all fall
    // through to the full listing.
    const target = command === "help" ? findCommand(positionals.slice(1)) : cmd;
    if (target && target.name !== "help") {
      printCommandHelp(target);
      return;
    }
    printHelp(values.all);
    return;
  }

  // `parseArgs` runs one flat option table (Node needs every flag declared up
  // front), so on its own it happily accepts `docs push --port 99`. The registry
  // is the second gate that binds each flag to the command that implements it.
  assertFlagsAllowed(cmd, values);

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
        noSkill: values["no-skill"],
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
      if (sub === "list") return docsList({ json: values.json });
      if (sub === "open") return docsOpen(positionals[2]);
      console.error(
        `Unknown docs subcommand: ${sub ?? "(none)"}. Try: tabbrew docs push <file.html> | tabbrew docs list | tabbrew docs open <id>`,
      );
      process.exitCode = 1;
      return;
    case "tabs":
      if (sub === "serve") return tabsServe({ out: values.out });
      if (sub === "list") return tabsList({ json: values.json });
      if (sub === "suggest")
        return tabsSuggest(positionals[2], {
          note: values.note,
          json: values.json,
        });
      console.error(
        `Unknown tabs subcommand: ${sub ?? "(none)"}. Try: tabbrew tabs serve | tabs list | tabs suggest <file>`,
      );
      process.exitCode = 1;
      return;
    case "update":
      return update({ check: values.check, json: values.json });
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
    err instanceof TokenExpiredError ||
    err instanceof UpdateError ||
    err instanceof TabsInputError ||
    err instanceof ServeError ||
    err instanceof TabsBridgeError ||
    err instanceof UsageError;

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
