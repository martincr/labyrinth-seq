// localStorage persistence.
//
// Shape follows move-trainer's: a namespaced key, a defaults-merge on load, and
// a try/catch around both ends. The merge matters more than it looks — it is
// what lets a stored session from an older build load into a newer one that has
// added a field, instead of arriving with `undefined` where a number belongs.
//
// Writes are debounced because the store is subscribed to on every keystroke of
// a knob drag, and JSON.stringify of the snapshot bank is not free.

import type { VoiceParams } from '../audio/labyrinthVoice.ts'
import type { PatternState, SeqId } from '../labyrinth/state.ts'
import type { Snapshot } from './useAppStore.ts'

const STORE_KEY = 'labyrinth-seq-v1'
const WRITE_DEBOUNCE_MS = 400

export interface PersistedState {
  pattern: PatternState
  bpm: number
  voice: VoiceParams
  seqMix: Record<SeqId, { volume: number; mute: boolean }>
  masterVolume: number
  snapshots: Snapshot[]
}

let writeTimer: number | null = null

export function persist(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return
  if (writeTimer !== null) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, ...state }))
    } catch {
      // Quota, private browsing, a disabled store — none of which should stop
      // the sequencer from running.
    }
  }, WRITE_DEBOUNCE_MS) as unknown as number
}

export function loadPersisted(): PersistedState | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState> & { version?: number }
    if (!parsed.pattern) return null
    return {
      pattern: parsed.pattern,
      bpm: parsed.bpm ?? 120,
      voice: parsed.voice as VoiceParams,
      seqMix: parsed.seqMix ?? {
        1: { volume: 0.8, mute: false },
        2: { volume: 0.8, mute: false },
      },
      masterVolume: parsed.masterVolume ?? 0.8,
      snapshots: parsed.snapshots ?? [],
    }
  } catch {
    return null
  }
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    // as above
  }
}
