import { useEffect, useMemo, useState } from 'react'
import { NOTE_COLORS } from './constants'
import { chipFor, RESERVED, type Field } from './fields'
import {
  applyColumns,
  buildRequests,
  fetchStructure,
  TYPE_LABEL,
  type ColType,
  type Draft,
  type Opt,
  type Structure,
  type SystemAdd,
  type SystemEdit,
} from './google/columns'
import { AuthRequiredError } from './google/auth'
import type { Task } from './types'

interface Props {
  sheetId: string
  /** The custom columns as the board understands them (types, dropdown values, colors). */
  fields: Field[]
  tasks: Task[]
  onClose: () => void
  /** The Sheet was changed: the board must reload. */
  onApplied: () => void
}

const TYPES: ColType[] = ['text', 'number', 'date', 'checkbox', 'select']
const COLOR_FALLBACK = NOTE_COLORS

const rawOf = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** The Tasks tab's columns, as editable drafts. */
function draftsFrom(st: Structure, fields: Field[], tasks: Task[]): Draft[] {
  return fields.flatMap((f) => {
    const col = st.columns.find((c) => c.index === f.index)
    if (!col) return []
    const type: ColType = f.type === 'link' ? 'text' : f.type
    const values = f.options ?? [...new Set(tasks.map((t) => t.values?.[f.key]).filter((v) => v !== undefined && v !== '').map(String))]
    const opts: Opt[] = type === 'select' ? values.map((value, i) => ({ value, color: f.colors?.[rawOf(value)] ?? COLOR_FALLBACK[i % COLOR_FALLBACK.length] })) : []
    const orig = { name: f.label, shown: f.shown, type, opts, hidden: col.hidden }
    return [{ uid: 'c' + f.index, index: f.index, name: f.label, shown: f.shown, type, opts, hidden: col.hidden, deleted: false, orig }]
  })
}

