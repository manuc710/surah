import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppShell() {
  const location = useLocation()
  const isPlayer = location.pathname.startsWith('/surah/')

  return (
    <div className={`app-shell ${isPlayer ? 'is-player' : ''}`}>
      <main className="app-shell__main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

