import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SurahCard } from '../components/SurahCard'
import { demoSurahs, type Revelation } from '../data/demo'

type Filter = 'all' | Revelation

export function SurahsPage() {
  const nav = useNavigate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return demoSurahs
      .filter((s) => (filter === 'all' ? true : s.revelation === filter))
      .filter((s) => {
        if (!q) return true
        const byId = Number(q)
        if (!Number.isNaN(byId)) return s.id === byId
        return s.name.toLowerCase().includes(q) || s.arabicName.includes(query.trim())
      })
  }, [filter, query])

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">Суры</div>
        <div className="page__subtitle">Выбери суру для чтения или прослушивания</div>
      </header>

      <section className="section">
        <div className="grid-2">
          <label className="input">
            <span className="input__label">Поиск</span>
            <input
              className="input__field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Номер или название"
              inputMode="search"
            />
          </label>

          <label className="input">
            <span className="input__label">Фильтр</span>
            <select
              className="input__field"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              <option value="all">Все</option>
              <option value="Meccan">Мекканские</option>
              <option value="Medinan">Мединские</option>
            </select>
          </label>
        </div>
      </section>

      <section className="section">
        <div className="list">
          {list.map((surah) => (
            <SurahCard
              key={surah.id}
              surah={surah}
              onClick={() => nav(`/surah/${surah.id}`)}
              right={<span className="pill">Открыть</span>}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

