// The Labyrinth's internal quantizer: 16 modes, addressed on the hardware as
// (SEQ, BIT) pairs — SEQ1 bits 1-8 are modes 1-8, SEQ2 bits 1-8 are modes 9-16.
// Mode 1 is "Unquantized", so there are 15 actual scales, matching the manual's
// "bank of 15 different scales" and the 16 mode LEDs.
//
// Indices here are 0-based (mode 1 in the manual is index 0), but the numbering
// is otherwise the manual's, pinned by three of its own presets:
//   p.16  "bit number 3 in SEQ1, which indicates a major scale"
//   p.48  "Set quantize mode to #13 Minor 7th Scale"
//   p.48  panel art reading "QTZ SCALE #12 (MAJ13)"
//
// Structure follows mc-202's src/lib/scales.ts (interval table + nearest-tone
// snap, ties resolving downward), but works on MIDI numbers rather than note
// name strings: this sequencer quantizes a control voltage, not a typed note.

export interface QuantMode {
  name: string
  /** Semitone offsets from the root. Empty for Unquantized. */
  intervals: number[]
  /** Set when the manual names a scale it does not spell out — see below. */
  assumed?: string
}

export const QUANT_MODES: QuantMode[] = [
  { name: 'Unquantized', intervals: [] },
  { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  // The manual just says "Pentatonic"; paired against Hirajoshi later in the
  // list, the major pentatonic is the reading that makes the bank non-redundant.
  { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  {
    name: 'Diminished 6th',
    // GUESS. "Diminished 6th" is not a standard name. Read here as the Barry
    // Harris sixth-diminished scale (major scale plus b6), which is what the
    // "6th" qualifier normally signals; the alternative reading is the
    // whole-half octatonic [0,2,3,5,6,8,9,11]. Worth checking against hardware.
    intervals: [0, 2, 4, 5, 7, 8, 9, 11],
    assumed: 'Read as the Barry Harris 6th-diminished (major + b6), not the whole-half octatonic.',
  },
  { name: 'Whole Tone', intervals: [0, 2, 4, 6, 8, 10] },
  { name: 'Hirajoshi Pentatonic', intervals: [0, 2, 3, 7, 8] },
  { name: '7 Sus 4', intervals: [0, 5, 7, 10] }, // 1 4 5 b7
  { name: 'Major 7th', intervals: [0, 4, 7, 11] }, // 1 3 5 7
  { name: 'Major 13th', intervals: [0, 2, 4, 7, 9, 11] }, // 1 3 5 6 7 9
  { name: 'Minor 7th', intervals: [0, 3, 7, 10] }, // 1 b3 5 b7
  { name: 'Minor 11th', intervals: [0, 2, 3, 5, 7, 10] }, // 1 b3 4 5 b7 9
  {
    name: 'Hang Drum Tuning',
    // GUESS. Modelled on the classic PANArt "integral"/D-minor hang layout
    // (D A Bb C D E F A), i.e. natural minor with the 4th omitted.
    intervals: [0, 2, 3, 7, 8, 10],
    assumed: 'Modelled on the D-minor PANArt hang layout (natural minor without the 4th).',
  },
  { name: 'Quads Tuning', intervals: [0, 3, 6, 9] }, // stacked minor 3rds
]

export function isUnquantized(mode: number): boolean {
  return mode === 0
}

export function scalePitchClasses(mode: number, rootPc: number): Set<number> {
  const intervals = QUANT_MODES[mode]?.intervals ?? []
  return new Set(intervals.map((i) => (((i + rootPc) % 12) + 12) % 12))
}

function clampMidi(n: number): number {
  return Math.max(0, Math.min(127, n))
}

/**
 * Nearest in-scale MIDI note to `target`, which may be fractional.
 *
 * The target stays continuous deliberately. Rounding to a semitone first and
 * snapping afterwards gives a different — and wrong — answer whenever the
 * rounded note lands on a tie that the true value was not near: with Major 7th
 * on C, 62.4 is nearer 64, but rounding to 62 ties between 60 and 64 and
 * resolves down to 60. An analog quantizer compares voltages, so we do too.
 *
 * Ties resolve to the lower note, matching mc-202's snapToKey.
 */
export function snapMidiToScale(target: number, mode: number, rootPc: number): number {
  if (isUnquantized(mode)) return clampMidi(Math.round(target))

  const classes = [...scalePitchClasses(mode, rootPc)].sort((a, b) => a - b)
  if (classes.length === 0) return clampMidi(Math.round(target))

  const wanted = clampMidi(target)
  const baseOctave = Math.floor(wanted / 12)

  let best = -1
  let bestDistance = Infinity
  // One octave either side always contains a candidate, since every mode has at
  // least one pitch class. Scanning ascending with a strict `<` keeps the lower
  // note on a tie.
  for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave++) {
    for (const pc of classes) {
      const candidate = octave * 12 + pc
      if (candidate < 0 || candidate > 127) continue
      const distance = Math.abs(candidate - wanted)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }
  }

  return best >= 0 ? best : clampMidi(Math.round(wanted))
}
