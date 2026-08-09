import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { DEFAULT_VOICE, type VoiceParams } from '../audio/labyrinthVoice.ts'
import { evolveTo } from '../labyrinth/evolve.ts'
import {
  BITS_PER_SEQ,
  type PatternState,
  type SeqId,
  bitShift,
  clonePattern,
  makePattern,
} from '../labyrinth/state.ts'
import { loadPersisted, persist } from './persistence.ts'

// The evolution anchor is the idea this store is built around.
//
// `pattern` is not "the current pattern" — it is the pattern as it stood at
// `originStep`, and everything after that is derived by replaying CORRUPT
// forward from it. `current()` is a pure function of (pattern, originStep,
// step), never a stored value, which is what keeps the scrub bar honest.
//
// Editing rebases: the evolved state becomes the new anchor and drift restarts
// from there. Without that, turning CORRUPT down would retroactively un-corrupt
// the history instead of locking in what you are hearing — and locking in what
// you are hearing is the single most important gesture on the instrument.

export interface Snapshot {
  id: string
  name: string
  createdAt: number
  pattern: PatternState
}

export interface SeqMix {
  volume: number
  mute: boolean
}

export interface AppState {
  /** The anchor pattern — the state as of `originStep`. */
  pattern: PatternState
  originStep: number
  /** Transport or scrub position, in master steps. */
  step: number
  /** Furthest step reached, so the scrub bar knows its extent. */
  reachedStep: number

  isPlaying: boolean
  bpm: number
  voice: VoiceParams
  seqMix: Record<SeqId, SeqMix>
  masterVolume: number
  snapshots: Snapshot[]

  setBpm(bpm: number): void
  setPlaying(playing: boolean): void
  setStep(step: number): void

  toggleBit(seqId: SeqId, index: number): void
  setLength(seqId: SeqId, length: number): void
  setCorrupt(seqId: SeqId, corrupt: number): void
  setCvRange(seqId: SeqId, cvRange: number): void
  setClockDiv(seqId: SeqId, clockDiv: number): void
  shiftWriteHead(seqId: SeqId, delta: number): void
  rotateBits(seqId: SeqId): void

  setChained(chained: boolean): void
  setChainOffset(offset: number): void
  setQuantMode(mode: number): void
  setRootMidi(midi: number): void
  setEgTrigMix(mix: number): void
  reseed(seed?: number): void

  /** Fix the current evolved state as the new anchor. */
  rebase(): void
  /** The hardware's "turn CORRUPT fully counterclockwise to lock the current
   *  pattern in" — but without losing it if you change your mind. */
  lock(): void
  clearAll(): void

  setVoice(patch: Partial<VoiceParams>): void
  setSeqMix(seqId: SeqId, patch: Partial<SeqMix>): void
  setMasterVolume(volume: number): void

  saveSnapshot(name: string): void
  loadSnapshot(id: string): void
  deleteSnapshot(id: string): void
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

const saved = loadPersisted()

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    pattern: saved?.pattern ?? makePattern({ seed: randomSeed() }),
    originStep: 0,
    step: 0,
    reachedStep: 0,
    isPlaying: false,
    bpm: saved?.bpm ?? 120,
    voice: saved?.voice ?? { ...DEFAULT_VOICE },
    seqMix: saved?.seqMix ?? { 1: { volume: 0.8, mute: false }, 2: { volume: 0.8, mute: false } },
    masterVolume: saved?.masterVolume ?? 0.8,
    snapshots: saved?.snapshots ?? [],

    setBpm(bpm) {
      set((s) => {
        s.bpm = Math.max(20, Math.min(300, bpm))
      })
    },

    setPlaying(playing) {
      set((s) => {
        s.isPlaying = playing
        if (!playing) return
        // Restarting replays from the anchor, so the same seed gives the same
        // performance twice.
        s.step = s.originStep
        s.reachedStep = s.originStep
      })
    },

    setStep(step) {
      set((s) => {
        s.step = Math.max(s.originStep, step)
        s.reachedStep = Math.max(s.reachedStep, s.step)
      })
    },

    // --- edits, all of which rebase ------------------------------------------

    toggleBit(seqId, index) {
      set((s) => {
        rebaseInto(s)
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        seq.bits[index] = !seq.bits[index]
        // "When a bit is flipped on, a random voltage value between -5V and
        // +5V is generated and stored in that bit location." Flipping off and
        // on again gives a different voltage, so this is unconditional.
        if (seq.bits[index]) seq.cvs[index] = Math.random() * 10 - 5
      })
    },

