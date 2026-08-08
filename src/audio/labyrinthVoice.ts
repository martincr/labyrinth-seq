// A Labyrinth-flavoured voice.
//
//   VCO (sine) ──┬──────────────────────┐
//   MOD VCO (tri)┤                      │      ┌→ VCW (wavefolder) → VCA ─┐
//   RING MOD ────┼→ mixer (saturating) ─┼──────┤                          ├→ BLEND
//   NOISE ───────┘                      │      └→ VCF (LP↔BP morph) → VCA ┘
//
// The structure — a whole node graph built per trigger, envelopes scheduled on
// AudioParams, everything torn down by its own stop() — is lifted from mc-202's
// SynthVoice, including its scheduleAdsr approach reduced here to the
// decay-only envelopes the Labyrinth actually has. The graph itself is
// different because the instruments are: the 202 is saw-or-square into a
// lowpass, the Labyrinth is a sine into a wavefolder running beside a filter.
//
// Deliberate approximations, none of which the sequencer depends on:
//   * MOD→VCO FM is ordinary exponential FM. The hardware is thru-zero, which
//     holds pitch as depth rises; this drifts sharp at high depth.
//   * The VCF is two biquads crossfaded rather than a real state-variable
//     filter. It morphs LP→BP convincingly and costs no AudioWorklet.
//   * The wavefolder is a triangular fold. The hardware's diode-transistor
//     folder has softer corners, so this is a little brighter at high FOLD.

import { type SeqId } from '../labyrinth/state.ts'
import { getSeqBus } from './audioContext.ts'

export type FilterOrder = 'parallel' | 'vcw-vcf' | 'vcf-vcw'

export interface VoiceParams {
  /** Mixer levels, 0..1. Above ~0.7 the mixer saturates, as the hardware's does. */
  vcoLevel: number
  modVcoLevel: number
  ringModLevel: number
  noiseLevel: number
  /** MOD VCO pitch in Hz. The hardware sweeps sub-audio to 1.3kHz. */
  modVcoFreq: number
  /** 0..1 dark to bright. */
  noiseTone: number
  /** 0..1 depth of MOD VCO frequency-modulating the VCO. */
  modToVcoFm: number

  /** Wavefolder. fold 0..1, bias -1..1 shifts the fold's symmetry. */
  fold: number
  bias: number

  /** Filter. cutoff 0..1 maps logarithmically; mode 0 = lowpass, 1 = bandpass. */
  cutoff: number
  resonance: number
  filterMode: number

  /** 0 = wavefolder path only, 1 = filter path only. */
  blend: number
  order: FilterOrder

  /** Both envelopes are decay-only, as on the panel. Seconds. */
  eg1Decay: number
  eg2Decay: number
  /** Bipolar EG1 amounts, -1..1. */
  eg1ToVco: number
  eg1ToModVco: number
  eg1ToFold: number
  eg1ToCutoff: number
}

export const DEFAULT_VOICE: VoiceParams = {
  vcoLevel: 0.6,
  modVcoLevel: 0,
  ringModLevel: 0,
  noiseLevel: 0,
  modVcoFreq: 110,
  noiseTone: 0.5,
  modToVcoFm: 0,
  fold: 0,
  bias: 0,
  cutoff: 0.8,
  resonance: 0.15,
  filterMode: 0,
  blend: 1,
  order: 'parallel',
  eg1Decay: 0.3,
  eg2Decay: 0.35,
  eg1ToVco: 0,
  eg1ToModVco: 0,
  eg1ToFold: 0,
  eg1ToCutoff: 0.3,
}

const MIN_CUTOFF = 40
const MAX_CUTOFF = 12000
/** Cents of pitch/cutoff swing at full EG1 amount — four octaves either way. */
const EG_MOD_CENTS = 4800
/** How hard FOLD can drive the folder. The curve encodes this, so a drive gain
 *  of 1/MAX_FOLD_DRIVE passes the signal through untouched. */
const MAX_FOLD_DRIVE = 8

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function cutoffHz(amount: number): number {
  return MIN_CUTOFF * Math.pow(MAX_CUTOFF / MIN_CUTOFF, clamp01(amount))
}

// --- cached curves -----------------------------------------------------------
// Rebuilt never; both are pure functions of nothing. Following mc-202's
// getComparatorCurve, which caches for the same reason: these are allocated per
// note otherwise, several times a second.

// Typed with the explicit ArrayBuffer parameter because WaveShaperNode.curve
// rejects a possibly-shared backing buffer.
let foldCurve: Float32Array<ArrayBuffer> | null = null
let satCurve: Float32Array<ArrayBuffer> | null = null

/** Reflect at ±1 until the value is back inside — the classic triangular fold. */
function triangleFold(x: number): number {
  let y = x
  for (let guard = 0; guard < 64 && (y > 1 || y < -1); guard++) {
    if (y > 1) y = 2 - y
    else y = -2 - y
  }
  return Math.max(-1, Math.min(1, y))
}

