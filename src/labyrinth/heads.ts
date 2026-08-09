// Where the play and write heads sit, for display.
//
// Pure, and separate from the component that draws it, because chaining makes
// this less obvious than it looks: the play head walks one shared sequence
// spanning both rows, so for part of every cycle a row has no play head on it
// at all. The write head is unaffected — CORRUPT stays a per-sequencer process
// over that sequencer's own eight bits, whatever the play heads are doing.

import { effectiveHead, effectiveSequence } from './chain.ts'
import { type PatternState, type SeqId, writeHead } from './state.ts'

export interface HeadInfo {
  /** Index into this sequencer's own eight bits, or null when the play head is
   *  currently over the other sequencer's half of a chained sequence. */
  play: number | null
  write: number
  /** This sequencer's own step count, after its clock division. */
  seqStep: number
}

export function headInfo(pattern: PatternState, seqId: SeqId, relStep: number): HeadInfo {
  const seq = seqId === 1 ? pattern.seq1 : pattern.seq2
  const seqStep = Math.floor(Math.max(0, relStep) / Math.max(1, seq.clockDiv))
  const view = effectiveSequence(pattern, seqId)
  const head = effectiveHead(view, seqStep)

  let play: number | null = head
  if (pattern.chained) {
    const len1 = Math.max(1, pattern.seq1.length)
    const inFirstHalf = head < len1
    if (seqId === 1) play = inFirstHalf ? head : null
    else play = inFirstHalf ? null : head - len1
  }

  return { play, write: writeHead(seq, seqStep), seqStep }
}
