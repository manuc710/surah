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

const state = {
  chapters: [],
  byId: new Map(),
  activePage: 'surahs', // surahs | chapter | bookmarks | settings
  q: '',
  chapterId: null,
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
  if (!chapter || !chapter.audioUrl) return { candidates: [], label: '' }
  return { candidates: [chapter.audioUrl], label: 'Локальное аудио' }
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
const repeatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const ccIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect><path d="M10 11H8a1 1 0 0 0-1 1v0a1 1 0 0 0 1 1h2"/><path d="M17 11h-2a1 1 0 0 0-1 1v0a1 1 0 0 0 1 1h2"/></svg>`;
const settingsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

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

  renderPlayer()
  resolveAudioForChapter(ch)
    .then((r) => {
      if (state.audioLoadToken !== token) return
      const candidates = r && Array.isArray(r.candidates) ? r.candidates : []
      if (!candidates.length) {
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
    const host = btnPlay.closest('.player')
    const expanded = !!(host && host.classList.contains('expanded'))
    btnPlay.title = isPlaying ? 'Пауза' : 'Играть';
    btnPlay.innerHTML = expanded
      ? `${isPlaying ? pauseIcon : playIcon}<span class="ctl-label">${isPlaying ? 'Пауза' : 'Играть'}</span>`
      : (isPlaying ? pauseIcon : playIcon);
  }

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  
  const progressInput = document.querySelector('.progress input[type="range"]');
  if (progressInput && document.activeElement !== progressInput) {
    progressInput.max = Math.max(1, duration || 0);
    progressInput.value = Math.min(currentTime, duration || currentTime);
  }
  
  const timeTexts = document.querySelectorAll('.progress .time-text');
  if (timeTexts.length >= 2) {
    timeTexts[0].textContent = fmt(currentTime);
    timeTexts[1].textContent = fmt(duration);
  }
  
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
  const v = params.get('v')
  return { page, chapter, v: v ? Number(v) : null }
}

function setHash(obj) {
  const p = new URLSearchParams()
  if (obj.page) p.set('page', obj.page)
  if (obj.chapter) p.set('chapter', obj.chapter)
  if (obj.v) p.set('v', String(obj.v))
  const s = p.toString()
  window.location.hash = s ? `#${s}` : '#'
}

