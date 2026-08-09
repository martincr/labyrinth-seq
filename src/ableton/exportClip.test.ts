import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { makePattern, makeSeq } from '../labyrinth/state.ts'
import type { SmfNote } from '../midi/smf.ts'
import { CLIP_TEMPLATE_XML } from './clipTemplate.ts'
import { buildClipXml, buildKeyTracks, clipFilename, exportAbletonClip } from './exportClip.ts'

function note(over: Partial<SmfNote> = {}): SmfNote {
  return { tick: 0, durationTicks: 48, note: 60, velocity: 100, channel: 1, ...over }
}

/** xmldom is here to *check* the output, never to produce it. */
function parse(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml')
}

/** Decompress with the same web API the exporter compresses with, rather than
 *  node:zlib — it keeps node types out of the app's tsconfig and exercises the
 *  path the browser actually takes. */
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function targetClip(doc: ReturnType<typeof parse>) {
  // The clip we filled is the one whose KeyTracks has children; the other
  // MidiClip in the donor is the groove.
  const clips = [...doc.getElementsByTagName('MidiClip')]
  return clips.find((c) => c.getElementsByTagName('KeyTrack').length > 0)
}

function grooveClip(doc: ReturnType<typeof parse>) {
  const pool = doc.getElementsByTagName('GroovePool')[0]
  return pool?.getElementsByTagName('MidiClip')[0]
}

