// Capturing a generative pattern as a Standard MIDI File.
//
// The exporter walks exactly the path the scheduler walks — evolveTo for the
// state, noteAt for the note — so the file is not a reconstruction of what was
// played, it is the same computation asked the same question. That is the whole
// reason CORRUPT was built as a pure function of (seed, sequencer, step).
//
// The two sequencers land on separate tracks and MIDI channels because on the
// hardware they are separate voices: SEQ1 typically drives the VCO and SEQ2 the
// MOD VCO, with independent lengths, clock divisions and CV ranges.

import { evolveTo } from '../labyrinth/evolve.ts'
import { noteAt } from '../labyrinth/pitch.ts'
import { type PatternState, type SeqId, loopLengthSteps } from '../labyrinth/state.ts'
import { STEPS_PER_BAR, TICKS_PER_STEP } from '../labyrinth/timing.ts'
import { type SmfNote, type SmfTrack, buildSmf } from './smf.ts'

export { STEPS_PER_BAR, TICKS_PER_STEP }

/** Bars captured when the pattern is still mutating and has no loop point. */
const DEFAULT_MUTATING_BARS = 4

export interface ExportOptions {
  bpm: number
  /** Master steps to capture. Defaults to `defaultExportSteps`. */
  steps?: number
  /** Note length as a fraction of the sequencer's own step. The Labyrinth's
   *  envelopes are decay-only, so notes are short by nature. */
  gateFraction?: number
}

export function isMutating(pattern: PatternState): boolean {
  return pattern.seq1.corrupt > 0 || pattern.seq2.corrupt > 0
}

/**
 * How much to capture by default.
 *
 * With CORRUPT off the pattern is periodic, so the polymeter loop length is the
 * whole piece — exporting more would just repeat it. With CORRUPT on there is
 * no loop point at all, so we take a few bars of the evolution instead.
 */
export function defaultExportSteps(pattern: PatternState): number {
  return isMutating(pattern)
    ? DEFAULT_MUTATING_BARS * STEPS_PER_BAR
    : loopLengthSteps(pattern)
}

/**
 * Every note the pattern sounds over `steps` master steps.
 *
 * A sequencer only acts on master steps that are a multiple of its clock
 * division; on the steps in between it is simply not listening, which is what
 * produces polyrhythm against its partner.
 */
export function collectNotes(
  initial: PatternState,
  steps: number,
  gateFraction: number,
): Record<SeqId, SmfNote[]> {
  const out: Record<SeqId, SmfNote[]> = { 1: [], 2: [] }

  for (let master = 0; master < steps; master++) {
    const state = evolveTo(initial, master)

    for (const seqId of [1, 2] as const) {
      const seq = seqId === 1 ? state.seq1 : state.seq2
      const div = Math.max(1, seq.clockDiv)
      if (master % div !== 0) continue

      const note = noteAt(state, seqId, master / div)
      if (!note) continue

      out[seqId].push({
        tick: master * TICKS_PER_STEP,
        // A divided sequencer holds each step longer, so its gate scales too.
        durationTicks: Math.max(1, Math.round(div * TICKS_PER_STEP * gateFraction)),
        note: note.midi,
        velocity: note.velocity,
        channel: seqId,
      })
    }
  }

  return out
}

/**
 * Conductor track, then one track per sequencer.
 *
 * buildSmf writes the tempo and time signature onto track 0, so leaving that
 * track empty gives the conventional Type-1 layout: a tempo map followed by the
 * musical parts. Putting SEQ1 there instead works, but makes the two
 * sequencers structurally different — importers treat a note-free track 0 as a
 * tempo map and fold it into the header, so an empty SEQ1 would vanish while an
 * empty SEQ2 survived. Symmetry is worth one spare track.
 */
export function patternToTracks(
  initial: PatternState,
  steps: number,
  gateFraction: number,
): SmfTrack[] {
  const notes = collectNotes(initial, steps, gateFraction)
  return [
    { name: 'Labyrinth', notes: [] },
    { name: 'SEQ1', notes: notes[1] },
    { name: 'SEQ2', notes: notes[2] },
  ]
}

export function exportPattern(initial: PatternState, options: ExportOptions): Uint8Array {
  const steps = options.steps ?? defaultExportSteps(initial)
  const gateFraction = options.gateFraction ?? 0.5
  return buildSmf(patternToTracks(initial, steps, gateFraction), options.bpm)
}

/** `labyrinth-<seed>-<mode>.mid`, so exports from one session stay distinct. */
export function exportFilename(pattern: PatternState): string {
  return `labyrinth-${pattern.seed}-${isMutating(pattern) ? 'drift' : 'locked'}.mid`
}
