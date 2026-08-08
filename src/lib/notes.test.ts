// Copied verbatim from the mc-202 project (src/lib/notes.test.ts).
// Kept in sync by hand; if you change it here, consider porting back.

import { describe, expect, test } from 'vitest'
import { isBlackKey, midiToNote, noteToFrequency, noteToMidi } from './notes'

describe('midi <-> note round trip', () => {
  test('every MIDI note survives the round trip, including negative octaves', () => {
    // MIDI 0-11 render as C-1..B-1; the parser used to reject the minus sign and
    // silently return C4 for all of them.
    for (let midi = 0; midi <= 127; midi++) {
      expect(noteToMidi(midiToNote(midi))).toBe(midi)
    }
  })

  test('known anchors', () => {
    expect(noteToMidi('C4')).toBe(60)
    expect(noteToMidi('A4')).toBe(69)
    expect(noteToMidi('C-1')).toBe(0)
    expect(noteToMidi('G9')).toBe(127)
    expect(midiToNote(60)).toBe('C4')
    expect(midiToNote(0)).toBe('C-1')
  })

  test('accidentals parse', () => {
    expect(noteToMidi('C#4')).toBe(61)
    expect(noteToMidi('Db4')).toBe(61)
  })

  test('accidentals that cross the octave boundary land in the right octave', () => {
    // Cb and B# are the two names whose accidental moves them into the
    // neighbouring octave. Wrapping the pitch class without moving the octave
    // put each of them a full octave out.
    expect(noteToMidi('Cb4')).toBe(noteToMidi('B3'))
    expect(noteToMidi('B#4')).toBe(noteToMidi('C5'))
    expect(noteToMidi('Cb4')).toBe(59)
    expect(noteToMidi('B#4')).toBe(72)
    // and the ones that don't cross are unaffected
    expect(noteToMidi('Fb4')).toBe(noteToMidi('E4'))
    expect(noteToMidi('E#4')).toBe(noteToMidi('F4'))
  })

  test('clamps rather than running off the end of the MIDI range', () => {
    expect(noteToMidi('Cb-1')).toBe(0)
    expect(noteToMidi('C11')).toBe(127)
  })

  test('unparseable input falls back to middle C rather than NaN', () => {
    expect(noteToMidi('')).toBe(60)
    expect(noteToMidi('H4')).toBe(60)
    expect(noteToMidi('c4')).toBe(60) // lowercase is not accepted
  })

  test('midiToNote clamps out-of-range input', () => {
    expect(midiToNote(-5)).toBe('C-1')
    expect(midiToNote(999)).toBe('G9')
  })
})

describe('noteToFrequency', () => {
  test('A4 is 440Hz and octaves double', () => {
    expect(noteToFrequency('A4')).toBeCloseTo(440, 6)
    expect(noteToFrequency('A5')).toBeCloseTo(880, 6)
    expect(noteToFrequency('A3')).toBeCloseTo(220, 6)
  })
})

describe('isBlackKey', () => {
  test('identifies the five accidentals per octave', () => {
    const black = ['C#4', 'D#4', 'F#4', 'G#4', 'A#4']
    const white = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']
    for (const n of black) expect(isBlackKey(n)).toBe(true)
    for (const n of white) expect(isBlackKey(n)).toBe(false)
  })
})
