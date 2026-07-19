// Display-width measurement is the one piece of pure logic in the CLI where a
// wrong answer is invisible in code review and obvious on screen (a shifted
// table column). `Bun.stringWidth` alone gets several scripts wrong — see the
// table in table.ts — so these cases pin the corrections down.
//
// Run with `bun test`.

import { describe, expect, test } from "bun:test";
import { padEnd, truncate, width } from "./table";

// The exact title from the bug report: two U+0E32 (า) that Bun measures as 0,
// which pushed this row's URL / WIN / FLAGS two columns right of every other.
const THAI_TITLE = "เมื่อพี่สาวแฟน ชอบมาคุยกับผม... - YouTube";

describe("width", () => {
  test("Thai spacing vowels count as one column each", () => {
    expect(width(THAI_TITLE)).toBe(35);
    expect(width("กาำ")).toBe(3);
  });

  test("Thai nonspacing marks still count as zero", () => {
    expect(width("สวัสดี")).toBe(4);
  });

  test("Arabic harakat count as zero", () => {
    expect(width("كِتَاب")).toBe(4);
  });

  test("Indic spacing matras count as one, virama and above-marks as zero", () => {
    expect(width("कि")).toBe(2);
    expect(width("नमस्ते")).toBe(4);
  });

  test("ASCII is measured verbatim", () => {
    expect(width("hello")).toBe(5);
    expect(width("")).toBe(0);
  });

  test("East-Asian wide characters count as two", () => {
    expect(width("日本語")).toBe(6);
    expect(width("한국어")).toBe(6);
  });

  test("emoji clusters count as two, however they are composed", () => {
    expect(width("👩‍💻")).toBe(2); // ZWJ sequence
    expect(width("🇹🇭")).toBe(2); // regional indicator pair
    expect(width("👍🏽")).toBe(2); // skin-tone modifier
    expect(width("🍃🌊💖")).toBe(6);
  });

  test("precomposed and decomposed forms agree", () => {
    expect(width("café".normalize("NFC"))).toBe(4);
    expect(width("café".normalize("NFD"))).toBe(4);
  });

  test("ANSI escapes occupy no columns", () => {
    expect(width("\x1b[31mred\x1b[0m")).toBe(3);
    expect(width("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe(4);
  });
});

describe("padEnd", () => {
  test("pads to a display width, not a code-unit length", () => {
    expect(width(padEnd(THAI_TITLE, 44))).toBe(44);
    expect(width(padEnd("日本語", 10))).toBe(10);
    expect(width(padEnd("👩‍💻", 6))).toBe(6);
  });

  test("never truncates when the cell is already too wide", () => {
    expect(padEnd("日本語", 2)).toBe("日本語");
  });
});

describe("truncate", () => {
  test("leaves strings that fit untouched", () => {
    expect(truncate(THAI_TITLE, 44)).toBe(THAI_TITLE);
  });

  test("respects the display-width budget", () => {
    expect(width(truncate("日本語日本語日本語", 10))).toBeLessThanOrEqual(10);
    expect(width(truncate(THAI_TITLE, 20))).toBeLessThanOrEqual(20);
  });

  test("never splits a grapheme cluster", () => {
    const out = truncate("👩‍💻👩‍💻👩‍💻", 4);
    expect(out).not.toInclude("�");
    expect(out).toBe("👩‍💻…");
  });
});
