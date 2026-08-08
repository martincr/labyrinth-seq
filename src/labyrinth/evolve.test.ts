import { describe, expect, it } from 'vitest'
import { bitFlipP, cvChanceP, evolveSeq, evolveTo, seqStepAt, stepOnce } from './evolve.ts'
import { type SeqState, makePattern, makeSeq } from './state.ts'

/** A sequencer with a known starting pattern: bits 1, 3, 5, 6 on — the
 *  rhythm the manual builds in "Exploring Labyrinth". */
function seeded(overrides: Partial<SeqState> = {}): SeqState {
  return makeSeq({
    bits: [true, false, true, false, true, true, false, false],
    cvs: [1, 0, -2, 0, 3.5, -4.25, 0, 0],
    ...overrides,
  })
}

describe('corrupt probability curves', () => {
  it('locks the pattern when fully counter-clockwise', () => {
    expect(cvChanceP(0)).toBe(0)
    expect(bitFlipP(0)).toBe(0)
  })

  it('never flips bits below 12 o\'clock', () => {
    for (let c = 0; c <= 0.5; c += 0.05) expect(bitFlipP(c)).toBe(0)
  })

  it('reaches the manual\'s quoted figures', () => {
    // "the probability is around 25% when CORRUPT is set near 12 o'clock"
    expect(cvChanceP(0.5)).toBeCloseTo(0.25, 5)
    // "increases from 25% to about 50%" and "near 50% when fully clockwise"
    expect(cvChanceP(1)).toBeCloseTo(0.5, 5)
    expect(bitFlipP(1)).toBeCloseTo(0.5, 5)
  })

  it('rises monotonically', () => {
    for (let c = 0; c < 1; c += 0.05) {
      expect(cvChanceP(c + 0.05)).toBeGreaterThanOrEqual(cvChanceP(c))
      expect(bitFlipP(c + 0.05)).toBeGreaterThanOrEqual(bitFlipP(c))
    }
  })
})

