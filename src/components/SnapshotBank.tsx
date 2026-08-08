import { useState } from 'react'
import { useAppStore } from '../store/useAppStore.ts'
import { PanelButton, Section } from './controls.tsx'

/**
 * The thing the hardware cannot do.
 *
 * The Labyrinth has one BUFFER slot; hold it and you overwrite whatever was
 * there. Since every state here is recomputable from its seed, a snapshot is
 * just a captured PatternState and there is no reason to have only one.
 */
export function SnapshotBank() {
  const { snapshots, saveSnapshot, loadSnapshot, deleteSnapshot } = useAppStore()
  const [name, setName] = useState('')

  return (
    <Section title={`Snapshots (${snapshots.length})`}>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          saveSnapshot(name)
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name this one"
          className="min-w-0 flex-1 rounded border border-panel-700 bg-panel-800 px-2 py-1 font-mono text-[11px] text-panel-200 outline-none placeholder:text-panel-600 focus:border-led-amber/60"
        />
        <PanelButton>Save</PanelButton>
      </form>

      {snapshots.length === 0 ? (
        <p className="font-mono text-[9px] text-panel-600">
          Nothing kept yet. The hardware would have lost it by now.
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {snapshots.map((snap) => (
            <li
              key={snap.id}
              className="flex items-center gap-2 rounded border border-panel-800 bg-panel-800/50 px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-panel-200">
                {snap.name}
              </span>
              <span className="shrink-0 font-mono text-[9px] text-panel-600">
                seed {snap.pattern.seed}
              </span>
              <PanelButton onClick={() => loadSnapshot(snap.id)}>Load</PanelButton>
              <PanelButton onClick={() => deleteSnapshot(snap.id)}>×</PanelButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
