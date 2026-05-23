import type { ReactNode } from 'react'
import type { Surah } from '../data/demo'

type Props = {
  surah: Surah
  right?: ReactNode
  onClick?: () => void
}

export function SurahCard({ surah, right, onClick }: Props) {
  return (
    <div
      className="surah-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
    >
      <div className="surah-card__left">
        <div className="surah-card__meta">
          <span className="surah-card__id">{surah.id}</span>
          <span className="surah-card__badge">{surah.revelation === 'Meccan' ? 'Мекка' : 'Медина'}</span>
          <span className="surah-card__badge">{surah.ayahCount} аятов</span>
        </div>
        <div className="surah-card__title">{surah.name}</div>
        <div className="surah-card__subtitle">{surah.arabicName}</div>
      </div>
      {right ? <div className="surah-card__right">{right}</div> : null}
    </div>
  )
}
