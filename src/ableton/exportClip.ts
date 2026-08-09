// Ableton Live Clip (.alc) export.
//
// A .alc is gzipped Live XML: a miniature LiveSet holding one track with one
// clip. Rather than authoring that from scratch — Live is unforgiving about
// missing elements, and `auto_create_session_clips` in the ableton-arrangement
// skill clones a donor clip for exactly this reason — we start from a real
// empty clip exported from Live and fill it in.
//
// The edits are done as targeted string replacement rather than a DOM
// round-trip. Every anchor is verified unique, and the result is that the other
// 59kB of the document stays byte-identical to what Live itself wrote, which is
// the safest possible outcome for a format this fussy. A serializer would be
// free to renormalise attribute order, self-closing tags and whitespace, and we
// would have no way to tell which of those Live cares about.
//
// Live measures clip time in BEATS, not ticks — no PPQ is involved once the
// notes are in here.

import { PPQ } from '../labyrinth/timing.ts'
import type { PatternState, SeqId } from '../labyrinth/state.ts'
import type { SmfNote } from '../midi/smf.ts'
import { collectNotes, defaultExportSteps } from '../midi/exportPattern.ts'

const KEY_TRACKS_ANCHOR = '<KeyTracks />'
const CLIP_OPEN = '<MidiClip '
const CLIP_CLOSE = '</MidiClip>'

export interface ClipExportOptions {
  steps?: number
  gateFraction?: number
  name?: string
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Live writes plain decimals; avoid exponent notation for very short gates. */
function num(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Notes as `<KeyTrack>` elements, one per pitch.
 *
 * Live groups notes by pitch rather than listing them in time order, with the
 * pitch itself in a `<MidiKey>` *after* the `<Notes>` block. Every KeyTrack Id
 * has to be unique across the document, and every NoteId unique within the
 * clip, so both are allocated from a base the caller advances.
 */
export function buildKeyTracks(notes: SmfNote[], firstKeyTrackId: number): string {
  const byPitch = new Map<number, SmfNote[]>()
  for (const note of notes) {
    const list = byPitch.get(note.note)
    if (list) list.push(note)
    else byPitch.set(note.note, [note])
  }

  let keyTrackId = firstKeyTrackId
  let noteId = 1
  const out: string[] = []

  for (const pitch of [...byPitch.keys()].sort((a, b) => a - b)) {
    const events = byPitch
      .get(pitch)!
      .slice()
      .sort((a, b) => a.tick - b.tick)
      .map((n) => {
        const time = num(n.tick / PPQ)
        const duration = num(n.durationTicks / PPQ)
        return `<MidiNoteEvent Time="${time}" Duration="${duration}" Velocity="${n.velocity}" OffVelocity="64" NoteId="${noteId++}" />`
      })
      .join('')

    out.push(
      `<KeyTrack Id="${keyTrackId++}"><Notes>${events}</Notes><MidiKey Value="${pitch}" /></KeyTrack>`,
    )
  }

  return out.join('')
}

/** Replace `<Tag Value="..." />` for one tag, within a slice, once. */
function setValue(xml: string, tag: string, value: string): string {
  const pattern = new RegExp(`<${tag} Value="[^"]*" />`)
  if (!pattern.test(xml)) throw new Error(`Could not find <${tag} Value=…> to set`)
  return xml.replace(pattern, `<${tag} Value="${value}" />`)
}

/**
 * Fill the donor's empty clip with `notes` and return the whole document.
 *
 * Exported separately from the gzip step so it can be read, diffed and tested
 * as text.
 */
export function buildClipXml(
  templateXml: string,
  notes: SmfNote[],
  lengthBeats: number,
  name: string,
): string {
  const anchor = templateXml.indexOf(KEY_TRACKS_ANCHOR)
  if (anchor === -1) throw new Error('Donor template has no empty <KeyTracks /> to fill')
  if (templateXml.indexOf(KEY_TRACKS_ANCHOR, anchor + 1) !== -1) {
    throw new Error('Donor template has more than one empty <KeyTracks />; cannot pick a clip')
  }

  // Scope every other edit to the enclosing clip. The donor also carries a
  // groove in its GroovePool, which is itself a MidiClip with its own loop
  // markers and NoteIdGenerator — editing document-wide would corrupt it.
  const start = templateXml.lastIndexOf(CLIP_OPEN, anchor)
  const end = templateXml.indexOf(CLIP_CLOSE, anchor)
  if (start === -1 || end === -1) throw new Error('Could not locate the clip around <KeyTracks />')
  const clipEnd = end + CLIP_CLOSE.length

  const head = templateXml.slice(0, start)
  const tail = templateXml.slice(clipEnd)

  // Allocate ids above everything the donor already uses.
  const nextPointee = Number(/<NextPointeeId Value="(\d+)" \/>/.exec(templateXml)?.[1] ?? 1000)
  const pitches = new Set(notes.map((n) => n.note)).size

  let clip = templateXml.slice(start, clipEnd)
  clip = clip.replace(
    KEY_TRACKS_ANCHOR,
    `<KeyTracks>${buildKeyTracks(notes, nextPointee)}</KeyTracks>`,
  )

  const beats = num(Math.max(0.25, lengthBeats))
  clip = setValue(clip, 'CurrentEnd', beats)
  clip = setValue(clip, 'LoopEnd', beats)
  clip = setValue(clip, 'OutMarker', beats)
  clip = setValue(clip, 'HiddenLoopEnd', beats)
  clip = setValue(clip, 'Name', escapeXml(name))
  // The donor's clip references a swing groove in the pool. Left alone, every
  // exported pattern would arrive in Live already swung.
  clip = setValue(clip, 'GrooveId', '-1')
  clip = clip.replace(
    /<NoteIdGenerator>\s*<NextId Value="\d+" \/>\s*<\/NoteIdGenerator>/,
    `<NoteIdGenerator><NextId Value="${notes.length + 1}" /></NoteIdGenerator>`,
  )

  const document = head + clip + tail
  return document.replace(
    /<NextPointeeId Value="\d+" \/>/,
    `<NextPointeeId Value="${nextPointee + pitches + 1}" />`,
  )
}

// The explicit ArrayBuffer parameter keeps Blob and friends happy downstream —
// a bare Uint8Array might be backed by a SharedArrayBuffer as far as the types
// are concerned, and BlobPart rejects that.
async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  // CompressionStream is in every current browser and in Node 18+, so the
  // gzip half of pako is not worth a dependency.
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function exportAbletonClip(
  pattern: PatternState,
  seqId: SeqId,
  options: ClipExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const { CLIP_TEMPLATE_XML } = await import('./clipTemplate.ts')
  const steps = options.steps ?? defaultExportSteps(pattern)
  const notes = collectNotes(pattern, steps, options.gateFraction ?? 0.5)[seqId]
  const name = options.name ?? `Labyrinth SEQ${seqId}`
  // One master step is a sixteenth, so four to the beat.
  return gzip(buildClipXml(CLIP_TEMPLATE_XML, notes, steps / 4, name))
}

export function clipFilename(pattern: PatternState, seqId: SeqId): string {
  return `Labyrinth-${pattern.seed}-SEQ${seqId}.alc`
}