    setLength(seqId, length) {
      set((s) => {
        rebaseInto(s)
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        seq.length = Math.max(1, Math.min(BITS_PER_SEQ, Math.round(length)))
      })
    },

    setCorrupt(seqId, corrupt) {
      set((s) => {
        rebaseInto(s)
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        seq.corrupt = Math.max(0, Math.min(1, corrupt))
      })
    },

    setCvRange(seqId, cvRange) {
      // Attenuates on the way out; it does not touch the evolution, so there is
      // nothing to rebase and the whole history re-scales.
      set((s) => {
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        seq.cvRange = Math.max(0, Math.min(1, cvRange))
      })
    },

    setClockDiv(seqId, clockDiv) {
      set((s) => {
        rebaseInto(s)
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        seq.clockDiv = Math.max(1, Math.min(16, Math.round(clockDiv)))
      })
    },

    shiftWriteHead(seqId, delta) {
      set((s) => {
        rebaseInto(s)
        const seq = seqId === 1 ? s.pattern.seq1 : s.pattern.seq2
        const len = Math.max(1, seq.length)
        seq.writeOffset = (((seq.writeOffset + delta) % len) + len) % len
      })
    },

    rotateBits(seqId) {
      set((s) => {
        rebaseInto(s)
        if (seqId === 1) s.pattern.seq1 = bitShift(s.pattern.seq1)
        else s.pattern.seq2 = bitShift(s.pattern.seq2)
      })
    },

    // --- render-only settings, no rebase needed -------------------------------

    setChained(chained) {
      set((s) => {
        s.pattern.chained = chained
      })
    },

    setChainOffset(offset) {
      set((s) => {
        s.pattern.chainOffset = Math.max(0, Math.round(offset))
      })
    },

    setQuantMode(mode) {
      set((s) => {
        s.pattern.quantMode = Math.max(0, Math.min(15, Math.round(mode)))
      })
    },

    setRootMidi(midi) {
      set((s) => {
        s.pattern.rootMidi = Math.max(0, Math.min(127, Math.round(midi)))
      })
    },

    setEgTrigMix(mix) {
      set((s) => {
        s.pattern.egTrigMix = Math.max(0, Math.min(1, mix))
      })
    },

    reseed(seed) {
      set((s) => {
        rebaseInto(s)
        s.pattern.seed = seed ?? randomSeed()
      })
    },

    // --- anchoring -------------------------------------------------------------

    rebase() {
      set(rebaseInto)
    },

    lock() {
      set((s) => {
        rebaseInto(s)
        s.pattern.seq1.corrupt = 0
        s.pattern.seq2.corrupt = 0
      })
    },

    clearAll() {
      set((s) => {
        const seed = s.pattern.seed
        s.pattern = makePattern({ seed })
        s.originStep = s.step
      })
    },

    // --- voice and mix ---------------------------------------------------------

    setVoice(patch) {
      set((s) => {
        Object.assign(s.voice, patch)
      })
    },

    setSeqMix(seqId, patch) {
      set((s) => {
        Object.assign(s.seqMix[seqId], patch)
      })
    },

    setMasterVolume(volume) {
      set((s) => {
        s.masterVolume = Math.max(0, Math.min(1, volume))
      })
    },

    // --- snapshots -------------------------------------------------------------

    saveSnapshot(name) {
      const s = get()
      const pattern = clonePattern(evolveTo(s.pattern, s.step - s.originStep))
      set((s) => {
        s.snapshots.unshift({
          id: newId(),
          name: name.trim() || `Snapshot ${s.snapshots.length + 1}`,
          createdAt: Date.now(),
          pattern,
        })
      })
    },

    loadSnapshot(id) {
      set((s) => {
        const snap = s.snapshots.find((x) => x.id === id)
        if (!snap) return
        s.pattern = clonePattern(snap.pattern)
        s.originStep = s.step
      })
    },

    deleteSnapshot(id) {
      set((s) => {
        s.snapshots = s.snapshots.filter((x) => x.id !== id)
      })
    },
  })),
)

/** Fold the evolution into the anchor so far, and start drifting again from
 *  here. Mutates the immer draft in place. */
function rebaseInto(s: AppState): void {
  s.pattern = clonePattern(evolveTo(s.pattern, s.step - s.originStep))
  s.originStep = s.step
}

// Persist on any change that is worth keeping. Transport position is not.
useAppStore.subscribe((s) => {
  persist({
    pattern: s.pattern,
    bpm: s.bpm,
    voice: s.voice,
    seqMix: s.seqMix,
    masterVolume: s.masterVolume,
    snapshots: s.snapshots,
  })
})
