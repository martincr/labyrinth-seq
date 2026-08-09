// Copied verbatim from the mc-202 project (src/lib/notes.ts).
// Kept in sync by hand; if you change it here, consider porting back.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// "C4" -> 60 (MIDI convention: C4 = 60, matching the 2oh2's C0 = midi 0 scheme
// shifted to the common octave numbering used by midi-writer-js)
export function noteToMidi(note: string): number {
  // The octave may be negative: midiToNote renders MIDI 0-11 as C-1..B-1, and
  // without the sign those names failed to parse and silently became C4.
  const m = note.match(/^([A-G])(#|b)?(-?\d+)$/)
  if (!m) return 60
  let semitone = NOTE_NAMES.indexOf(m[1])
  if (m[2] === '#') semitone += 1
  if (m[2] === 'b') semitone -= 1
  // An accidental may push the semitone to -1 (Cb) or 12 (B#), which belongs in
  // the neighbouring octave. Wrapping it into 0..11 without moving the octave —
  // as this used to — put Cb4 an octave above B3 instead of on it.
  const midi = (parseInt(m[3], 10) + 1) * 12 + semitone
  return Math.max(0, Math.min(127, midi))
}

export function midiToNote(midi: number): string {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)))
  return `${NOTE_NAMES[clamped % 12]}${Math.floor(clamped / 12) - 1}`
}

export function noteToFrequency(note: string): number {
  return 440 * Math.pow(2, (noteToMidi(note) - 69) / 12)
}

export function isBlackKey(note: string): boolean {
  return note.includes('#')
}
