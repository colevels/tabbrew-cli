# tabbrew-cli

[![CI](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/colevels/tabbrew-cli/actions/workflows/ci.yml)

TabBrew CLI, built on Bun and commander.

## Run

```bash
bun install
bun start --help
```

## Build a standalone binary

```bash
bun run build
./dist/tabbrew --version
```

## Layout

Commands are organised as noun folders with one verb per file.

```
src/index.ts                   root program, registers nouns
src/commands/<noun>/index.ts   new Command("<noun>") + addCommand(each verb)
src/commands/<noun>/<verb>.ts  one verb = one exported Command
```
