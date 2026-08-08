// Copied verbatim from the mc-202 project (src/midi/smf.ts).
// Kept in sync by hand; if you change it here, consider porting back.

// Minimal Standard MIDI File writer for the rhythm engine.
//
// midi-writer-js is fixed at 128 ticks per quarter, and 128 is not divisible
// by 3, so no tick value there can express an eighth-note triplet exactly. The
// engine's grid is 96 ticks per quarter and every pulse resolution divides it
// evenly, so writing at PPQ 96 maps engine ticks 1:1 and triplets land dead on
// the grid in a DAW editor.
//
// Raising midi-writer-js's PPQ would mean mutating a shared module constant
// that the pattern exporter also reads; owning ~130 lines of format is the
// smaller risk. The pattern export stays on the library, where 128 is exact.

export const RHYTHM_PPQ = 96

export interface SmfNote {
  tick: number
  durationTicks: number
  /** 0-127 */
  note: number
  /** 0-127 */
  velocity: number
  /** 1-16 */
  channel: number
}

export interface SmfTrack {
  name: string
  notes: SmfNote[]
}

function variableLength(value: number): number[] {
  let v = Math.max(0, Math.trunc(value))
  const bytes = [v & 0x7f]
  v >>>= 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>>= 7
  }
  return bytes
}

function stringBytes(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63
    out.push(code < 128 ? code : 63) // SMF text is 7-bit; '?' for anything else
  }
  return out
}

function chunk(id: string, body: number[]): number[] {
  const length = body.length
  return [
    ...stringBytes(id),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ]
}

interface TimedEvent {
  tick: number
  /** note-off sorts before note-on at the same tick, so a repeated note
   *  retriggers instead of being cut by its own predecessor's release. */
  order: number
  data: number[]
}

function trackChunk(track: SmfTrack, meta: number[]): number[] {
  const events: TimedEvent[] = []

  for (const note of track.notes) {
    const channel = Math.max(0, Math.min(15, Math.trunc(note.channel) - 1))
    const pitch = Math.max(0, Math.min(127, Math.round(note.note)))
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity)))
    const end = note.tick + Math.max(1, Math.round(note.durationTicks))
    events.push({ tick: note.tick, order: 1, data: [0x90 | channel, pitch, velocity] })
    events.push({ tick: end, order: 0, data: [0x80 | channel, pitch, 0x40] })
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order)

  const body: number[] = [...meta]
  let last = 0
  for (const event of events) {
    body.push(...variableLength(event.tick - last), ...event.data)
    last = event.tick
  }
  body.push(...variableLength(0), 0xff, 0x2f, 0x00) // end of track
  return chunk('MTrk', body)
}

function trackNameMeta(name: string): number[] {
  const text = stringBytes(name)
  return [0x00, 0xff, 0x03, ...variableLength(text.length), ...text]
}

function tempoMeta(bpm: number): number[] {
  const usPerQuarter = Math.round(60000000 / bpm)
  return [
    0x00,
    0xff,
    0x51,
    0x03,
    (usPerQuarter >>> 16) & 0xff,
    (usPerQuarter >>> 8) & 0xff,
    usPerQuarter & 0xff,
  ]
}

function timeSignatureMeta(): number[] {
  // 4/4, 24 MIDI clocks per metronome click, 8 32nds per quarter.
  return [0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]
}

/**
 * Type 1 (multi-track) SMF. Tempo and time signature live on track 0 alone,
 * which is where importers expect them — midi-writer-js repeats the tempo on
 * every track, and some hardware is fussy about that.
 */
export function buildSmf(tracks: SmfTrack[], bpm: number): Uint8Array {
  const header = chunk('MThd', [
    0x00,
    0x01, // format 1
    (tracks.length >>> 8) & 0xff,
    tracks.length & 0xff,
    (RHYTHM_PPQ >>> 8) & 0xff,
    RHYTHM_PPQ & 0xff,
  ])

  const bytes: number[] = [...header]
  tracks.forEach((track, i) => {
    const meta =
      i === 0
        ? [...trackNameMeta(track.name), ...tempoMeta(bpm), ...timeSignatureMeta()]
        : trackNameMeta(track.name)
    bytes.push(...trackChunk(track, meta))
  })

  return new Uint8Array(bytes)
}
