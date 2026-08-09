// Turning stored control voltages into notes.
//
// This is the single place where sequencer state becomes a pitch and a
// velocity. The scheduler and the MIDI exporter both call `noteAt`, which is
// what makes "the exported file matches what you heard" a structural guarantee
// rather than a thing to keep re-checking.

import { effectiveHead, effectiveSequence } from './chain.ts'
import { snapMidiToScale } from './scales.ts'
import type { PatternState, SeqId } from './state.ts'

/** Volts per octave — the modular standard the Labyrinth's CV follows. */
const SEMITONES_PER_VOLT = 12

/** Quietest audible velocity, so a lightly-weighted trigger still sounds. */
const MIN_VELOCITY = 20
const MAX_VELOCITY = 127

export interface NoteEvent {
  midi: number
  velocity: number
}

/**
 * Stored voltage to a semitone offset from the root.
 *
 * 1V/oct, so the hardware's ±5V spans ±5 octaves — the manual's "a range of 10
 * octaves". CV RANGE attenuates before the quantizer, and because the spread is
 * bipolar the root stays put as the range opens: "the sequencer voltages will
 * spread in a bipolar fashion with the root note you tuned in the center".
 */
export function cvToSemitones(cv: number, cvRange: number): number {
  // The `+ 0` normalises -0 (which a negative CV times a closed range produces)
  // to +0. Negative zero survives JSON round-trips and fails Object.is against
  // 0, which would make snapshot comparisons lie.
  return cv * clamp01(cvRange) * SEMITONES_PER_VOLT + 0
}

export function cvToMidi(
  cv: number,
  cvRange: number,
  rootMidi: number,
  quantMode: number,
): number {
  return snapMidiToScale(rootMidi + cvToSemitones(cv, cvRange), quantMode, rootMidi % 12)
}

/**
 * EG TRIG MIX as a pair of gains — the hardware's velocity/accent mechanism.
 *
 * "Fully counterclockwise only SEQ1's triggers will trigger the envelope
 * generators, and fully clockwise only SEQ2's. In between you will get a nice
 * rhythmic balance, with the triggers from one sequencer at a higher velocity
 * than the other (unless set to 12 o'clock, where each trigger stream will be
 * at the same velocity)."
 *
 * Both reach full at the midpoint and one falls to silence at each extreme.
 */
export function egTrigGains(egTrigMix: number): { gain1: number; gain2: number } {
  const mix = clamp01(egTrigMix)
  return {
    gain1: Math.min(1, (1 - mix) * 2),
    gain2: Math.min(1, mix * 2),
  }
}

export function gainToVelocity(gain: number): number {
  return Math.round(MIN_VELOCITY + clamp01(gain) * (MAX_VELOCITY - MIN_VELOCITY))
}

/**
 * The note a sequencer sounds at its own step `absStep`, or null for silence —
 * either the bit is off, or EG TRIG MIX has starved this sequencer of triggers
 * entirely, in which case its CV still moves but nothing fires the envelopes.
 */
export function noteAt(
  pattern: PatternState,
  seqId: SeqId,
  absStep: number,
): NoteEvent | null {
  const view = effectiveSequence(pattern, seqId)
  const head = effectiveHead(view, absStep)
  if (!view.bits[head]) return null

  const { gain1, gain2 } = egTrigGains(pattern.egTrigMix)
  const gain = seqId === 1 ? gain1 : gain2
  if (gain <= 0) return null

  const seq = seqId === 1 ? pattern.seq1 : pattern.seq2
  return {
    midi: cvToMidi(view.cvs[head], seq.cvRange, pattern.rootMidi, pattern.quantMode),
    velocity: gainToVelocity(gain),
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
