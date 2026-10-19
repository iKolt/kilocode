// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { KiloHandoff } from "@/kilocode/session/handoff"
import { SessionID } from "@/session/schema"

describe("kilocode.session.handoff.parse", () => {
  test("parses a well-formed reply", () => {
    const text = [
      "---DOCUMENT---",
      "## Goal",
      "Build the thing.",
      "",
      "---PROMPT---",
      "Continue with the next step.",
    ].join("\n")
    const parsed = KiloHandoff.parse(text)
    expect(parsed).toBeDefined()
    expect(parsed!.document).toContain("## Goal")
    expect(parsed!.prompt).toBe("Continue with the next step.")
  })

  test("returns undefined without the document tag", () => {
    expect(KiloHandoff.parse("just some text\n---PROMPT---\ndo it")).toBeUndefined()
  })

  test("returns undefined without the prompt tag", () => {
    expect(KiloHandoff.parse("---DOCUMENT---\nsome doc")).toBeUndefined()
  })

  test("returns undefined when the tags are reversed", () => {
    const text = "---PROMPT---\ndo it\n---DOCUMENT---\nthe doc"
    expect(KiloHandoff.parse(text)).toBeUndefined()
  })

  test("returns undefined when a section is empty", () => {
    expect(KiloHandoff.parse("---DOCUMENT---\n\n---PROMPT---\n\n")).toBeUndefined()
    expect(KiloHandoff.parse("---DOCUMENT---\ndoc\n---PROMPT---\n")).toBeUndefined()
  })

  test("trims surrounding whitespace in each section", () => {
    const parsed = KiloHandoff.parse("---DOCUMENT---\n\n  doc body  \n\n---PROMPT---\n\n  go  \n")
    expect(parsed).toEqual({ document: "doc body", prompt: "go" })
  })
})

describe("kilocode.session.handoff.prompt", () => {
  test("carries the kickoff prompt and points at the file", () => {
    const text = KiloHandoff.prompt({ file: ".kilo/handoff/x.md", prompt: "THE PROMPT" })
    expect(text).toContain("THE PROMPT")
    expect(text).toContain(".kilo/handoff/x.md")
  })
})

describe("kilocode.session.handoff.response", () => {
  test("includes the saved path and the copyable prompt block", () => {
    const text = KiloHandoff.response({ file: ".kilo/handoff/x.md", prompt: "THE PROMPT" })
    expect(text).toContain("Handoff ready")
    expect(text).toContain(".kilo/handoff/x.md")
    expect(text).toContain("THE PROMPT")
  })
})

describe("kilocode.session.handoff.file", () => {
  test("places the file under .kilo/handoff with the session id", () => {
    const sid = SessionID.make("ses_handoff_test")
    const file = KiloHandoff.file("/proj", sid, Date.UTC(2026, 0, 2, 3, 4, 5))
    expect(file).toContain("handoff")
    expect(file).toContain("ses_handoff_test")
    expect(file.endsWith(".md")).toBe(true)
  })

  test("produces a filesystem-safe name", () => {
    const file = KiloHandoff.file("/proj", SessionID.make("ses_x"), Date.now())
    const name = file.split(/[\\/]/).pop()!
    expect(name).toMatch(/^[a-zA-Z0-9._-]+\.md$/)
  })
})
