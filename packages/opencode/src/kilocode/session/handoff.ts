// kilocode_change - new file
import path from "path"
import type { SessionID } from "@/session/schema"

/**
 * Building blocks for the /handoff command: capture the current session into a
 * durable handoff document plus a kickoff prompt, then start a fresh session on
 * them. The pure pieces (prompt template, output parsing, kickoff text, file
 * path) live here so they stay unit-testable; the orchestration that touches
 * session/LLM services lives in SessionPrompt.handleHandoff.
 */
export namespace KiloHandoff {
  /** Handoff files live under `<project>/.kilo/handoff/`. */
  export const DIR = path.join(".kilo", "handoff")

  const DOCUMENT_TAG = "---DOCUMENT---"
  const PROMPT_TAG = "---PROMPT---"

  /**
   * Instruction appended to the conversation so the model emits both artifacts
   * in one call, in a machine-parseable delimited format.
   */
  export const PROMPT = `You are handing off the current working session to a brand-new session that has none of this context.

Produce two artifacts.

1. A handoff document (Markdown) with everything the new session needs to continue effectively:
   - ## Goal — what the user is trying to accomplish
   - ## Progress — what has been done so far
   - ## Remaining — what is left to do
   - ## Key files — relevant file paths with brief notes on each
   - ## Decisions & gotchas — conventions, constraints, and pitfalls discovered

2. A kickoff prompt — the first message the new session should act on. One short paragraph stating the immediate next step. Do not restate the whole document.

Reply in EXACTLY this format, with no other text:
${DOCUMENT_TAG}
<handoff document markdown>
${PROMPT_TAG}
<kickoff prompt>`

  export type Handoff = {
    /** The Markdown handoff document. */
    document: string
    /** The short kickoff prompt for the new session. */
    prompt: string
  }

  /**
   * Parse the model reply into its two artifacts. Returns undefined when the
   * reply does not follow the delimited format or either section is empty, so
   * the caller can surface a retryable error instead of a broken handoff.
   */
  export function parse(text: string): Handoff | undefined {
    const doc = text.indexOf(DOCUMENT_TAG)
    const prm = text.indexOf(PROMPT_TAG)
    if (doc < 0 || prm < 0 || prm <= doc) return undefined
    const document = text.slice(doc + DOCUMENT_TAG.length, prm).trim()
    const prompt = text.slice(prm + PROMPT_TAG.length).trim()
    if (!document || !prompt) return undefined
    return { document, prompt }
  }

  /**
   * The first user message injected into the new session: the kickoff prompt
   * followed by the full handoff document inline, so the fresh session has the
   * context immediately without a file read. The file path is noted as the
   * durable record.
   */
  export function kickoff(input: { file: string; document: string; prompt: string }): string {
    return [
      input.prompt,
      "",
      "## Handoff document",
      "",
      `Saved to \`${input.file}\`. Full contents:`,
      "",
      input.document,
    ].join("\n")
  }

  /** Absolute path for a session's handoff document. */
  export function file(directory: string, sessionID: SessionID, now: number): string {
    const stamp = new Date(now).toISOString().replaceAll(":", "-").replaceAll(".", "-")
    const safe = sessionID.replace(/[^a-zA-Z0-9_-]/g, "_")
    return path.join(directory, DIR, `${stamp}-${safe}.md`)
  }
}
