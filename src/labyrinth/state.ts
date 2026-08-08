// The sequencer's data model. Pure data and pure helpers — no audio, no React,
// no DOM. Everything downstream (scheduler, exporter, UI) reads this, and the
// determinism guarantee in evolve.ts depends on nothing here holding hidden
// mutable state.

export const BITS_PER_SEQ = 8
export const MAX_CHAINED_STEPS = BITS_PER_SEQ * 2

export type SeqId = 1 | 2

export interface SeqState {
  /** Eight bit locations, on or off. An "on" bit triggers and sounds its CV. */
  bits: boolean[]
  /** Stored control voltage per bit, −5V..+5V. Only meaningful where bits[i]. */
  cvs: number[]
  /** 1..8. Shorter lengths against each other give polymeter. */
  length: number
  /** Write head offset from the play head, via BIT SHIFT + ADVANCE. */
  writeOffset: number
  /** 0..1. Below 0.5 drifts voltages only; above 0.5 also flips bits. */
  corrupt: number
  /** 0..1 attenuator applied to the CV before the quantizer. */
  cvRange: number
  /** 1..16. Divides the master clock, so the two sequencers can run at
   *  different rates off one counter. */
  clockDiv: number
}

export interface PatternState {
  seq1: SeqState
  seq2: SeqState
  /** CHAIN SEQ: both sequencers read one shared 16-bit sequence. */
  chained: boolean
  /** SEQ2's play-head offset within the chained sequence, for round-robin. */
  chainOffset: number
  /** Index into QUANT_MODES. 0 is Unquantized. */
  quantMode: number
  /** The note the bipolar CV spreads around — the VCO FREQUENCY tuning. */
  rootMidi: number
  /** 0..1. Balances which sequencer's triggers fire the envelopes, which is
   *  how the hardware expresses velocity/accent. */
  egTrigMix: number
  seed: number
}

export function makeSeq(overrides: Partial<SeqState> = {}): SeqState {
  return {
    bits: Array(BITS_PER_SEQ).fill(false),
    cvs: Array(BITS_PER_SEQ).fill(0),
    length: BITS_PER_SEQ,
    writeOffset: 0,
    corrupt: 0,
    cvRange: 0.5,
    clockDiv: 1,
    ...overrides,
  }
}

export function makePattern(overrides: Partial<PatternState> = {}): PatternState {
  return {
    seq1: makeSeq(),
    seq2: makeSeq(),
    chained: false,
    chainOffset: 0,
    quantMode: 2, // Major — the hardware ships set to SEQ1 bit 3
    rootMidi: 48, // C2, low enough that ±5 octaves stays mostly in range
    egTrigMix: 0.5,
    seed: 1,
    ...overrides,
  }
}

export function cloneSeq(seq: SeqState): SeqState {
  return { ...seq, bits: [...seq.bits], cvs: [...seq.cvs] }
}

export function clonePattern(pattern: PatternState): PatternState {
  return { ...pattern, seq1: cloneSeq(pattern.seq1), seq2: cloneSeq(pattern.seq2) }
}

/** Which bit the play head sits on after `absStep` of this sequencer's own steps. */
export function playHead(seq: SeqState, absStep: number): number {
  const len = Math.max(1, seq.length)
  return ((absStep % len) + len) % len
}

/** Which bit the write head sits on. Travels with the play head unless offset
 *  via BIT SHIFT + ADVANCE. */
export function writeHead(seq: SeqState, absStep: number): number {
  const len = Math.max(1, seq.length)
  return (((absStep + seq.writeOffset) % len) + len) % len
}

/** Rotate all bits (and their stored voltages) one place right, wrapping within
 *  the current LENGTH. Bits beyond LENGTH are left alone, as on the hardware:
 *  "If the sequence LENGTH is anything shorter than 8 bits, only the bits in
 *  the current LENGTH will be affected by BIT SHIFT." */
export function bitShift(seq: SeqState): SeqState {
  const len = Math.max(1, seq.length)
  const next = cloneSeq(seq)
  for (let i = 0; i < len; i++) {
    const from = (i - 1 + len) % len
    next.bits[i] = seq.bits[from]
    next.cvs[i] = seq.cvs[from]
  }
  return next
}

/** Greatest common divisor, for the polymeter loop length. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * How many master steps before the whole pattern repeats.
 *
 * Each sequencer advances every `clockDiv` master steps and repeats every
 * `length` of its own steps, so it repeats every `length * clockDiv` master
 * steps; the pair repeats at the LCM of the two. Meaningful only when CORRUPT
 * is off — otherwise the pattern is still mutating and has no loop point.
 */
export function loopLengthSteps(pattern: PatternState): number {
  const a = Math.max(1, pattern.seq1.length) * Math.max(1, pattern.seq1.clockDiv)
  const b = Math.max(1, pattern.seq2.length) * Math.max(1, pattern.seq2.clockDiv)
  return (a / gcd(a, b)) * b
}
