// The skill `init` installs. One skill, bundled as a string at compile time via
// the text import, so nothing is read from disk at runtime and it survives
// `bun build --compile`.
//
// Unlike the DSL runtime next to it, this prompt is **native to this repo**: it
// documents `tabs list` / `tabs suggest`, which don't exist upstream, so
// tabbrew-cli is its source of truth and it must NOT be re-synced from
// tabbrew-api. It replaced three token-budget variants (compact/standard/full)
// of a chat-shaped prompt — an agent with a terminal doesn't need the cheap one,
// and there is no chat turn to run the interactive version in.

import skill from "./SKILL.md" with { type: "text" };

export const TABS_SKILL = skill;
