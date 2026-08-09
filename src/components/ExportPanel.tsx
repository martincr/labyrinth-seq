import { useState } from 'react'
import { clipFilename, exportAbletonClip } from '../ableton/exportClip.ts'
import { useCurrentPattern } from '../hooks/useCurrentPattern.ts'
import { downloadBytes } from '../lib/download.ts'
import { STEPS_PER_BAR } from '../labyrinth/timing.ts'
import {
  collectNotes,
  defaultExportSteps,
  exportFilename,
  exportPattern,
  isMutating,
} from '../midi/exportPattern.ts'
import { useAppStore } from '../store/useAppStore.ts'
import { Knob, PanelButton, Section } from './controls.tsx'

export function ExportPanel() {
  const bpm = useAppStore((s) => s.bpm)
  const { pattern: source } = useCurrentPattern()
  const quantMode = source.quantMode

  const [useDefault, setUseDefault] = useState(true)
  const [bars, setBars] = useState(4)
  const [gate, setGate] = useState(0.5)

  const steps = useDefault ? defaultExportSteps(source) : bars * STEPS_PER_BAR
  const counts = collectNotes(source, steps, gate)
  const total = counts[1].length + counts[2].length

  return (
    <Section title="Export">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <PanelButton
            active={useDefault}
            onClick={() => setUseDefault(true)}
            title={
              isMutating(source)
                ? 'Four bars of the drift'
                : 'Exactly one loop of the locked pattern'
            }
          >
            {isMutating(source) ? 'Four bars' : 'One loop'}
          </PanelButton>
          <PanelButton active={!useDefault} onClick={() => setUseDefault(false)}>
            Custom
          </PanelButton>
        </div>

        {!useDefault && (
          <Knob
            label="Bars"
            value={bars}
            min={1}
            max={64}
            onChange={(v) => setBars(Math.round(v))}
            format={(v) => String(Math.round(v))}
          />
        )}

        <Knob
          label="Gate"
          value={gate}
          min={0.05}
          max={1}
          onChange={setGate}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        <div className="flex-1 font-mono text-[9px] leading-relaxed text-panel-600">
          <div>
            {steps} steps · {(steps / STEPS_PER_BAR).toFixed(2)} bars · {total} notes
          </div>
          <div>
            SEQ1 {counts[1].length} · SEQ2 {counts[2].length} · two tracks at {bpm} BPM
          </div>
          {quantMode === 0 && (
            <div className="text-led-amber/80">
              Unquantized rounds to the nearest semitone on export — MIDI has no
              in-between.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <PanelButton
            className="px-4 py-2"
            onClick={() =>
              downloadBytes(
                exportPattern(source, { bpm, steps, gateFraction: gate }),
                exportFilename(source),
                'audio/midi',
              )
            }
          >
            Download .mid — both
          </PanelButton>
          <div className="flex gap-1.5">
            {([1, 2] as const).map((seqId) => (
              <PanelButton
                key={seqId}
                className="flex-1"
                title={`Ableton Live clip for SEQ${seqId} — drag straight into a Session slot`}
                onClick={() => {
                  void exportAbletonClip(source, seqId, { steps, gateFraction: gate }).then(
                    (bytes) =>
                      downloadBytes(
                        bytes,
                        clipFilename(source, seqId),
                        'application/octet-stream',
                      ),
                  )
                }}
              >
                .alc SEQ{seqId}
              </PanelButton>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 font-mono text-[9px] text-panel-600">
        Exports the pattern as it stands at this point in the history, not from the
        beginning — what you scrubbed to is what you get. A `.alc` is one clip, so the
        two sequencers export separately; the `.mid` carries both as two tracks.
      </p>
    </Section>
  )
}
