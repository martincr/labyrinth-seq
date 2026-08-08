// Copied verbatim from the mc-202 project (src/lib/prng.test.ts).
// Kept in sync by hand; if you change it here, consider porting back.

import { describe, expect, test } from 'vitest'
import { hash32, pickDistinct, randomAt } from './prng'

describe('randomAt', () => {
  test('is stable across calls — the property the whole engine rests on', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomAt(1234, i, 7)).toBe(randomAt(1234, i, 7))
    }
  })

  test('stays in [0, 1)', () => {
    for (let i = 0; i < 5000; i++) {
      const v = randomAt(99, i, i * 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('is sensitive to every argument position', () => {
    expect(randomAt(1, 2, 3)).not.toBe(randomAt(2, 1, 3))
    expect(randomAt(1, 2, 3)).not.toBe(randomAt(1, 3, 2))
    expect(randomAt(0, 0, 0)).not.toBe(randomAt(0, 0, 1))
    // Adjacent coordinates must decorrelate, or probability would come in runs.
    expect(randomAt(5, 10, 0)).not.toBe(randomAt(5, 11, 0))
  })

  test('is roughly uniform over 10k samples', () => {
    const buckets = new Array(10).fill(0)
    const n = 10000
    for (let i = 0; i < n; i++) buckets[Math.floor(randomAt(42, i, 0) * 10)]++
    // Each decile should hold ~1000; allow generous slack for a hash, but a
    // biased or short-cycling generator blows straight through this.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800)
      expect(count).toBeLessThan(1200)
    }
  })

  test('a probability threshold fires at about the requested rate', () => {
    for (const p of [0.25, 0.5, 0.7]) {
      let fired = 0
      const n = 4000
      for (let cycle = 0; cycle < n; cycle++) {
        if (randomAt(7, cycle, 3, 0x9e37) < p) fired++
      }
      expect(fired / n).toBeGreaterThan(p - 0.04)
      expect(fired / n).toBeLessThan(p + 0.04)
    }
  })

  test('hash32 returns an unsigned 32-bit integer', () => {
    for (let i = 0; i < 200; i++) {
      const h = hash32(i, -i, i * 7919)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('pickDistinct', () => {
  test('returns exactly `count` distinct in-range indices', () => {
    for (let range = 1; range <= 32; range++) {
      for (let count = 0; count <= range; count++) {
        const picked = pickDistinct(count, range, 1234 + range)
        expect(picked).toHaveLength(count)
        expect(new Set(picked).size).toBe(count)
        for (const v of picked) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(range)
        }
      }
    }
  })

  test('is deterministic in the seed and varies with it', () => {
    expect(pickDistinct(5, 16, 99)).toEqual(pickDistinct(5, 16, 99))
    expect(pickDistinct(5, 16, 99)).not.toEqual(pickDistinct(5, 16, 100))
  })

  test('clamps an over-large count and handles empty ranges', () => {
    expect(pickDistinct(20, 8, 1)).toHaveLength(8)
    expect(pickDistinct(3, 0, 1)).toEqual([])
    expect(pickDistinct(-1, 8, 1)).toEqual([])
  })

  test('returns ascending indices so the onset word reads left to right', () => {
    const picked = pickDistinct(7, 24, 55)
    expect([...picked].sort((a, b) => a - b)).toEqual(picked)
  })
})
