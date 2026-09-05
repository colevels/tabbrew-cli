import { describe, expect, test } from "bun:test"
import { findBlock, inject, MARKER_END, MARKER_START, remove } from "./block"

const v1 = `${MARKER_START}\nv1\n${MARKER_END}`
const v2 = `${MARKER_START}\nv2\n${MARKER_END}`

describe("agent docs block", () => {
  test("inject into empty content", () => {
    expect(inject("", v1)).toBe(`${v1}\n`)
  })

  test("inject appends below existing content", () => {
    expect(inject("# Mine\n\ntext\n", v1)).toBe(`# Mine\n\ntext\n\n${v1}\n`)
  })

  test("inject replaces an existing block and keeps what surrounds it", () => {
    expect(inject(`before\n\n${v1}\n\nafter\n`, v2)).toBe(`before\n\n${v2}\n\nafter\n`)
  })

  test("inject is idempotent", () => {
    const once = inject("# Mine\n", v1)
    expect(inject(once, v1)).toBe(once)
  })

  test("findBlock is null without markers", () => {
    expect(findBlock("plain\n")).toBeNull()
  })

  test("refuses two start markers", () => {
    expect(() => inject(`${v1}\n${v1}`, v2)).toThrow(/more than one/)
  })

  test("refuses a start marker with no end", () => {
    expect(() => inject(`${MARKER_START}\nbroken\n`, v2)).toThrow(/without/)
  })

  test("remove is null when there is no block", () => {
    expect(remove("plain\n")).toBeNull()
  })

  test("remove strips the block and the blank lines around it", () => {
    expect(remove(`before\n\n${v1}\n\nafter\n`)).toBe("before\n\nafter\n")
    expect(remove(`${v1}\n`)).toBe("")
    expect(remove(`# Mine\n\n${v1}\n`)).toBe("# Mine\n")
  })
})
