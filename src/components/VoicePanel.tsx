import type { FilterOrder } from '../audio/labyrinthVoice.ts'
import { useAppStore } from '../store/useAppStore.ts'
import { Knob, PanelButton, Section } from './controls.tsx'

const ORDERS: { value: FilterOrder; label: string }[] = [
  { value: 'parallel', label: 'Parallel' },
  { value: 'vcw-vcf', label: 'VCW→VCF' },
  { value: 'vcf-vcw', label: 'VCF→VCW' },
]

export function VoicePanel() {
  const voice = useAppStore((s) => s.voice)
  const setVoice = useAppStore((s) => s.setVoice)
  const masterVolume = useAppStore((s) => s.masterVolume)
  const setMasterVolume = useAppStore((s) => s.setMasterVolume)

  return (
    <Section title="Voice">
      <div className="flex flex-wrap gap-x-1 gap-y-3">
        <Group label="Oscillators">
          <Knob label="VCO" value={voice.vcoLevel} onChange={(v) => setVoice({ vcoLevel: v })} />
          <Knob
            label="Mod VCO"
            value={voice.modVcoLevel}
            onChange={(v) => setVoice({ modVcoLevel: v })}
          />
          <Knob
            label="M Freq"
            value={voice.modVcoFreq}
            min={0.2}
            max={1300}
            onChange={(v) => setVoice({ modVcoFreq: v })}
            format={(v) => (v < 20 ? `${v.toFixed(1)}` : `${Math.round(v)}`)}
          />
          <Knob
            label="M→VCO FM"
            value={voice.modToVcoFm}
            onChange={(v) => setVoice({ modToVcoFm: v })}
          />
          <Knob
            label="Ring"
            value={voice.ringModLevel}
            onChange={(v) => setVoice({ ringModLevel: v })}
          />
          <Knob
            label="Noise"
            value={voice.noiseLevel}
            onChange={(v) => setVoice({ noiseLevel: v })}
          />
          <Knob
            label="N Tone"
            value={voice.noiseTone}
            onChange={(v) => setVoice({ noiseTone: v })}
          />
        </Group>

        <Group label="Wavefolder">
          <Knob
            label="Fold"
            value={voice.fold}
            onChange={(v) => setVoice({ fold: v })}
            accent="var(--color-led-red)"
          />
          <Knob
            label="Bias"
            value={voice.bias}
            min={-1}
            max={1}
            bipolar
            onChange={(v) => setVoice({ bias: v })}
            format={(v) => v.toFixed(2)}
          />
        </Group>

        <Group label="Filter">
          <Knob label="Cutoff" value={voice.cutoff} onChange={(v) => setVoice({ cutoff: v })} />
          <Knob
            label="Reso"
            value={voice.resonance}
            onChange={(v) => setVoice({ resonance: v })}
          />
          <Knob
            label="Mode"
            value={voice.filterMode}
            onChange={(v) => setVoice({ filterMode: v })}
            format={(v) => (v < 0.5 ? 'LP' : 'BP')}
          />
        </Group>

        <Group label="Blend / Envelopes">
          <Knob
            label="Blend"
            value={voice.blend}
            onChange={(v) => setVoice({ blend: v })}
            format={(v) => (v < 0.5 ? 'VCW' : 'VCF')}
            accent="var(--color-led-green)"
          />
          <Knob
            label="EG1 Dec"
            value={voice.eg1Decay}
            min={0.01}
            max={3}
            onChange={(v) => setVoice({ eg1Decay: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Knob
            label="EG2 Dec"
            value={voice.eg2Decay}
            min={0.01}
            max={3}
            onChange={(v) => setVoice({ eg2Decay: v })}
            format={(v) => `${v.toFixed(2)}s`}
          />
          <Knob
            label="Volume"
            value={masterVolume}
            onChange={setMasterVolume}
            format={(v) => `${Math.round(v * 100)}`}
          />
        </Group>

        <Group label="EG1 Amounts">
          <Knob
            label="→ VCO"
            value={voice.eg1ToVco}
            min={-1}
            max={1}
            bipolar
            onChange={(v) => setVoice({ eg1ToVco: v })}
            format={(v) => v.toFixed(2)}
          />
          <Knob
            label="→ M VCO"
            value={voice.eg1ToModVco}
            min={-1}
            max={1}
            bipolar
            onChange={(v) => setVoice({ eg1ToModVco: v })}
            format={(v) => v.toFixed(2)}
          />
          <Knob
            label="→ Fold"
            value={voice.eg1ToFold}
            min={-1}
            max={1}
            bipolar
            onChange={(v) => setVoice({ eg1ToFold: v })}
            format={(v) => v.toFixed(2)}
          />
          <Knob
            label="→ Cutoff"
            value={voice.eg1ToCutoff}
            min={-1}
            max={1}
            bipolar
            onChange={(v) => setVoice({ eg1ToCutoff: v })}
            format={(v) => v.toFixed(2)}
          />
        </Group>

        <Group label="Order">
          <div className="flex flex-col gap-1">
            {ORDERS.map((o) => (
              <PanelButton
                key={o.value}
                active={voice.order === o.value}
                onClick={() => setVoice({ order: o.value })}
              >
                {o.label}
              </PanelButton>
            ))}
          </div>
        </Group>
      </div>
    </Section>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded border border-panel-800/70 px-2 py-1.5">
      <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-panel-600">
        {label}
      </span>
      <div className="flex items-start gap-0.5">{children}</div>
    </div>
  )
}