function gotoSurahs() {
  setHash({ page: 'surahs' })
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

window.addEventListener('hashchange', () => {
  syncFromHash()
  render()
})

function syncFromHash() {
  const { page, chapter, v } = parseHash()
  state.activePage = ['chapter', 'bookmarks', 'settings', 'surahs'].includes(page) ? page : 'surahs'
  state.chapterId = chapter && state.byId.has(chapter) ? chapter : state.chapterId
  state.verseFocus = Number.isFinite(v) && v > 0 ? v : null
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
  const navBookmarks = $('#nav-bookmarks')
  const navSettings = $('#nav-settings')
  
  if (navSurahs) navSurahs.classList.toggle('active', state.activePage === 'surahs' || state.activePage === 'chapter')
  if (navBookmarks) navBookmarks.classList.toggle('active', state.activePage === 'bookmarks')
  if (navSettings) navSettings.classList.toggle('active', state.activePage === 'settings')
}

function renderSettings() {
  const root = $('#view')
  root.innerHTML = ''
  root.appendChild(el('h1', {}, ['Настройки']))
  root.appendChild(el('p', { class: 'muted' }, ['Раздел настроек находится в разработке.']))
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
      class: `chapterTop${state.ui.modePickerOpen ? ' modeOpen' : ''}`,
      onclick: () => {
        state.ui.modePickerOpen = !state.ui.modePickerOpen
        renderChapter()
      },
    }, [
      el('div', { class: 'arabic-title' }, [arTitle]),
      el('h1', {}, [chapter.displayTitle]),
      el('div', { class: 'actions' }, [
        chapter.audioUrl
          ? el('button', {
              class: 'btn primary',
              onclick: (e) => {
                e.stopPropagation()
                if (state.chapterId === chapter.id && audio.src) {
                  if (audio.paused) audio.play().catch(() => {})
                  else audio.pause()
                } else {
                  setChapter(chapter.id, { autoplay: true })
                }
              },
            }, [audio.paused ? 'Играть' : 'Пауза'])
          : null,
        el('button', {
          class: 'btn',
          onclick: (e) => {
            e.stopPropagation()
            copyText(window.location.href)
          },
          title: 'Скопировать ссылку на главу',
        }, ['Поделиться']),
      ].filter(Boolean)),
      state.ui.modePickerOpen
        ? el('div', { class: 'modePanel', onclick: (e) => e.stopPropagation() }, [
            el('button', {
              class: `btn ${mode === 'listen' ? 'primary' : ''}`,
              onclick: () => {
                setChapterMode(chapter.id, 'listen')
                if (chapter.audioUrl) setChapter(chapter.id, { autoplay: true })
              },
            }, ['Слушать']),
            el('button', {
              class: `btn ${mode === 'read' ? 'primary' : ''}`,
              onclick: () => setChapterMode(chapter.id, 'read'),
            }, ['Читать']),
          ])
        : null,
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
        el('div', { class: 'num' }, [String(v.index)]),
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

function renderPlayer() {
  const host = $('#player')
  const container = $('#player-container')
  const chapter = state.chapterId ? state.byId.get(state.chapterId) : null
  
  if (!chapter || !chapter.audioUrl) {
    host.innerHTML = ''
    if (container) container.classList.add('hidden')
    document.body.classList.remove('player-open');
    return
  }
  
  if (container) container.classList.remove('hidden')
  document.body.classList.add('player-open');

  const isPlaying = !audio.paused && !!audio.src
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
  const isLooping = audio.loop

  // Ensure timings are generated if they weren't yet
  generateTimings();

  const playIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const pauseIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const nextIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`;
  const prevIcon = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`;
  const userIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const repeatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`;
  const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  const imageOrSvgHTML = chapter.imageUrl 
    ? `<img src="${chapter.imageUrl}" alt="${chapter.displayTitle}">` 
    : userIcon;

  host.innerHTML = ''
  const expanded = state.activePage === 'chapter' && getChapterMode(chapter.id) === 'listen'
  const subtitleText = state.playerLoading
    ? 'Загрузка аудио…'
    : (state.playerAudioLabel || 'Локальное аудио')

  host.appendChild(
    el('div', { class: expanded ? 'player expanded' : 'player' }, [
      
      // Верхний ряд: Аватар + Инфо + Кнопки
      el('div', { class: 'row' }, [
        el('div', { class: 'left' }, [
          el('div', { class: 'avatar', html: imageOrSvgHTML }),
          el('div', { class: 'info' }, [
            el(
              'a',
              { class: expanded ? 'ptitle active' : 'ptitle', href: `#page=chapter&chapter=${encodeURIComponent(chapter.id)}` },
              [`${chapter.id.replace('chapter', '')}. ${chapter.displayTitle}`],
            ),
            el('div', { class: 'p-subtitle' }, [subtitleText])
          ]),
        ]),
        
        el('div', { class: 'controls' }, [
          el('button', {
            class: `btn-icon ${state.subSettings.enabled ? 'active' : ''}`,
            title: 'Субтитры',
            html: ccIcon,
            onclick: () => {
              state.subSettings.enabled = !state.subSettings.enabled;
              saveSubSettings();
              renderPlayer(); // Re-render to update toggle button
            }
          }),
          el('button', {
            class: 'btn-icon',
            title: 'Настройки субтитров',
            html: settingsIcon,
            onclick: () => {
              const panel = document.getElementById('sub-settings-panel');
              if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
            }
          }),
          el('button', {
            class: 'btn-play',
            title: isPlaying ? 'Пауза' : 'Играть',
            html: isPlaying ? pauseIcon : playIcon,
            onclick: () => {
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
            },
          }),
          el('button', { class: 'btn-icon', onclick: nextChapter, title: 'Следующая', html: nextIcon }),
          el('div', { style: 'width: 1px; height: 24px; background: rgba(255,255,255,0.1); margin: 0 4px;' }),
          el('button', { class: 'btn-icon', onclick: () => setChapter(null), title: 'Закрыть плеер', html: closeIcon })
        ])
      ]),

      state.playerError ? el('div', { class: 'player-error' }, [state.playerError]) : null,

      // Субтитры (Отображение)
      el('div', { class: 'subtitle-display', id: 'subtitle-display', style: 'display: none;' }, [
        el('div', { class: 'sub-arabic' }, []),
        el('div', { class: 'sub-translation' }, [])
      ]),
      
      // Настройки субтитров
      el('div', { class: 'sub-settings-panel', id: 'sub-settings-panel', style: 'display: none;' }, [
        el('label', {}, [
          'Размер текста: ',
          el('input', { type: 'range', min: 14, max: 32, value: state.subSettings.fontSize, oninput: e => { state.subSettings.fontSize = Number(e.target.value); saveSubSettings(); } })
        ]),
        el('label', {}, [
          'Цвет текста: ',
          el('input', { type: 'color', value: state.subSettings.color, oninput: e => { state.subSettings.color = e.target.value; saveSubSettings(); } })
        ]),
        el('label', {}, [
          'Фон (прозрачность): ',
          el('input', { type: 'range', min: 0, max: 100, value: state.subSettings.bgOpacity * 100, oninput: e => { state.subSettings.bgOpacity = Number(e.target.value) / 100; saveSubSettings(); } })
        ])
      ]),

      expanded ? el('div', { class: 'player-section-title muted' }, ['Перемотка']) : null,

      el('div', { class: 'timeline progress' }, [
        el('span', { class: 'time-text' }, [fmt(currentTime)]),
        el('input', {
          type: 'range',
          min: 0,
          max: Math.max(1, duration || 0),
          step: 0.25,
          value: Math.min(currentTime, duration || currentTime),
          'aria-label': 'Перемотка',
          oninput: (e) => {
            const t = Number(e.target.value)
            const nextTime = Math.max(0, Math.min(t, duration || t))
            audio.currentTime = nextTime
            updateSubtitles(nextTime)
          },
        }),
        el('span', { class: 'time-text' }, [fmt(duration)]),
        el('button', {
          class: `btn-icon repeat-btn ${isLooping ? 'active' : ''}`,
          title: isLooping ? 'Повтор включен' : 'Повтор выключен',
          html: repeatIcon,
          onclick: () => {
            audio.loop = !audio.loop;
            renderPlayer();
          }
        })
      ]),

      expanded ? el('div', { class: 'player-section-title muted' }, ['Громкость']) : null,

      expanded ? el('div', { class: 'volume-row' }, [
        el('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.01,
          value: String(state.volume),
          'aria-label': 'Громкость',
          oninput: (e) => {
            const v = Number(e.target.value)
            setVolume(v)
            const out = e.target.parentElement && e.target.parentElement.querySelector('.vol-value')
            if (out) out.textContent = `${Math.round(clamp(v, 0, 1) * 100)}%`
          },
        }),
        el('span', { class: 'time-text vol-value' }, [`${Math.round(clamp(state.volume, 0, 1) * 100)}%`]),
      ]) : null
      
    ])
  )
  
  // Инициализация субтитров и прогресса при рендеринге плеера
  updatePlayerProgress();
}

function render() {
  renderNav()
  if (state.activePage === 'bookmarks') renderBookmarks()
  else if (state.activePage === 'chapter') renderChapter()
  else if (state.activePage === 'settings') renderSettings()
  else if (state.activePage === 'surahs') renderSurahs()
  else renderSurahs()
  renderPlayer()
  syncListenModeClass()
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
  if ($('#nav-bookmarks')) {
    $('#nav-bookmarks').addEventListener('click', (e) => {
      e.preventDefault()
      gotoBookmarks()
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

  render()
}

init().catch((e) => {
  console.error(e)
  $('#view').innerHTML = `<p class="muted">Ошибка загрузки данных. Откройте папку целиком и убедитесь, что рядом с index.html лежит chapters.json.</p>`
})
