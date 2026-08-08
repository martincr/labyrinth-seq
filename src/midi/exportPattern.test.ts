import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { evolveTo } from '../labyrinth/evolve.ts'
import { noteAt } from '../labyrinth/pitch.ts'
import { makePattern, makeSeq } from '../labyrinth/state.ts'
import {
  STEPS_PER_BAR,
  TICKS_PER_STEP,
  collectNotes,
  defaultExportSteps,
  exportFilename,
  exportPattern,
} from './exportPattern.ts'

/** Four evenly spaced notes on SEQ1, nothing on SEQ2. */
const simple = makePattern({
  seq1: makeSeq({
    bits: [true, false, true, false, true, false, true, false],
    cvs: [0, 0, 1, 0, -1, 0, 0.5, 0],
    cvRange: 1,
  }),
  quantMode: 1, // chromatic, so pitches are plain arithmetic
  rootMidi: 60,
})

describe('defaultExportSteps', () => {
  it('captures exactly one loop when the pattern is locked', () => {
    const p = makePattern({ seq1: makeSeq({ length: 5 }), seq2: makeSeq({ length: 8 }) })
    expect(defaultExportSteps(p)).toBe(40)
  })

  it('captures several bars when the pattern is still mutating', () => {
    const p = makePattern({ seq1: makeSeq({ length: 5, corrupt: 0.8 }) })
    expect(defaultExportSteps(p)).toBe(4 * STEPS_PER_BAR)
  })
})

describe('collectNotes', () => {
  it('places notes on the sixteenth-note grid', () => {
    const notes = collectNotes(simple, 8, 0.5)
    expect(notes[1].map((n) => n.tick)).toEqual([0, 2, 4, 6].map((s) => s * TICKS_PER_STEP))
  })

  it('reads the stored voltages as pitches', () => {
    const notes = collectNotes(simple, 8, 0.5)
    expect(notes[1].map((n) => n.note)).toEqual([60, 72, 48, 66])
  })

  it('puts each sequencer on its own channel', () => {
    const both = {
      ...simple,
      seq2: makeSeq({ bits: [true, true, true, true, true, true, true, true] }),
    }
    const notes = collectNotes(both, 4, 0.5)
    expect(new Set(notes[1].map((n) => n.channel))).toEqual(new Set([1]))
    expect(new Set(notes[2].map((n) => n.channel))).toEqual(new Set([2]))
  })

  it('skips master steps a divided sequencer is not listening on', () => {
    const divided = {
      ...simple,
      seq2: makeSeq({ bits: Array(8).fill(true), clockDiv: 2 }),
    }
    const notes = collectNotes(divided, 16, 0.5)
    expect(notes[2]).toHaveLength(8) // half of sixteen
    for (const n of notes[2]) expect(n.tick % (2 * TICKS_PER_STEP)).toBe(0)
  })

  it('lengthens the gate of a divided sequencer to match its longer step', () => {
    const divided = {
      ...simple,
      seq2: makeSeq({ bits: Array(8).fill(true), clockDiv: 4 }),
    }
    const notes = collectNotes(divided, 16, 0.5)
    expect(notes[1][0].durationTicks).toBe(TICKS_PER_STEP * 0.5)
    expect(notes[2][0].durationTicks).toBe(TICKS_PER_STEP * 2)
  })

  it('carries EG TRIG MIX through as velocity', () => {
    const both = {
      ...simple,
      seq2: makeSeq({ bits: Array(8).fill(true) }),
      egTrigMix: 0.75,
    }
    const notes = collectNotes(both, 4, 0.5)
    expect(notes[2][0].velocity).toBeGreaterThan(notes[1][0].velocity)
  })

  it('writes nothing for an empty pattern', () => {
    const notes = collectNotes(makePattern(), 32, 0.5)
    expect(notes[1]).toHaveLength(0)
    expect(notes[2]).toHaveLength(0)
  })
})

