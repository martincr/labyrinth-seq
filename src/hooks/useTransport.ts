import { useEffect, useRef } from 'react'
import { getAudioContext, setMasterVolume, setSeqLevel } from '../audio/audioContext.ts'
import { triggerVoice } from '../audio/labyrinthVoice.ts'
import { type Transport, createTransport } from '../audio/scheduler.ts'
import { useAppStore } from '../store/useAppStore.ts'

/**
 * Wires the transport to the store.
 *
 * Every hook reads through `useAppStore.getState()` rather than closing over a
 * subscribed value, so the scheduler always sees the live setting — turning a
 * knob mid-bar takes effect on the next scheduled step instead of after a React
 * re-render, and the transport never needs rebuilding.
 */
export function useTransport(): Transport | null {
  const ref = useRef<Transport | null>(null)

  if (ref.current === null) {
    ref.current = createTransport({
      getBpm: () => useAppStore.getState().bpm,
      getAnchor: () => {
        const s = useAppStore.getState()
        return { pattern: s.pattern, originStep: s.originStep }
      },
      onNote: (seqId, note, when) => {
        const s = useAppStore.getState()
        if (s.seqMix[seqId].mute) return
        triggerVoice(getAudioContext(), {
          midi: note.midi,
          velocity: note.velocity,
          when,
          params: s.voice,
          seqId,
        })
      },
      onStep: (step) => useAppStore.getState().setStep(step),
    })
  }

  const isPlaying = useAppStore((s) => s.isPlaying)
  const seqMix = useAppStore((s) => s.seqMix)
  const masterVolume = useAppStore((s) => s.masterVolume)

  useEffect(() => {
    const transport = ref.current
    if (!transport) return
    if (isPlaying) transport.start()
    else transport.stop()
  }, [isPlaying])

  useEffect(() => {
    // A bus is created at unity, so push the stored levels before the first
    // note or the mixer reads wrong for one step.
    if (!useAppStore.getState().isPlaying) return
    setSeqLevel(1, seqMix[1].volume, seqMix[1].mute)
    setSeqLevel(2, seqMix[2].volume, seqMix[2].mute)
    setMasterVolume(masterVolume)
  }, [seqMix, masterVolume])

  useEffect(() => () => ref.current?.stop(), [])

  return ref.current
}
