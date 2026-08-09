import { ExportPanel } from './components/ExportPanel.tsx'
import { SeqPanel } from './components/SeqPanel.tsx'
import { SnapshotBank } from './components/SnapshotBank.tsx'
import { HistoryScrub, Transport } from './components/Transport.tsx'
import { VoicePanel } from './components/VoicePanel.tsx'
import { useCurrentPattern } from './hooks/useCurrentPattern.ts'
import { useTransport } from './hooks/useTransport.ts'

export default function App() {
  useTransport()

  // The pattern is derived, never stored: what the bit rows draw is the same
  // evolveTo the scheduler and the exporter call.
  const { pattern, relStep } = useCurrentPattern()

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-3 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-bold tracking-[0.3em] text-panel-200">
          LABYRINTH
        </h1>
        <p className="font-mono text-[10px] tracking-wide text-panel-600">
          parallel generative sequencer · exports what the hardware forgets
        </p>
      </header>

      <Transport />

      <SeqPanel pattern={pattern} seqId={1} relStep={relStep} />
      <SeqPanel pattern={pattern} seqId={2} relStep={relStep} />

      <HistoryScrub />

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <ExportPanel />
        <SnapshotBank />
      </div>

      <VoicePanel />

      <footer className="pb-6 font-mono text-[9px] leading-relaxed text-panel-600">
        Quantizer modes marked * are the two the manual names but does not spell out —
        see <code className="text-panel-400">src/labyrinth/scales.ts</code>.
      </footer>
    </main>
  )
}