describe('stepOnce', () => {
  it('does not mutate its input', () => {
    const seq = seeded({ corrupt: 1 })
    const before = JSON.stringify(seq)
    stepOnce(seq, 42, 1, 0)
    expect(JSON.stringify(seq)).toBe(before)
  })

  it('leaves everything alone when corrupt is 0', () => {
    const seq = seeded({ corrupt: 0 })
    for (let i = 0; i < 200; i++) {
      expect(stepOnce(seq, 42, 1, i)).toEqual(seq)
    }
  })

  it('only ever touches the write head position', () => {
    const seq = seeded({ corrupt: 1, writeOffset: 3 })
    for (let absStep = 0; absStep < 40; absStep++) {
      const next = stepOnce(seq, 7, 1, absStep)
      const w = (absStep + 3) % seq.length
      for (let i = 0; i < seq.bits.length; i++) {
        if (i === w) continue
        expect(next.bits[i]).toBe(seq.bits[i])
        expect(next.cvs[i]).toBe(seq.cvs[i])
      }
    }
  })

  it('keeps generated voltages inside the hardware\'s -5V..+5V', () => {
    const seq = seeded({ corrupt: 1 })
    let s = seq
    for (let i = 0; i < 500; i++) {
      s = stepOnce(s, 99, 1, i)
      for (const cv of s.cvs) {
        expect(cv).toBeGreaterThanOrEqual(-5)
        expect(cv).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('rhythm preservation below 12 o\'clock', () => {
  it('drifts voltages but never the bit pattern', () => {
    const seq = seeded({ corrupt: 0.5 })
    let s = seq
    let cvChanged = false
    for (let i = 0; i < 400; i++) {
      s = stepOnce(s, 3, 1, i)
      expect(s.bits).toEqual(seq.bits) // rhythm intact
      if (s.cvs.some((cv, idx) => cv !== seq.cvs[idx])) cvChanged = true
    }
    expect(cvChanged).toBe(true) // ...but the melody moved
  })

  it('does flip bits above 12 o\'clock', () => {
    const seq = seeded({ corrupt: 1 })
    let s = seq
    let flipped = false
    for (let i = 0; i < 100; i++) {
      s = stepOnce(s, 3, 1, i)
      if (s.bits.some((b, idx) => b !== seq.bits[idx])) flipped = true
    }
    expect(flipped).toBe(true)
  })
})

describe('determinism', () => {
  it('gives the same result for the same seed and step count', () => {
    const p = makePattern({ seq1: seeded({ corrupt: 0.8 }), seq2: seeded({ corrupt: 0.9 }), seed: 12345 })
    expect(evolveTo(p, 137)).toEqual(evolveTo(p, 137))
  })

  it('matches an incremental fold — the property the scrub bar relies on', () => {
    const seq = seeded({ corrupt: 0.8 })
    let folded = seq
    for (let i = 0; i <= 60; i++) folded = stepOnce(folded, 555, 1, i)
    expect(evolveSeq(seq, 555, 1, 60)).toEqual(folded)
  })

  it('diverges on a different seed', () => {
    const seq = seeded({ corrupt: 0.9 })
    expect(evolveSeq(seq, 1, 1, 80)).not.toEqual(evolveSeq(seq, 2, 1, 80))
  })

  it('decorrelates the two sequencers under one seed', () => {
    const seq = seeded({ corrupt: 0.9 })
    expect(evolveSeq(seq, 1, 1, 80)).not.toEqual(evolveSeq(seq, 1, 2, 80))
  })

  it('does not mutate the pattern it is given', () => {
    const p = makePattern({ seq1: seeded({ corrupt: 1 }), seq2: seeded({ corrupt: 1 }) })
    const before = JSON.stringify(p)
    evolveTo(p, 250)
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('clock division', () => {
  it('advances a divided sequencer proportionally more slowly', () => {
    expect(seqStepAt(makeSeq({ clockDiv: 1 }), 8)).toBe(8)
    expect(seqStepAt(makeSeq({ clockDiv: 2 }), 8)).toBe(4)
    expect(seqStepAt(makeSeq({ clockDiv: 4 }), 9)).toBe(2)
  })

  it('evolves a half-speed sequencer to the half-speed state', () => {
    const fast = seeded({ corrupt: 0.9, clockDiv: 1 })
    const slow = seeded({ corrupt: 0.9, clockDiv: 2 })
    const p = makePattern({ seq1: fast, seq2: slow, seed: 8 })
    const out = evolveTo(p, 40)
    // seq2 sees half as many write-head visits, so it equals the same
    // sequencer evolved to step 20 rather than 40.
    expect(out.seq2).toEqual(evolveSeq(slow, 8, 2, 20))
    expect(out.seq1).toEqual(evolveSeq(fast, 8, 1, 40))
  })
})

describe('statistical behaviour', () => {
  // The manual gives percentages rather than a formula, so these guard the
  // shape of the curve against drift rather than asserting exact rates.
  function flipRate(corrupt: number): number {
    const seq = makeSeq({ bits: Array(8).fill(true), cvs: Array(8).fill(0), corrupt })
    let flips = 0
    let s = seq
    const N = 4000
    for (let i = 0; i < N; i++) {
      const next = stepOnce(s, 4242, 1, i)
      const w = i % 8
      if (next.bits[w] !== s.bits[w]) flips++
      s = next
    }
    return flips / N
  }

  it('flips about half the time at full corrupt', () => {
    expect(flipRate(1)).toBeGreaterThan(0.42)
    expect(flipRate(1)).toBeLessThan(0.58)
  })

  it('flips about a quarter of the time at three-quarters corrupt', () => {
    expect(flipRate(0.75)).toBeGreaterThan(0.19)
    expect(flipRate(0.75)).toBeLessThan(0.31)
  })

  it('never flips at half corrupt', () => {
    expect(flipRate(0.5)).toBe(0)
  })
})
