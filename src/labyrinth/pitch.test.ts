import { describe, expect, it } from 'vitest'
import { cvToMidi, cvToSemitones, egTrigGains, gainToVelocity, noteAt } from './pitch.ts'
import { makePattern, makeSeq } from './state.ts'

describe('cvToSemitones', () => {
  it('follows 1V/oct at full range', () => {
    expect(cvToSemitones(1, 1)).toBe(12)
    expect(cvToSemitones(-1, 1)).toBe(-12)
  })

  it('spans the manual\'s ten octaves across -5V..+5V', () => {
    expect(cvToSemitones(5, 1) - cvToSemitones(-5, 1)).toBe(120)
  })

  it('collapses to the root when CV RANGE is closed', () => {
    for (const cv of [-5, -2.5, 0, 3.1, 5]) expect(cvToSemitones(cv, 0)).toBe(0)
  })

  it('attenuates proportionally', () => {
    expect(cvToSemitones(5, 0.5)).toBe(30) // half of five octaves
  })
})

describe('cvToMidi', () => {
  const CHROMATIC = 1
  const UNQUANTIZED = 0

  it('sits on the root with the range closed', () => {
    expect(cvToMidi(4.2, 0, 48, CHROMATIC)).toBe(48)
  })

  it('spreads bipolar around the root', () => {
    expect(cvToMidi(1, 1, 60, CHROMATIC)).toBe(72)
    expect(cvToMidi(-1, 1, 60, CHROMATIC)).toBe(48)
  })

  it('stays in the MIDI range at the extremes', () => {
    expect(cvToMidi(-5, 1, 48, CHROMATIC)).toBe(0) // would be -12
    expect(cvToMidi(5, 1, 100, CHROMATIC)).toBe(127) // would be 160
  })

  it('rounds to the nearest semitone when unquantized', () => {
    // 0.51V at full range is 6.12 semitones above the root
    expect(cvToMidi(0.51, 1, 48, UNQUANTIZED)).toBe(54)
  })

  it('snaps into the selected scale', () => {
    // Major on C, so the tones are 60 62 64 65 67 69 71 72.
    // 0.05V at full range is 0.6 semitones -> 60.6, still nearest C (60).
    expect(cvToMidi(0.05, 1, 60, 2)).toBe(60)
    // 0.3V is 3.6 semitones -> 63.6, nearest major tone is E (64).
    expect(cvToMidi(0.3, 1, 60, 2)).toBe(64)
  })

  it('quantizes the continuous voltage, not a rounded semitone', () => {
    // 0.1V is 1.2 semitones above C: 61.2. Rounding first would give C# (61),
    // which ties between C and D and would resolve down to 60. Comparing the
    // real value instead puts it nearer D (62) — which is what an analog
    // quantizer comparing voltages does.
    expect(cvToMidi(0.1, 1, 60, 2)).toBe(62)
  })

  it('takes the scale root from the tuned root note', () => {
    // Major on D (rootMidi 62). Two semitones up is E, which is in D major.
    expect(cvToMidi(2 / 12, 1, 62, 2)).toBe(64)
  })
})

describe('egTrigGains', () => {
  it('gives SEQ1 alone when fully counter-clockwise', () => {
    expect(egTrigGains(0)).toEqual({ gain1: 1, gain2: 0 })
  })

  it('gives SEQ2 alone when fully clockwise', () => {
    expect(egTrigGains(1)).toEqual({ gain1: 0, gain2: 1 })
  })

  it('gives both the same velocity at 12 o\'clock', () => {
    expect(egTrigGains(0.5)).toEqual({ gain1: 1, gain2: 1 })
  })

  it('puts one sequencer above the other in between', () => {
    const { gain1, gain2 } = egTrigGains(0.75)
    expect(gain2).toBeGreaterThan(gain1)
    expect(gain1).toBeGreaterThan(0)
  })
})

