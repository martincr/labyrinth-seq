import { useMemo } from 'react'
import { evolveTo } from '../labyrinth/evolve.ts'
import type { PatternState } from '../labyrinth/state.ts'
import { useAppStore } from '../store/useAppStore.ts'

/**
 * The pattern as it stands at the current position.
 *
 * Derived here rather than exposed as a store method on purpose. A method like
 * `current()` is a stable function reference, so a component selecting it never
 * re-renders when the underlying pattern changes — the value it returns would
 * be right and the screen would be stale. Subscribing to the three inputs makes
 * the dependency real.
 */
export function useCurrentPattern(): { pattern: PatternState; relStep: number } {
  const anchor = useAppStore((s) => s.pattern)
  const originStep = useAppStore((s) => s.originStep)
  const step = useAppStore((s) => s.step)
  const relStep = step - originStep

  const pattern = useMemo(() => evolveTo(anchor, relStep), [anchor, relStep])
  return { pattern, relStep }
}
