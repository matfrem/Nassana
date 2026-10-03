import { useEffect } from 'react'
import { isoOf, type Field } from './fields'
import type { Task } from './types'

interface Props {
  task: Task
  /** Every custom column, shown on notes or not. */
  fields: Field[]
  zoneNames: string[]
  editable: boolean
  onClose: () => void
  onTitle: (id: string, title: string) => void
  onDescription: (id: string, text: string) => void
  onStatus: (id: string, status: string) => void
  onValue: (id: string, field: Field, input: string | boolean) => void
}

/** Side panel (bottom sheet on phones) with every column of the selected note. */
export function DetailPanel({ task, fields, zoneNames, editable, onClose, onTitle, onDescription, onStatus, onValue }: Props) {
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
        {editable ? (
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
          <span>Description</span>
          {editable ? (
            <textarea rows={3} value={task.description ?? ''} onChange={(e) => onDescription(task.id, e.target.value)} />
          ) : (
            <p className="read">{task.description || '—'}</p>
          )}
        </label>

        <label>
          <span>Status</span>
          {editable ? (
            zoneNames.length > 0 ? (
              <select value={status} onChange={(e) => onStatus(task.id, e.target.value)}>
                <option value="" />
                {statusChoices.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input value={status} onChange={(e) => onStatus(task.id, e.target.value)} />
            )
          ) : (
            <p className="read">{status || '—'}</p>
          )}
        </label>

        {fields.map((f) => (
          <FieldRow key={f.key} field={f} task={task} editable={editable} onValue={onValue} />
        ))}
      </div>
    </aside>
  )
}

function FieldRow({
  field,
  task,
  editable,
  onValue,
}: {
  field: Field
  task: Task
  editable: boolean
  onValue: (id: string, field: Field, input: string | boolean) => void
}) {
  const v = task.values?.[field.key]
  const text = v === undefined ? '' : String(v)
  const set = (input: string | boolean) => onValue(task.id, field, input)

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
      <select value={text} onChange={(e) => set(e.target.value)}>
        <option value="" />
        {(text && !options.includes(text) ? [...options, text] : options).map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    )
  } else if (field.type === 'date') {
    control = <input type="date" value={isoOf(v)} onChange={(e) => set(e.target.value)} />
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
    <label className={field.type === 'checkbox' ? 'inline' : undefined}>
      <span>
        {field.label}
        {field.shown && <i title="Shown on the note"> #</i>}
      </span>
      {control}
    </label>
  )
}
