import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SurahCard } from '../components/SurahCard'
import { demoSurahs, getSurahById } from '../data/demo'
import { formatTime } from '../lib/time'
import { usePlayer } from '../features/player/PlayerProvider'

export function HomePage() {
  const nav = useNavigate()
  const player = usePlayer()
  const [query, setQuery] = useState('')

  const continueSurah = useMemo(() => {
    if (!player.lastSession) return null
    return getSurahById(player.lastSession.surahId) ?? null
  }, [player.lastSession])

  const favorites = useMemo(
    () => demoSurahs.filter((s) => player.favorites.includes(s.id)),
    [player.favorites],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const byId = Number(q)
    if (!Number.isNaN(byId)) return demoSurahs.filter((s) => s.id === byId)
    return demoSurahs.filter((s) => s.name.toLowerCase().includes(q) || s.arabicName.includes(query.trim()))
  }, [query])

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">Quran</div>
        <div className="page__subtitle">Чтение и прослушивание</div>
      </header>

      <section className="section">
        <label className="input">
          <span className="input__label">Быстрый поиск</span>
          <input
            className="input__field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Номер или название суры"
            inputMode="search"
          />
        </label>

        {results.length ? (
          <div className="list">
            {results.map((surah) => (
              <SurahCard
                key={surah.id}
                surah={surah}
                onClick={() => nav(`/surah/${surah.id}`)}
                right={<span className="pill">Открыть</span>}
              />
            ))}
          </div>
        ) : null}
      </section>

      {continueSurah && player.lastSession ? (
        <section className="section">
          <div className="section__head">
            <div className="section__title">Продолжить</div>
            <button type="button" className="link" onClick={() => nav(`/surah/${continueSurah.id}`)}>
              Открыть
            </button>
          </div>

          <div className="card">
            <div className="card__row">
              <div>
                <div className="card__title">{continueSurah.name}</div>
                <div className="card__subtitle">
                  {continueSurah.arabicName} · {formatTime(player.lastSession.positionSec)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  player.openSurah(continueSurah.id)
                  player.seek(player.lastSession?.positionSec ?? 0)
                  nav(`/surah/${continueSurah.id}`)
                }}
              >
                Play
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section__head">
          <div className="section__title">Избранное</div>
          <button type="button" className="link" onClick={() => nav('/bookmarks')}>
            Все
          </button>
        </div>

        {favorites.length ? (
          <div className="scroll-row">
            {favorites.map((surah) => (
              <button
                key={surah.id}
                type="button"
                className="mini-card"
                onClick={() => nav(`/surah/${surah.id}`)}
              >
                <div className="mini-card__title">{surah.name}</div>
                <div className="mini-card__subtitle">{surah.arabicName}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            Добавь суры в избранное на экране плеера, чтобы они появились здесь.
          </div>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <div className="section__title">Популярное</div>
        </div>
        <div className="list">
          {demoSurahs.map((surah) => (
            <SurahCard
              key={surah.id}
              surah={surah}
              onClick={() => nav(`/surah/${surah.id}`)}
              right={<span className="pill">Play</span>}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