/**
 * The folder's transfer function over the full drive range.
 *
 * The curve bakes in MAX_FOLD_DRIVE so the drive itself can be an ordinary
 * GainNode in front of it — which is what lets EG1 modulate FOLD. A WaveShaper
 * clamps anything outside [-1, 1], so driving into a fixed unit-domain curve
 * would clip rather than fold.
 */
function getFoldCurve(): Float32Array<ArrayBuffer> {
  if (!foldCurve) {
    const size = 2048
    foldCurve = new Float32Array(size)
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1
      foldCurve[i] = triangleFold(x * MAX_FOLD_DRIVE)
    }
  }
  return foldCurve
}

/** Soft saturation for the mixer — "adding harmonics and warm saturation to
 *  the four signal sources". Normalised so unity in stays unity out. */
function getSaturationCurve(): Float32Array<ArrayBuffer> {
  if (!satCurve) {
    const size = 1024
    const drive = 1.8
    const norm = Math.tanh(drive)
    satCurve = new Float32Array(size)
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1
      satCurve[i] = Math.tanh(x * drive) / norm
    }
  }
  return satCurve
}

let noiseBuffer: AudioBuffer | null = null
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  return noiseBuffer
}

/** A decay-only envelope on a param: jump to peak, fall away. */
function scheduleDecay(param: AudioParam, peak: number, when: number, decaySec: number): void {
  const decay = Math.max(0.005, decaySec)
  param.cancelScheduledValues(when)
  param.setValueAtTime(Math.max(0.0001, peak), when)
  param.exponentialRampToValueAtTime(0.0001, when + decay)
}

export interface TriggerOptions {
  midi: number
  /** 0..127. */
  velocity: number
  when: number
  params: VoiceParams
  seqId: SeqId
}

/**
 * Build, play and dispose of one note.
 *
 * Fire-and-forget, like mc-202's voices: every node is scheduled to stop, so
 * the graph collects itself and there is no pool to manage. The Labyrinth is
 * monophonic per sequencer in spirit, but overlapping decays sound right and
 * cost nothing here.
 */
