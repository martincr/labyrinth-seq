# Labyrinth Sequencer — design

*2026-08-08*

## Problem

The Moog Labyrinth is a generative instrument with a deliberate cruelty: two 8-bit sequencers whose
stored voltages and bit states mutate as CORRUPT is raised, and **exactly one memory slot**. Good
patterns drift away and cannot be recovered.

This project is a browser version of that dual generative sequencer that can export what it
generates as MIDI. The point is not to replicate the hardware's limits but to keep what it throws
away.

## The architectural insight

The sibling `mc-202` project already solved the hard part. Its `src/lib/prng.ts` is
*coordinate-addressed*: every random roll is a pure hash of `(seed, cycle, step)` rather than a draw
from a stateful stream, so "the scheduler, the visualizer and the exporter always agree".

Applying that to CORRUPT makes the entire mutation a pure function of `(seed, initialState, cycle)`.
For 8 bits that is trivially cheap to recompute, which buys three things the hardware cannot do:

1. **Rewind/scrub** the generative evolution.
2. **Snapshot at any point**, including points already drifted past.
3. An exported file that **provably matches what was auditioned**.

Everything else in the design follows from keeping that property intact — which is why the whole
sequencer core is pure functions with no audio and no React.

## Hardware behaviour being modelled

From the manual (pp. 11, 16, 35–38, 47):

- Two sequencers, SEQ1/SEQ2, **8 bits each**. The play head triggers on "on" bits.
- **Flipping a bit on stores a new random CV, −5V to +5V.** Off-then-on gives a *different* voltage;
  bits already on keep theirs.
- **LENGTH** 1–8 per sequencer, independently → polymeter. **BIT SHIFT** rotates right by one within
  the current length. **CHAIN SEQ** joins both into one 16-step sequence.
- The **write head** travels with the play head but can be offset (`BIT SHIFT + ADVANCE`). CORRUPT
  and BIT FLIP act at the *write* head.
- **CORRUPT**, per sequencer:
  - CCW → 12 o'clock: `P(CV re-roll)` ramps `0 → ~0.25`; bits never flip. Rhythm preserved, melody
    drifts.
  - 12 o'clock → CW: `P(CV re-roll)` ramps `0.25 → ~0.5`, **and** `P(bit flip)` ramps `0 → ~0.5`.
  - Fully CCW locks the pattern.
- **CV RANGE** attenuates the stored voltage before the quantizer. 1V/oct, so ±5V = ±5 octaves,
  bipolar around the tuned root.
- **Quantizer**: 16 modes, mode 1 = Unquantized.
- **EG TRIG MIX** balances which sequencer's triggers fire the envelopes — the velocity/accent
  mechanism. Full CCW = SEQ1 only; 12 o'clock = both equal; full CW = SEQ2 only.
- **Clock**: internal TEMPO, 24 PPQN MIDI clock, per-sequencer division 1–16.

## Scope

| Decision | Choice |
|---|---|
| Centre of gravity | Sequencer-first. The voice exists to audition; export is first-class. |
| MC-202 code | Copied in with origin comments, not a shared package. |
| Export | `.mid` first (two tracks). Ableton `.alc` deferred. |
| Audition voice | Labyrinth-flavoured, reusing the MC-202 audio architecture. |
| UI | Hardware-inspired, not a pixel replica. No patch bay in v1. |
| Capture | Seeded history (scrub/rewind) + unlimited named snapshots. |

## Modules

```
src/
  labyrinth/   state.ts  evolve.ts  pitch.ts  scales.ts  chain.ts   ← pure, fully tested
  audio/       audioContext.ts  scheduler.ts  labyrinthVoice.ts
  midi/        smf.ts  exportPattern.ts
  lib/         prng.ts  notes.ts  download.ts                       ← copied from mc-202
  store/       useAppStore.ts (Zustand + immer)  persistence.ts
  components/  BitRow  SeqPanel  Transport  VoicePanel  HistoryScrub  SnapshotBank  ExportPanel
```

The `labyrinth/` layer knows nothing about audio, React or the DOM. That boundary is what makes the
determinism guarantee testable.

## Core model

