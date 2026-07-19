// Bundled interactive skill prompts. These are verbatim copies of the "portable"
// SKILL.md variants whose source of truth is
// tabbrew/tabbrew-api/src/skill/portable/tabbrew-portable-{compact,standard,full}/SKILL.md
// (re-sync on any change there — see CLAUDE.md). They teach an agent the
// interactive NL→TabBrew-Script workflow (clarify → plan → confirm DEL → emit a
// fenced ```tabbrew block). The binary embeds them at compile time via the text
// import, so `init` can install one with no runtime file read.

import compact from "./SKILL.compact.md" with { type: "text" };
import standard from "./SKILL.standard.md" with { type: "text" };
import full from "./SKILL.full.md" with { type: "text" };
import auto from "./SKILL.auto.md" with { type: "text" };

export type SkillVariant = "compact" | "standard" | "full";

export const SKILL_VARIANTS: Record<SkillVariant, string> = { compact, standard, full };

/**
 * The auto-mode loop skill — watch → propose → listen, driving `tabs watch` /
 * `tabs suggest`. Unlike the three variants above, this one is **native to this
 * repo**: it documents CLI commands that don't exist upstream, so tabbrew-cli is
 * its source of truth and it must NOT be re-synced from tabbrew-api. It has no
 * variants; the loop's instructions don't get cheaper with more tabs.
 */
export const AUTO_SKILL = auto;

/** Full is the default: an agent (unlike a token-budgeted extension) can afford it. */
export const DEFAULT_SKILL_VARIANT: SkillVariant = "full";

export const isSkillVariant = (v: string): v is SkillVariant =>
  v === "compact" || v === "standard" || v === "full";
