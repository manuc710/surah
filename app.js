/* global window, document, navigator */

const NS = 'kyrilquran_html'
const $ = (sel) => document.querySelector(sel)
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined) node.setAttribute(k, String(v))
  }
  for (const c of children) {
    if (c === null || c === undefined) continue
    if (typeof c === 'string') node.appendChild(document.createTextNode(c))
    else if (c instanceof Node) node.appendChild(c)
    else node.appendChild(document.createTextNode(String(c)))
  }
  return node
}

function key(k) {
  return `${NS}.${k}`
}

function loadJSON(k, fallback) {
  try {
    const raw = localStorage.getItem(key(k))
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}
function saveJSON(k, v) {
  localStorage.setItem(key(k), JSON.stringify(v))
}

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00'
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const savedSettings = loadJSON('settings', { playbackRate: 1, volume: 1 })
const savedQuranTranslation = loadJSON('quranTranslation', 'ru.kuliev')

const state = {
  chapters: [],
  byId: new Map(),
  activePage: 'surahs', // surahs | chapter | bookmarks | settings | readers | reader | reading | quran | surah114
  q: '',
  quranQ: '',
  readingQ: '',
  chapterId: null,
  readerFolder: null,
  verseFocus: null,
  activeVerseId: null,
  bookmarks: new Set(loadJSON('bookmarks', [])),
  notes: loadJSON('notes', {}),
  playbackRate: Number.isFinite(Number(savedSettings.playbackRate)) ? Number(savedSettings.playbackRate) : 1,
  volume: Number.isFinite(Number(savedSettings.volume)) ? Number(savedSettings.volume) : 1,
  subSettings: loadJSON('subSettings', { enabled: true, fontSize: 20, color: '#ffffff', bgOpacity: 0.7 }),
  viewMode: loadJSON('viewMode', {}),
  ui: { modePickerOpen: false },
  audioLoadToken: 0,
  audioSourceToken: 0,
  audioCandidates: null,
  audioCandidateIndex: 0,
  playerLoading: false,
  playerError: '',
  playerAudioLabel: '',
  audioAnalysis: loadJSON('audioAnalysis', {}),
  quranTranslation: typeof savedQuranTranslation === 'string' ? savedQuranTranslation : 'id',
  quranSurahNumber: null,
  quranList: null,
  quranListLoading: false,
  quranListError: '',
  quranCache: {},
  quranCurrent: null,
  quranLoadToken: 0,
  readingSurahNumber: null,
  readingCache: {},
  readingCurrent: null,
  pendingQuranAutoplay: false,
  surah114: null,
  surah114Loading: false,
  surah114Error: '',
  surah114LoadToken: 0,
  surah114Q: '',
  surah114Limit: 30,
}

const KARAOKE_RECITERS = [
  { name: 'Abdullah Al-Juhany', folder: '01' },
  { name: 'Abdul Muhsin Al-Qasim', folder: '02' },
  { name: 'Abdurrahman as-Sudais', folder: '03' },
  { name: 'Ibrahim Al-Dossari', folder: '04' },
  { name: 'Misyari Rasyid Al-Afasi', folder: '05' },
]

const READING_RECITERS = [
  { name: 'Abdullah Al-Juhany', folder: '01', subtitle: 'Точный verse-by-verse' },
  { name: 'Abdul Muhsin Al-Qasim', folder: '02', subtitle: 'Точный verse-by-verse' },
  { name: 'Abdurrahman as-Sudais', folder: '03', subtitle: 'Точный verse-by-verse' },
  { name: 'Ibrahim Al-Dossari', folder: '04', subtitle: 'Точный verse-by-verse' },
  { name: 'Misyari Rasyid Al-Afasi', folder: '05', subtitle: 'Точный verse-by-verse' },
  { name: 'Yasser Al-Dosari', folder: '06', subtitle: 'Точный verse-by-verse' },
]

function getFullQuranReciters() {
  const data = window.__MP3QURAN_RECITERS__
  if (!data || typeof data !== 'object' || !Array.isArray(data.reciters)) return []
  return data.reciters.filter((r) => r && typeof r.folder === 'string' && typeof r.server === 'string')
}

function getFullQuranReciterByFolder(folder) {
  if (typeof folder !== 'string' || !folder) return null
  return getFullQuranReciters().find((r) => r.folder === folder) || null
}

function getDefaultFullQuranReciter() {
  const list = getFullQuranReciters()
  return list.length ? list[0] : null
}

function readSelectedReciter() {
  try {
    const raw = localStorage.getItem('selectedReciter') || localStorage.getItem(key('selectedReciter'))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeSelectedReciter(reciter) {
  const v = reciter ? { name: reciter.name, folder: reciter.folder } : null
  if (!v) {
    localStorage.removeItem('selectedReciter')
    localStorage.removeItem(key('selectedReciter'))
    return
  }
  localStorage.setItem('selectedReciter', JSON.stringify(v))
  saveJSON('selectedReciter', v)
}

function readSelectedQuranReciter() {
  try {
    const raw = localStorage.getItem('selectedQuranReciter') || localStorage.getItem(key('selectedQuranReciter'))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return getFullQuranReciterByFolder(String(parsed.folder || '')) || null
  } catch {
    return null
  }
}

function getActiveFullQuranReciter() {
  return readSelectedQuranReciter() || getDefaultFullQuranReciter()
}

function writeSelectedQuranReciter(reciter) {
  const v = reciter ? { name: reciter.name, folder: reciter.folder } : null
  if (!v) {
    localStorage.removeItem('selectedQuranReciter')
    localStorage.removeItem(key('selectedQuranReciter'))
    return
  }
  localStorage.setItem('selectedQuranReciter', JSON.stringify(v))
  saveJSON('selectedQuranReciter', v)
}

function getReadingReciters() {
  return READING_RECITERS.slice()
}

function getReadingReciterByFolder(folder) {
  if (typeof folder !== 'string' || !folder) return null
  return READING_RECITERS.find((r) => r.folder === folder) || null
}

function readSelectedReadingReciter() {
  try {
    const raw = localStorage.getItem('selectedReadingReciter') || localStorage.getItem(key('selectedReadingReciter'))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return getReadingReciterByFolder(String(parsed.folder || '')) || null
  } catch {
    return null
  }
}

function writeSelectedReadingReciter(reciter) {
  const v = reciter ? { name: reciter.name, folder: reciter.folder } : null
  if (!v) {
    localStorage.removeItem('selectedReadingReciter')
    localStorage.removeItem(key('selectedReadingReciter'))
    return
  }
  localStorage.setItem('selectedReadingReciter', JSON.stringify(v))
  saveJSON('selectedReadingReciter', v)
  writeSelectedReciter(reciter)
}

function getActiveReadingReciter() {
  return readSelectedReadingReciter() || getReadingReciterByFolder('05') || READING_RECITERS[0] || null
}

function padSurahNumber(n) {
  return String(Number(n) || 0).padStart(3, '0')
}

function buildMp3QuranSurahUrl(server, surahNumber) {
  const base = typeof server === 'string' ? server.trim() : ''
  const sn = Number(surahNumber)
  if (!base || !Number.isFinite(sn) || sn < 1 || sn > 114) return ''
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}${padSurahNumber(sn)}.mp3`
}

function getReciterInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'Q'
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

function saveSubSettings() {
  saveJSON('subSettings', state.subSettings)
  updateSubtitles(audio.currentTime)
}

function saveAudioAnalysis() {
  saveJSON('audioAnalysis', state.audioAnalysis)
}

function getChapterMode(chapterId) {
  const v = chapterId ? state.viewMode[chapterId] : null
  return v === 'listen' ? 'listen' : 'read'
}

function isListenModeActive() {
  return state.activePage === 'chapter' && state.chapterId && getChapterMode(state.chapterId) === 'listen'
}

function syncListenModeClass() {
  document.body.classList.toggle('listen-mode', !!isListenModeActive())
}

function setChapterMode(chapterId, mode) {
  if (!chapterId) return
  state.viewMode[chapterId] = mode === 'listen' ? 'listen' : 'read'
  saveJSON('viewMode', state.viewMode)
  state.ui.modePickerOpen = false
  syncListenModeClass()
  render()
}

async function resolveAudioForChapter(chapter) {
  if (!chapter) return { candidates: [], label: '' }
  // Provide full path if it's a relative path starting with kyril
  let url = chapter.audioUrl
  if (url && !url.startsWith('http') && !url.startsWith('/')) {
    url = `/${url}`
  }
  if (!url) return { candidates: [], label: '' }
  return { candidates: [url], label: 'Локальное аудио' }
}

function getCachedAudioAnalysis(chapterId, duration) {
  if (!chapterId) return null
  const v = state.audioAnalysis ? state.audioAnalysis[chapterId] : null
  if (!v || typeof v !== 'object') return null
  if (!Number.isFinite(v.duration) || !Number.isFinite(v.leadIn)) return null
  if (!Number.isFinite(duration) || duration <= 0) return null
  if (Math.abs(v.duration - duration) > 0.75) return null
  return v
}

let audioCtx = null
const analysisInFlight = new Map()

function getAudioContext() {
  if (audioCtx) return audioCtx
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  audioCtx = new Ctx()
  return audioCtx
}

function clamp(n, a, b) {
  const x = Number(n)
  if (!Number.isFinite(x)) return a
  return Math.max(a, Math.min(b, x))
}

function computeAudioAnalysisFromBuffer(buf, duration) {
  const channel = buf.getChannelData(0)
  const sampleRate = buf.sampleRate || 44100
  const step = Math.max(1, Math.floor(sampleRate * 0.05))
  const win = step
  const energies = []

  for (let i = 0; i + win < channel.length; i += step) {
    let sum = 0
    for (let j = 0; j < win; j++) {
      const s = channel[i + j]
      sum += s * s
    }
    energies.push(Math.sqrt(sum / win))
  }

  if (!energies.length) return { duration, leadIn: 0, pauses: [] }

  const sorted = energies.slice().sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.12)] || 0
  const startThreshold = Math.max(noiseFloor * 5, 0.012)
  const silenceThreshold = Math.max(noiseFloor * 2.2, 0.008)

  let leadIndex = 0
  let streak = 0
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] > startThreshold) streak++
    else streak = 0
    if (streak >= 4) {
      leadIndex = Math.max(0, i - 3)
      break
    }
  }
  const leadIn = clamp((leadIndex * step) / sampleRate, 0, Math.min(8, duration * 0.4))

  const pauses = []
  let runStart = -1
  for (let i = 0; i < energies.length; i++) {
    const isSilence = energies[i] < silenceThreshold
    if (isSilence) {
      if (runStart === -1) runStart = i
    } else if (runStart !== -1) {
      const runLen = i - runStart
      if (runLen >= 6) {
        const mid = runStart + Math.floor(runLen / 2)
        const t = (mid * step) / sampleRate
        if (t > 0.15 && t < duration - 0.15) pauses.push(t)
      }
      runStart = -1
    }
  }
  if (runStart !== -1) {
    const runLen = energies.length - runStart
    if (runLen >= 6) {
      const mid = runStart + Math.floor(runLen / 2)
      const t = (mid * step) / sampleRate
      if (t > 0.15 && t < duration - 0.15) pauses.push(t)
    }
  }

  return { duration, leadIn, pauses }
}

async function ensureAudioAnalysisForChapter(chapter) {
  if (!chapter || !chapter.id || !chapter.audioUrl) return null
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  if (!duration) return null

  const cached = getCachedAudioAnalysis(chapter.id, duration)
  if (cached) return cached

  if (analysisInFlight.has(chapter.id)) return analysisInFlight.get(chapter.id)

  const ctx = getAudioContext()
  if (!ctx) return null

  const p = (async () => {
    try {
      if (ctx.state === 'suspended') await ctx.resume()
      const res = await fetch(chapter.audioUrl, { cache: 'force-cache' })
      const arr = await res.arrayBuffer()
      const buf = await ctx.decodeAudioData(arr.slice(0))
      const a = computeAudioAnalysisFromBuffer(buf, duration || buf.duration || 0)
      state.audioAnalysis[chapter.id] = a
      saveAudioAnalysis()
      return a
    } catch {
      return null
    } finally {
      analysisInFlight.delete(chapter.id)
    }
  })()

  analysisInFlight.set(chapter.id, p)
  return p
}

const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const nextIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`;
const prevIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`;
const userIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const repeatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 12h4"/><path d="M18 16h4"/></svg>`;
const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const ccIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;

// --- audio player ---
const audio = new Audio()
audio.preload = 'metadata'
audio.playbackRate = state.playbackRate
audio.volume = clamp(state.volume, 0, 1)

function setPlaybackRate(rate) {
  const r = Number(rate)
  if (!Number.isFinite(r) || r <= 0) return
  state.playbackRate = r
  audio.playbackRate = r
  saveJSON('settings', { playbackRate: r, volume: state.volume })
  renderPlayer()
}

function setVolume(v) {
  const n = clamp(Number(v), 0, 1)
  state.volume = n
  audio.volume = n
  saveJSON('settings', { playbackRate: state.playbackRate, volume: n })
}

let prefetchAudio = null

function setAudioCandidates(candidates, token) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  state.audioSourceToken = token
  state.audioCandidates = list
  state.audioCandidateIndex = 0
  state.playerLoading = false
  state.playerError = ''
  audio.pause()
  audio.src = list[0] || ''
  if (audio.src) audio.load()
}

function prefetchNextChapterAudio() {
  const idx = state.chapters.findIndex((c) => c.id === state.chapterId)
  const next = idx >= 0 ? state.chapters[Math.min(state.chapters.length - 1, idx + 1)] : null
  if (!next) return

  resolveAudioForChapter(next)
    .then((r) => {
      const url = r && Array.isArray(r.candidates) ? r.candidates[0] : null
      if (!url) return
      prefetchAudio = new Audio()
      prefetchAudio.preload = 'auto'
      prefetchAudio.src = url
      prefetchAudio.load()
    })
    .catch(() => {})
}

function setChapter(chapterId, { autoplay = false } = {}) {
  const ch = chapterId ? state.byId.get(chapterId) : null
  state.chapterId = ch ? ch.id : null
  saveJSON('lastChapterId', state.chapterId)
  state.playerError = ''
  state.playerAudioLabel = ''
  state.playerLoading = !!ch

  const token = ++state.audioLoadToken

  if (!ch) {
    audio.pause()
    audio.src = ''
    state.playerLoading = false
    renderPlayer()
    return
  }

  audio.pause()
  audio.src = ''

  if (window.karaokePlayer && typeof window.karaokePlayer.setChapter === 'function') {
    window.karaokePlayer.setChapter(ch)
  }

  resolveAudioForChapter(ch)
    .then((r) => {
      if (state.audioLoadToken !== token) return
      const candidates = r && Array.isArray(r.candidates) ? r.candidates : []
      if (!candidates.length || !candidates[0]) {
        state.playerLoading = false
        state.playerError = 'Аудио недоступно'
        renderPlayer()
        return
      }
      state.playerAudioLabel = r.label || ''
      setAudioCandidates(candidates, token)
      renderPlayer()
      if (autoplay) audio.play().catch(() => {})
      prefetchNextChapterAudio()
    })
    .catch(() => {
      if (state.audioLoadToken !== token) return
      state.playerLoading = false
      state.playerError = 'Не удалось загрузить аудио'
      renderPlayer()
    })
}

function nextChapter() {
  const idx = state.chapters.findIndex((c) => c.id === state.chapterId)
  const next = state.chapters[Math.min(state.chapters.length - 1, idx + 1)]
  if (next) {
    setChapter(next.id, { autoplay: true })
    gotoChapter(next.id)
  }
}
function prevChapter() {
  const idx = state.chapters.findIndex((c) => c.id === state.chapterId)
  const prev = state.chapters[Math.max(0, idx - 1)]
  if (prev) {
    setChapter(prev.id, { autoplay: true })
    gotoChapter(prev.id)
  }
}

audio.addEventListener('timeupdate', updatePlayerProgress)
audio.addEventListener('durationchange', () => {
  generateTimings();
  updatePlayerProgress();
})
audio.addEventListener('loadedmetadata', () => {
  generateTimings()
  updatePlayerProgress()
})
audio.addEventListener('play', updatePlayerProgress)
audio.addEventListener('pause', updatePlayerProgress)
audio.addEventListener('ended', updatePlayerProgress)
audio.addEventListener('seeked', updatePlayerProgress)
audio.addEventListener('error', () => {
  if (state.audioSourceToken !== state.audioLoadToken) return
  if (!state.chapterId) return
  const list = state.audioCandidates
  if (!Array.isArray(list) || !list.length) return
  const i = Number(state.audioCandidateIndex) || 0
  if (i < 0 || i >= list.length) return
  if (audio.src !== list[i]) return

  const next = i + 1
  if (next < list.length) {
    state.audioCandidateIndex = next
    const ch = state.byId.get(state.chapterId)
    if (ch && list[next] === ch.audioUrl) state.playerAudioLabel = 'Локальное аудио'
    audio.pause()
    audio.src = list[next]
    audio.load()
    renderPlayer()
    return
  }

  state.playerLoading = false
  state.playerError = 'Не удалось загрузить аудио'
  renderPlayer()
})

function snapTimingsToPauses(timings, pauses, duration, opts = {}) {
  if (!Array.isArray(timings) || timings.length < 2) return
  if (!Array.isArray(pauses) || !pauses.length) return

  const windowSec = Number.isFinite(opts.windowSec) ? opts.windowSec : 1.2
  const minGap = Number.isFinite(opts.minGap) ? opts.minGap : 0.35
  const tail = Number.isFinite(opts.tail) ? opts.tail : 0.35

  let start = timings[0].start
  for (let i = 0; i < timings.length - 1; i++) {
    const proposed = timings[i].end
    let best = null
    let bestDist = Infinity
    for (let p = 0; p < pauses.length; p++) {
      const t = pauses[p]
      if (t <= start + minGap) continue
      if (t >= duration - tail) continue
      const d = Math.abs(t - proposed)
      if (d <= windowSec && d < bestDist) {
        bestDist = d
        best = t
      }
    }
    const boundary = best !== null && best - start >= minGap ? best : proposed
    timings[i].start = start
    timings[i].end = boundary
    timings[i + 1].start = boundary
    start = boundary
  }
  timings[timings.length - 1].end = duration
}

function generateTimings(force = false) {
  const chapter = state.chapterId ? state.byId.get(state.chapterId) : null;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (!chapter || !duration || !chapter.verses) return;
  
  if (!force && chapter.timings && Math.abs(chapter.timingsDuration - duration) < 1) return;

  const analysis = getCachedAudioAnalysis(chapter.id, duration)
  const leadIn = analysis ? clamp(analysis.leadIn, 0, Math.min(8, duration * 0.4)) : 0
  const speechDuration = Math.max(0.1, duration - leadIn)

  const verseWeights = chapter.verses.map((v) => {
    const arabicLen = (v.arabic || '').length
    const translitLen = (v.translit || '').length
    const translationLen = (v.translation || '').length
    const w = arabicLen * 1 + translitLen * 0.15 + translationLen * 0.1
    return Math.max(1, w)
  })

  const n = chapter.verses.length
  const minDur = 1.05
  const baseTotal = Math.min(speechDuration, n * minDur)
  const extraTotal = Math.max(0, speechDuration - baseTotal)
  const weightsSum = verseWeights.reduce((a, b) => a + b, 0) || 1

  let start = leadIn
  chapter.timings = chapter.verses.map((v, i) => {
    const base = baseTotal / n
    const extra = (verseWeights[i] / weightsSum) * extraTotal
    const dur = base + extra
    const end = start + dur
    const t = { index: v.index, start, end, arabic: v.arabic, translation: v.translation }
    start = end
    return t
  })

  if (chapter.timings.length) {
    chapter.timings[chapter.timings.length - 1].end = duration
  }
  if (analysis && Array.isArray(analysis.pauses) && analysis.pauses.length) {
    snapTimingsToPauses(chapter.timings, analysis.pauses, duration)
  }
  chapter.timingsDuration = duration;
}

function updatePlayerProgress() {
  const isPlaying = !audio.paused && !!audio.src;
  const btnPlay = document.querySelector('.btn-play');
  if (btnPlay) {
    btnPlay.title = isPlaying ? 'Пауза' : 'Играть';
    btnPlay.innerHTML = isPlaying ? pauseIcon : playIcon;
  }
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  
  updateSubtitles(currentTime);
}


function updateSubtitles(currentTime) {
  const display = document.getElementById('subtitle-display');
  if (!display) return;
  
  if (!state.subSettings.enabled) {
    display.style.display = 'none';
    return;
  }
  
  const chapter = state.chapterId ? state.byId.get(state.chapterId) : null;
  if (!chapter || !chapter.timings) {
    display.style.display = 'none';
    return;
  }
  
  const activeVerse = chapter.timings.find((t) => currentTime >= t.start && currentTime <= t.end);
  if (activeVerse) {
    display.style.display = 'block';
    
    display.style.backgroundColor = `rgba(0, 0, 0, ${state.subSettings.bgOpacity})`;
    
    const arEl = display.querySelector('.sub-arabic');
    const trEl = display.querySelector('.sub-translation');
    if (!arEl || !trEl) return;
    
    if (arEl.dataset.index !== String(activeVerse.index)) {
      arEl.dataset.index = activeVerse.index;
      arEl.textContent = activeVerse.arabic;
      trEl.textContent = activeVerse.translation;
      
      // Auto-scroll the main view if chapter is open
      if (state.activePage === 'chapter' && state.chapterId === chapter.id) {
         const verseEl = document.getElementById(`v-${activeVerse.index}`);
         if (verseEl) {
             document.querySelectorAll('.verse.active').forEach(e => e.classList.remove('active'));
             verseEl.classList.add('active');
             verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
         }
      }
    }
    
    arEl.style.fontSize = state.subSettings.fontSize + 'px';
    arEl.style.color = state.subSettings.color;
    trEl.style.fontSize = Math.max(12, state.subSettings.fontSize - 6) + 'px';
    trEl.style.color = state.subSettings.color;
  } else {
    display.style.display = 'none';
  }
}

// --- navigation via location.hash ---
function parseHash() {
  const raw = (window.location.hash || '').replace(/^#/, '')
  const params = new URLSearchParams(raw)
  const page = params.get('page') || 'surahs'
  const chapter = params.get('chapter')
  const reciter = params.get('reciter')
  const surah = params.get('surah')
  const v = params.get('v')
  const tr = params.get('tr')
  return { page, chapter, reciter, surah: surah ? Number(surah) : null, v: v ? Number(v) : null, tr }
}

function setHash(obj) {
  const p = new URLSearchParams()
  if (obj.page) p.set('page', obj.page)
  if (obj.chapter) p.set('chapter', obj.chapter)
  if (obj.reciter) p.set('reciter', obj.reciter)
  if (obj.surah) p.set('surah', String(obj.surah))
  if (obj.v) p.set('v', String(obj.v))
  if (obj.tr) p.set('tr', String(obj.tr))
  const s = p.toString()
  window.location.hash = s ? `#${s}` : '#'
}

function gotoSurahs() {
  setHash({ page: 'surahs' })
}
function gotoReaders() {
  setHash({ page: 'readers' })
}
function gotoReading(surah = null) {
  setHash({ page: 'reading', surah })
}
function gotoReader(reciterFolder) {
  setHash({ page: 'reader', reciter: reciterFolder })
}
function gotoBookmarks() {
  setHash({ page: 'bookmarks' })
}
function gotoSettings() {
  setHash({ page: 'settings' })
}
function gotoChapter(chapterId, v = null) {
  setHash({ page: 'chapter', chapter: chapterId, v })
}
function gotoQuran(surah = null, tr = null) {
  setHash({ page: 'quran', surah, tr })
}
function gotoSurah114() {
  setHash({ page: 'surah114' })
}

window.addEventListener('hashchange', () => {
  const prevChapterId = state.chapterId
  syncFromHash()
  render()
  if (state.chapterId && state.chapterId !== prevChapterId) {
    setChapter(state.chapterId, { autoplay: false })
  }
})

function syncFromHash() {
  const { page, chapter, reciter, surah, v, tr } = parseHash()
  state.activePage = ['chapter', 'bookmarks', 'settings', 'readers', 'reader', 'reading', 'surahs', 'quran', 'surah114'].includes(page)
    ? page
    : 'surahs'
  state.chapterId = chapter && state.byId.has(chapter) ? chapter : state.chapterId
  state.readerFolder = typeof reciter === 'string' && reciter ? reciter : null
  state.quranSurahNumber = state.activePage === 'quran' && Number.isFinite(surah) && surah >= 1 && surah <= 114 ? surah : null
  state.readingSurahNumber = state.activePage === 'reading' && Number.isFinite(surah) && surah >= 1 && surah <= 114 ? surah : null
  state.verseFocus = Number.isFinite(v) && v > 0 ? v : null
  if (typeof tr === 'string' && tr) state.quranTranslation = tr
}

// --- bookmarks / notes ---
function verseKey(chapterId, verseIndex) {
  return `${chapterId}:${verseIndex}`
}
function toggleBookmark(chapterId, verseIndex) {
  const id = verseKey(chapterId, verseIndex)
  if (state.bookmarks.has(id)) state.bookmarks.delete(id)
  else state.bookmarks.add(id)
  saveJSON('bookmarks', Array.from(state.bookmarks))
  render()
}
function setNote(chapterId, verseIndex, note) {
  const id = verseKey(chapterId, verseIndex)
  const t = String(note || '').trim()
  if (!t) delete state.notes[id]
  else state.notes[id] = t
  saveJSON('notes', state.notes)
  render()
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    alert('Ссылка скопирована')
  } catch {
    prompt('Скопируйте ссылку:', text)
  }
}

// --- render ---
function renderNav() {
  const navSurahs = $('#nav-surahs')
  const navReaders = $('#nav-readers')
  const navReading = $('#nav-reading')
  const navSettings = $('#nav-settings')

  if (navSurahs)
    navSurahs.classList.toggle(
      'active',
      state.activePage === 'surahs' || state.activePage === 'chapter' || state.activePage === 'quran' || state.activePage === 'surah114',
    )
  if (navReaders) navReaders.classList.toggle('active', state.activePage === 'readers' || state.activePage === 'reader')
  if (navReading) navReading.classList.toggle('active', state.activePage === 'reading')
  if (navSettings) navSettings.classList.toggle('active', state.activePage === 'settings' || state.activePage === 'bookmarks')
}

function renderReaders() {
  const root = $('#view')
  root.innerHTML = ''
  const selected = getActiveFullQuranReciter()
  const allReciters = getFullQuranReciters()

  root.appendChild(el('h1', {}, ['Чтецы']))

  root.appendChild(
    el('div', { class: 'searchbar', style: 'margin-top:16px' }, [
      el('input', {
        id: 'readers-search',
        value: '',
        placeholder: 'Поиск чтеца…',
        autocapitalize: 'off',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
      }),
    ]),
  )

  const currentLine = selected && selected.folder ? `Текущий: ${selected.name || selected.folder}` : 'Текущий: не выбран'
  root.appendChild(el('p', { class: 'muted', id: 'readers-current', style: 'margin-top:10px' }, [currentLine]))

  root.appendChild(el('div', { class: 'readers-grid', id: 'readers-grid' }))
  root.appendChild(el('p', { class: 'muted', id: 'readers-empty', style: 'margin-top:12px; display:none' }, ['']))

  const update = () => {
    const grid = $('#readers-grid')
    const empty = $('#readers-empty')
    const current = $('#readers-current')
    if (!grid || !empty || !current) return

    const q = String($('#readers-search')?.value || '').toLowerCase().trim()
    const list = !q
      ? allReciters
      : allReciters.filter((r) => `${r.name} ${r.style || ''}`.toLowerCase().includes(q))

    const sel = getActiveFullQuranReciter()
    current.textContent = sel && sel.folder ? `Текущий: ${sel.name || sel.folder}` : 'Текущий: не выбран'

    grid.innerHTML = ''
    for (const r of list) {
      const isSelected = !!sel && sel.folder === r.folder
      const card = el('button', {
        type: 'button',
        class: isSelected ? 'reader-card selected' : 'reader-card',
        onclick: () => {
          writeSelectedQuranReciter(r)
          gotoReader(r.folder)
        },
      })

      if (isSelected) card.appendChild(el('span', { class: 'reader-badge' }, ['Выбрано']))
      card.appendChild(el('div', { class: 'reader-avatar' }, [getReciterInitials(r.name)]))
      card.appendChild(el('div', { class: 'reader-name' }, [r.name]))
      grid.appendChild(card)
    }

    if (!list.length) {
      empty.textContent = 'Ничего не найдено'
      empty.style.display = 'block'
    } else {
      empty.style.display = 'none'
    }
  }

  const input = $('#readers-search')
  if (input) input.addEventListener('input', update)
  update()
}

function getSurahMetaForReader(surahNumber) {
  const sn = Number(surahNumber)
  if (!Number.isFinite(sn) || sn < 1 || sn > 114) return null
  const local = getLocalQuran114()
  if (local && Array.isArray(local.surahs)) {
    return local.surahs.find((s) => Number(s && s.number) === sn) || null
  }
  if (Array.isArray(state.quranList)) {
    const s = state.quranList.find((item) => Number(item && item.number) === sn)
    if (!s) return null
    return {
      number: sn,
      arabicName: s.name,
      transliteratedName: s.englishName,
      numberOfAyahs: s.numberOfAyahs,
    }
  }
  return null
}

async function playReaderSurah(reciter, surahNumber) {
  const sn = Number(surahNumber)
  if (!reciter || !Number.isFinite(sn) || sn < 1 || sn > 114) return
  writeSelectedQuranReciter(reciter)
  state.pendingQuranAutoplay = false
  await ensureQuranSurahLoaded(sn, state.quranTranslation)
  const chapter = state.quranCurrent && state.quranCurrent.surahNumber === sn ? state.quranCurrent : null
  if (!chapter || chapter.error) {
    render()
    return
  }
  audio.pause()
  if (window.karaokePlayer && typeof window.karaokePlayer.setChapter === 'function') {
    window.karaokePlayer.setChapter(chapter)
  }
  render()
  if (window.karaokePlayer && typeof window.karaokePlayer.play === 'function') {
    window.karaokePlayer.play()
  }
}

function renderReaderProfile() {
  const root = $('#view')
  root.innerHTML = ''

  const reciter = getFullQuranReciterByFolder(state.readerFolder || '') || getActiveFullQuranReciter()
  if (!reciter) {
    root.appendChild(el('h1', {}, ['Чтец не найден']))
    root.appendChild(el('div', { class: 'actions', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', onclick: gotoReaders }, ['← Все чтецы']),
    ]))
    return
  }

  writeSelectedQuranReciter(reciter)
  ensureQuranListLoaded()

  const surahNumbers = Array.isArray(reciter.surahs) ? [...reciter.surahs].sort((a, b) => a - b) : []
  const playAll = () => {
    playReaderSurah(reciter, surahNumbers[0] || 1)
  }

  root.appendChild(
    el('div', { class: 'reader-hero' }, [
      el('div', { class: 'reader-hero-banner' }, [
        el('div', { class: 'reader-hero-banner-glow' }),
        el('div', { class: 'reader-hero-banner-pattern' }),
      ]),
      el('div', { class: 'reader-hero-top' }, [
        el('button', { class: 'btn', onclick: gotoReaders }, ['← Все чтецы']),
      ]),
      el('div', { class: 'reader-hero-head' }, [
        el('div', { class: 'reader-hero-avatar' }, [getReciterInitials(reciter.name)]),
        el('div', { class: 'reader-hero-meta' }, [
          el('div', { class: 'reader-hero-kicker' }, ['Чтец']),
          el('h1', { class: 'reader-hero-title' }, [reciter.name]),
          el('p', { class: 'reader-hero-subtitle' }, [
            `${surahNumbers.length} сур${surahNumbers.length === 1 ? 'а' : ''} • mp3quran`,
          ]),
        ]),
      ]),
      el('div', { class: 'actions', style: 'margin-top:14px; justify-content:flex-start;' }, [
        el('button', { class: 'btn primary reader-play-all', onclick: playAll, title: 'Играть все' }, [
          el('span', {
            class: 'reader-play-all-svg',
            html: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="8 5 19 12 8 19 8 5"></polygon></svg>',
          }),
          el('span', { class: 'reader-play-all-text' }, ['Играть все']),
        ]),
      ]),
    ]),
  )

  root.appendChild(el('h2', { class: 'reader-section-title' }, ['Суры']))
  root.appendChild(
    el('div', { class: 'reader-track-head' }, [
      el('div', { class: 'reader-track-head-num' }, ['#']),
      el('div', { class: 'reader-track-head-title' }, ['Сура']),
      el('div', { class: 'reader-track-head-count' }, ['Аяты']),
      el('div', { class: 'reader-track-head-action' }, ['']),
    ]),
  )
  const list = el('div', { class: 'reader-surah-list' })

  for (const sn of surahNumbers) {
    const meta = getSurahMetaForReader(sn)
    const translit = String((meta && meta.transliteratedName) || `Сура ${sn}`)
    const arabic = String((meta && meta.arabicName) || '')
    const ayahs = Number((meta && meta.numberOfAyahs) || 0)
    const isActive =
      (state.activePage === 'reader' && state.quranCurrent && state.quranCurrent.surahNumber === sn) || state.quranSurahNumber === sn
    const row = el('button', {
      type: 'button',
      class: isActive ? 'reader-surah-row active' : 'reader-surah-row',
      onclick: () => playReaderSurah(reciter, sn),
    })
    row.appendChild(el('div', { class: 'reader-surah-num' }, [String(sn).padStart(2, '0')]))
    row.appendChild(
      el('div', { class: 'reader-surah-meta' }, [
        el('div', { class: 'reader-surah-title' }, [translit]),
        arabic ? el('div', { class: 'reader-surah-arabic' }, [arabic]) : null,
      ].filter(Boolean)),
    )
    row.appendChild(el('div', { class: 'reader-surah-count' }, [ayahs ? String(ayahs) : '']))
    row.appendChild(el('div', { class: 'reader-surah-action' }, ['▶']))
    list.appendChild(row)
  }

  root.appendChild(list)
}

function renderSettings() {
  const root = $('#view')
  root.innerHTML = ''
  root.appendChild(el('h1', {}, ['Настройки']))
  root.appendChild(el('p', { class: 'muted' }, ['Раздел настроек находится в разработке.']))
  root.appendChild(
    el('div', { class: 'actions', style: 'margin-top:14px; justify-content:flex-start;' }, [
      el('button', { class: 'btn', onclick: gotoBookmarks }, [`Избранное (${state.bookmarks.size})`]),
    ]),
  )
}

const QURAN_TRANSLATIONS = [{ id: 'id', label: 'Локальный файл 114' }]

function getLocalQuran114() {
  const data = window.__QURAN114__
  if (!data || typeof data !== 'object') return null
  if (data.fileId !== '114' || !Array.isArray(data.surahs) || data.surahs.length !== 114) return null
  return data
}

async function ensureQuranListLoaded() {
  if (Array.isArray(state.quranList) && state.quranList.length) return
  if (state.quranListLoading) return
  state.quranListLoading = true
  state.quranListError = ''
  try {
    const local = getLocalQuran114()
    if (local) {
      state.quranList = local.surahs.map((s) => ({
        number: s.number,
        name: s.arabicName,
        englishName: s.transliteratedName,
        englishNameTranslation: '',
        numberOfAyahs: s.numberOfAyahs,
      }))
      state.quranTranslation = 'id'
      saveJSON('quranTranslation', 'id')
      return
    }
    const res = await fetch('https://equran.id/api/v2/surat')
    const json = await res.json()
    const list = json && json.data && Array.isArray(json.data) ? json.data : null
    if (!list) throw new Error('Bad response')
    state.quranList = list.map((s) => ({
      number: s.nomor,
      name: s.nama,
      englishName: s.namaLatin,
      englishNameTranslation: s.arti,
      numberOfAyahs: s.jumlahAyat,
    }))
  } catch {
    state.quranListError = 'Не удалось загрузить список сур'
  } finally {
    state.quranListLoading = false
    render()
  }
}

async function ensureQuranSurahLoaded(surahNumber, translationId) {
  const sn = Number(surahNumber)
  if (!Number.isFinite(sn) || sn < 1 || sn > 114) return
  const local = getLocalQuran114()
  if (local) {
    const selectedReciter = getActiveFullQuranReciter()
    const reciterKey = selectedReciter && selectedReciter.folder ? selectedReciter.folder : 'none'
    const cacheKey = `${sn}:id:${reciterKey}`
    if (state.quranCurrent && state.quranCurrent.cacheKey === cacheKey) return
    if (state.quranCache[cacheKey]) {
      state.quranCurrent = state.quranCache[cacheKey]
      return
    }
    const surah = local.surahs.find((item) => Number(item && item.number) === sn)
    if (!surah) {
      state.quranCurrent = { id: `quran-${sn}`, cacheKey, surahNumber: sn, error: 'Не удалось загрузить суру' }
      return
    }
    const chapter = {
      id: `quran-${sn}`,
      cacheKey,
      surahNumber: sn,
      arabicTitle: String(surah.arabicName || ''),
      displayTitle: `${sn}. ${String(surah.transliteratedName || '')}`,
      title: '',
      audioMode: selectedReciter ? 'full-surah' : '',
      audioUrl: selectedReciter ? buildMp3QuranSurahUrl(selectedReciter.server, sn) : '',
      reciterName: selectedReciter ? String(selectedReciter.name || '') : '',
      reciterStyle: selectedReciter ? String(selectedReciter.style || '') : '',
      audioFull: surah.audioFull || {},
      verses: Array.isArray(surah.verses)
        ? surah.verses.map((v) => ({
            index: Number(v && v.index),
            arabic: String((v && v.arabic) || ''),
            translit: String((v && v.translit) || ''),
            audio: (v && v.audio) || {},
          }))
        : [],
    }
    state.quranCache[cacheKey] = chapter
    state.quranCurrent = chapter
    state.quranTranslation = 'id'
    saveJSON('quranTranslation', 'id')
    return
  }
  const tr = typeof translationId === 'string' && translationId ? translationId : 'id'
  const cacheKey = `${sn}:${tr}`
  if (state.quranCurrent && state.quranCurrent.cacheKey === cacheKey) return
  if (state.quranCache[cacheKey]) {
    state.quranCurrent = state.quranCache[cacheKey]
    return
  }

  const token = ++state.quranLoadToken
  state.quranCurrent = null
  try {
    const baseUrl = tr === 'en' ? 'https://equran.id/api/en/surah' : 'https://equran.id/api/v2/surat'
    const url = `${baseUrl}/${sn}`
    const res = await fetch(url)
    const json = await res.json()
    const data = json && json.data ? json.data : null
    if (!data) throw new Error('Bad response')

    const verses = []
    const ayahs = Array.isArray(data.ayat) ? data.ayat : []
    for (let i = 0; i < ayahs.length; i++) {
      const a = ayahs[i]
      const index = Number(a && a.nomorAyat)
      if (!Number.isFinite(index) || index <= 0) continue
      verses.push({
        index,
        arabic: String(a.teksArab || ''),
        translit: String(a.teksLatin || ''),
        translation: String(a.teksIndonesia || a.text || ''),
      })
    }

    const chapter = {
      id: `quran-${sn}`,
      cacheKey,
      surahNumber: sn,
      arabicTitle: String(data.nama || ''),
      displayTitle: `${sn}. ${String(data.namaLatin || '')}`,
      title: String(data.arti || ''),
      verses,
    }

    if (state.quranLoadToken !== token) return
    state.quranCache[cacheKey] = chapter
    state.quranCurrent = chapter
    saveJSON('quranTranslation', tr)
  } catch {
    if (state.quranLoadToken !== token) return
    state.quranCurrent = { id: `quran-${sn}`, cacheKey, surahNumber: sn, error: 'Не удалось загрузить суру' }
  } finally {
    if (state.quranLoadToken === token) render()
  }
}

function buildReadingChapterFromLocal(surahNumber, reciter) {
  const sn = Number(surahNumber)
  const activeReciter = reciter || getActiveReadingReciter()
  const local = getLocalQuran114()
  if (!local || !activeReciter || !Number.isFinite(sn) || sn < 1 || sn > 114) return null
  const surah = local.surahs.find((item) => Number(item && item.number) === sn)
  if (!surah) return null
  return {
    id: `reading-${sn}-${activeReciter.folder}`,
    cacheKey: `reading:${sn}:${activeReciter.folder}`,
    surahNumber: sn,
    arabicTitle: String(surah.arabicName || ''),
    displayTitle: `${sn}. ${String(surah.transliteratedName || '')}`,
    title: '',
    reciterName: String(activeReciter.name || ''),
    reciterFolder: String(activeReciter.folder || ''),
    verses: Array.isArray(surah.verses)
      ? surah.verses.map((v) => ({
          index: Number(v && v.index),
          arabic: String((v && v.arabic) || ''),
          translit: String((v && v.translit) || ''),
          audio: (v && v.audio) || {},
        }))
      : [],
  }
}

function ensureReadingSurahLoaded(surahNumber) {
  const sn = Number(surahNumber)
  const reciter = getActiveReadingReciter()
  if (!reciter || !Number.isFinite(sn) || sn < 1 || sn > 114) {
    state.readingCurrent = null
    return
  }
  const cacheKey = `reading:${sn}:${reciter.folder}`
  if (state.readingCurrent && state.readingCurrent.cacheKey === cacheKey) return
  if (state.readingCache[cacheKey]) {
    state.readingCurrent = state.readingCache[cacheKey]
    return
  }
  const chapter = buildReadingChapterFromLocal(sn, reciter)
  if (!chapter) {
    state.readingCurrent = { id: `reading-${sn}`, cacheKey, surahNumber: sn, error: 'Не удалось загрузить суру' }
    return
  }
  state.readingCache[cacheKey] = chapter
  state.readingCurrent = chapter
}

async function ensureSurah114Loaded() {
  if (state.surah114 && typeof state.surah114 === 'object') return
  if (window.__SURAH114__ && typeof window.__SURAH114__ === 'object') {
    const localData = window.__SURAH114__
    if (localData.fileId === 'surah114' && Array.isArray(localData.ayahs) && Array.isArray(localData.reciters)) {
      state.surah114 = localData
      state.surah114Loading = false
      state.surah114Error = ''
      return
    }
  }
  if (state.surah114Loading) return
  const token = ++state.surah114LoadToken
  state.surah114Loading = true
  state.surah114Error = ''
  try {
    const res = await fetch('./surah114.json', { cache: 'force-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (state.surah114LoadToken !== token) return
    if (!json || json.fileId !== 'surah114' || !Array.isArray(json.ayahs) || !Array.isArray(json.reciters)) throw new Error('Bad response')
    state.surah114 = json
  } catch {
    if (state.surah114LoadToken !== token) return
    state.surah114Error = 'Не удалось загрузить surah114.json'
  } finally {
    if (state.surah114LoadToken === token) {
      state.surah114Loading = false
      render()
    }
  }
}

function renderQuran() {
  const root = $('#view')
  root.innerHTML = ''

  const activeSurah = state.quranSurahNumber
  if (!activeSurah) {
    root.appendChild(el('h1', {}, ['Полный Коран (114 сур)']))
    root.appendChild(
      el('div', { class: 'actions', style: 'margin-top:10px' }, [
        el('button', { class: 'btn', onclick: gotoSurahs }, ['Короткие суры']),
      ]),
    )

    ensureQuranListLoaded()

    root.appendChild(
      el('div', { class: 'searchbar', style: 'margin-top:16px' }, [
        el('input', {
          id: 'quran-search',
          value: state.quranQ,
          placeholder: 'Поиск по названию, английскому или арабскому…',
          autocapitalize: 'off',
          autocomplete: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          oninput: (e) => {
            state.quranQ = e.target.value || ''
            renderQuran()
          },
        }),
      ]),
    )

    if (state.quranListError) {
      root.appendChild(el('div', { class: 'player-error', style: 'margin-top:12px' }, [state.quranListError]))
      return
    }
    if (state.quranListLoading || !Array.isArray(state.quranList)) {
      root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, ['Загрузка…']))
      return
    }

    const q = String(state.quranQ || '').toLowerCase().trim()
    const list = !q
      ? state.quranList
      : state.quranList.filter((s) => {
          const t = `${s.number} ${s.englishName} ${s.englishNameTranslation} ${s.name}`.toLowerCase()
          return t.includes(q)
        })

    const grid = el('div', { class: 'grid' })
    for (const s of list) {
      const num = Number(s && s.number)
      if (!Number.isFinite(num)) continue
      const card = el('div', { class: 'card', onclick: () => gotoQuran(num, state.quranTranslation) })
      card.appendChild(
        el('div', { class: 'body' }, [
          el('div', { class: 'title' }, [`${num}. ${String(s.englishName || '')}`]),
          el('div', { class: 'arabic-title' }, [String(s.name || '')]),
        ]),
      )
      card.appendChild(el('div', { class: 'icon-wrapper', html: svgIcons.book }))
      grid.appendChild(card)
    }
    root.appendChild(grid)
    return
  }

  const sn = Number(activeSurah)
  const trId = state.quranTranslation
  ensureQuranSurahLoaded(sn, trId)
  ensureQuranListLoaded()

  const chapter = state.quranCurrent && state.quranCurrent.surahNumber === sn ? state.quranCurrent : null
  const arabicTitle = chapter && typeof chapter.arabicTitle === 'string' ? chapter.arabicTitle : ''
  const title = chapter && typeof chapter.displayTitle === 'string' ? chapter.displayTitle : `Сура ${sn}`

  root.appendChild(
    el('div', { class: 'chapterTop modeOpen' }, [
      arabicTitle ? el('div', { class: 'arabic-title' }, [arabicTitle]) : null,
      el('h1', {}, [title]),
    ].filter(Boolean)),
  )

  root.appendChild(
    el('div', { class: 'actions', style: 'margin-top:10px' }, [
      el('button', { class: 'btn', onclick: () => gotoQuran(null, trId) }, ['← Все суры']),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          if (!chapter || !Array.isArray(chapter.verses)) return
          const currentReciter = getActiveFullQuranReciter()
          if (!currentReciter) {
            const fallback = getDefaultFullQuranReciter()
            if (fallback) {
              writeSelectedQuranReciter(fallback)
              state.quranCurrent = null
              ensureQuranSurahLoaded(sn, trId).then(() => {
                if (window.karaokePlayer && typeof window.karaokePlayer.setChapter === 'function' && state.quranCurrent) {
                  window.karaokePlayer.setChapter(state.quranCurrent)
                  if (typeof window.karaokePlayer.play === 'function') window.karaokePlayer.play()
                }
              })
              return
            }
          }
          audio.pause()
          if (window.karaokePlayer && typeof window.karaokePlayer.setChapter === 'function') window.karaokePlayer.setChapter(chapter)
          if (window.karaokePlayer && typeof window.karaokePlayer.play === 'function') window.karaokePlayer.play()
        },
      }, ['▶ Играть']),
    ]),
  )

  if (!chapter) {
    root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, ['Загрузка…']))
    return
  }
  if (chapter.error) {
    root.appendChild(el('div', { class: 'player-error', style: 'margin-top:12px' }, [String(chapter.error)]))
    return
  }

  const versesHost = el('div', { class: 'verses' })
  for (const v of chapter.verses || []) {
    const verseNode = el('div', { class: 'verse', id: `v-${v.index}` })
    verseNode.appendChild(
      el('div', { class: 'meta' }, [
        el('div', { class: 'verse-meta-left' }, [el('div', { class: 'num' }, [String(v.index)])]),
      ]),
    )
    verseNode.appendChild(el('div', { class: 'arabic' }, [String(v.arabic || '')]))
    verseNode.appendChild(el('div', { class: 'translit' }, [String(v.translit || '')]))
    versesHost.appendChild(verseNode)
  }
  root.appendChild(versesHost)
}

