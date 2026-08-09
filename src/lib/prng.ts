// Copied verbatim from the mc-202 project (src/lib/prng.ts).
// Kept in sync by hand; if you change it here, consider porting back.

// Stateless, coordinate-addressed randomness.
//
// The rhythm engine re-rolls probability every cycle, so patterns evolve over
// long spans — but a stateful Math.random() would mean the circular display
// couldn't show what is about to fire, and an exported MIDI file wouldn't match
// what was auditioned. Hashing the coordinates (seed, cycle, step) instead
// keeps every roll a pure function of where it sits in the pattern, so the
// scheduler, the visualizer and the exporter always agree.

export function hash32(...parts: number[]): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    let v = Math.trunc(part) | 0
    // Mix all four bytes so high-order coordinate bits reach the low bits.
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff
      h = Math.imul(h, 0x01000193)
      v >>>= 8
    }
  }
  // Final avalanche (murmur3 finalizer) so adjacent coordinates decorrelate.
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export function randomAt(...parts: number[]): number {
  return hash32(...parts) / 0x100000000
}

// `count` distinct indices in [0, range), deterministic in `seed`. Used by the
// 'random' distribution mode, where a Math.random() fill would reshuffle on
// every re-render.
export function pickDistinct(count: number, range: number, seed: number): number[] {
  const n = Math.max(0, Math.trunc(range))
  const k = Math.min(Math.max(0, Math.trunc(count)), n)
  // Partial Fisher-Yates over the identity permutation, drawing swaps from the
  // hash so the result depends only on (seed, range).
  const pool = Array.from({ length: n }, (_, i) => i)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(randomAt(seed, i, 0x5bf03635) * (n - i))
    const t = pool[i]
    pool[i] = pool[Math.min(j, n - 1)]
    pool[Math.min(j, n - 1)] = t
  }
  return pool.slice(0, k).sort((a, b) => a - b)
}