describe('the export matches what was auditioned', () => {
  // The point of the coordinate-addressed PRNG. If this ever fails, the
  // exporter and the scheduler have drifted apart and the app is lying.
  it('agrees with evolveTo/noteAt step for step, mid-mutation', () => {
    const drifting = makePattern({
      seq1: makeSeq({
        bits: [true, true, false, true, false, false, true, false],
        cvs: [1, -1, 0, 2, 0, 0, -3, 0],
        corrupt: 0.85,
        cvRange: 1,
        length: 5,
      }),
      seq2: makeSeq({
        bits: [true, false, true, true, false, true, false, false],
        cvs: [0, 0, 1.5, -2, 0, 3, 0, 0],
        corrupt: 0.6,
        cvRange: 0.7,
        length: 7,
        clockDiv: 2,
      }),
      seed: 90210,
      quantMode: 12,
      rootMidi: 45,
    })

    const steps = 64
    const notes = collectNotes(drifting, steps, 0.5)

    const expected: { tick: number; note: number; seq: number }[] = []
    for (let master = 0; master < steps; master++) {
      const state = evolveTo(drifting, master)
      for (const seqId of [1, 2] as const) {
        const div = seqId === 1 ? state.seq1.clockDiv : state.seq2.clockDiv
        if (master % div !== 0) continue
        const n = noteAt(state, seqId, master / div)
        if (n) expected.push({ tick: master * TICKS_PER_STEP, note: n.midi, seq: seqId })
      }
    }

    const actual = [
      ...notes[1].map((n) => ({ tick: n.tick, note: n.note, seq: 1 })),
      ...notes[2].map((n) => ({ tick: n.tick, note: n.note, seq: 2 })),
    ].sort((a, b) => a.tick - b.tick || a.seq - b.seq)

    expect(actual).toEqual(expected.sort((a, b) => a.tick - b.tick || a.seq - b.seq))
    expect(actual.length).toBeGreaterThan(20) // the test is actually exercising something
  })

  it('produces the same bytes twice for the same seed', () => {
    const p = makePattern({ seq1: makeSeq({ bits: Array(8).fill(true), corrupt: 0.9 }), seed: 7 })
    expect(exportPattern(p, { bpm: 120 })).toEqual(exportPattern(p, { bpm: 120 }))
  })

  it('produces different bytes for a different seed', () => {
    const a = makePattern({ seq1: makeSeq({ bits: Array(8).fill(true), corrupt: 0.9 }), seed: 1 })
    const b = { ...a, seed: 2 }
    expect(exportPattern(a, { bpm: 120 })).not.toEqual(exportPattern(b, { bpm: 120 }))
  })
})

describe('the bytes are a real MIDI file', () => {
  function parse(bytes: Uint8Array): Midi {
    return new Midi(bytes)
  }

  it('round-trips through a real parser', () => {
    const midi = parse(exportPattern(simple, { bpm: 132, steps: 8 }))
    expect(midi.header.ppq).toBe(96)
    expect(midi.header.tempos[0].bpm).toBeCloseTo(132, 1)
    expect(midi.tracks).toHaveLength(2)
  })

  it('preserves pitch, timing and velocity', () => {
    const midi = parse(exportPattern(simple, { bpm: 120, steps: 8 }))
    const seq1 = midi.tracks.find((t) => t.name === 'SEQ1')!
    expect(seq1.notes.map((n) => n.midi)).toEqual([60, 72, 48, 66])
    expect(seq1.notes.map((n) => n.ticks)).toEqual([0, 48, 96, 144])
    expect(Math.round(seq1.notes[0].velocity * 127)).toBe(127)
  })

  it('names the tracks after the sequencers', () => {
    const midi = parse(exportPattern(simple, { bpm: 120, steps: 8 }))
    expect(midi.tracks.map((t) => t.name)).toEqual(['SEQ1', 'SEQ2'])
  })

  it('puts the two sequencers on different channels', () => {
    const both = { ...simple, seq2: makeSeq({ bits: Array(8).fill(true) }) }
    const midi = parse(exportPattern(both, { bpm: 120, steps: 8 }))
    const ch = midi.tracks.map((t) => t.notes[0]?.midi !== undefined ? t.channel : null)
    expect(ch[0]).not.toBe(ch[1])
  })

  it('stays valid with no notes at all', () => {
    const midi = parse(exportPattern(makePattern(), { bpm: 100, steps: 16 }))
    expect(midi.tracks).toHaveLength(2)
    expect(midi.tracks.flatMap((t) => t.notes)).toHaveLength(0)
  })

  it('keeps both sequencer tracks even when only one of them plays', () => {
    // Guards the conductor track. Without it the tempo lands on SEQ1, and an
    // importer folds a note-free track 0 into the header — so a silent SEQ1
    // would disappear from the file while a silent SEQ2 stayed.
    const onlySeq2 = makePattern({ seq2: makeSeq({ bits: Array(8).fill(true) }) })
    const midi = parse(exportPattern(onlySeq2, { bpm: 120, steps: 8 }))
    expect(midi.tracks.map((t) => t.name)).toEqual(['SEQ1', 'SEQ2'])
    expect(midi.tracks[0].notes).toHaveLength(0)
    expect(midi.tracks[1].notes).toHaveLength(8)
  })

  it('does not overlap a repeated note with itself', () => {
    // Same pitch on consecutive steps at a full gate: the note-off must land
    // before the next note-on or a DAW shows one long smeared note.
    const solid = makePattern({
      seq1: makeSeq({ bits: Array(8).fill(true), cvs: Array(8).fill(0), cvRange: 0 }),
      rootMidi: 60,
      quantMode: 1,
    })
    const midi = parse(exportPattern(solid, { bpm: 120, steps: 8, gateFraction: 1 }))
    const notes = midi.tracks[0].notes
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i - 1].ticks + notes[i - 1].durationTicks).toBeLessThanOrEqual(notes[i].ticks)
    }
  })
})

describe('exportFilename', () => {
  it('distinguishes a locked pattern from a drifting one', () => {
    expect(exportFilename(makePattern({ seed: 42 }))).toBe('labyrinth-42-locked.mid')
    expect(exportFilename(makePattern({ seed: 42, seq1: makeSeq({ corrupt: 0.7 }) })))
      .toBe('labyrinth-42-drift.mid')
  })
})
