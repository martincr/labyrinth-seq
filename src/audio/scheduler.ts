// Lookahead transport.
//
// The timing is mc-202's, and its most important property is that step times
// are recomputed from an anchor rather than accumulated. Adding a float step
// repeatedly drifts audibly over exactly the multi-bar spans polymeter exists
// to show off, which is the one thing this sequencer must get right. A tempo
// change re-anchors, bending the future without retiming the past.
//
// Unlike mc-202's scheduler this one takes callbacks instead of reaching into
// the store. The store is a React concern; a clock is not, and the indirection
// costs nothing while making the transport driveable from a test.
//
// One clock, not two. The sequencers differ by clock division off a shared
// counter, so they cannot drift apart no matter how long they run.

import { evolveTo } from '../labyrinth/evolve.ts'
import { type NoteEvent, noteAt } from '../labyrinth/pitch.ts'
import type { PatternState, SeqId } from '../labyrinth/state.ts'
import { stepDuration } from '../labyrinth/timing.ts'
import { getAudioContext } from './audioContext.ts'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1
/** Small cushion so the first step is not scheduled in the past. */
const START_DELAY_S = 0.06

export interface TransportHooks {
  getBpm(): number
  /**
   * The evolution anchor: a pattern, and the master step at which it was
   * captured. Rebasing (turning CORRUPT down to lock a pattern, say) means
   * returning a new pattern and the step it was taken at — the scheduler then
   * evolves forward from there rather than from the beginning of time.
   */
  getAnchor(): { pattern: PatternState; originStep: number }
  onNote(seqId: SeqId, note: NoteEvent, when: number, stepSeconds: number): void
  /** Fired when a step becomes audible, not when it is scheduled. */
  onStep(masterStep: number): void
}

export interface Transport {
  start(): void
  stop(): void
  isRunning(): boolean
  /** Fractional step position on the audio clock, for the UI to sample at its
   *  own rate. Reading this beats pushing every step through React. */
  currentStep(): number
}

export function createTransport(hooks: TransportHooks): Transport {
  let timer: number | null = null
  let stepIndex = 0
  let nextStepTime = 0
  let anchorTime = 0
  let anchorStep = 0
  let anchorBpm = 0

  function scheduleStep(masterStep: number, when: number): void {
    const ctx = getAudioContext()
    const { pattern, originStep } = hooks.getAnchor()
    const relative = masterStep - originStep
    if (relative < 0) return

    const state = evolveTo(pattern, relative)
    const secondsPerStep = stepDuration(hooks.getBpm())

    for (const seqId of [1, 2] as const) {
      const seq = seqId === 1 ? state.seq1 : state.seq2
      const div = Math.max(1, seq.clockDiv)
      // On the steps in between, this sequencer simply is not listening.
      if (relative % div !== 0) continue

      const note = noteAt(state, seqId, relative / div)
      if (note) hooks.onNote(seqId, note, when, secondsPerStep * div)
    }

    // Defer the playhead to the moment the step sounds, rather than the moment
    // it was scheduled up to 100ms earlier.
    const delayMs = Math.max(0, (when - ctx.currentTime) * 1000)
    window.setTimeout(() => hooks.onStep(masterStep), delayMs)
  }

  function tick(): void {
    const ctx = getAudioContext()
    const bpm = hooks.getBpm()
    if (bpm !== anchorBpm) {
      anchorTime = nextStepTime
      anchorStep = stepIndex
      anchorBpm = bpm
    }
    const dur = stepDuration(bpm)
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(stepIndex, nextStepTime)
      stepIndex++
      nextStepTime = anchorTime + (stepIndex - anchorStep) * dur
    }
  }

  return {
    start(): void {
      if (timer !== null) return
      const ctx = getAudioContext()
      // Counting resumes from the anchor rather than zero. After a rebase the
      // anchor sits at some step N, and starting from 0 would make every
      // scheduled step negative relative to it — i.e. silent.
      stepIndex = hooks.getAnchor().originStep
      nextStepTime = ctx.currentTime + START_DELAY_S
      anchorTime = nextStepTime
      anchorStep = stepIndex
      anchorBpm = hooks.getBpm()
      timer = window.setInterval(tick, LOOKAHEAD_MS)
      tick() // schedule the first window immediately rather than 25ms late
    },

    stop(): void {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },

    isRunning(): boolean {
      return timer !== null
    },

    currentStep(): number {
      if (timer === null) return 0
      const ctx = getAudioContext()
      return anchorStep + (ctx.currentTime - anchorTime) / stepDuration(anchorBpm)
    },
  }
}