describe('gainToVelocity', () => {
  it('maps a full trigger to maximum velocity', () => {
    expect(gainToVelocity(1)).toBe(127)
  })

  it('keeps a weak trigger audible', () => {
    expect(gainToVelocity(0)).toBeGreaterThan(0)
    expect(gainToVelocity(0)).toBeLessThan(30)
  })
})

describe('noteAt', () => {
  const pattern = makePattern({
    seq1: makeSeq({
      bits: [true, false, true, false, false, false, false, false],
      cvs: [0, 0, 1, 0, 0, 0, 0, 0],
      cvRange: 1,
      length: 4,
    }),
    quantMode: 1, // chromatic, so the arithmetic is visible
    rootMidi: 60,
  })

  it('is silent on an off bit', () => {
    expect(noteAt(pattern, 1, 1)).toBeNull()
    expect(noteAt(pattern, 1, 3)).toBeNull()
  })

  it('sounds the stored voltage on an on bit', () => {
    expect(noteAt(pattern, 1, 0)).toEqual({ midi: 60, velocity: 127 })
    expect(noteAt(pattern, 1, 2)).toEqual({ midi: 72, velocity: 127 })
  })

  it('wraps at the sequence length', () => {
    expect(noteAt(pattern, 1, 4)).toEqual(noteAt(pattern, 1, 0))
    expect(noteAt(pattern, 1, 6)).toEqual(noteAt(pattern, 1, 2))
  })

  it('goes silent when EG TRIG MIX starves the sequencer', () => {
    // Fully clockwise: only SEQ2's triggers reach the envelopes.
    const starved = { ...pattern, egTrigMix: 1 }
    expect(noteAt(starved, 1, 0)).toBeNull()
  })

  it('lowers velocity rather than pitch as the mix moves away', () => {
    const leaning = { ...pattern, egTrigMix: 0.75 }
    const note = noteAt(leaning, 1, 0)
    expect(note?.midi).toBe(60)
    expect(note?.velocity).toBeLessThan(127)
  })
})

describe('noteAt when chained', () => {
  const chained = makePattern({
    chained: true,
    seq1: makeSeq({
      bits: [true, false, false, false, false, false, false, false],
      cvs: [0, 0, 0, 0, 0, 0, 0, 0],
      length: 2,
      cvRange: 1,
    }),
    seq2: makeSeq({
      bits: [false, true, false, false, false, false, false, false],
      cvs: [0, 1, 0, 0, 0, 0, 0, 0],
      length: 2,
      cvRange: 1,
    }),
    quantMode: 1,
    rootMidi: 60,
  })

  it('reads one shared sequence of both sequencers\' active steps', () => {
    // Chain is [seq1 bit0, seq1 bit1, seq2 bit0, seq2 bit1] = [on, off, off, on]
    expect(noteAt(chained, 1, 0)).not.toBeNull()
    expect(noteAt(chained, 1, 1)).toBeNull()
    expect(noteAt(chained, 1, 2)).toBeNull()
    expect(noteAt(chained, 1, 3)).not.toBeNull()
  })

  it('offsets SEQ2\'s play head for round robin', () => {
    const offset = { ...chained, chainOffset: 1 }
    // SEQ2 now reads one step ahead: its step 0 lands on chain index 1.
    expect(noteAt(offset, 2, 0)).toBeNull()
    expect(noteAt(offset, 2, 2)).not.toBeNull()
  })

  it('keeps each sequencer\'s own CV RANGE over the shared data', () => {
    // Same chain index 3 (stored CV of 1V), but SEQ2 attenuated to half.
    const halved = { ...chained, seq2: { ...chained.seq2, cvRange: 0.5 } }
    expect(noteAt(halved, 1, 3)?.midi).toBe(72) // full range: +1 octave
    expect(noteAt(halved, 2, 3)?.midi).toBe(66) // half range: +6 semitones
  })
})
