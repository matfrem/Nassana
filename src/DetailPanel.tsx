import { useEffect } from 'react'
import { DateField } from './DateField'
import { inkFor, isoOf, type Field } from './fields'
import type { ArrowMode, Task } from './types'

/** A link seen from the note whose panel is open. */
/** The http(s) links found in a text, in order, without the punctuation that ends a sentence. */
export function linksIn(text: string | undefined): string[] {
  return [...(text ?? '').matchAll(/https?:\/\/[^\s<>"]+/gi)].map((m) => m[0].replace(/[.,;:!?)\]}'"]+$/, '')).filter((u) => u.length > 8)
}

export interface LinkRow {
  id: string
  /** Title of the note at the other end. */
  title: string
  /** `out`: this note points at the other one; `in`: the other points at this one. */
  dir: 'out' | 'in'
  arrow: ArrowMode
}

interface Props {
  /** The notes the panel edits: one, or the selection (the first one is shown; `≠` marks what differs on the others). */
  tasks: Task[]
  /** Every custom column, shown on notes or not. */
  fields: Field[]
  zoneNames: string[]
  editable: boolean
  onClose: () => void
  onTitle: (id: string, title: string) => void
  onDescription: (ids: string[], text: string) => void
  onStatus: (ids: string[], status: string) => void
  onValue: (ids: string[], field: Field, input: string | boolean) => void
  parentId: string | null
  /** Some of the notes have another parent than the first one. */
  parentDiffers: boolean
  /** The emoji of columns, and the color of a value of a dropdown column. */
  icons: Record<string, string>
  colorOf: (key: string, value: string) => string | undefined
  /** Notes that may become this note's parent (not itself, not its own sub-tasks). */
  parentChoices: { id: string; title: string }[]
  onParent: (ids: string[], parentId: string | null) => void
  subtasks: number
  links: LinkRow[]
  onRemoveLink: (id: string) => void
}

/** Side panel (bottom sheet on phones) with every column of the selected note. */
/** Marks a property whose value is not the same on every selected note. */
const Diff = () => (
  <i className="differs" title="Different on other selected notes" aria-label="differs">
    {' '}
    ≠
  </i>
)