function renderReading() {
  const root = $('#view')
  root.innerHTML = ''

  const selectedReciter = getActiveReadingReciter()
  const activeSurah = state.readingSurahNumber
  if (selectedReciter) writeSelectedReadingReciter(selectedReciter)

  if (!activeSurah) {
    ensureQuranListLoaded()

    root.appendChild(el('h1', {}, ['Чтение']))
    root.appendChild(
      el('div', { class: 'note', style: 'margin-top:12px' }, [
        'Точный режим verse-by-verse. Здесь доступны только несколько популярных чтецов с поаятным воспроизведением.',
      ]),
    )

    root.appendChild(el('h2', { class: 'reader-section-title' }, ['Чтецы для точного чтения']))
    const recitersGrid = el('div', { class: 'readers-grid' })
    for (const reciter of getReadingReciters()) {
      const isSelected = !!selectedReciter && selectedReciter.folder === reciter.folder
      const card = el('button', {
        type: 'button',
        class: isSelected ? 'reader-card selected' : 'reader-card',
        onclick: () => {
          writeSelectedReadingReciter(reciter)
          state.readingCurrent = null
          renderReading()
        },
      })
      if (isSelected) card.appendChild(el('span', { class: 'reader-badge' }, ['Выбрано']))
      card.appendChild(el('div', { class: 'reader-avatar' }, [getReciterInitials(reciter.name)]))
      card.appendChild(el('div', { class: 'reader-name' }, [reciter.name]))
      card.appendChild(el('div', { class: 'muted', style: 'font-size:12px; text-align:center; max-width:118px;' }, [reciter.subtitle]))
      recitersGrid.appendChild(card)
    }
    root.appendChild(recitersGrid)

    root.appendChild(el('p', { class: 'muted', style: 'margin-top:14px' }, [`Текущий чтец: ${selectedReciter ? selectedReciter.name : 'не выбран'}`]))

    root.appendChild(
      el('div', { class: 'searchbar', style: 'margin-top:16px' }, [
        el('input', {
          id: 'reading-search',
          value: state.readingQ,
          placeholder: 'Поиск по суре…',
          autocapitalize: 'off',
          autocomplete: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          oninput: (e) => {
            state.readingQ = e.target.value || ''
            renderReading()
          },
        }),
      ]),
    )

    if (state.quranListError) {
      root.appendChild(el('div', { class: 'player-error', style: 'margin-top:12px' }, [state.quranListError]))
      return
    }
    if (state.quranListLoading || !Array.isArray(state.quranList)) {
      root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, ['Загрузка…']))
      return
    }

    const q = String(state.readingQ || '').toLowerCase().trim()
    const list = !q
      ? state.quranList
      : state.quranList.filter((s) => {
          const t = `${s.number} ${s.englishName} ${s.englishNameTranslation} ${s.name}`.toLowerCase()
          return t.includes(q)
        })

    const grid = el('div', { class: 'grid' })
    for (const s of list) {
      const num = Number(s && s.number)
      if (!Number.isFinite(num)) continue
      const card = el('div', { class: 'card', onclick: () => gotoReading(num) })
      card.appendChild(
        el('div', { class: 'body' }, [
          el('div', { class: 'title' }, [`${num}. ${String(s.englishName || '')}`]),
          el('div', { class: 'arabic-title' }, [String(s.name || '')]),
        ]),
      )
      card.appendChild(el('div', { class: 'icon-wrapper', html: svgIcons.book }))
      grid.appendChild(card)
    }
    root.appendChild(grid)
    return
  }

  ensureReadingSurahLoaded(activeSurah)
  const chapter = state.readingCurrent && state.readingCurrent.surahNumber === Number(activeSurah) ? state.readingCurrent : null
  const arabicTitle = chapter && typeof chapter.arabicTitle === 'string' ? chapter.arabicTitle : ''
  const title = chapter && typeof chapter.displayTitle === 'string' ? chapter.displayTitle : `Сура ${activeSurah}`

  root.appendChild(
    el('div', { class: 'chapterTop modeOpen' }, [
      arabicTitle ? el('div', { class: 'arabic-title' }, [arabicTitle]) : null,
      el('h1', {}, [title]),
    ].filter(Boolean)),
  )

  root.appendChild(el('p', { class: 'muted', style: 'margin-top:0; text-align:center;' }, [
    `Точный verse-by-verse • ${selectedReciter ? selectedReciter.name : 'Чтец не выбран'}`,
  ]))

  root.appendChild(
    el('div', { class: 'actions', style: 'margin-top:10px' }, [
      el('button', { class: 'btn', onclick: () => gotoReading(null) }, ['← Все суры']),
      ...getReadingReciters().map((reciter) =>
        el(
          'button',
          {
            class: reciter.folder === (selectedReciter && selectedReciter.folder) ? 'btn primary' : 'btn',
            onclick: () => {
              writeSelectedReadingReciter(reciter)
              state.readingCurrent = null
              ensureReadingSurahLoaded(activeSurah)
              render()
            },
          },
          [reciter.name.split(' ')[0]],
        ),
      ),
      el('button', {
        class: 'btn primary',
        onclick: () => {
          if (!chapter || !Array.isArray(chapter.verses) || !chapter.verses.length) return
          writeSelectedReadingReciter(selectedReciter)
          audio.pause()
          if (window.karaokePlayer && typeof window.karaokePlayer.setChapter === 'function') window.karaokePlayer.setChapter(chapter)
          if (window.karaokePlayer && typeof window.karaokePlayer.play === 'function') window.karaokePlayer.play()
        },
      }, ['▶ Играть']),
    ]),
  )

  if (!chapter) {
    root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, ['Загрузка…']))
    return
  }
  if (chapter.error) {
    root.appendChild(el('div', { class: 'player-error', style: 'margin-top:12px' }, [String(chapter.error)]))
    return
  }

  const versesHost = el('div', { class: 'verses' })
  for (const v of chapter.verses || []) {
    const verseNode = el('div', { class: 'verse', id: `v-${v.index}` })
    verseNode.appendChild(
      el('div', { class: 'meta' }, [
        el('div', { class: 'verse-meta-left' }, [el('div', { class: 'num' }, [String(v.index)])]),
      ]),
    )
    verseNode.appendChild(el('div', { class: 'arabic' }, [String(v.arabic || '')]))
    verseNode.appendChild(el('div', { class: 'translit' }, [String(v.translit || '')]))
    versesHost.appendChild(verseNode)
  }
  root.appendChild(versesHost)
}

