// The one place the clock grid is defined.
//
// 96 ticks per quarter is inherited from mc-202's SMF writer: unlike the 128 of
// midi-writer-js it divides by 3, so triplet divisions land exactly on the grid
// rather than a tick either side. A sequencer step is a sixteenth — 24 ticks —
// and each sequencer's clockDiv multiplies that.

export const PPQ = 96
export const TICKS_PER_STEP = PPQ / 4
export const STEPS_PER_BAR = 16

/** Seconds per master step (a sixteenth note) at `bpm`. */
export function stepDuration(bpm: number): number {
  return 60 / Math.max(1, bpm) / 4
}

/** Seconds per clock tick at `bpm`. */
export function tickDuration(bpm: number): number {
  return 60 / Math.max(1, bpm) / PPQ
}
