import { useTheme, type ThemeMode } from '../features/theme/ThemeProvider'

export function SettingsPage() {
  const theme = useTheme()

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">Настройки</div>
        <div className="page__subtitle">Тема и параметры чтения</div>
      </header>

      <section className="section">
        <div className="card">
          <div className="card__row">
            <div>
              <div className="card__title">Тема</div>
              <div className="card__subtitle">Сейчас: {theme.resolved === 'dark' ? 'тёмная' : 'светлая'}</div>
            </div>
            <select
              className="select"
              value={theme.mode}
              onChange={(e) => theme.setMode(e.target.value as ThemeMode)}
              aria-label="Выбор темы"
            >
              <option value="system">Авто (системная)</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card__title">Чтение</div>
          <div className="card__subtitle">В демо-версии настройки чтения пока как заглушка.</div>
          <div className="chip-row">
            <span className="chip">Арабский</span>
            <span className="chip">Перевод</span>
            <span className="chip">Размер текста</span>
          </div>
        </div>

        <div className="card">
          <div className="card__title">Аудио</div>
          <div className="card__subtitle">
            Сейчас плеер работает в режиме UI-демо (без реального источника аудио).
          </div>
          <div className="chip-row">
            <span className="chip">Скорость</span>
            <span className="chip">Повтор</span>
            <span className="chip">Таймер сна</span>
          </div>
        </div>
      </section>
    </div>
  )
}

