import { getAudioContext } from '../audio/audioContext.ts'
import { midiToNote } from '../lib/notes.ts'
import { QUANT_MODES } from '../labyrinth/scales.ts'
import { loopLengthSteps } from '../labyrinth/state.ts'
import { STEPS_PER_BAR } from '../labyrinth/timing.ts'
import { useAppStore } from '../store/useAppStore.ts'
import { Knob, PanelButton, Section, Select } from './controls.tsx'

export function Transport() {
  const { isPlaying, bpm, setBpm, setPlaying, lock, clearAll, reseed } = useAppStore()
  const pattern = useAppStore((s) => s.pattern)
  const drifting = pattern.seq1.corrupt > 0 || pattern.seq2.corrupt > 0

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-panel-800 bg-panel-900/70 p-3">
      <button
        type="button"
        onClick={() => {
          // Create/resume the context inside the click itself. Deferring to the
          // effect that starts the transport puts it a paint away from the
          // gesture, which browsers may refuse to unmute.
          getAudioContext()
          setPlaying(!isPlaying)
        }}
        className={`no-select h-12 w-12 rounded-full border-2 transition-colors ${
          isPlaying
            ? 'led-on border-led-green/50 bg-led-green/20 text-led-green'
            : 'border-panel-600 bg-panel-800 text-panel-400 hover:border-panel-400'
        }`}
        title="Run / Stop"
      >
        <span className="font-mono text-[9px] uppercase">{isPlaying ? 'Stop' : 'Run'}</span>
      </button>

      <Knob
        label="Tempo"
        value={bpm}
        min={40}
        max={220}
        onChange={(v) => setBpm(Math.round(v))}
        size={52}
        format={(v) => `${Math.round(v)}`}
      />

      <div className="flex flex-col gap-1.5">
        <PanelButton
          onClick={lock}
          active={!drifting}
          title="Fix what you are hearing now and stop it drifting"
        >
          {drifting ? 'Lock pattern' : 'Locked'}
        </PanelButton>
        <PanelButton onClick={() => reseed()} title="A different evolution from the same pattern">
          Reseed
        </PanelButton>
      </div>

      <PanelButton onClick={clearAll} title="Clear both sequencers">
        Clear
      </PanelButton>

      <div className="ml-auto flex items-end gap-3">
        <Select
          label="Quantize"
          value={pattern.quantMode}
          onChange={useAppStore.getState().setQuantMode}
          options={QUANT_MODES.map((m, i) => ({
            value: i,
            label: `${String(i + 1).padStart(2, '0')} ${m.name}${m.assumed ? ' *' : ''}`,
          }))}
        />
        <Knob
          label="Root"
          value={pattern.rootMidi}
          min={24}
          max={84}
          onChange={(v) => useAppStore.getState().setRootMidi(v)}
          format={(v) => midiToNote(Math.round(v))}
        />
        <Knob
          label="EG Trig Mix"
          value={pattern.egTrigMix}
          onChange={useAppStore.getState().setEgTrigMix}
          bipolar
          format={(v) => (v < 0.5 ? `S1 ${Math.round((1 - v * 2) * 100)}` : v > 0.5 ? `S2 ${Math.round((v * 2 - 1) * 100)}` : 'even')}
        />
        <div className="flex flex-col gap-1.5">
          <PanelButton
            active={pattern.chained}
            onClick={() => useAppStore.getState().setChained(!pattern.chained)}
            title="Join both sequencers into one shared sequence"
          >
            Chain
          </PanelButton>
          {pattern.chained && (
            <PanelButton
              onClick={() => useAppStore.getState().setChainOffset(pattern.chainOffset + 1)}
              title="Offset SEQ2's play head within the chain"
            >
              Offset {pattern.chainOffset}
            </PanelButton>
          )}
        </div>
      </div>

      <div className="w-full font-mono text-[10px] text-panel-600">
        {drifting ? (
          <>Drifting — no loop point. Lock, or keep a snapshot, to hold onto it.</>
        ) : (
          <>
            Locked — repeats every {loopLengthSteps(pattern)} steps
            {' ('}
            {(loopLengthSteps(pattern) / STEPS_PER_BAR).toFixed(2)} bars{')'}
          </>
        )}
      </div>
    </div>
  )
}

export function HistoryScrub() {
  const { step, originStep, reachedStep, setStep, isPlaying, saveSnapshot } = useAppStore()
  const span = Math.max(1, reachedStep - originStep)

  return (
    <Section title="History">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={originStep}
          max={Math.max(originStep + 1, reachedStep)}
          value={step}
          disabled={isPlaying}
          onChange={(e) => setStep(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-panel-800 accent-led-amber disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="w-28 shrink-0 font-mono text-[10px] text-panel-400">
          step {step - originStep} / {span}
        </div>
        <PanelButton
          onClick={() => saveSnapshot('')}
          title="Save the pattern exactly as it stands at this point"
        >
          Keep this
        </PanelButton>
      </div>
      <p className="mt-2 font-mono text-[9px] leading-relaxed text-panel-600">
        {isPlaying
          ? 'Stop the transport to scrub back through the mutation.'
          : 'Every state is recomputed from the seed, so you can go back to one that already drifted past.'}
      </p>
    </Section>
  )
}
