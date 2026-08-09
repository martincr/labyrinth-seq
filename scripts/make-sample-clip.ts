// Writes a pair of example .alc clips so the export can be checked in Live
// without clicking through the app. Not part of the build.
//
// Run: npm run sample:clip

import { writeFileSync } from 'node:fs'
import { exportAbletonClip } from '../src/ableton/exportClip.ts'
import { makePattern, makeSeq } from '../src/labyrinth/state.ts'

const pattern = makePattern({
  seq1: makeSeq({
    bits: [true, false, true, false, true, true, false, false],
    cvs: [0, 0, 1.2, 0, -0.8, 0.5, 0, 0],
    cvRange: 0.25,
  }),
  seq2: makeSeq({
    bits: [false, true, false, false, false, false, true, false],
    cvs: [0, -1.5, 0, 0, 0, 0, 2.2, 0],
    cvRange: 0.25,
    clockDiv: 2,
  }),
  quantMode: 12, // Minor 7th
  rootMidi: 48, // C2
  seed: 1234,
})

for (const seqId of [1, 2] as const) {
  const bytes = await exportAbletonClip(pattern, seqId, { steps: 32, gateFraction: 0.5 })
  const name = `Labyrinth-sample-SEQ${seqId}.alc`
  writeFileSync(name, bytes)
  console.log(`wrote ${name} (${bytes.length} bytes)`)
}
