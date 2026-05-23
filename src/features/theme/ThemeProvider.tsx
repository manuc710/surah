import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { readJson, writeJson } from '../../lib/storage'

export type ThemeMode = 'system' | 'light' | 'dark'

type ThemeContextValue = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  resolved: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'quran.theme.mode'

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>(() => readJson<ThemeMode>(STORAGE_KEY, 'system'))
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(mode))

  useEffect(() => {
    writeJson(STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    const update = () => setResolved(resolveTheme(mode))
    update()

    if (mode !== 'system') return
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const handler = () => update()
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      resolved,
    }),
    [mode, resolved],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

