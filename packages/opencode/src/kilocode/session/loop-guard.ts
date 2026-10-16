// kilocode_change - new file
import type { SessionID } from "@/session/schema"

/**
 * Circuit breaker for reasoning loops. A model (especially a long-context
 * reasoning model) can get stuck emitting the same block of text over and over
 * inside a single reasoning chain, burning tokens without ever producing an
 * answer. This guard watches the accumulated reasoning text, detects a tail
 * that is the same block repeated several times in a row, and trips so the
 * processor can interrupt the stream and tell the model to answer normally.
 *
 * The detector is a pure function over the accumulated text; throttling and
 * the per-session interruption budget live in the small stateful helpers so
 * the hot streaming path stays cheap and the turn cannot ping-pong forever.
 */
export namespace KiloLoopGuard {
  /** Shortest repeated block treated as a loop (chars). */
  export const MIN_UNIT = 24
  /** Consecutive repeats of the block required to trip. */
  export const MIN_REPEATS = 3
  /** Minimum total size of the repeated region (unit * repeats, chars). */
  export const MIN_SPAN = 180
  /** Only the tail of the reasoning text is scanned (chars). */
  export const WINDOW = 4000
  /** Minimum newly accumulated chars between scans of the same block. */
  export const INTERVAL = 300
  /** Consecutive interruptions allowed per session before giving up. */
  export const MAX_INTERRUPTS = 3

  export type Repetition = {
    /** The repeated block (smallest period found at the tail). */
    unit: string
    /** How many times it repeats consecutively at the tail. */
    repeats: number
  }

  /**
   * Return the repetition when the tail of `text` is the same block repeated
   * at least MIN_REPEATS times spanning at least MIN_SPAN chars. Scans unit
   * lengths ascending so the smallest (fundamental) period wins. Exact-match:
   * near-duplicates are intentionally out of scope for a first cut.
   */
  export function detect(text: string): Repetition | undefined {
    const tail = text.length > WINDOW ? text.slice(text.length - WINDOW) : text
    const n = tail.length
    if (n < MIN_SPAN) return undefined
    for (let len = MIN_UNIT; len * MIN_REPEATS <= n; len++) {
      const unit = tail.slice(n - len)
      let repeats = 1
      while ((repeats + 1) * len <= n && tail.slice(n - (repeats + 1) * len, n - repeats * len) === unit) {
        repeats++
      }
      if (repeats >= MIN_REPEATS && repeats * len >= MIN_SPAN) return { unit, repeats }
    }
    return undefined
  }

  /** Per-stream detection state (one per processor / model step). */
  export type State = {
    /** reasoning block id -> accumulated length at the last scan. */
    checked: Record<string, number>
    /** set once a loop trips this stream; stops further scans. */
    detected: boolean
  }

  export function state(): State {
    return { checked: {}, detected: false }
  }

  /**
   * Throttled scan of one reasoning block. Returns the repetition exactly once
   * (when the loop first trips); afterwards `state.detected` stays true and no
   * further hits are reported for this stream.
   */
  export function inspect(state: State, id: string, text: string): Repetition | undefined {
    if (state.detected) return undefined
    const last = state.checked[id] ?? 0
    if (text.length - last < INTERVAL) return undefined
    state.checked[id] = text.length
    const hit = detect(text)
    if (hit) state.detected = true
    return hit
  }

  // Consecutive interruptions per session, so a model that keeps looping after
  // being told to stop cannot ping-pong the turn forever. Cleared as soon as
  // the model produces real answer text (a sign it recovered). Bounded like
  // the malformed-tool guard map.
  const interrupts = new Map<string, number>()

  /** Record a loop interruption; returns the consecutive count for this session. */
  export function noteInterrupt(sessionID: SessionID): number {
    const count = (interrupts.get(sessionID) ?? 0) + 1
    if (interrupts.size >= 64 && !interrupts.has(sessionID)) {
      const oldest = interrupts.keys().next()
      if (!oldest.done) interrupts.delete(oldest.value)
    }
    interrupts.set(sessionID, count)
    return count
  }

  /** Reset the consecutive-interruption budget once the model emits answer text. */
  export function noteText(sessionID: SessionID) {
    interrupts.delete(sessionID)
  }
}
