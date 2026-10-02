import { useEffect, useState } from 'react'
import { BoardView } from './BoardView'
import { Home } from './Home'

type Route = { kind: 'home' } | { kind: 'demo' } | { kind: 'sheet'; id: string }

function parseHash(): Route {
  const h = location.hash
  if (h === '#/demo') return { kind: 'demo' }
  const m = h.match(/^#\/sheet\/([A-Za-z0-9_-]+)/)
  return m ? { kind: 'sheet', id: m[1] } : { kind: 'home' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route.kind === 'home') return <Home />
  // key: remount (fresh state, fresh camera) when switching sheets
  return <BoardView key={route.kind === 'sheet' ? route.id : 'demo'} source={route} />
}
