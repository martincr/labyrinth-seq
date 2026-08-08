// CHAIN SEQ.
//
// Unchained, each sequencer reads its own eight bits. Chained, both read one
// shared sequence of up to sixteen — but they keep their own play heads, clock
// divisions and CV RANGE attenuators. The manual is explicit that this is not
// simply "one longer sequencer": "you actually have two 16-step sequencers that
// share steps but can be clocked, scaled, and offset completely independently."
//
// So the shared thing is the *data*; everything about how a sequencer reads it
// stays per-sequencer. That is why this returns a view rather than mutating
// state into a chained shape.

import type { PatternState, SeqId } from './state.ts'

export interface EffectiveSequence {
  bits: boolean[]
  cvs: number[]
  length: number
  /** Added to the play head, so SEQ2 can trail SEQ1 for round-robin effects. */
  headOffset: number
}

export function effectiveSequence(pattern: PatternState, seqId: SeqId): EffectiveSequence {
  const seq = seqId === 1 ? pattern.seq1 : pattern.seq2

  if (!pattern.chained) {
    return {
      bits: seq.bits,
      cvs: seq.cvs,
      length: Math.max(1, seq.length),
      headOffset: 0,
    }
  }

  // Only the active portion of each sequencer joins the chain — a LENGTH of 5
  // on SEQ1 contributes five steps, not five plus three stale ones.
  const len1 = Math.max(1, pattern.seq1.length)
  const len2 = Math.max(1, pattern.seq2.length)

  return {
    bits: [...pattern.seq1.bits.slice(0, len1), ...pattern.seq2.bits.slice(0, len2)],
    cvs: [...pattern.seq1.cvs.slice(0, len1), ...pattern.seq2.cvs.slice(0, len2)],
    length: len1 + len2,
    // "BIT SHIFT (2) in chained mode moves SEQ2 PLAY head once, changing offset
    // between SEQ1 and SEQ2 PLAY heads."
    headOffset: seqId === 2 ? pattern.chainOffset : 0,
  }
}

/** Where this sequencer's play head sits in the (possibly shared) sequence. */
export function effectiveHead(seq: EffectiveSequence, absStep: number): number {
  const len = Math.max(1, seq.length)
  return (((absStep + seq.headOffset) % len) + len) % len
}
