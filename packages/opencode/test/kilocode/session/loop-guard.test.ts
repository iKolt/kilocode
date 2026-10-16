// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { KiloLoopGuard } from "@/kilocode/session/loop-guard"
import { SessionID } from "@/session/schema"

/** Build a tail that is `unit` repeated `n` times, optionally prefixed. */
function looped(unit: string, n: number, prefix = "some earlier reasoning. ") {
  return prefix + unit.repeat(n)
}

describe("kilocode.session.loopGuard.detect", () => {
  test("detects a clearly repeated block", () => {
    const unit = "Let me reconsider the approach step by step. "
    const hit = KiloLoopGuard.detect(looped(unit, 6))
    expect(hit).toBeDefined()
    expect(hit!.repeats).toBeGreaterThanOrEqual(KiloLoopGuard.MIN_REPEATS)
  })

  test("reports the fundamental (smallest) period", () => {
    const unit = "reasoning step alpha beta gamma delta" // 37 chars, aperiodic
    const hit = KiloLoopGuard.detect(looped(unit, 5)) // 185 chars >= MIN_SPAN
    expect(hit).toBeDefined()
    expect(hit!.unit).toBe(unit)
    expect(hit!.repeats).toBe(5)
  })

  test("does not trigger on ordinary prose", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. ".repeat(2) +
      "Now for something completely different: a list of distinct sentences that never repeat verbatim."
    expect(KiloLoopGuard.detect(text)).toBeUndefined()
  })

  test("does not trigger below the minimum span", () => {
    const unit = "short block here. " // 18 chars
    // 3 repeats = 54 chars < MIN_SPAN, and unit < MIN_UNIT anyway
    expect(KiloLoopGuard.detect(looped(unit, 3))).toBeUndefined()
  })

  test("does not trigger on text shorter than the minimum span", () => {
    expect(KiloLoopGuard.detect("tiny")).toBeUndefined()
    expect(KiloLoopGuard.detect("")).toBeUndefined()
  })

  test("requires the block to repeat at the very tail", () => {
    const unit = "x".repeat(80)
    // repetition is not at the end, so the tail is not periodic
    const text = unit.repeat(4) + "a distinct trailing sentence that breaks the period."
    expect(KiloLoopGuard.detect(text)).toBeUndefined()
  })

  test("only scans the trailing window", () => {
    const unit = "window check block. ".repeat(4) // 80 chars
    const filler = "unique filler sentence number one. ".repeat(200) // pushes the loop out of the window
    const hit = KiloLoopGuard.detect(looped(unit, 4, filler))
    // the loop is still at the tail, so it is found regardless of the long filler
    expect(hit).toBeDefined()
  })
})

describe("kilocode.session.loopGuard.inspect", () => {
  test("throttles until enough new text accumulates", () => {
    const state = KiloLoopGuard.state()
    const unit = "throttle test block. ".repeat(4) // 84 chars
    const text = looped(unit, 5)
    // first call scans (last = 0)
    expect(KiloLoopGuard.inspect(state, "r1", text)).toBeDefined()
  })

  test("latches after the first hit and stops rescanning", () => {
    const state = KiloLoopGuard.state()
    const unit = "latch test block. ".repeat(4)
    const text = looped(unit, 5)
    expect(KiloLoopGuard.inspect(state, "r1", text)).toBeDefined()
    // a second call reports nothing because the stream already tripped
    expect(KiloLoopGuard.inspect(state, "r1", text + unit)).toBeUndefined()
    expect(state.detected).toBe(true)
  })

  test("does not scan again before the interval elapses", () => {
    const state = KiloLoopGuard.state()
    const unit = "interval block. ".repeat(4)
    const base = looped(unit, 5)
    expect(KiloLoopGuard.inspect(state, "r1", base)).toBeDefined()
  })
})

describe("kilocode.session.loopGuard budget", () => {
  test("counts consecutive interruptions per session", () => {
    const key = SessionID.make("ses_budget_a")
    KiloLoopGuard.noteText(key)
    expect(KiloLoopGuard.noteInterrupt(key)).toBe(1)
    expect(KiloLoopGuard.noteInterrupt(key)).toBe(2)
    expect(KiloLoopGuard.noteInterrupt(key)).toBe(3)
  })

  test("real answer text resets the budget", () => {
    const key = SessionID.make("ses_budget_b")
    KiloLoopGuard.noteText(key)
    KiloLoopGuard.noteInterrupt(key)
    KiloLoopGuard.noteInterrupt(key)
    KiloLoopGuard.noteText(key)
    expect(KiloLoopGuard.noteInterrupt(key)).toBe(1)
  })

  test("sessions are tracked independently", () => {
    const a = SessionID.make("ses_budget_c")
    const b = SessionID.make("ses_budget_d")
    KiloLoopGuard.noteText(a)
    KiloLoopGuard.noteText(b)
    KiloLoopGuard.noteInterrupt(a)
    KiloLoopGuard.noteInterrupt(a)
    expect(KiloLoopGuard.noteInterrupt(b)).toBe(1)
  })
})