function renderSurah114() {
  const root = $('#view')
  root.innerHTML = ''

  root.appendChild(el('h1', {}, ['Сура 114 — An-Nas (Люди)']))
  root.appendChild(
    el('div', { class: 'actions', style: 'margin-top:10px' }, [
      el('button', { class: 'btn', onclick: gotoSurahs }, ['Короткие суры']),
      el('button', { class: 'btn', onclick: () => gotoQuran(114, state.quranTranslation) }, ['Открыть в полном Коране']),
    ]),
  )

  ensureSurah114Loaded()

  if (state.surah114Error) {
    root.appendChild(el('div', { class: 'player-error', style: 'margin-top:12px' }, [state.surah114Error]))
    return
  }
  if (state.surah114Loading || !state.surah114) {
    root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, ['Загрузка…']))
    return
  }

  const data = state.surah114
  const parts = data && data.structure && Array.isArray(data.structure.logicalParts) ? data.structure.logicalParts : []
  const ayahs = Array.isArray(data.ayahs) ? data.ayahs : []

  if (data.surah && data.surah.classification && Array.isArray(data.surah.classification.sourceDisagreement)) {
    const items = data.surah.classification.sourceDisagreement
      .map((x) => (x && x.source && x.value ? `${x.source}: ${x.value}` : ''))
      .filter(Boolean)
      .join(' • ')
    if (items) root.appendChild(el('p', { class: 'muted', style: 'margin-top:10px' }, [`Место ниспослания: ${items}`]))
  }

  if (data.structure && data.structure.summary) {
    root.appendChild(el('div', { class: 'note', style: 'margin-top:12px' }, [String(data.structure.summary)]))
  }

  if (parts.length) {
    root.appendChild(el('h2', { style: 'margin-top:18px' }, ['Структура']))
    const list = el('div', { class: 'list' })
    for (const p of parts) {
      list.appendChild(
        el('div', { class: 'listItem' }, [
          el('div', {}, [
            el('div', { class: 'title' }, [`${String(p.title || '')}`]),
            el('div', { class: 'text' }, [`Аяты: ${String(p.ayahRange || '')}`]),
          ]),
          el('div', { class: 'text' }, [String(p.theme || '')]),
        ]),
      )
    }
    root.appendChild(list)
  }

  root.appendChild(el('h2', { style: 'margin-top:18px' }, ['Текст']))
  const versesHost = el('div', { class: 'verses' })
  for (const v of ayahs) {
    const n = Number(v && v.ayahNumber)
    const ar = v && v.arabic ? String(v.arabic) : ''
    const trn = v && v.transliteration ? String(v.transliteration) : ''
    const ru = v && v.translations && v.translations.ru ? String(v.translations.ru) : ''
    const verseNode = el('div', { class: 'verse', id: `s114-v-${n}` })
    verseNode.appendChild(
      el('div', { class: 'meta' }, [
        el('div', { class: 'verse-meta-left' }, [el('div', { class: 'num' }, [String(n)])]),
      ]),
    )
    verseNode.appendChild(el('div', { class: 'arabic' }, [ar]))
    if (trn) verseNode.appendChild(el('div', { class: 'translit' }, [trn]))
    if (ru) verseNode.appendChild(el('div', { class: 'translation' }, [ru]))
    versesHost.appendChild(verseNode)
  }
  root.appendChild(versesHost)

  root.appendChild(el('h2', { style: 'margin-top:18px' }, ['Чтецы (аудио 114-й суры)']))

  root.appendChild(
    el('div', { class: 'searchbar', style: 'margin-top:10px' }, [
      el('input', {
        id: 'surah114-search',
        value: state.surah114Q,
        placeholder: 'Поиск чтеца…',
        autocapitalize: 'off',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        oninput: (e) => {
          state.surah114Q = e.target.value || ''
          state.surah114Limit = 30
          renderSurah114()
        },
      }),
    ]),
  )

  const allReciters = Array.isArray(data.reciters) ? data.reciters : []
  const q = String(state.surah114Q || '').toLowerCase().trim()
  const filtered = !q
    ? allReciters
    : allReciters.filter((r) => {
        const name = r && r.fullName ? String(r.fullName) : ''
        return name.toLowerCase().includes(q)
      })

  root.appendChild(el('p', { class: 'muted', style: 'margin-top:10px' }, [`Найдено: ${filtered.length}`]))

  const limit = Math.max(10, Number(state.surah114Limit) || 30)
  const visible = filtered.slice(0, limit)

  const list = el('div', { class: 'list', style: 'margin-top:10px' })
  for (const r of visible) {
    const name = r && r.fullName ? String(r.fullName) : ''
    const styles = r && r.characteristics && Array.isArray(r.characteristics.styles) ? r.characteristics.styles : []
    const riwayat = r && r.characteristics && Array.isArray(r.characteristics.riwayatOrEditions) ? r.characteristics.riwayatOrEditions : []
    const profilesCount =
      r && r.characteristics && Number.isFinite(Number(r.characteristics.availableProfilesCount))
        ? Number(r.characteristics.availableProfilesCount)
        : null

    const audioMaterials = Array.isArray(r.audioMaterials) ? r.audioMaterials : []
    const primary = audioMaterials.find((x) => x && x.surah114Url) || null
    const moreCount = Math.max(0, audioMaterials.length - (primary ? 1 : 0))

    const right = el('div', { class: 'text', style: 'text-align:right; max-width: 50%' }, [])
    if (primary && primary.surah114Url) {
      right.appendChild(el('a', { href: String(primary.surah114Url), target: '_blank', rel: 'noopener' }, ['114.mp3']))
      if (moreCount) right.appendChild(el('div', { class: 'muted', style: 'margin-top:4px; font-size:12px' }, [`Ещё: ${moreCount}`]))
    } else {
      right.appendChild(el('div', { class: 'muted' }, ['Нет ссылки']))
    }

    const leftLines = []
    if (styles.length) leftLines.push(`Стиль: ${styles.slice(0, 2).join(', ')}${styles.length > 2 ? '…' : ''}`)
    if (riwayat.length) leftLines.push(`Риваят/издание: ${riwayat.slice(0, 1).join(', ')}${riwayat.length > 1 ? '…' : ''}`)
    if (profilesCount !== null) leftLines.push(`Профилей: ${profilesCount}`)

    const item = el('div', { class: 'listItem' }, [
      el('div', {}, [el('div', { class: 'title' }, [name]), el('div', { class: 'text' }, [leftLines.join(' • ')])]),
      right,
    ])

    if (moreCount) {
      const details = el('details', { style: 'margin-top:10px' }, [
        el('summary', { class: 'muted', style: 'cursor:pointer' }, ['Показать варианты']),
        el('div', { class: 'list', style: 'margin-top:10px' }, [
          ...audioMaterials
            .filter((m) => m && m.surah114Url)
            .slice(0, 12)
            .map((m) =>
              el('div', { class: 'listItem' }, [
                el('div', {}, [
                  el('div', { class: 'title' }, [String(m.profileLabel || 'Вариант')]),
                  el('div', { class: 'text' }, [String(m.riwayahOrEdition || '')]),
                ]),
                el('div', { class: 'text', style: 'text-align:right' }, [
                  el('a', { href: String(m.surah114Url), target: '_blank', rel: 'noopener' }, ['114.mp3']),
                ]),
              ]),
            ),
        ]),
      ])
      item.appendChild(el('div', { style: 'flex-basis:100%' }, [details]))
    }

    list.appendChild(item)
  }
  root.appendChild(list)

  if (filtered.length > visible.length) {
    root.appendChild(
      el('div', { class: 'actions', style: 'margin-top:12px' }, [
        el('button', {
          class: 'btn',
          onclick: () => {
            state.surah114Limit = Math.min(filtered.length, (Number(state.surah114Limit) || 30) + 30)
            renderSurah114()
          },
        }, ['Показать ещё']),
      ]),
    )
  }
}

