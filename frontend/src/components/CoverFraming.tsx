import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
  src: string
  /** Part of the photo kept in view, as % across and down (CSS object-position). */
  x: number
  y: number
  onChange: (x: number, y: number) => void
}

const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)))

/**
 * The cover as the event page crops it, on a wide screen and on a phone. Drag the photo (or use
 * the arrow keys) to choose which part stays in view.
 */
export function CoverFraming({ src, x, y, onChange }: Props) {
  const img = useRef<HTMLImageElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number; spanX: number; spanY: number } | null>(null)
  const position = `${x}% ${y}%`

  const onPointerDown = (e: PointerEvent<HTMLImageElement>) => {
    const el = img.current
    if (!el?.naturalWidth) return
    const box = el.getBoundingClientRect()
    const scale = Math.max(box.width / el.naturalWidth, box.height / el.naturalHeight)
    // How far the scaled photo overhangs the frame on each axis, in screen pixels.
    drag.current = {
      px: e.clientX,
      py: e.clientY,
      x,
      y,
      spanX: el.naturalWidth * scale - box.width,
      spanY: el.naturalHeight * scale - box.height,
    }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLImageElement>) => {
    const d = drag.current
    if (!d) return
    // Dragging the photo right brings more of its left side into view, so the focus moves left.
    onChange(
      d.spanX > 0 ? clamp(d.x - ((e.clientX - d.px) / d.spanX) * 100) : d.x,
      d.spanY > 0 ? clamp(d.y - ((e.clientY - d.py) / d.spanY) * 100) : d.y,
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    onChange(clamp(x + move[0]), clamp(y + move[1]))
  }

  return (
    <div className="cover-framing">
      <div className="cover-frames">
        <div
          className="cover-frame wide"
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label={`Cover framing, ${x}% across and ${y}% down. Use the arrow keys to move the photo.`}
        >
          <img
            ref={img}
            src={src}
            alt=""
            draggable={false}
            style={{ objectPosition: position }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
        </div>
        <div className="cover-frame phone" aria-hidden="true">
          <img src={src} alt="" style={{ objectPosition: position }} />
          <span className="cover-frame-label">Phone</span>
        </div>
      </div>
      <div className="cover-framing-help">
        <span className="muted small">Drag the photo to choose what stays in view.</span>
        {(x !== 50 || y !== 50) && (
          <button type="button" className="btn ghost small" onClick={() => onChange(50, 50)}>
            Re-center
          </button>
        )}
      </div>
    </div>
  )
}
