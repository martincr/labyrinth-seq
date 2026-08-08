// CORRUPT — the Labyrinth's generative engine, as a pure function.
//
// On the hardware this is a stateful random walk: as the write head passes each
// bit, dice are rolled against the CORRUPT setting, and whatever the dice say is
// gone forever. There is one memory slot and no way back.
//
// Here every roll is instead a hash of its coordinates — (seed, sequencer,
// step) — using mc-202's coordinate-addressed PRNG. Nothing is drawn from a
// stream, so the state after N steps is a pure function of (initial, seed, N).
// That single property is what makes the rest of the app possible:
//
//   * the scrub bar can rewind, because past states are recomputable
//   * a snapshot can be taken of a state that already drifted past
//   * an exported file provably matches what was auditioned, because the
//     exporter and the scheduler ask the same function the same question
//
// Knobs (corrupt, length, clockDiv...) live in SeqState and are read on every
// recomputation, so changing one re-derives the whole history under the new
// setting. To reproduce the hardware's "turn CORRUPT down to lock the pattern"
// gesture, the store rebases — it captures the current evolved state as a new
// anchor and restarts the step count from there.

import { randomAt } from '../lib/prng.ts'
import { type PatternState, type SeqId, type SeqState, cloneSeq, writeHead } from './state.ts'

// Distinct salts keep the three rolls at one coordinate independent of each
// other; without them the CV re-roll and the bit flip would fire together.
const SALT_CV_ROLL = 0x9e3779b9
const SALT_CV_VALUE = 0x7f4a7c15
const SALT_FLIP_ROLL = 0x165667b1
const SALT_FLIP_VALUE = 0x27d4eb2f

/**
 * Probability that an already-on bit's stored voltage is re-rolled as the write
 * head passes. Matches the manual: "the probability is around 25% when CORRUPT
 * is set near 12 o'clock", rising to "about 50%" fully clockwise.
 */
export function cvChanceP(corrupt: number): number {
  const c = clamp01(corrupt)
  return c <= 0.5 ? c * 0.5 : 0.25 + (c - 0.5) * 0.5
}

/**
 * Probability that a bit flips state. Zero below 12 o'clock — this is what
 * preserves the rhythm while the melody drifts — then "from a 0% chance of bit
 * flip below 12 o'clock to near 50% when CORRUPT is fully clockwise".
 */
export function bitFlipP(corrupt: number): number {
  const c = clamp01(corrupt)
  return c <= 0.5 ? 0 : (c - 0.5) * 1.0
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** A fresh stored voltage, uniform over the hardware's −5V..+5V. */
function newCv(seed: number, seqId: SeqId, absStep: number, salt: number): number {
  return randomAt(seed, seqId, absStep, salt) * 10 - 5
}

/**
 * One clock step for one sequencer: roll the dice at the write head.
 *
 * The voltage re-roll is evaluated against the bit's state *before* any flip,
 * because on the hardware the two are separate mechanisms — drift affects bits
 * that are already on, while a flip to on always writes a brand new voltage
 * ("Press BIT FLIP to flip bit 1 off, and then press it again... the voltage
 * value at bit 1 is different from what it was before").
 */
export function stepOnce(seq: SeqState, seed: number, seqId: SeqId, absStep: number): SeqState {
  const flipP = bitFlipP(seq.corrupt)
  const driftP = cvChanceP(seq.corrupt)
  if (flipP === 0 && driftP === 0) return seq

  const w = writeHead(seq, absStep)
  const next = cloneSeq(seq)

  if (next.bits[w] && randomAt(seed, seqId, absStep, SALT_CV_ROLL) < driftP) {
    next.cvs[w] = newCv(seed, seqId, absStep, SALT_CV_VALUE)
  }

  if (flipP > 0 && randomAt(seed, seqId, absStep, SALT_FLIP_ROLL) < flipP) {
    next.bits[w] = !next.bits[w]
    if (next.bits[w]) next.cvs[w] = newCv(seed, seqId, absStep, SALT_FLIP_VALUE)
  }

  return next
}

/** How many of its own steps a sequencer has taken by master step `masterStep`. */
export function seqStepAt(seq: SeqState, masterStep: number): number {
  return Math.floor(Math.max(0, masterStep) / Math.max(1, seq.clockDiv))
}

/**
 * Fold `stepOnce` from the anchor up to and including `throughStep`.
 *
 * Inclusive because the write head rolls as it *arrives* at a position, so by
 * the time step N sounds its roll has already been applied — turning CORRUPT up
 * changes the note you are hearing, not the one after it.
 */
export function evolveSeq(
  seq: SeqState,
  seed: number,
  seqId: SeqId,
  throughStep: number,
): SeqState {
  let s = seq
  for (let i = 0; i <= throughStep; i++) s = stepOnce(s, seed, seqId, i)
  return s
}

/**
 * The pattern as it stands while `masterStep` is sounding.
 *
 * `masterStep` counts the shared clock; each sequencer consumes it at its own
 * division, so a divided sequencer has simply seen fewer write-head visits.
 * Negative steps mean nothing has happened yet.
 */
export function evolveTo(initial: PatternState, masterStep: number): PatternState {
  if (masterStep < 0) return initial
  return {
    ...initial,
    seq1: evolveSeq(initial.seq1, initial.seed, 1, seqStepAt(initial.seq1, masterStep)),
    seq2: evolveSeq(initial.seq2, initial.seed, 2, seqStepAt(initial.seq2, masterStep)),
  }
}