const svgIcons = {
  sunrise: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="m4 10 3 3"/><path d="m20 10-3 3"/><path d="M2 22h20"/><path d="M12 14a8 8 0 0 0-8 8"/><path d="M20 22a8 8 0 0 0-8-8"/></svg>`,
  horse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20v-2l-3-4V9l2-2h4l2 2v5l-3 4v2"/><path d="M13 14h5l2-2v-4l-3-2-2 2-3-2-2 2v4l2 2h3z"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
  hourglass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12a5 5 0 0 0 5-5V4H7v3a5 5 0 0 0 5 5Z"/><path d="M12 12a5 5 0 0 1 5 5v3H7v-3a5 5 0 0 1 5-5Z"/><path d="M10 2h4"/><path d="M10 22h4"/></svg>`,
  building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22v-14a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M10 22v-6h4v6"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/></svg>`,
  scroll: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2"/><path d="M4 6h16"/><path d="M4 20h16"/></svg>`,
  stars: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>`,
  elephant: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c0 4 3 7 7 7h1c1 0 2-1 2-2v-1c0-1-1-2-2-2h-1c-2 0-3-1-3-2s1-2 3-2h2c2 0 3-1 3-2V4"/><path d="M22 12c0 4-3 7-7 7h-1c-1 0-2-1-2-2v-1c0-1 1-2 2-2h1c2 0 3-1 3-2s-1-2-3-2h-2c-2 0-3-1-3-2V4"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  water: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  bread: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 12-8 4v4h16v-4z"/><path d="M4 16a8 8 0 0 1 16 0"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  coins: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>`,
  leaf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 22l8-8"/></svg>`,
  mountain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 1 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>`,
  camel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16v-3a4 4 0 0 1 4-4h1.5a2.5 2.5 0 0 0 4.5 0H14a3 3 0 0 1 3 3v4"/><path d="M17 16h4v-2a2 2 0 0 0-2-2h-2"/><path d="M6 16v4"/><path d="M14 16v4"/></svg>`,
  hand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  kaaba: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h12v12H6z"/><path d="M6 10h12"/><path d="M6 14h12"/></svg>`,
  bed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
  chair: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v17"/><path d="M5 12h14"/><path d="M9 12v10"/><path d="M15 12v10"/></svg>`,
  speech: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
};

