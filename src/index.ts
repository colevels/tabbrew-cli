#!/usr/bin/env bun
import { Command } from "commander"
import pkg from "../package.json"
import { init } from "./commands/init"
import { session } from "./commands/session"

const program = new Command().name("tabbrew").description("TabBrew CLI").version(pkg.version)

program.addCommand(session)
program.addCommand(init)

await program.parseAsync()
