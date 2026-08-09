// Lazy AudioContext singleton and master chain.
//
// Structure follows mc-202's src/audio/audioContext.ts — module-level context,
// per-voice buses that outlive any single note, a limiter before the
// destination — minus its mu-law bitcrusher, which is a 2oh2 characteristic and
// has no business on a Moog.
//
// The buses are keyed by sequencer and live here rather than on the voice
// because voices are built per note: an instance field would give several
// competing gain nodes for one sequencer.

import type { SeqId } from '../labyrinth/state.ts'

let ctx: AudioContext | null = null
let masterInput: GainNode | null = null

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    masterInput = ctx.createGain()
    masterInput.gain.value = 0.8

    // The wavefolder can produce a lot of level very suddenly, and BLEND sums
    // two full-scale paths. A limiter is not a nicety here.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.1

    masterInput.connect(limiter)
    limiter.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function getMasterInput(): GainNode {
  getAudioContext()
  return masterInput!
}

const seqBuses = new Map<SeqId, GainNode>()

export function getSeqBus(seqId: SeqId): GainNode {
  getAudioContext()
  let bus = seqBuses.get(seqId)
  if (!bus) {
    bus = ctx!.createGain()
    bus.connect(masterInput!)
    seqBuses.set(seqId, bus)
  }
  return bus
}

/** Ramps rather than sets: a step change on a summing bus with notes still
 *  ringing through it clicks. */
export function setSeqLevel(seqId: SeqId, volume: number, mute: boolean): void {
  const context = getAudioContext()
  const bus = getSeqBus(seqId)
  const target = mute ? 0 : Math.max(0, Math.min(1, volume))
  bus.gain.setTargetAtTime(target, context.currentTime, 0.01)
}

export function setMasterVolume(volume: number): void {
  const context = getAudioContext()
  getMasterInput().gain.setTargetAtTime(
    Math.max(0, Math.min(1, volume)),
    context.currentTime,
    0.01,
  )
}