const chapterIcons = {
  "chapter01": "sunrise",
  "chapter02": "horse",
  "chapter03": "mountain",
  "chapter04": "book",
  "chapter05": "hourglass",
  "chapter06": "building",
  "chapter07": "scroll",
  "chapter08": "stars",
  "chapter09": "sunrise",
  "chapter10": "sunrise",
  "chapter11": "book",
  "chapter12": "elephant",
  "chapter13": "cloud",
  "chapter14": "star",
  "chapter15": "moon",
  "chapter16": "bell",
  "chapter17": "water",
  "chapter18": "stop",
  "chapter19": "bed",
  "chapter20": "fire",
  "chapter21": "bread",
  "chapter22": "crown",
  "chapter23": "speech",
  "chapter24": "people",
  "chapter25": "hand",
  "chapter26": "sun",
  "chapter27": "heart",
  "chapter28": "coins",
  "chapter29": "stars",
  "chapter30": "leaf",
  "chapter31": "chair",
  "chapter32": "globe",
  "chapter33": "camel",
  "chapter34": "book"
};

const arabicTitles = {
  "chapter01": "الضحى",
  "chapter02": "العاديات",
  "chapter03": "الأعلى",
  "chapter04": "العلق",
  "chapter05": "العصر",
  "chapter06": "البلد",
  "chapter07": "البينة",
  "chapter08": "البروج",
  "chapter09": "الفجر",
  "chapter10": "الفلق",
  "chapter11": "الفاتحة",
  "chapter12": "الفيل",
  "chapter13": "الغاشية",
  "chapter14": "الإخلاص",
  "chapter15": "القدر",
  "chapter16": "القارعة",
  "chapter17": "الكوثر",
  "chapter18": "الكافرون",
  "chapter19": "الليل",
  "chapter20": "المسد",
  "chapter21": "الماعون",
  "chapter22": "الملك",
  "chapter23": "الهمزة",
  "chapter24": "الناس",
  "chapter25": "النصر",
  "chapter26": "الشمس",
  "chapter27": "الشرح",
  "chapter28": "التكاثر",
  "chapter29": "الطارق",
  "chapter30": "التين",
  "chapter31": "آية الكرسي",
  "chapter32": "الزلزلة",
  "chapter33": "قريش",
  "chapter34": "يس"
};

