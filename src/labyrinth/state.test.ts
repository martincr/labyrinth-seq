import { describe, expect, it } from 'vitest'
import { bitShift, loopLengthSteps, makePattern, makeSeq, playHead, writeHead } from './state.ts'

describe('playHead', () => {
  it('wraps at the sequence length', () => {
    const seq = makeSeq({ length: 5 })
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => playHead(seq, s))).toEqual([0, 1, 2, 3, 4, 0, 1])
  })
})

describe('writeHead', () => {
  it('travels with the play head by default', () => {
    const seq = makeSeq({ length: 8 })
    for (let s = 0; s < 20; s++) expect(writeHead(seq, s)).toBe(playHead(seq, s))
  })

  it('leads the play head when offset via BIT SHIFT + ADVANCE', () => {
    const seq = makeSeq({ length: 8, writeOffset: 3 })
    expect(writeHead(seq, 0)).toBe(3)
    expect(writeHead(seq, 6)).toBe(1) // wraps
  })
})

describe('bitShift', () => {
  it('rotates bits one place to the right, wrapping', () => {
    const seq = makeSeq({
      bits: [true, false, false, false, false, false, false, true],
      cvs: [1, 0, 0, 0, 0, 0, 0, 8],
    })
    const out = bitShift(seq)
    expect(out.bits).toEqual([true, true, false, false, false, false, false, false])
    expect(out.cvs.slice(0, 2)).toEqual([8, 1])
  })

  it('carries each bit\'s stored voltage with it', () => {
    const seq = makeSeq({
      bits: [true, true, false, false, false, false, false, false],
      cvs: [1.5, -2.5, 0, 0, 0, 0, 0, 0],
    })
    expect(bitShift(seq).cvs.slice(0, 3)).toEqual([0, 1.5, -2.5])
  })

  it('leaves bits beyond the current LENGTH untouched', () => {
    // "If the sequence LENGTH is anything shorter than 8 bits, only the bits in
    // the current LENGTH will be affected by BIT SHIFT."
    const seq = makeSeq({
      bits: [true, false, false, true, true, true, true, true],
      cvs: [1, 2, 3, 9, 9, 9, 9, 9],
      length: 3,
    })
    const out = bitShift(seq)
    expect(out.bits.slice(0, 3)).toEqual([false, true, false])
    expect(out.bits.slice(3)).toEqual([true, true, true, true, true])
    expect(out.cvs.slice(3)).toEqual([9, 9, 9, 9, 9])
  })

  it('returns to the original after LENGTH shifts — the BIT SHIFT + RESET rotation', () => {
    for (const length of [1, 3, 5, 8]) {
      const seq = makeSeq({
        bits: [true, false, true, true, false, false, true, false],
        cvs: [1, 2, 3, 4, 5, 6, 7, 8],
        length,
      })
      let out = seq
      for (let i = 0; i < length; i++) out = bitShift(out)
      expect(out).toEqual(seq)
    }
  })

  it('does not mutate its input', () => {
    const seq = makeSeq({ bits: [true, false, false, false, false, false, false, false] })
    const before = JSON.stringify(seq)
    bitShift(seq)
    expect(JSON.stringify(seq)).toBe(before)
  })
})

describe('loopLengthSteps', () => {
  it('is the sequence length when both agree', () => {
    expect(loopLengthSteps(makePattern())).toBe(8)
  })

  it('is the LCM under polymeter', () => {
    const p = makePattern({ seq1: makeSeq({ length: 5 }), seq2: makeSeq({ length: 8 }) })
    expect(loopLengthSteps(p)).toBe(40)
  })

  it('handles coprime lengths', () => {
    const p = makePattern({ seq1: makeSeq({ length: 3 }), seq2: makeSeq({ length: 7 }) })
    expect(loopLengthSteps(p)).toBe(21)
  })

  it('handles a shared factor without over-counting', () => {
    const p = makePattern({ seq1: makeSeq({ length: 4 }), seq2: makeSeq({ length: 6 }) })
    expect(loopLengthSteps(p)).toBe(12)
  })

  it('accounts for clock division as well as length', () => {
    // A length-4 sequencer at half speed repeats every 8 master steps.
    const p = makePattern({
      seq1: makeSeq({ length: 4, clockDiv: 2 }),
      seq2: makeSeq({ length: 8, clockDiv: 1 }),
    })
    expect(loopLengthSteps(p)).toBe(8)
  })

  it('really is the point where both play heads return to the start', () => {
    const p = makePattern({
      seq1: makeSeq({ length: 5, clockDiv: 1 }),
      seq2: makeSeq({ length: 3, clockDiv: 2 }),
    })
    const loop = loopLengthSteps(p)
    expect(playHead(p.seq1, loop)).toBe(0)
    expect(playHead(p.seq2, Math.floor(loop / p.seq2.clockDiv))).toBe(0)
    // ...and not before.
    let returnedEarly = false
    for (let s = 1; s < loop; s++) {
      const a = playHead(p.seq1, s)
      const b = playHead(p.seq2, Math.floor(s / p.seq2.clockDiv))
      if (a === 0 && b === 0 && s % p.seq2.clockDiv === 0) returnedEarly = true
    }
    expect(returnedEarly).toBe(false)
  })
})
