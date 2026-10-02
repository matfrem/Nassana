import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Shows a readable message instead of a blank page if rendering crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="home">
        <h1>Something went wrong</h1>
        <p className="error">{this.state.error.message}</p>
        <p>
          <a href="#/" onClick={() => location.reload()}>
            Reload
          </a>
        </p>
      </main>
    )
  }
}