function renderSurahs() {
  const root = $('#view')
  if (root.dataset.page !== 'surahs') {
    root.innerHTML = ''
    root.dataset.page = 'surahs'

    root.appendChild(
      el('div', { class: 'actions', style: 'margin-top:10px' }, [
        el('button', { class: 'btn primary', onclick: () => gotoQuran(null, state.quranTranslation) }, ['Полный Коран (114)']),
      ]),
    )

    root.appendChild(
      el('div', { class: 'searchbar' }, [
        el('input', {
          id: 'surahs-search',
          value: state.q,
          placeholder: 'Поиск по названию, транслиту, переводу, арабскому…',
          autocapitalize: 'off',
          autocomplete: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          oninput: (e) => {
            state.q = e.target.value || ''
            updateSurahsList()
          },
        }),
      ]),
    )

    root.appendChild(el('div', { class: 'grid', id: 'surahs-grid' }))
    root.appendChild(el('p', { class: 'muted', id: 'surahs-empty', style: 'margin-top:12px; display:none' }, ['']))
  } else {
    const input = $('#surahs-search')
    if (input && document.activeElement !== input && input.value !== String(state.q || '')) input.value = String(state.q || '')
  }

  updateSurahsList()
}

function updateSurahsList() {
  const grid = $('#surahs-grid')
  if (!grid) return

  const empty = $('#surahs-empty')
  const nq = String(state.q || '').toLowerCase().trim()
  const list = !nq
    ? state.chapters
    : state.chapters.filter((c) => {
        const txt =
          `${c.displayTitle} ${c.title} ` +
          c.verses.map((v) => `${v.arabic} ${v.translit} ${v.translation}`).join(' ')
        return txt.toLowerCase().includes(nq)
      })

  grid.innerHTML = ''
  for (const c of list) {
    const iconKey = chapterIcons[c.id] || 'star'
    const svgHTML = svgIcons[iconKey] || svgIcons.star

    const imageOrSvgHTML = c.imageUrl ? `<img src="${c.imageUrl}" alt="${c.title}" loading="lazy">` : svgHTML

    const card = el('div', { class: 'card', onclick: () => gotoChapter(c.id) })
    const arTitle = arabicTitles[c.id] || ''

    card.appendChild(
      el('div', { class: 'body' }, [
        el('div', { class: 'title' }, [c.displayTitle]),
        el('div', { class: 'arabic-title' }, [arTitle]),
      ]),
    )

    card.appendChild(el('div', { class: 'icon-wrapper', html: imageOrSvgHTML }))
    grid.appendChild(card)
  }

  if (empty) {
    if (!list.length) {
      empty.textContent = 'Ничего не найдено.'
      empty.style.display = ''
    } else {
      empty.textContent = ''
      empty.style.display = 'none'
    }
  }
}

