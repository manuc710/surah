import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { SurahCard } from '../components/SurahCard'
import { demoSurahs } from '../data/demo'
import { usePlayer } from '../features/player/PlayerProvider'

export function BookmarksPage() {
  const nav = useNavigate()
  const player = usePlayer()

  const favorites = useMemo(
    () => demoSurahs.filter((s) => player.favorites.includes(s.id)),
    [player.favorites],
  )

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">Закладки</div>
        <div className="page__subtitle">Суры, которые ты отметил</div>
      </header>

      <section className="section">
        {favorites.length ? (
          <div className="list">
            {favorites.map((surah) => (
              <SurahCard
                key={surah.id}
                surah={surah}
                onClick={() => nav(`/surah/${surah.id}`)}
                right={
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      player.toggleFavorite(surah.id)
                    }}
                    aria-label="Убрать из избранного"
                    title="Убрать из избранного"
                  >
                    ✕
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <div className="empty">Пока нет избранных сур. Добавь их на экране плеера.</div>
        )}
      </section>
    </div>
  )
}

