import { describe, expect, it } from 'vitest'
import { RHYTHM_PPQ } from '../midi/smf.ts'
import { PPQ, STEPS_PER_BAR, TICKS_PER_STEP, stepDuration, tickDuration } from './timing.ts'

describe('the clock grid', () => {
  it('agrees with the SMF writer\'s PPQ', () => {
    // smf.ts is copied from mc-202 and hard-codes its own PPQ. If the two ever
    // disagree, every exported tick is wrong by a constant factor — which
    // sounds fine in isolation and is badly wrong against a DAW's grid.
    expect(PPQ).toBe(RHYTHM_PPQ)
  })

  it('divides evenly by three, so triplets land on the grid', () => {
    expect(PPQ % 3).toBe(0)
    expect((PPQ / 4) % 1).toBe(0)
  })

  it('puts a step on the sixteenth', () => {
    expect(TICKS_PER_STEP * 4).toBe(PPQ)
    expect(TICKS_PER_STEP * STEPS_PER_BAR).toBe(PPQ * 4)
  })
})

describe('durations', () => {
  it('gives four steps to the beat', () => {
    expect(stepDuration(120) * 4).toBeCloseTo(0.5, 10)
  })

  it('keeps ticks and steps consistent', () => {
    for (const bpm of [60, 90, 120, 174]) {
      expect(tickDuration(bpm) * TICKS_PER_STEP).toBeCloseTo(stepDuration(bpm), 10)
    }
  })

  it('does not divide by zero on a nonsense tempo', () => {
    expect(Number.isFinite(stepDuration(0))).toBe(true)
    expect(Number.isFinite(tickDuration(-5))).toBe(true)
  })
})