function renderBookmarks() {
  const root = $('#view')
  root.innerHTML = ''
  root.appendChild(el('h1', {}, ['Закладки']))

  const items = Array.from(state.bookmarks)
    .map((id) => {
      const [chapterId, verseStr] = id.split(':')
      const verseIndex = Number(verseStr)
      const ch = state.byId.get(chapterId)
      const verse = ch ? ch.verses.find((v) => v.index === verseIndex) : null
      return ch && verse ? { id, ch, verse, verseIndex } : null
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ai = state.chapters.findIndex((c) => c.id === a.ch.id)
      const bi = state.chapters.findIndex((c) => c.id === b.ch.id)
      if (ai !== bi) return ai - bi
      return a.verseIndex - b.verseIndex
    })

  if (!items.length) {
    root.appendChild(
      el('p', { class: 'muted' }, [
        'Пока пусто. Добавляйте закладки звёздочкой в главе. ',
        el('a', { href: '#page=surahs' }, ['К списку сур']),
      ]),
    )
    return
  }

  const list = el('div', { class: 'list' })
  for (const it of items) {
    list.appendChild(
      el('div', { class: 'listItem' }, [
        el('div', {}, [
          el('div', { class: 'title' }, [
            el(
              'a',
              { href: `#page=chapter&chapter=${encodeURIComponent(it.ch.id)}&v=${it.verseIndex}` },
              [it.ch.displayTitle],
            ),
            ' ',
            el('span', { class: 'muted' }, [`— аят ${it.verseIndex}`]),
          ]),
          el('div', { class: 'text' }, [it.verse.translation]),
        ]),
        el('button', { class: 'btn', onclick: () => toggleBookmark(it.ch.id, it.verseIndex) }, ['Убрать']),
      ]),
    )
  }
  root.appendChild(list)
}