export function ColumnsPage({ sheetId, fields, tasks, onClose, onApplied }: Props) {
  const [opened, setOpened] = useState<Structure | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [system, setSystem] = useState<SystemEdit[]>([])
  const [adds, setAdds] = useState<SystemAdd[]>([])
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetchStructure(sheetId)
      .then((st) => {
        if (!alive) return
        setOpened(st)
        setDrafts(draftsFrom(st, fields, tasks))
        setSystem(st.columns.filter((c) => RESERVED.includes(c.header.toLowerCase())).map((c) => ({ index: c.index, hidden: c.hidden, origHidden: c.hidden })))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
    // Loaded once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId])

  /** How many tasks have a value in each existing column (to warn before deleting it). */
  const valueCounts = useMemo(() => {
    const m: Record<number, number> = {}
    for (const f of fields) m[f.index] = tasks.filter((t) => t.values?.[f.key] !== undefined && t.values[f.key] !== '').length
    return m
  }, [fields, tasks])

  const plan = useMemo(() => (opened ? buildRequests(opened, drafts, system, adds, valueCounts) : { requests: [], summary: [] as string[] }), [opened, drafts, system, adds, valueCounts])

  // ---- validation
  const systemNames = useMemo(
    () => [...(opened?.columns.map((c) => c.header.toLowerCase()) ?? []).filter((h) => RESERVED.includes(h)), ...adds],
    [opened, adds],
  )
  const errors = useMemo(() => {
    const out = new Map<string, string>()
    const live = drafts.filter((d) => !d.deleted)
    for (const d of live) {
      const name = d.name.trim()
      const key = name.toLowerCase()
      if (!name) out.set(d.uid, 'Give the column a name.')
      else if (RESERVED.includes(key) || systemNames.includes(key)) out.set(d.uid, `“${name}” is used by the app. Pick another name.`)
      else if (live.filter((o) => o.name.trim().toLowerCase() === key).length > 1) out.set(d.uid, 'Two columns have this name.')
      else if (d.type === 'select') {
        const vals = d.opts.map((o) => o.value.trim().toLowerCase())
        if (vals.length === 0) out.set(d.uid, 'Add at least one value to the dropdown.')
        else if (vals.some((v) => !v)) out.set(d.uid, 'A dropdown value is empty.')
        else if (new Set(vals).size !== vals.length) out.set(d.uid, 'Two dropdown values are the same.')
      }
    }
    return out
  }, [drafts, systemNames])

  const patch = (uid: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.uid === uid ? { ...d, ...p } : d)))

  const setType = (d: Draft, type: ColType) => {
    if (type === d.type) return
    let opts = d.opts
    if (type === 'select' && opts.length === 0) {
      // Offer the values already in the column.
      const f = fields.find((x) => x.index === d.index)
      const seen = f ? [...new Set(tasks.map((t) => t.values?.[f.key]).filter((v) => v !== undefined && v !== '').map(String))] : []
      opts = seen.map((value, i) => ({ value, color: f?.colors?.[rawOf(value)] ?? COLOR_FALLBACK[i % COLOR_FALLBACK.length] }))
    }
    patch(d.uid, { type, opts })
  }

  const move = (uid: string, dir: -1 | 1) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.uid === uid)
      let j = i + dir
      while (ds[j]?.deleted) j += dir // jump over deleted columns
      if (i < 0 || j < 0 || j >= ds.length) return ds
      const next = [...ds]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const addColumn = () =>
    setDrafts((ds) => [...ds, { uid: 'new' + Date.now(), name: '', shown: true, type: 'text', opts: [], hidden: false, deleted: false }])

  const removeColumn = (d: Draft) => (d.index === undefined ? setDrafts((ds) => ds.filter((x) => x.uid !== d.uid)) : patch(d.uid, { deleted: true }))

  const close = () => {
    if (plan.summary.length > 0 && !window.confirm('Discard your changes?')) return
    onClose()
  }

  const apply = async () => {
    if (!opened) return
    setBusy(true)
    setError('')
    try {
      await applyColumns(sheetId, opened, drafts, system, adds)
      onApplied()
    } catch (e) {
      setConfirming(false)
      setError(e instanceof AuthRequiredError ? 'Please sign in again.' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const missing = (['description', 'status'] as SystemAdd[]).filter((n) => opened && !opened.columns.some((c) => c.header.toLowerCase() === n))
  const live = drafts.filter((d) => !d.deleted)
  const canApply = !!opened && plan.summary.length > 0 && errors.size === 0 && !busy

  return (
    <div className="cfg" role="dialog" aria-label="Columns">
      <header>
        <button onClick={close}>Cancel</button>
        <h2>Columns</h2>
        <button className="primary" disabled={!canApply} onClick={() => setConfirming(true)}>
          Apply{plan.summary.length ? ` (${plan.summary.length})` : ''}
        </button>
      </header>

      <div className="cfg-body">
        {error && <p className="error">{error}</p>}
        {!opened && !error && <p>Loading columns…</p>}

        {opened && (
          <>
            <Preview drafts={live} />

            <h3>Your columns</h3>
            <p className="hint">These are the columns of your Sheet. Changes are written to it when you press Apply.</p>
            {drafts.map((d, i) => (
              <Row
                key={d.uid}
                d={d}
                first={!drafts.slice(0, i).some((x) => !x.deleted)}
                last={!drafts.slice(i + 1).some((x) => !x.deleted)}
                error={errors.get(d.uid)}
                count={d.index !== undefined ? (valueCounts[d.index] ?? 0) : 0}
                onChange={(p) => patch(d.uid, p)}
                onType={(t) => setType(d, t)}
                onMove={(dir) => move(d.uid, dir)}
                onDelete={() => removeColumn(d)}
              />
            ))}
            <button className="add" onClick={addColumn}>
              ＋ Add a column
            </button>

            <h3>Managed by the app</h3>
            <p className="hint">The app reads and writes these columns. They can’t be renamed or deleted, but you can hide them in the Sheet.</p>
            {opened.columns
              .filter((c) => RESERVED.includes(c.header.toLowerCase()))
              .map((c) => {
                const s = system.find((x) => x.index === c.index)!
                return (
                  <div className="cfg-row system" key={c.index}>
                    <div className="cfg-main">
                      <span aria-hidden>🔒</span>
                      <strong>{c.header}</strong>
                      <label className="flag">
                        <input
                          type="checkbox"
                          checked={s?.hidden ?? false}
                          onChange={(e) => setSystem((ss) => ss.map((x) => (x.index === c.index ? { ...x, hidden: e.target.checked } : x)))}
                        />
                        Hidden in the Sheet
                      </label>
                    </div>
                  </div>
                )
              })}
            {missing.map((n) => (
              <div className="cfg-row system" key={n}>
                <div className="cfg-main">
                  <span aria-hidden>🔒</span>
                  <strong>{n}</strong>
                  {adds.includes(n) ? (
                    <button onClick={() => setAdds((a) => a.filter((x) => x !== n))}>Will be added ✕</button>
                  ) : (
                    <button onClick={() => setAdds((a) => [...a, n])}>＋ Add</button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {confirming && (
        <div className="cfg-confirm" role="alertdialog">
          <div className="card">
            <h3>Apply to the Sheet?</h3>
            <ul>
              {plan.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="hint">Everything is sent at once. You can undo it from the Sheet’s version history.</p>
            <div className="row">
              <button onClick={() => setConfirming(false)} disabled={busy}>
                Back
              </button>
              <button className="primary" onClick={() => void apply()} disabled={busy}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({
  d,
  first,
  last,
  error,
  count,
  onChange,
  onType,
  onMove,
  onDelete,
}: {
  d: Draft
  first: boolean
  last: boolean
  error?: string
  count: number
  onChange: (p: Partial<Draft>) => void
  onType: (t: ColType) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  if (d.deleted) {
    return (
      <div className="cfg-row deleted">
        <div className="cfg-main">
          <s>{d.orig?.name ?? d.name}</s>
          <span className="hint">
            will be deleted{count ? ` with its ${count} value${count === 1 ? '' : 's'}` : ''}
          </span>
          <button onClick={() => onChange({ deleted: false })}>Undo</button>
        </div>
      </div>
    )
  }

  const setOpt = (i: number, p: Partial<Opt>) => onChange({ opts: d.opts.map((o, k) => (k === i ? { ...o, ...p } : o)) })
  const moveOpt = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= d.opts.length) return
    const next = [...d.opts]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange({ opts: next })
  }

  return (
    <div className={`cfg-row${error ? ' invalid' : ''}`}>
      <div className="cfg-main">
        <span className="cfg-move">
          <button aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
            ↓
          </button>
        </span>
        <input
          aria-label="Column name"
          value={d.name}
          placeholder="Column name"
          onChange={(e) => onChange({ name: e.target.value.replace(/#/g, '') })}
        />
        <select aria-label="Type" value={d.type} onChange={(e) => onType(e.target.value as ColType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="cfg-flags">
        <label className="flag">
          <input type="checkbox" checked={d.shown} onChange={(e) => onChange({ shown: e.target.checked })} />
          Show on notes
        </label>
        <label className="flag">
          <input type="checkbox" checked={d.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} />
          Hidden in the Sheet
        </label>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {d.type === 'select' && (
        <div className="cfg-opts">
          {d.opts.map((o, i) => (
            <div className="cfg-opt" key={i}>
              <input type="color" aria-label="Color" value={/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#cccccc'} onChange={(e) => setOpt(i, { color: e.target.value })} />
              <input aria-label="Value" value={o.value} placeholder="Value" onChange={(e) => setOpt(i, { value: e.target.value })} />
              <button aria-label="Move value up" disabled={i === 0} onClick={() => moveOpt(i, -1)}>
                ↑
              </button>
              <button aria-label="Move value down" disabled={i === d.opts.length - 1} onClick={() => moveOpt(i, 1)}>
                ↓
              </button>
              <button aria-label="Remove value" onClick={() => onChange({ opts: d.opts.filter((_, k) => k !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="add" onClick={() => onChange({ opts: [...d.opts, { value: '', color: COLOR_FALLBACK[d.opts.length % COLOR_FALLBACK.length] }] })}>
            ＋ Add a value
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** A sample note showing how the columns marked “Show on notes” will look. */
function Preview({ drafts }: { drafts: Draft[] }) {
  const today = new Date()
  const soon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  const chips = drafts
    .filter((d) => d.shown && d.name.trim())
    .flatMap((d) => {
      const field: Field = {
        key: d.uid,
        label: d.name.trim(),
        index: 0,
        shown: true,
        type: d.type,
        options: d.opts.map((o) => o.value),
      }
      const sample = d.type === 'date' ? iso : d.type === 'number' ? 3 : d.type === 'checkbox' ? true : d.type === 'select' ? (d.opts[0]?.value ?? '') : 'Sample'
      return chipFor(field, sample) ?? []
    })
  return (
    <div className="cfg-preview">
      <span className="hint">Preview</span>
      <div className="note static" style={{ background: '#FFE066', color: '#1f2328' }}>
        <div className="note-title">Example note</div>
        <div className="note-chips">
          {chips.map((c) => (
            <span key={c.key} className={`chip${c.tone ? ` tone-${c.tone}` : ''}`}>
              {c.icon && <span aria-hidden>{c.icon}</span>}
              {c.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
