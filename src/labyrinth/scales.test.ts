import { describe, expect, it } from 'vitest'
import { QUANT_MODES, isUnquantized, scalePitchClasses, snapMidiToScale } from './scales.ts'

describe('QUANT_MODES', () => {
  it('has the manual\'s 16 modes in order', () => {
    expect(QUANT_MODES).toHaveLength(16)
    expect(QUANT_MODES[0].name).toBe('Unquantized')
  })

  // The manual numbers modes 1-16 as (SEQ, BIT) pairs. Three presets pin the
  // numbering down, so these are regression tests against a real document:
  //   p.16 "quantizer will be set to the scale of bit number 3 in SEQ1,
  //         which indicates a major scale"
  //   p.48 "A SIMPLE START" — "Set quantize mode to #13 Minor 7th Scale"
  //   p.48 "LOST IN THE LABYRINTH" — panel shows "QTZ SCALE #12 (MAJ13)"
  it('matches the mode numbers quoted in the manual presets', () => {
    expect(QUANT_MODES[2].name).toBe('Major') // mode 3
    expect(QUANT_MODES[11].name).toBe('Major 13th') // mode 12
    expect(QUANT_MODES[12].name).toBe('Minor 7th') // mode 13
  })

  it('spells the chord-scales as the manual does', () => {
    expect(QUANT_MODES[9].intervals).toEqual([0, 5, 7, 10]) // 7 Sus 4: 1 4 5 b7
    expect(QUANT_MODES[10].intervals).toEqual([0, 4, 7, 11]) // Major 7th: 1 3 5 7
    expect(QUANT_MODES[11].intervals).toEqual([0, 2, 4, 7, 9, 11]) // Major 13th: 1 3 5 6 7 9
    expect(QUANT_MODES[12].intervals).toEqual([0, 3, 7, 10]) // Minor 7th: 1 b3 5 b7
    expect(QUANT_MODES[13].intervals).toEqual([0, 2, 3, 5, 7, 10]) // Minor 11th: 1 b3 4 5 b7 9
    expect(QUANT_MODES[15].intervals).toEqual([0, 3, 6, 9]) // Quads: stacked minor 3rds
  })

  it('keeps every interval inside one octave and sorted', () => {
    for (const mode of QUANT_MODES) {
      expect(mode.intervals).toEqual([...mode.intervals].sort((a, b) => a - b))
      expect(new Set(mode.intervals).size).toBe(mode.intervals.length)
      for (const i of mode.intervals) expect(i).toBeGreaterThanOrEqual(0)
      for (const i of mode.intervals) expect(i).toBeLessThan(12)
    }
  })

  it('treats only mode 0 as unquantized', () => {
    expect(isUnquantized(0)).toBe(true)
    for (let m = 1; m < 16; m++) expect(isUnquantized(m)).toBe(false)
  })
})

describe('scalePitchClasses', () => {
  it('transposes by the root', () => {
    // Major on C
    expect([...scalePitchClasses(2, 0)].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11])
    // Major on D (root pc 2) — same shape, shifted
    expect([...scalePitchClasses(2, 2)].sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 7, 9, 11])
  })
})

describe('snapMidiToScale', () => {
  const MAJOR = 2
  const CHROMATIC = 1

  it('leaves in-scale notes alone', () => {
    for (const midi of [60, 62, 64, 65, 67, 69, 71, 72]) {
      expect(snapMidiToScale(midi, MAJOR, 0)).toBe(midi)
    }
  })

  it('snaps out-of-scale notes to the nearest scale tone', () => {
    expect(snapMidiToScale(61, MAJOR, 0)).toBe(60) // C#4 -> C4
    expect(snapMidiToScale(66, MAJOR, 0)).toBe(65) // F#4 -> F4
    expect(snapMidiToScale(70, MAJOR, 0)).toBe(69) // A#4 -> A4
  })

  it('is the identity for chromatic', () => {
    for (let midi = 0; midi <= 127; midi++) {
      expect(snapMidiToScale(midi, CHROMATIC, 0)).toBe(midi)
    }
  })

  it('resolves ties downward', () => {
    // Major 7th on C is [0,4,7,11]; 62 (D4) sits exactly between 60 and 64.
    expect(snapMidiToScale(62, 10, 0)).toBe(60)
  })

  it('snaps a continuous target rather than rounding first', () => {
    // Major 7th on C: [60, 64]. A target of 62.4 is nearer 64, but rounding to
    // 62 first would tie and resolve down to 60. Quantizing the continuous
    // value is what the analog quantizer actually does.
    expect(snapMidiToScale(62.4, 10, 0)).toBe(64)
    expect(snapMidiToScale(61.6, 10, 0)).toBe(60)
  })

  it('respects the root', () => {
    // F#4 (66) is in D major but not in C major. Same input, different root,
    // different answer — on C it ties between F and G and resolves down.
    expect(snapMidiToScale(66, MAJOR, 2)).toBe(66)
    expect(snapMidiToScale(66, MAJOR, 0)).toBe(65)
  })

  it('resolves every out-of-key note in a 7-note scale downward', () => {
    // Major has gaps of 2,2,1,2,2,2,1 semitones, so each of the five
    // out-of-key classes sits exactly one semitone from a tone either side.
    // There is no nearest note, only a tie — and ties go down.
    for (const midi of [61, 63, 66, 68, 70]) {
      expect(snapMidiToScale(midi, MAJOR, 0)).toBe(midi - 1)
    }
  })

  it('stays inside the MIDI range at the extremes', () => {
    for (const mode of QUANT_MODES.slice(1).keys()) {
      const m = mode + 1
      for (const target of [-40, 0, 1, 126, 127, 200]) {
        const out = snapMidiToScale(target, m, 0)
        expect(out).toBeGreaterThanOrEqual(0)
        expect(out).toBeLessThanOrEqual(127)
        expect(Number.isInteger(out)).toBe(true)
      }
    }
  })

  it('never moves a note further than half an octave', () => {
    for (const mode of QUANT_MODES.slice(1).keys()) {
      const m = mode + 1
      for (let midi = 12; midi <= 115; midi++) {
        expect(Math.abs(snapMidiToScale(midi, m, 0) - midi)).toBeLessThanOrEqual(6)
      }
    }
  })
})
