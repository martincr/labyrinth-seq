import { describe, expect, it } from 'vitest'
import { headInfo } from './heads.ts'
import { makePattern, makeSeq } from './state.ts'

describe('headInfo unchained', () => {
  const p = makePattern({ seq1: makeSeq({ length: 4 }), seq2: makeSeq({ length: 8 }) })

  it('walks the play head around the sequence length', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => headInfo(p, 1, s).play)).toEqual([0, 1, 2, 3, 0, 1])
  })

  it('keeps the write head with the play head by default', () => {
    for (let s = 0; s < 12; s++) {
      const h = headInfo(p, 1, s)
      expect(h.write).toBe(h.play)
    }
  })

  it('separates the heads once the write head is offset', () => {
    const offset = makePattern({ seq1: makeSeq({ length: 4, writeOffset: 2 }) })
    expect(headInfo(offset, 1, 0)).toMatchObject({ play: 0, write: 2 })
    expect(headInfo(offset, 1, 3)).toMatchObject({ play: 3, write: 1 })
  })

  it('slows the heads by the clock division', () => {
    const slow = makePattern({ seq1: makeSeq({ length: 4, clockDiv: 2 }) })
    expect([0, 1, 2, 3, 4].map((s) => headInfo(slow, 1, s).play)).toEqual([0, 0, 1, 1, 2])
  })

  it('never reports a negative step before the transport starts', () => {
    expect(headInfo(p, 1, -5).seqStep).toBe(0)
  })
})

describe('headInfo chained', () => {
  // A four-step chain: SEQ1 contributes two steps, then SEQ2 contributes two.
  const chained = makePattern({
    chained: true,
    seq1: makeSeq({ length: 2 }),
    seq2: makeSeq({ length: 2 }),
  })

  it('hands the play head between the rows', () => {
    expect([0, 1, 2, 3, 4].map((s) => headInfo(chained, 1, s).play)).toEqual([0, 1, null, null, 0])
  })

  it('puts SEQ2\'s play head on its own row only in the second half', () => {
    expect([0, 1, 2, 3].map((s) => headInfo(chained, 2, s).play)).toEqual([null, null, 0, 1])
  })

  it('offsets SEQ2\'s head within the chain', () => {
    const offset = { ...chained, chainOffset: 2 }
    // SEQ2 now starts two steps into the chain, i.e. on its own first bit.
    expect(headInfo(offset, 2, 0).play).toBe(0)
    expect(headInfo(offset, 2, 2).play).toBeNull()
  })

  it('keeps the write head on the sequencer\'s own bits regardless', () => {
    // Play head may be off this row, but CORRUPT still has somewhere to act.
    for (let s = 0; s < 8; s++) {
      const h = headInfo(chained, 1, s)
      expect(h.write).toBeGreaterThanOrEqual(0)
      expect(h.write).toBeLessThan(2)
    }
  })
})
