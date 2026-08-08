import { type ReactNode, useCallback, useRef } from 'react'

// Panel controls. The knob is a real rotary — drag vertically — because the
// Labyrinth's continuous controls are knobs and a row of sliders reads as a
// mixer rather than an instrument. Everything here is presentational.

const KNOB_MIN_ANGLE = -135
const KNOB_MAX_ANGLE = 135
/** Pixels of drag for the full range. Shift slows it down for fine work. */
const KNOB_TRAVEL_PX = 180

interface KnobProps {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
  /** Draws the fill from the centre rather than the minimum. */
  bipolar?: boolean
  format?: (value: number) => string
  size?: number
  accent?: string
}

export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  onChange,
  bipolar = false,
  format,
  size = 44,
  accent = 'var(--color-led-amber)',
}: KnobProps) {
  const dragging = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null)

  const endDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragging.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragging.current = null
    const el = e.currentTarget as Element
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragging.current = { pointerId: e.pointerId, startY: e.clientY, startValue: value }
    },
    [value],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragging.current
      if (!drag || drag.pointerId !== e.pointerId) return
      // No button held means the pointerup was missed — the drag left the
      // window, or a touch was cancelled. Without this the knob stays latched
      // to the cursor and every later mouse move keeps turning it.
      if (e.buttons === 0) {
        endDrag(e)
        return
      }
      const scale = e.shiftKey ? 4 : 1
      const delta = (drag.startY - e.clientY) / (KNOB_TRAVEL_PX * scale)
      onChange(Math.max(min, Math.min(max, drag.startValue + delta * (max - min))))
    },
    [min, max, onChange, endDrag],
  )

  const fraction = (value - min) / (max - min || 1)
  const angle = KNOB_MIN_ANGLE + fraction * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE)
  const centreAngle = bipolar ? 0 : KNOB_MIN_ANGLE
  const r = size / 2 - 3

  return (
    <div className="no-select flex w-16 flex-col items-center gap-1">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="cursor-ns-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => onChange(bipolar ? (min + max) / 2 : min)}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <circle cx={size / 2} cy={size / 2} r={r} className="fill-panel-800 stroke-panel-700" />
        <path
          d={arc(size / 2, size / 2, r + 1.5, centreAngle, angle)}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <line
          x1={size / 2}
          y1={size / 2}
          x2={size / 2 + Math.sin((angle * Math.PI) / 180) * (r - 6)}
          y2={size / 2 - Math.cos((angle * Math.PI) / 180) * (r - 6)}
          stroke="var(--color-panel-200)"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center font-mono text-[9px] leading-tight tracking-wide text-panel-400">
        <div className="uppercase">{label}</div>
        {format && <div className="text-panel-200">{format(value)}</div>}
      </div>
    </div>
  )
}

/** SVG arc between two angles measured clockwise from twelve o'clock. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [a, b] = from <= to ? [from, to] : [to, from]
  const p = (deg: number) => [
    cx + Math.sin((deg * Math.PI) / 180) * r,
    cy - Math.cos((deg * Math.PI) / 180) * r,
  ]
  const [x1, y1] = p(a)
  const [x2, y2] = p(b)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

interface PanelButtonProps {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  title?: string
  className?: string
}

export function PanelButton({ children, onClick, active, title, className = '' }: PanelButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`no-select rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? 'border-led-amber/60 bg-led-amber/15 text-led-amber'
          : 'border-panel-700 bg-panel-800 text-panel-400 hover:border-panel-600 hover:text-panel-200'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-panel-800 bg-panel-900/70 p-3">
      <h2 className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-panel-600">
        {title}
      </h2>
      {children}
    </section>
  )
}

interface SelectProps<T extends string | number> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: SelectProps<T>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wide text-panel-400">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          const match = options.find((o) => String(o.value) === raw)
          if (match) onChange(match.value)
        }}
        className="rounded border border-panel-700 bg-panel-800 px-2 py-1 font-mono text-[11px] text-panel-200 outline-none focus:border-led-amber/60"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
