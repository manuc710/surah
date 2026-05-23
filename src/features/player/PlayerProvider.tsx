import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { demoSurahs, getSurahById } from '../../data/demo'
import { readJson, writeJson } from '../../lib/storage'

export type PlayerMode = 'listen' | 'read'

type LastSession = {
  surahId: number
  positionSec: number
}

type PlayerContextValue = {
  currentSurahId: number | null
  isPlaying: boolean
  positionSec: number
  durationSec: number
  mode: PlayerMode
  favorites: number[]
  lastSession: LastSession | null
  openSurah: (surahId: number) => void
  togglePlay: () => void
  seek: (positionSec: number) => void
  setMode: (mode: PlayerMode) => void
  toggleFavorite: (surahId: number) => void
  saveLastSession: (surahId: number, positionSec: number) => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const STORAGE_FAVORITES = 'quran.favorites.surahs'
const STORAGE_LAST = 'quran.last.session'

export function PlayerProvider({ children }: PropsWithChildren) {
  const [currentSurahId, setCurrentSurahId] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [positionSec, setPositionSec] = useState(0)
  const [durationSec, setDurationSec] = useState(0)
  const [mode, setMode] = useState<PlayerMode>('listen')
  const [favorites, setFavorites] = useState<number[]>(() => readJson<number[]>(STORAGE_FAVORITES, []))
  const [lastSession, setLastSession] = useState<LastSession | null>(() =>
    readJson<LastSession | null>(STORAGE_LAST, null),
  )

  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    writeJson(STORAGE_FAVORITES, favorites)
  }, [favorites])

  useEffect(() => {
    writeJson(STORAGE_LAST, lastSession)
  }, [lastSession])

  useEffect(() => {
    if (!isPlaying) return
    if (!currentSurahId) return

    tickRef.current = window.setInterval(() => {
      setPositionSec((p) => {
        const next = Math.min(p + 1, durationSec)
        if (next >= durationSec) {
          setIsPlaying(false)
        }
        return next
      })
    }, 1000)

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [currentSurahId, durationSec, isPlaying])

  useEffect(() => {
    if (!currentSurahId) return
    setLastSession({ surahId: currentSurahId, positionSec })
  }, [currentSurahId, positionSec])

  const openSurah = useCallback((surahId: number) => {
    const surah = getSurahById(surahId)
    setCurrentSurahId(surahId)
    setDurationSec(surah?.durationSec ?? demoSurahs[0]?.durationSec ?? 0)
    setPositionSec(0)
    setIsPlaying(false)
    setMode('listen')
  }, [])

  const togglePlay = useCallback(() => {
    if (!currentSurahId) return
    if (durationSec <= 0) return
    setIsPlaying((p) => !p)
  }, [currentSurahId, durationSec])

  const seek = useCallback(
    (next: number) => {
      if (!currentSurahId) return
      const clamped = Math.max(0, Math.min(next, durationSec))
      setPositionSec(clamped)
    },
    [currentSurahId, durationSec],
  )

  const toggleFavorite = useCallback((surahId: number) => {
    setFavorites((prev) => {
      if (prev.includes(surahId)) return prev.filter((id) => id !== surahId)
      return [surahId, ...prev]
    })
  }, [])

  const saveLastSession = useCallback((surahId: number, positionSec: number) => {
    setLastSession({ surahId, positionSec })
  }, [])

  const value = useMemo<PlayerContextValue>(
    () => ({
      currentSurahId,
      isPlaying,
      positionSec,
      durationSec,
      mode,
      favorites,
      lastSession,
      openSurah,
      togglePlay,
      seek,
      setMode,
      toggleFavorite,
      saveLastSession,
    }),
    [
      currentSurahId,
      durationSec,
      favorites,
      isPlaying,
      lastSession,
      mode,
      openSurah,
      seek,
      toggleFavorite,
      togglePlay,
      saveLastSession,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}