describe('buildKeyTracks', () => {
  it('groups notes by pitch', () => {
    const xml = buildKeyTracks(
      [note({ note: 60 }), note({ note: 64, tick: 24 }), note({ note: 60, tick: 48 })],
      500,
    )
    expect(xml.match(/<KeyTrack /g)).toHaveLength(2)
    expect(xml).toContain('<MidiKey Value="60" />')
    expect(xml).toContain('<MidiKey Value="64" />')
  })

  it('puts MidiKey after the notes, as Live does', () => {
    const xml = buildKeyTracks([note()], 500)
    expect(xml.indexOf('</Notes>')).toBeLessThan(xml.indexOf('<MidiKey'))
  })

  it('converts ticks to beats', () => {
    // PPQ 96, so a 24-tick sixteenth is 0.25 beats and 48 ticks is half a beat.
    const xml = buildKeyTracks([note({ tick: 24, durationTicks: 48 })], 500)
    expect(xml).toContain('Time="0.25"')
    expect(xml).toContain('Duration="0.5"')
  })

  it('gives every note a unique NoteId and every pitch a unique KeyTrack Id', () => {
    const notes = [60, 64, 67, 60, 64].map((n, i) => note({ note: n, tick: i * 24 }))
    const xml = buildKeyTracks(notes, 500)
    const noteIds = [...xml.matchAll(/NoteId="(\d+)"/g)].map((m) => m[1])
    const trackIds = [...xml.matchAll(/<KeyTrack Id="(\d+)"/g)].map((m) => m[1])
    expect(new Set(noteIds).size).toBe(notes.length)
    expect(new Set(trackIds).size).toBe(3)
    expect(trackIds).toEqual(['500', '501', '502'])
  })

  it('orders each pitch by time', () => {
    const xml = buildKeyTracks([note({ tick: 96 }), note({ tick: 0 }), note({ tick: 48 })], 500)
    const times = [...xml.matchAll(/Time="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('writes plain decimals rather than exponent notation', () => {
    const xml = buildKeyTracks([note({ durationTicks: 1 })], 500)
    expect(xml).not.toMatch(/[eE]-/)
  })

  it('produces nothing for no notes', () => {
    expect(buildKeyTracks([], 500)).toBe('')
  })
})

describe('buildClipXml', () => {
  const notes = [
    note({ tick: 0, note: 60 }),
    note({ tick: 24, note: 63 }),
    note({ tick: 48, note: 67 }),
  ]
  const xml = buildClipXml(CLIP_TEMPLATE_XML, notes, 4, 'Test Clip')

  it('is well-formed XML with an Ableton root', () => {
    const doc = parse(xml)
    expect(doc.documentElement?.nodeName).toBe('Ableton')
  })

  it('fills the empty clip rather than the groove', () => {
    const doc = parse(xml)
    const clip = targetClip(doc)
    expect(clip).toBeDefined()
    expect(clip!.getElementsByTagName('MidiNoteEvent')).toHaveLength(3)
  })

  it('leaves the groove clip in the pool untouched', () => {
    const before = parse(CLIP_TEMPLATE_XML)
    const after = parse(xml)
    const a = grooveClip(before)!
    const b = grooveClip(after)!
    expect(b.getElementsByTagName('MidiNoteEvent').length).toBe(
      a.getElementsByTagName('MidiNoteEvent').length,
    )
    expect(b.getElementsByTagName('MidiKey')[0]?.getAttribute('Value')).toBe(
      a.getElementsByTagName('MidiKey')[0]?.getAttribute('Value'),
    )
  })

  it('detaches the clip from the donor\'s swing groove', () => {
    // Otherwise every exported pattern arrives in Live already swung.
    const clip = targetClip(parse(xml))!
    const groove = clip.getElementsByTagName('GrooveId')[0]
    expect(groove?.getAttribute('Value')).toBe('-1')
    expect(CLIP_TEMPLATE_XML).toContain('<GrooveId Value="0" />')
  })

  it('sets every loop marker to the requested length', () => {
    const clip = targetClip(parse(xml))!
    for (const tag of ['CurrentEnd', 'LoopEnd', 'OutMarker', 'HiddenLoopEnd']) {
      expect(clip.getElementsByTagName(tag)[0]?.getAttribute('Value')).toBe('4')
    }
    expect(clip.getElementsByTagName('LoopStart')[0]?.getAttribute('Value')).toBe('0')
    expect(clip.getElementsByTagName('LoopOn')[0]?.getAttribute('Value')).toBe('true')
  })

  it('names the clip and escapes the name', () => {
    const clip = targetClip(parse(buildClipXml(CLIP_TEMPLATE_XML, notes, 4, 'A & B <x>')))!
    expect(clip.getElementsByTagName('Name')[0]?.getAttribute('Value')).toBe('A & B <x>')
  })

  it('advances NextPointeeId past the KeyTrack ids it allocated', () => {
    const before = Number(/<NextPointeeId Value="(\d+)"/.exec(CLIP_TEMPLATE_XML)![1])
    const after = Number(/<NextPointeeId Value="(\d+)"/.exec(xml)![1])
    expect(after).toBeGreaterThan(before + 2) // three distinct pitches
  })

  it('advances the clip\'s NoteId generator', () => {
    const clip = targetClip(parse(xml))!
    const gen = clip.getElementsByTagName('NoteIdGenerator')[0]
    expect(gen?.getElementsByTagName('NextId')[0]?.getAttribute('Value')).toBe('4')
  })

  it('changes nothing outside the clip it fills', () => {
    // The strongest guarantee available: everything before the clip and after
    // it is byte-identical to the file Live wrote, bar the id counter.
    const anchor = CLIP_TEMPLATE_XML.indexOf('<KeyTracks />')
    const start = CLIP_TEMPLATE_XML.lastIndexOf('<MidiClip ', anchor)
    const normalise = (s: string) => s.replace(/<NextPointeeId Value="\d+" \/>/, '')
    expect(normalise(xml.slice(0, start))).toBe(normalise(CLIP_TEMPLATE_XML.slice(0, start)))
    const tailFrom = (s: string) => s.slice(s.indexOf('</MidiClip>', s.indexOf('<KeyTrack')))
    expect(tailFrom(xml)).toBe(
      CLIP_TEMPLATE_XML.slice(CLIP_TEMPLATE_XML.indexOf('</MidiClip>', anchor)),
    )
  })

  it('still produces a valid clip with no notes', () => {
    const empty = buildClipXml(CLIP_TEMPLATE_XML, [], 4, 'Empty')
    expect(parse(empty).documentElement?.nodeName).toBe('Ableton')
    expect(empty).toContain('<KeyTracks></KeyTracks>')
  })

  it('refuses a template it cannot anchor into', () => {
    expect(() => buildClipXml('<Ableton></Ableton>', notes, 4, 'x')).toThrow(/KeyTracks/)
  })
})

describe('exportAbletonClip', () => {
  const pattern = makePattern({
    seq1: makeSeq({
      bits: [true, false, true, false, true, true, false, false],
      cvs: [0, 0, 1, 0, -1, 0.5, 0, 0],
      cvRange: 1,
    }),
    quantMode: 1,
    rootMidi: 60,
  })

  it('produces a gzipped Live document', async () => {
    const bytes = await exportAbletonClip(pattern, 1, { steps: 16 })
    expect(bytes[0]).toBe(0x1f) // gzip magic
    expect(bytes[1]).toBe(0x8b)

    const xml = await gunzip(bytes)
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(parse(xml).documentElement?.nodeName).toBe('Ableton')
  })

  it('round-trips the notes the sequencer would play', async () => {
    const xml = await gunzip(await exportAbletonClip(pattern, 1, { steps: 8 }))
    const clip = targetClip(parse(xml))!
    const events = [...clip.getElementsByTagName('MidiNoteEvent')]
    expect(events).toHaveLength(4) // bits 1, 3, 5, 6 over eight steps
    // Chromatic on C4: 0V, +1V, -1V, +0.5V at full range.
    const keys = [...clip.getElementsByTagName('MidiKey')].map((k) => Number(k.getAttribute('Value')))
    expect(keys.sort((a, b) => a - b)).toEqual([48, 60, 66, 72])
  })

  it('lands the notes on the right beats', async () => {
    const xml = await gunzip(await exportAbletonClip(pattern, 1, { steps: 8 }))
    const clip = targetClip(parse(xml))!
    const times = [...clip.getElementsByTagName('MidiNoteEvent')]
      .map((e) => Number(e.getAttribute('Time')))
      .sort((a, b) => a - b)
    // Bits 1, 3, 5, 6 are sixteenths 0, 2, 4, 5 — quarter of a beat each.
    expect(times).toEqual([0, 0.5, 1, 1.25])
  })

  it('sets the loop to the captured length in beats', async () => {
    const xml = await gunzip(await exportAbletonClip(pattern, 1, { steps: 32 }))
    const clip = targetClip(parse(xml))!
    expect(clip.getElementsByTagName('LoopEnd')[0]?.getAttribute('Value')).toBe('8')
  })

  it('exports each sequencer separately', async () => {
    const both = {
      ...pattern,
      seq2: makeSeq({ bits: Array(8).fill(true), cvs: Array(8).fill(0) }),
    }
    const one = await gunzip(await exportAbletonClip(both, 1, { steps: 8 }))
    const two = await gunzip(await exportAbletonClip(both, 2, { steps: 8 }))
    expect(targetClip(parse(one))!.getElementsByTagName('MidiNoteEvent')).toHaveLength(4)
    expect(targetClip(parse(two))!.getElementsByTagName('MidiNoteEvent')).toHaveLength(8)
    expect(one).toContain('Value="Labyrinth SEQ1"')
    expect(two).toContain('Value="Labyrinth SEQ2"')
  })
})

describe('clipFilename', () => {
  it('distinguishes seed and sequencer', () => {
    expect(clipFilename(makePattern({ seed: 7 }), 2)).toBe('Labyrinth-7-SEQ2.alc')
  })
})
