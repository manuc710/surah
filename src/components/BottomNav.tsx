import { NavLink } from 'react-router-dom'

type Item = {
  to: string
  label: string
}

const items: Item[] = [
  { to: '/', label: 'Главная' },
  { to: '/surahs', label: 'Суры' },
  { to: '/bookmarks', label: 'Закладки' },
  { to: '/settings', label: 'Настройки' },
]

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `bottom-nav__item ${isActive ? 'is-active' : ''}`}
          end={item.to === '/'}
        >
          <span className="bottom-nav__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

