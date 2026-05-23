import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAyahsBySurahId, getSurahById } from '../data/demo'
import { usePlayer } from '../features/player/PlayerProvider'
import { formatTime } from '../lib/time'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(n, max))
}

export function SurahPlayerPage() {
  const nav = useNavigate()
  const params = useParams()
  const player = usePlayer()

  const surahId = Number(params.surahId)
  const surah = useMemo(() => (Number.isFinite(surahId) ? getSurahById(surahId) : undefined), [surahId])
  const ayahs = useMemo(() => (surah ? getAyahsBySurahId(surah.id) : []), [surah])

  useEffect(() => {
    if (!surah) return
    if (player.currentSurahId === surah.id) return
    player.openSurah(surah.id)
  }, [player, surah])

  const isFavorite = surah ? player.favorites.includes(surah.id) : false

  const currentAyah = useMemo(() => {
    if (!surah) return null
    if (!ayahs.length) return null
    const k = player.durationSec > 0 ? player.positionSec / player.durationSec : 0
    const idx = clamp(Math.floor(k * ayahs.length), 0, ayahs.length - 1)
    return ayahs[idx] ?? null
  }, [ayahs, player.durationSec, player.positionSec, surah])

  if (!surah) {
    return (
      <div className="page">
        <header className="page__header">
          <div className="page__title">Сура не найдена</div>
          <button type="button" className="link" onClick={() => nav('/surahs')}>
            К списку сур
          </button>
        </header>
      </div>
    )
  }

  return (
    <div className="page page--player">
      <header className="player-top">
        <button type="button" className="icon-btn" onClick={() => nav(-1)} aria-label="Назад">
          ←
        </button>
        <div className="player-top__title">
          <div className="player-top__name">{surah.name}</div>
          <div className="player-top__sub">{surah.arabicName}</div>
        </div>
        <button
          type="button"
          className={`icon-btn ${isFavorite ? 'is-on' : ''}`}
          onClick={() => player.toggleFavorite(surah.id)}
          aria-label={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
          title={isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
        >
          ★
        </button>
      </header>

      <section className="section">
        <div className="cover">
          <div className="cover__arabic">{surah.arabicName}</div>
          <div className="cover__meta">
            <span className="pill">{surah.ayahCount} аятов</span>
            <span className="pill">{surah.revelation === 'Meccan' ? 'Мекка' : 'Медина'}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="segmented">
          <button
            type="button"
            className={`segmented__btn ${player.mode === 'listen' ? 'is-active' : ''}`}
            onClick={() => player.setMode('listen')}
          >
            Слушать
          </button>
          <button
            type="button"
            className={`segmented__btn ${player.mode === 'read' ? 'is-active' : ''}`}
            onClick={() => player.setMode('read')}
          >
            Читать
          </button>
        </div>
      </section>

      {player.mode === 'listen' ? (
        <section className="section">
          <div className="card">
            <div className="ayah-focus">
              <div className="ayah-focus__ar">{currentAyah?.ar ?? ''}</div>
              <div className="ayah-focus__ru">{currentAyah?.ru ?? ''}</div>
            </div>

            <div className="player">
              <div className="player__times">
                <span className="muted">{formatTime(player.positionSec)}</span>
                <span className="muted">{formatTime(player.durationSec)}</span>
              </div>

              <input
                className="range"
                type="range"
                min={0}
                max={player.durationSec || 0}
                value={player.positionSec}
                onChange={(e) => player.seek(Number(e.target.value))}
              />

              <div className="player__controls">
                <button type="button" className="btn" onClick={() => player.seek(player.positionSec - 10)}>
                  -10s
                </button>
                <button type="button" className="btn btn--primary" onClick={() => player.togglePlay()}>
                  {player.isPlaying ? 'Pause' : 'Play'}
                </button>
                <button type="button" className="btn" onClick={() => player.seek(player.positionSec + 10)}>
                  +10s
                </button>
              </div>

              <div className="chip-row">
                <span className="chip">Скорость</span>
                <span className="chip">Повтор</span>
                <span className="chip">Таймер сна</span>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="list">
            {ayahs.map((a) => (
              <button
                key={a.number}
                type="button"
                className="ayah-row"
                onClick={() => {
                  if (player.durationSec > 0) {
                    const k = (a.number - 1) / Math.max(1, ayahs.length)
                    player.seek(Math.floor(k * player.durationSec))
                  }
                }}
              >
                <div className="ayah-row__num">{a.number}</div>
                <div className="ayah-row__text">
                  <div className="ayah-row__ar">{a.ar}</div>
                  <div className="ayah-row__ru">{a.ru}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

