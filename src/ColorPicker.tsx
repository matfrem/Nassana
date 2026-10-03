import { useEffect, useMemo, useState } from 'react'
import { hexToHsl, hslToHex, normalizeHex, PALETTE, type Hsl } from './colorUtil'
import { loadRecentColors, rememberColor } from './recentColors'

interface Props {
  title: string
  value: string
  /** Colors already used on the board, most used first. */
  boardColors: string[]
  /** Called on every change (the board updates live). */
  onChange: (color: string) => void
  onClose: () => void
}

/** Bottom sheet to choose a color: what the board already uses, recent picks, a palette and free sliders. */
export function ColorPicker({ title, value, boardColors, onChange, onClose }: Props) {
  const [initial] = useState(value)
  const [color, setColor] = useState(normalizeHex(value) ?? '#cccccc')
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(value))
  const [hex, setHex] = useState(color)
  const recent = useMemo(() => loadRecentColors(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const close = () => {
    rememberColor(color)
    onClose()
  }
  /** Puts the color back as it was when the picker opened, and closes without remembering anything. */
  const cancel = () => {
    onChange(initial)
    onClose()
  }
  const apply = (c: string, from?: Hsl) => {
    setColor(c)
    setHex(c)
    setHsl(from ?? hexToHsl(c))
    onChange(c)
  }
  const slide = (patch: Partial<Hsl>) => {
    const next = { ...hsl, ...patch }
    apply(hslToHex(next), next)
  }

  const Row = ({ label, colors, grid }: { label: string; colors: string[]; grid?: boolean }) =>
    colors.length === 0 ? null : (
      <section>
        <h3>{label}</h3>
        <div className={`cp-swatches${grid ? ' grid' : ''}`}>
          {colors.map((c) => (
            <button key={c} className={`cp-swatch${c === color ? ' on' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => apply(c)} />
          ))}
        </div>
      </section>
    )

  return (
    <div className="cp-backdrop" onPointerDown={close}>
      <div className="cp" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <span className="cp-current" style={{ background: color }} />
          <button onClick={cancel}>Cancel</button>
          <button className="primary" onClick={close}>Done</button>
        </header>
        <Row label="On this board" colors={boardColors} />
        <Row label="Recent" colors={recent} />
        <Row label="Palette" colors={PALETTE} grid />
        <section>
          <h3>Custom</h3>
          <label className="cp-slider">
            Hue
            <input
              type="range" min={0} max={359} value={hsl.h} aria-label="Hue"
              style={{ background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
              onChange={(e) => slide({ h: Number(e.target.value) })}
            />
          </label>
          <label className="cp-slider">
            Saturation
            <input
              type="range" min={0} max={100} value={hsl.s} aria-label="Saturation"
              style={{ background: `linear-gradient(90deg,${hslToHex({ ...hsl, s: 0 })},${hslToHex({ ...hsl, s: 100 })})` }}
              onChange={(e) => slide({ s: Number(e.target.value) })}
            />
          </label>
          <label className="cp-slider">
            Lightness
            <input
              type="range" min={0} max={100} value={hsl.l} aria-label="Lightness"
              style={{ background: `linear-gradient(90deg,#000,${hslToHex({ ...hsl, l: 50 })},#fff)` }}
              onChange={(e) => slide({ l: Number(e.target.value) })}
            />
          </label>
          <label className="cp-hex">
            Hex
            <input
              value={hex}
              aria-label="Hex color"
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                setHex(e.target.value)
                const c = normalizeHex(e.target.value)
                if (c) apply(c)
              }}
            />
          </label>
        </section>
      </div>
    </div>
  )
}
