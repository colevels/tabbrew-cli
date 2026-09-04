#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";

const program = new Command()
  .name("tabbrew")
  .description("TabBrew CLI")
  .version(pkg.version);

// Nouns register here, one line each:
// program.addCommand(tabsCommand);

await program.parseAsync();
