import { midiToNote } from '../lib/notes.ts'
import { headInfo } from '../labyrinth/heads.ts'
import { cvToMidi } from '../labyrinth/pitch.ts'
import { BITS_PER_SEQ, type PatternState, type SeqId } from '../labyrinth/state.ts'
import { useAppStore } from '../store/useAppStore.ts'
import { Knob, PanelButton } from './controls.tsx'

interface BitRowProps {
  pattern: PatternState
  seqId: SeqId
  relStep: number
}

function BitRow({ pattern, seqId, relStep }: BitRowProps) {
  const toggleBit = useAppStore((s) => s.toggleBit)
  const seq = seqId === 1 ? pattern.seq1 : pattern.seq2
  const { play, write } = headInfo(pattern, seqId, relStep)

  return (
    <div className="flex gap-1.5">
      {Array.from({ length: BITS_PER_SEQ }, (_, i) => {
        const on = seq.bits[i]
        const active = i < seq.length
        const note = on ? cvToMidi(seq.cvs[i], seq.cvRange, pattern.rootMidi, pattern.quantMode) : null

        return (
          <button
            key={i}
            type="button"
            onClick={() => toggleBit(seqId, i)}
            title={`Bit ${i + 1}${on ? ` — ${seq.cvs[i].toFixed(2)}V` : ' — off'}`}
            className={`no-select group relative flex w-11 flex-col items-center gap-1 rounded border px-1 py-1.5 transition-colors ${
              active
                ? 'border-panel-700 bg-panel-800/80 hover:border-panel-600'
                : 'border-panel-800/60 bg-panel-900/40 opacity-40'
            }`}
          >
            {/* Play head: a green ring above the LED, as on the panel. */}
            <div
              className={`h-1 w-5 rounded-full ${
                play === i ? 'led-on bg-led-green text-led-green' : 'bg-panel-800'
              }`}
            />

            <div
              className={`h-4 w-4 rounded-full border ${
                on
                  ? 'led-on border-led-red/40 bg-led-red text-led-red'
                  : 'border-panel-700 bg-panel-900'
              }`}
            />

            {/* Write head, which can be offset from the play head. */}
            <div
              className={`h-1 w-5 rounded-full ${
                write === i ? 'led-on bg-led-amber text-led-amber' : 'bg-panel-800'
              }`}
            />

            <div className="font-mono text-[8px] leading-none text-panel-600">{i + 1}</div>

            {/* The two things the hardware cannot show you. */}
            <div className="font-mono text-[8px] leading-tight text-panel-400">
              {on ? `${seq.cvs[i] >= 0 ? '+' : ''}${seq.cvs[i].toFixed(1)}` : '·'}
            </div>
            <div className="font-mono text-[9px] font-semibold leading-none text-panel-200">
              {note !== null ? midiToNote(note) : ' '}
            </div>
          </button>
        )
      })}
    </div>
  )
}

interface SeqPanelProps {
  pattern: PatternState
  seqId: SeqId
  relStep: number
}

export function SeqPanel({ pattern, seqId, relStep }: SeqPanelProps) {
  const seq = seqId === 1 ? pattern.seq1 : pattern.seq2
  const { setCorrupt, setCvRange, setLength, setClockDiv, rotateBits, shiftWriteHead, setSeqMix } =
    useAppStore()
  const mix = useAppStore((s) => s.seqMix[seqId])

  return (
    <div className="rounded-lg border border-panel-800 bg-panel-900/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-panel-200">
          Seq {seqId}
        </h2>
        <div className="flex items-center gap-1.5">
          <PanelButton
            active={mix.mute}
            onClick={() => setSeqMix(seqId, { mute: !mix.mute })}
            title="Mute this sequencer"
          >
            Mute
          </PanelButton>
          <PanelButton onClick={() => rotateBits(seqId)} title="Rotate all bits one place right">
            Bit Shift
          </PanelButton>
          <PanelButton
            onClick={() => shiftWriteHead(seqId, 1)}
            title="Advance the write head relative to the play head"
          >
            Write +{seq.writeOffset}
          </PanelButton>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <BitRow pattern={pattern} seqId={seqId} relStep={relStep} />

        <div className="flex items-start gap-1">
          <Knob
            label="Corrupt"
            value={seq.corrupt}
            onChange={(v) => setCorrupt(seqId, v)}
            accent={seq.corrupt > 0.5 ? 'var(--color-led-red)' : 'var(--color-led-amber)'}
            format={(v) => (v === 0 ? 'lock' : `${Math.round(v * 100)}%`)}
          />
          <Knob
            label="CV Range"
            value={seq.cvRange}
            onChange={(v) => setCvRange(seqId, v)}
            format={(v) => `${(v * 5).toFixed(1)}oct`}
          />
          <Knob
            label="Length"
            value={seq.length}
            min={1}
            max={BITS_PER_SEQ}
            onChange={(v) => setLength(seqId, v)}
            format={(v) => String(Math.round(v))}
          />
          <Knob
            label="Clock ÷"
            value={seq.clockDiv}
            min={1}
            max={16}
            onChange={(v) => setClockDiv(seqId, v)}
            format={(v) => `÷${Math.round(v)}`}
          />
          <Knob
            label="Level"
            value={mix.volume}
            onChange={(v) => setSeqMix(seqId, { volume: v })}
            format={(v) => `${Math.round(v * 100)}`}
          />
        </div>
      </div>
    </div>
  )
}