```ts
interface SeqState {
  bits: boolean[]      // 8
  cvs: number[]        // 8, volts −5..+5, meaningful where bits[i]
  length: number       // 1..8
  writeOffset: number  // write head offset from play head
  corrupt: number      // 0..1
  cvRange: number      // 0..1
  clockDiv: number     // 1..16
}

interface PatternState {
  seq1: SeqState; seq2: SeqState
  chained: boolean; chainOffset: number
  quantMode: number    // 0..15, 0 = Unquantized
  rootMidi: number
  egTrigMix: number    // 0..1
  seed: number
}
```

### Evolution

```ts
export function stepOnce(s: SeqState, seed: number, seqId: 1 | 2, absStep: number): SeqState
export function evolveTo(initial: PatternState, cycle: number): PatternState
```

Every roll is `randomAt(seed, seqId, absStep, salt)` with distinct salts for the bit-flip and CV
rolls. A new CV is `randomAt(...) * 10 - 5`. Because this is a fold rather than a stream, the scrub
bar is just `evolveTo(initial, n)`.

```
cvChanceP = corrupt <= 0.5 ? corrupt * 0.5 : 0.25 + (corrupt - 0.5) * 0.5
bitFlipP  = corrupt <= 0.5 ? 0             :        (corrupt - 0.5) * 1.0
```

### CV → pitch

```
semitones = cv * cvRange * 12        // 1V/oct; ±5V × 12 = ±60 = ±5 octaves
midi      = clamp(round(rootMidi + semitones), 0, 127)
pitch     = quantMode === 0 ? midi : snapMidiToScale(midi, rootMidi % 12, intervals[quantMode])
```

Bipolar around the root, matching the manual: "the sequencer voltages will spread in a bipolar
fashion with the root note you tuned in the center".

### Velocity

```
gain1 = clamp((1 - egTrigMix) * 2, 0, 1)
gain2 = clamp(egTrigMix * 2, 0, 1)
```

Equal at 0.5, sole-source at the extremes; mapped onto MIDI velocity 20–127.

### Clock

One 96-PPQN master counter; each sequencer consumes it at its own `clockDiv`. One clock, not two —
separate schedulers drift apart over exactly the multi-bar spans polymeter exists to demonstrate.

## Audition voice

```
VCO (sine)      ─┬─────────────────┐
MOD VCO (tri) ───┤                 │        ┌→ VCW (wavefolder) → VCA(EG2) ─┐
RING MOD ────────┼→ saturating mix ─┤────────┤                              ├→ BLEND → out
NOISE (tone) ────┘                          └→ VCF (LP↔BP morph) → VCA(EG2) ┘
```

- Wavefolder: `WaveShaperNode` with a triangular fold curve; FOLD drives into it, BIAS is a DC
  offset before folding.
- Saturating mixer: `WaveShaperNode`, tanh curve.
- Ring mod: `GainNode` with `gain.value = 0` and the modulator connected to the `gain` AudioParam.
- LP↔BP morph: two `BiquadFilterNode`s crossfaded (a real SVF is not worth an AudioWorklet here).
- EG1/EG2 are decay-only.
- `ORDER` (parallel / VCW→VCF / VCF→VCW) is a routing switch over the same nodes.

## Known lossy edges

- **Unquantized → MIDI.** True unquantized CV is continuous; MIDI notes are not. v1 rounds to the
  nearest semitone on export and says so in the UI. Pitch-bend is a later refinement.
- **Two scales in the manual's table are ambiguous** — *Diminished 6th* and *Hang Drum Tuning*. The
  chosen intervals are documented in `src/labyrinth/scales.ts` and flagged as a guess.

## Verification

Vitest over the pure layer:

- `evolveTo(initial, n)` is deterministic and equals an incremental fold of `stepOnce`.
- `corrupt === 0` never mutates; `corrupt <= 0.5` never flips a bit.
- BIT SHIFT rotates only within LENGTH; `BIT SHIFT + RESET` restores the original rotation.
- `cvRange = 0` collapses to the root; ±5V at `cvRange = 1` gives ±60 semitones.
- Lengths 5 and 8 produce a 40-step combined loop.
- Exported bytes parse back correctly with `@tonejs/midi`.
- Exported notes equal what the scheduler would fire for the same `(seed, cycle)`.