function renderChapter() {
  const root = $('#view')
  root.innerHTML = ''

  const chapter = state.chapterId ? state.byId.get(state.chapterId) : null
  if (!chapter) {
    root.appendChild(el('p', {}, ['Глава не найдена. ']))
    root.appendChild(el('a', { href: '#page=surahs' }, ['Вернуться']))
    return
  }

  const arTitle = arabicTitles[chapter.id] || ''

  const mode = getChapterMode(chapter.id)

  root.appendChild(
    el('div', {
      class: 'chapterTop modeOpen',
    }, [
      el('div', { class: 'arabic-title' }, [arTitle]),
      el('h1', {}, [chapter.displayTitle]),
    ].filter(Boolean)),
  )

  // Убрана видео-обложка (chapter.imageUrl)
  // Убрано предупреждение про тайминги (warning-note)

  if (getChapterMode(chapter.id) === 'listen') {
    syncListenModeClass()
    return
  }

  const verses = el('div', { class: 'verses' })
  for (const v of chapter.verses) {
    const id = verseKey(chapter.id, v.index)
    const marked = state.bookmarks.has(id)
    const note = state.notes[id] || ''
    const isActive = state.activeVerseId === id

    const verseNode = el('div', {
      class: `verse${isActive ? ' active' : ''}`,
      id: `v-${v.index}`,
      onclick: () => {
        state.activeVerseId = id
        renderChapter()
      },
    })

    const bookmarkIcon = marked 
      ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      
    const linkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
    
    const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;

    verseNode.appendChild(
      el('div', { class: 'meta' }, [
        el('div', { class: 'verse-meta-left' }, [
          chapter.imageUrl
            ? el('img', { class: 'verse-icon', src: chapter.imageUrl, alt: chapter.displayTitle || 'Сура', loading: 'lazy' })
            : null,
          el('div', { class: 'num' }, [String(v.index)]),
        ]),
        el('div', { class: 'vactions' }, [
          el('button', {
            class: `iconbtn${marked ? ' on' : ''}`,
            title: 'Закладка',
            html: bookmarkIcon,
            onclick: (e) => {
              e.stopPropagation()
              toggleBookmark(chapter.id, v.index)
            },
          }),
          el('button', {
            class: 'iconbtn',
            title: 'Ссылка на аят',
            html: linkIcon,
            onclick: (e) => {
              e.stopPropagation()
              gotoChapter(chapter.id, v.index)
              copyText(window.location.href)
            },
          }),
          el('button', {
            class: 'iconbtn',
            title: 'Заметка',
            html: editIcon,
            onclick: (e) => {
              e.stopPropagation()
              const current = state.notes[id] || ''
              const next = prompt('Заметка (пусто = удалить):', current)
              if (next === null) return
              setNote(chapter.id, v.index, next)
            },
          }),
        ]),
      ]),
    )

    verseNode.appendChild(el('div', { class: 'arabic' }, [v.arabic]))
    verseNode.appendChild(el('div', { class: 'translit' }, [v.translit]))
    verseNode.appendChild(el('div', { class: 'translation' }, [v.translation]))
    if (note) verseNode.appendChild(el('div', { class: 'note' }, [note]))
    verses.appendChild(verseNode)
  }
  root.appendChild(verses)

  // авто-скролл к аяту из hash-параметра
  if (state.verseFocus) {
    const target = document.getElementById(`v-${state.verseFocus}`)
    if (target) {
      state.activeVerseId = verseKey(chapter.id, state.verseFocus)
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }
}

window.renderPlayer = renderPlayer
function renderPlayer() {
  const host = $('#player')
  const container = $('#player-container')
  const chapter =
    state.activePage === 'reading'
      ? state.readingCurrent
      : state.activePage === 'quran'
        ? state.quranCurrent
        : state.chapterId
          ? state.byId.get(state.chapterId)
          : null

  // Always show player if karaoke is active or local is active
  const isKaraoke = (state.activePage === 'quran') || (state.activePage === 'reading') || (state.activePage === 'chapter' && getChapterMode(chapter?.id) === 'read')
  const showLocal = state.activePage === 'chapter' || state.activePage === 'surahs'
  
  if (!isKaraoke && !showLocal) {
    host.innerHTML = ''
    if (container) container.classList.add('hidden')
    document.body.classList.remove('player-open')
    return
  }
  
  if (!chapter) {
    host.innerHTML = ''
    if (container) container.classList.add('hidden')
    document.body.classList.remove('player-open');
    return
  }
  
  if (container) container.classList.remove('hidden')
  document.body.classList.add('player-open');

  const kp = window.karaokePlayer
  let isPlaying = false
  if (isKaraoke && kp) {
    isPlaying = !kp.audio.paused && !!kp.audio.src
  } else {
    isPlaying = !audio.paused && !!audio.src
  }

  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0

  // Ensure timings are generated if they weren't yet
  generateTimings();

  const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const nextIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`;
  const prevIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`;
  const userIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const repeatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 12h4"/><path d="M18 16h4"/></svg>`;
  const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  const ccIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const imageOrSvgHTML = chapter.imageUrl 
    ? `<img src="${chapter.imageUrl}" alt="${chapter.displayTitle}">` 
    : userIcon;

  host.innerHTML = ''
  const expanded = state.activePage === 'chapter' && getChapterMode(chapter.id) === 'listen'

  let karaokeSubtitle = null
  if (isKaraoke && kp && kp.items.length > 0) {
    const curAyah = kp.items[kp.currentIndex]
    if (curAyah) {
      const reciterName =
        state.activePage === 'quran'
          ? String((state.quranCurrent && state.quranCurrent.reciterName) || '')
          : String((readSelectedReciter() && readSelectedReciter().name) || '')
      const isFullSurah = !!curAyah.fullSurah
      const currentAyahText = Number.isFinite(Number(curAyah.ayahNumber)) ? `Аят ${curAyah.ayahNumber} / ${kp.items[kp.items.length - 1].ayahNumber}` : 'Полная сура'
      karaokeSubtitle = el('div', { class: 'player-subtitle muted', style: 'font-size: 11.5px; margin-top: 2px;' }, [
        isFullSurah
          ? `${reciterName ? reciterName + ' • ' : ''}${currentAyahText}`
          : `${reciterName ? reciterName + ' • ' : ''}${currentAyahText}`
      ])
    }
  }

  const toggleSubs = () => {
    state.subSettings.enabled = !state.subSettings.enabled
    saveSubSettings()
    renderPlayer()
  }

  const goPrev = () => {
    if (isKaraoke) {
      if (kp) kp.prev()
      return
    }
    prevChapter()
  }

  const toggleMainPlay = () => {
    if (isKaraoke) {
      if (kp) {
        if (audio && !audio.paused) audio.pause()
        kp.togglePlay()
      }
      return
    }

    if (state.playerLoading || !audio.src || audio.src.endsWith('undefined')) {
      setChapter(chapter.id, { autoplay: true })
      return
    }
    if (chapter) {
      ensureAudioAnalysisForChapter(chapter).then((a) => {
        if (!a) return
        if (state.chapterId !== chapter.id) return
        generateTimings(true)
        updatePlayerProgress()
      })
    }
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  const goNext = () => {
    if (isKaraoke) {
      if (kp) kp.next()
      return
    }
    nextChapter()
  }

  const toggleRepeat = () => {
    if (isKaraoke) {
      if (kp) {
        kp.loop = !kp.loop
        renderPlayer()
      }
      return
    }
    audio.loop = !audio.loop
    renderPlayer()
  }

  const repeatActive = isKaraoke ? !!(kp && kp.loop) : !!audio.loop
  const prevTitle = isKaraoke ? 'Предыдущий аят' : 'Предыдущая'
  const nextTitle = isKaraoke ? 'Следующий аят' : 'Следующая'
  const controls = [
    el('button', {
      class: `btn-icon ${state.subSettings.enabled ? 'active' : ''}`,
      title: 'Субтитры',
      html: ccIcon,
      onclick: toggleSubs,
    }),
    el('button', { class: 'btn-icon', title: prevTitle, html: prevIcon, onclick: goPrev }),
    el('button', {
      class: 'btn-play',
      title: isPlaying ? 'Пауза' : 'Играть',
      html: isPlaying ? pauseIcon : playIcon,
      onclick: toggleMainPlay,
    }),
    el('button', { class: 'btn-icon', title: nextTitle, html: nextIcon, onclick: goNext }),
    el('button', {
      class: `btn-icon repeat-btn ${repeatActive ? 'active' : ''}`,
      title: repeatActive ? 'Повтор включен' : 'Повтор выключен',
      html: repeatIcon,
      onclick: toggleRepeat,
    }),
  ]

  host.appendChild(
    el('div', { class: expanded ? 'player expanded' : 'player' }, [
      
      // Верхний ряд: Аватар + Инфо + Кнопки
      el('div', { class: 'row' }, [
        el('div', { class: 'left' }, [
          el('div', { class: 'avatar', html: imageOrSvgHTML }),
          el('div', { class: 'info' }, [
            (() => {
              const isQuranPage = state.activePage === 'quran'
              const isReadingPage = state.activePage === 'reading'
              const href = isQuranPage
                ? `#page=quran&surah=${encodeURIComponent(chapter.surahNumber || '')}`
                : isReadingPage
                  ? `#page=reading&surah=${encodeURIComponent(chapter.surahNumber || '')}`
                : `#page=chapter&chapter=${encodeURIComponent(chapter.id)}`
              const label = isQuranPage || isReadingPage
                ? String(chapter.displayTitle || `Сура ${chapter.surahNumber || ''}`)
                : `${chapter.id.replace('chapter', '')}. ${chapter.displayTitle}`
              return el('a', { class: 'ptitle', href }, [label])
            })(),
            karaokeSubtitle
          ].filter(Boolean)),
        ]),
        
        el('div', { class: 'controls' }, controls),
      ]),
      
    ])
  )

  
  // Инициализация субтитров и прогресса при рендеринге плеера
  updatePlayerProgress();
}

function render() {
  renderNav()
  if (state.activePage === 'bookmarks') renderBookmarks()
  else if (state.activePage === 'chapter') renderChapter()
  else if (state.activePage === 'readers') renderReaders()
  else if (state.activePage === 'reader') renderReaderProfile()
  else if (state.activePage === 'reading') renderReading()
  else if (state.activePage === 'settings') renderSettings()
  else if (state.activePage === 'quran') renderQuran()
  else if (state.activePage === 'surah114') renderSurah114()
  else if (state.activePage === 'surahs') renderSurahs()
  else renderSurahs()
  renderPlayer()
  syncListenModeClass()
  if (window.karaokePlayer && typeof window.karaokePlayer.syncUI === 'function') {
    if (state.activePage === 'quran' && state.quranSurahNumber && state.quranCurrent && state.quranCurrent.verses) {
      window.karaokePlayer.syncUI({ activePage: 'quran', chapter: state.quranCurrent, mode: 'read' })
    } else if (state.activePage === 'reading' && state.readingSurahNumber && state.readingCurrent && state.readingCurrent.verses) {
      window.karaokePlayer.syncUI({ activePage: 'reading', chapter: state.readingCurrent, mode: 'read' })
    } else {
      const chapter = state.chapterId ? state.byId.get(state.chapterId) : null
      const mode = chapter ? getChapterMode(chapter.id) : null
      window.karaokePlayer.syncUI({ activePage: state.activePage, chapter, mode })
    }
  }
  if (state.pendingQuranAutoplay && state.activePage === 'quran' && state.quranCurrent && !state.quranCurrent.error) {
    state.pendingQuranAutoplay = false
    if (window.karaokePlayer && typeof window.karaokePlayer.play === 'function') {
      setTimeout(() => {
        if (state.activePage !== 'quran') return
        window.karaokePlayer.play()
      }, 0)
    }
  }
}

async function init() {
  const data =
    (window.__CHAPTERS__ && typeof window.__CHAPTERS__ === 'object' && window.__CHAPTERS__) ||
    (await (await fetch('chapters.json')).json())
  state.chapters = data.chapters || []
  state.byId = new Map(state.chapters.map((c) => [c.id, c]))

  // восстановим последнее
  const last = loadJSON('lastChapterId', null)
  if (last && state.byId.has(last)) state.chapterId = last

  syncFromHash()

  if (state.activePage === 'surah114') ensureSurah114Loaded()

  // если мы открыли сразу главу — подготовим плеер на неё (без автоплея)
  if (state.activePage === 'chapter' && state.chapterId) setChapter(state.chapterId, { autoplay: false })
  else if (state.chapterId) setChapter(state.chapterId, { autoplay: false })

  // навигация
  if ($('#nav-surahs')) {
    $('#nav-surahs').addEventListener('click', (e) => {
      e.preventDefault()
      gotoSurahs()
    })
  }
  if ($('#nav-readers')) {
    $('#nav-readers').addEventListener('click', (e) => {
      e.preventDefault()
      gotoReaders()
    })
  }
  if ($('#nav-reading')) {
    $('#nav-reading').addEventListener('click', (e) => {
      e.preventDefault()
      gotoReading()
    })
  }
  if ($('#nav-settings')) {
    $('#nav-settings').addEventListener('click', (e) => {
      e.preventDefault()
      gotoSettings()
    })
  }

  // скрытие меню при скролле вниз
  let lastScrollY = window.scrollY;
  window.addEventListener('scroll', () => {
    const wrapper = document.getElementById('player-wrapper');
    
    if (window.scrollY > lastScrollY && window.scrollY > 50) {
      if (wrapper) wrapper.classList.add('dropped');
    } else {
      if (wrapper) wrapper.classList.remove('dropped');
    }
    lastScrollY = window.scrollY;
  });

  if (window.AudioPlayer && !window.karaokePlayer) {
    window.karaokePlayer = new window.AudioPlayer()
  }

  render()
}

init().catch((e) => {
  console.error(e)
  $('#view').innerHTML = `<p class="muted">Ошибка загрузки данных. Откройте папку целиком и убедитесь, что рядом с index.html лежит chapters.json.</p>`
})
