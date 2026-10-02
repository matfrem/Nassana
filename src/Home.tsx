import { useState } from 'react'
import { parseSheetId } from './google/sheets'
import { loadRecent } from './recent'

export function Home() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const recent = loadRecent()

  const open = (e: React.FormEvent) => {
    e.preventDefault()
    const id = parseSheetId(input)
    if (!id) return setError('That does not look like a Google Sheets link.')
    location.hash = `#/sheet/${id}`
  }

  return (
    <main className="home">
      <h1>Nassana</h1>
      <p className="lead">Your Google Sheet tasks, as sticky notes on an infinite board.</p>

      <form onSubmit={open}>
        <label htmlFor="sheet-url">Google Sheet link</label>
        <div className="row">
          <input
            id="sheet-url"
            value={input}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            onChange={(e) => {
              setInput(e.target.value)
              setError('')
            }}
            autoFocus
          />
          <button className="primary" type="submit">
            Open
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      {recent.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.id}>
                <a href={`#/sheet/${r.id}`}>{r.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="hint">
        The Sheet needs a tab named <code>Tasks</code> with the columns <code>id</code>,{' '}
        <code>title</code> and <code>board</code>. <a href="#/demo">Try the demo</a>
      </p>
    </main>
  )
}