export function DetailPanel({ tasks, fields, zoneNames, editable, onClose, onTitle, onDescription, onStatus, onValue, parentId, parentDiffers, icons, colorOf, parentChoices, onParent, subtasks, links, onRemoveLink }: Props) {
  const task = tasks[0]
  const ids = tasks.map((t) => t.id)
  const multi = tasks.length > 1
  const differs = (get: (t: Task) => string) => multi && tasks.some((t) => get(t) !== get(task))
  // Escape closes the panel (and only the panel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const status = task.status ?? ''
  const statusChoices = zoneNames.includes(status) || !status ? zoneNames : [...zoneNames, status]

  return (
    <aside className="panel" aria-label="Note details">
      <header>
        {multi ? (
          <h2>{tasks.length} notes</h2>
        ) : editable ? (
          <input
            className="panel-title"
            value={task.title}
            aria-label="Title"
            onChange={(e) => onTitle(task.id, e.target.value)}
          />
        ) : (
          <h2>{task.title}</h2>
        )}
        <button onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>

      <div className="panel-body">
        <label>
          <span>
            Description{differs((t) => t.description ?? '') && <Diff />}
          </span>
          {editable ? (
            <textarea rows={3} value={task.description ?? ''} onChange={(e) => onDescription(ids, e.target.value)} />
          ) : (
            <p className="read">{task.description || '—'}</p>
          )}
        </label>

        {!multi && linksIn(task.description).length > 0 && (
          <div className="open-links">
            {linksIn(task.description).map((url, i) => (
              <a key={i} className="open-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
                ↗ Open Link {i + 1}
              </a>
            ))}
          </div>
        )}

        <label>
          <span>
            Status{differs((t) => t.status ?? '') && <Diff />}
          </span>
          {editable ? (
            zoneNames.length > 0 ? (
              <select value={status} onChange={(e) => onStatus(ids, e.target.value)}>
                <option value="" />
                {statusChoices.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input value={status} onChange={(e) => onStatus(ids, e.target.value)} />
            )
          ) : (
            <p className="read">{status || '—'}</p>
          )}
        </label>

        {(editable || parentId) && (
          <label>
            <span>
              Parent{parentDiffers && <Diff />}
            </span>
            {editable ? (
              <select value={parentId ?? ''} onChange={(e) => onParent(ids, e.target.value || null)}>
                <option value="">— none (free note)</option>
                {parentChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || 'Untitled'}
                  </option>
                ))}
              </select>
            ) : (
              <p className="read">{parentChoices.find((c) => c.id === parentId)?.title ?? '—'}</p>
            )}
          </label>
        )}
        {!multi && subtasks > 0 && <p className="read">{subtasks} sub-task{subtasks > 1 ? 's' : ''}</p>}

        {!multi && links.length > 0 && (
          <div className="links-list">
            <span>Links</span>
            <ul>
              {links.map((l) => (
                <li key={l.id}>
                  <span aria-hidden>{l.arrow === 'none' ? '—' : l.arrow === 'both' ? '↔' : l.dir === 'out' ? '→' : '←'}</span>
                  <em>{l.title || 'Untitled'}</em>
                  {editable && (
                    <button onClick={() => onRemoveLink(l.id)} aria-label={`Remove link to ${l.title}`}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fields.map((f) => (
          <FieldRow key={f.key} field={f} tasks={tasks} icon={icons[f.key]} colorOf={colorOf} editable={editable} onValue={onValue} />
        ))}
      </div>
    </aside>
  )
}

function FieldRow({
  field,
  tasks,
  icon,
  colorOf,
  editable,
  onValue,
}: {
  field: Field
  tasks: Task[]
  icon?: string
  colorOf: (key: string, value: string) => string | undefined
  editable: boolean
  onValue: (ids: string[], field: Field, input: string | boolean) => void
}) {
  const task = tasks[0]
  const v = task.values?.[field.key]
  const text = v === undefined ? '' : String(v)
  const set = (input: string | boolean) => onValue(tasks.map((t) => t.id), field, input)
  const cellOf = (t: Task) => String(t.values?.[field.key] ?? '')
  const differs = tasks.length > 1 && tasks.some((t) => cellOf(t) !== cellOf(task))
  const tint = (value: string) => {
    const c = field.type === 'select' && value ? colorOf(field.key, value) : undefined
    return c ? { background: c, color: inkFor(c) } : undefined
  }

  let control: React.ReactNode
  if (!editable) {
    control =
      field.type === 'checkbox' ? (
        <p className="read">{v === true ? '✓' : '—'}</p>
      ) : field.type === 'link' && text ? (
        <p className="read">
          <a href={text} target="_blank" rel="noreferrer noopener">
            {text}
          </a>
        </p>
      ) : (
        <p className="read">{field.type === 'date' ? isoOf(v) || text || '—' : text || '—'}</p>
      )
  } else if (field.type === 'checkbox') {
    control = <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} />
  } else if (field.type === 'select') {
    const options = field.options ?? []
    control = (
      <select value={text} style={tint(text)} onChange={(e) => set(e.target.value)}>
        <option value="" />
        {(text && !options.includes(text) ? [...options, text] : options).map((o) => (
          <option key={o} style={tint(o)}>
            {o}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'date') {
    control = <DateField value={v} onChange={set} />
  } else {
    control = (
      <input
        type={field.type === 'link' ? 'url' : 'text'}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        value={text}
        onChange={(e) => set(e.target.value)}
      />
    )
  }

  return (
    <label className={field.type === 'checkbox' ? 'inline' : undefined} onClick={field.type === 'date' ? (e) => e.preventDefault() : undefined}>
      <span>
        {icon ? `${icon} ` : ''}
        {field.label}
        {differs && <Diff />}
      </span>
      {control}
    </label>
  )
}
