# Labyrinth — browser generative sequencer

A browser version of the [Moog Labyrinth](https://www.moogmusic.com/)'s dual generative sequencer,
with MIDI export.

The hardware is a generative instrument with a deliberate cruelty: two 8-bit sequencers whose stored
voltages and bit states mutate as CORRUPT is raised, and **exactly one memory slot**. Good patterns
drift away and cannot be recovered. This exists to keep what it throws away.

## The idea

On the hardware, CORRUPT is a stateful random walk — whatever the dice say is gone forever. Here
every roll is instead a hash of its coordinates, `(seed, sequencer, step)`, borrowed from the
sibling `mc-202` project's coordinate-addressed PRNG. Nothing is drawn from a stream, so the state
after N steps is a pure function of `(initial, seed, N)`.

Three things follow from that:

- **Rewind.** Past states are recomputable, so the scrub bar can go back to a pattern that already
  drifted away.
- **Snapshot anything.** Including a moment you have already played past.
- **Exports match what you heard.** The exporter and the scheduler call the same `evolveTo` and
  `noteAt`, so the file is the same computation, not a reconstruction of it. There is a test that
  asserts this directly, mid-mutation.

## What it models

Two 8-bit sequencers, each bit storing a random −5V..+5V when flipped on. Independent LENGTH (1–8)
for polymeter, BIT SHIFT, CHAIN, an offsettable write head, per-sequencer clock division, the
16-mode quantizer, CV RANGE, and EG TRIG MIX as the velocity mechanism.

CORRUPT follows the manual's two zones: below 12 o'clock only voltages drift, so the rhythm
survives while the melody moves; above it, bits start flipping too.

The audition voice is Labyrinth-flavoured rather than a faithful model — sine VCO and triangle MOD
VCO with ring mod and noise into a saturating mixer, then a wavefolder and an LP→BP filter in
parallel, crossfaded by BLEND. Approximations are documented at the top of
`src/audio/labyrinthVoice.ts`.

## Running it

```sh
npm install
npm run dev     # http://localhost:5173
npm run test    # 152 tests over the pure layer
npm run build   # typecheck + production build
npm run lint
```

Tests cover the sequencer, pitch, scales, chaining, timing and export — everything that has no DOM.
Exported bytes are verified by parsing them back with `@tonejs/midi`. The audio and React layers are
checked by driving the app in a browser.

## Layout

```
src/
  labyrinth/   state, evolve, pitch, scales, chain, heads, timing   ← pure, fully tested
  audio/       audioContext, scheduler, labyrinthVoice
  midi/        smf (copied), exportPattern
  lib/         prng, notes, download                                ← copied from mc-202
  store/       useAppStore (Zustand + immer), persistence
  components/  transport, sequencer panels, voice, snapshots, export
```

`labyrinth/` knows nothing about audio, React or the DOM. That boundary is what makes the
determinism guarantee testable.

## Known rough edges

- **Unquantized → MIDI is lossy.** Continuous CV has no MIDI equivalent, so export rounds to the
  nearest semitone and the UI says so. Pitch bend would fix it.
- **Two quantizer scales are guesses.** The manual names *Diminished 6th* and *Hang Drum Tuning*
  without spelling them out. Both are marked `assumed` in `src/labyrinth/scales.ts` and flagged with
  an asterisk in the UI. Worth checking against hardware.

## Ableton clip export

`.alc` is gzipped Live XML — a miniature LiveSet holding one track and one clip. Rather than
authoring that from scratch, the exporter starts from `templates/Labyrinth.alc`, a real empty clip
exported from Live 12.4.3, and fills in the notes and the loop length.

The edits are targeted string replacement rather than a DOM round-trip, so the other 59kB of the
document stays byte-identical to what Live wrote — a serializer would be free to renormalise
attribute order, self-closing tags and whitespace, and there is no way to know which of those Live
cares about. A test asserts that byte-identity directly.

Two details the donor forced:

- The donor's clip referenced a **swing groove** in its GroovePool. Left alone, every exported
  pattern would have arrived in Live already swung, so the exporter detaches it (`GrooveId` `-1`).
- The GroovePool contains a second `MidiClip` with its own loop markers and id generator, so every
  edit is scoped to the clip around the unique empty `<KeyTracks />` anchor.

A `.alc` holds one clip, so the two sequencers export separately; the `.mid` carries both as two
tracks. To regenerate the embedded template after replacing the donor:

```sh
npm run build:clip-template
npm run sample:clip          # writes two example clips to drag into Live
```