export function triggerVoice(ctx: AudioContext, opts: TriggerOptions): void {
  const { midi, velocity, when, params, seqId } = opts
  const freq = midiToFrequency(midi)
  const amp = Math.max(0.05, Math.min(1, velocity / 127))

  // --- EG1: a modulation source, not an amplifier -----------------------------
  const eg1 = ctx.createConstantSource()
  eg1.offset.value = 0
  scheduleDecay(eg1.offset, 1, when, params.eg1Decay)

  function eg1Into(target: AudioParam, amount: number, scale: number): void {
    if (Math.abs(amount) < 0.001) return
    const depth = ctx.createGain()
    depth.gain.value = amount * scale
    eg1.connect(depth)
    depth.connect(target)
  }

  // --- oscillators ------------------------------------------------------------
  const vco = ctx.createOscillator()
  vco.type = 'sine'
  vco.frequency.value = freq
  eg1Into(vco.detune, params.eg1ToVco, EG_MOD_CENTS)

  const modVco = ctx.createOscillator()
  modVco.type = 'triangle'
  modVco.frequency.value = Math.max(0.05, params.modVcoFreq)
  eg1Into(modVco.detune, params.eg1ToModVco, EG_MOD_CENTS)

  // MOD -> VCO FM. Depth scales with the carrier so the character holds across
  // the keyboard instead of vanishing up top.
  if (params.modToVcoFm > 0.001) {
    const fm = ctx.createGain()
    fm.gain.value = params.modToVcoFm * freq * 4
    modVco.connect(fm)
    fm.connect(vco.frequency)
  }

  // --- mixer ------------------------------------------------------------------
  const mixSum = ctx.createGain()
  mixSum.gain.value = 1

  const vcoLevel = ctx.createGain()
  vcoLevel.gain.value = clamp01(params.vcoLevel)
  vco.connect(vcoLevel)
  vcoLevel.connect(mixSum)

  const modLevel = ctx.createGain()
  modLevel.gain.value = clamp01(params.modVcoLevel)
  modVco.connect(modLevel)
  modLevel.connect(mixSum)

  // Ring mod: a gain node at zero, with the modulator driving its gain, is a
  // multiplier — the sum and difference tones, no carrier.
  if (params.ringModLevel > 0.001) {
    const ring = ctx.createGain()
    ring.gain.value = 0
    vco.connect(ring)
    modVco.connect(ring.gain)
    const ringLevel = ctx.createGain()
    ringLevel.gain.value = clamp01(params.ringModLevel)
    ring.connect(ringLevel)
    ringLevel.connect(mixSum)
  }

  let noise: AudioBufferSourceNode | null = null
  if (params.noiseLevel > 0.001) {
    noise = ctx.createBufferSource()
    noise.buffer = getNoiseBuffer(ctx)
    noise.loop = true
    // NOISE TONE "emphasiz[es] low frequencies counterclockwise and higher
    // frequencies clockwise" — a lowpass opening up across the knob.
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 200 * Math.pow(60, clamp01(params.noiseTone))
    tone.Q.value = 0.7
    const noiseLevel = ctx.createGain()
    noiseLevel.gain.value = clamp01(params.noiseLevel) * 0.6
    noise.connect(tone)
    tone.connect(noiseLevel)
    noiseLevel.connect(mixSum)
  }

  const saturator = ctx.createWaveShaper()
  saturator.curve = getSaturationCurve()
  saturator.oversample = '2x'
  mixSum.connect(saturator)

  // --- wavefolder path --------------------------------------------------------
  const foldDrive = ctx.createGain()
  const baseDrive = (1 + clamp01(params.fold) * (MAX_FOLD_DRIVE - 1)) / MAX_FOLD_DRIVE
  foldDrive.gain.value = baseDrive
  eg1Into(foldDrive.gain, params.eg1ToFold, 1 - 1 / MAX_FOLD_DRIVE)

  const foldSum = ctx.createGain()
  foldDrive.connect(foldSum)

  // BIAS shifts the DC offset going into the folder, so the wave folds
  // asymmetrically and emphasises even rather than odd harmonics.
  let biasSource: ConstantSourceNode | null = null
  if (Math.abs(params.bias) > 0.001) {
    biasSource = ctx.createConstantSource()
    biasSource.offset.value = Math.max(-1, Math.min(1, params.bias)) * 0.5
    biasSource.connect(foldSum)
  }

  const folder = ctx.createWaveShaper()
  folder.curve = getFoldCurve()
  folder.oversample = '4x' // folding generates a lot of harmonics; alias control
  foldSum.connect(folder)

  // --- filter path ------------------------------------------------------------
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = cutoffHz(params.cutoff)
  lp.Q.value = 0.5 + clamp01(params.resonance) * 18

  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = cutoffHz(params.cutoff)
  bp.Q.value = 0.7 + clamp01(params.resonance) * 18

  eg1Into(lp.detune, params.eg1ToCutoff, EG_MOD_CENTS)
  eg1Into(bp.detune, params.eg1ToCutoff, EG_MOD_CENTS)

  // FILTER MODE morphs between the two responses rather than switching.
  const mode = clamp01(params.filterMode)
  const lpMix = ctx.createGain()
  lpMix.gain.value = 1 - mode
  const bpMix = ctx.createGain()
  bpMix.gain.value = mode
  const filterOut = ctx.createGain()
  lp.connect(lpMix)
  bp.connect(bpMix)
  lpMix.connect(filterOut)
  bpMix.connect(filterOut)

  function feedFilter(source: AudioNode): void {
    source.connect(lp)
    source.connect(bp)
  }

  // ORDER rearranges which path feeds which. In the series settings you blend
  // between one path's raw output and that same output sent through the other.
  switch (params.order) {
    case 'vcw-vcf':
      saturator.connect(foldDrive)
      feedFilter(folder)
      break
    case 'vcf-vcw':
      feedFilter(saturator)
      filterOut.connect(foldDrive)
      break
    case 'parallel':
      saturator.connect(foldDrive)
      feedFilter(saturator)
      break
  }

  // --- VCAs, blend and output -------------------------------------------------
  const vcaW = ctx.createGain()
  const vcaF = ctx.createGain()
  vcaW.gain.value = 0
  vcaF.gain.value = 0
  scheduleDecay(vcaW.gain, amp * 0.5, when, params.eg2Decay)
  scheduleDecay(vcaF.gain, amp * 0.5, when, params.eg2Decay)

  folder.connect(vcaW)
  filterOut.connect(vcaF)

  const blend = clamp01(params.blend)
  const blendW = ctx.createGain()
  blendW.gain.value = 1 - blend
  const blendF = ctx.createGain()
  blendF.gain.value = blend

  vcaW.connect(blendW)
  vcaF.connect(blendF)

  const bus = getSeqBus(seqId)
  blendW.connect(bus)
  blendF.connect(bus)

  // --- lifetime ---------------------------------------------------------------
  const stopAt = when + Math.max(params.eg1Decay, params.eg2Decay) + 0.15
  vco.start(when)
  vco.stop(stopAt)
  modVco.start(when)
  modVco.stop(stopAt)
  eg1.start(when)
  eg1.stop(stopAt)
  if (biasSource) {
    biasSource.start(when)
    biasSource.stop(stopAt)
  }
  if (noise) {
    noise.start(when)
    noise.stop(stopAt)
  }
}
