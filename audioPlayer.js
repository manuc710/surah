/* global window, document, localStorage */

;(function () {
  function safeParseJSON(raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  function getSelectedReciter() {
    const raw = localStorage.getItem('selectedReciter') || localStorage.getItem('kyrilquran_html.selectedReciter')
    if (!raw) return null
    const v = safeParseJSON(raw)
    if (!v || typeof v !== 'object') return null
    const folder = typeof v.folder === 'string' ? v.folder.trim() : ''
    if (!folder) return null
    return {
      name: typeof v.name === 'string' ? v.name : '',
      arabic: typeof v.arabic === 'string' ? v.arabic : '',
      folder,
    }
  }

  function getAudioBaseName(chapter) {
    // We use the existing local MP3 filename as a stable ID to map the chapter
    // to the real Quran surah number (needed by everyayah.com URLs).
    const url = chapter && typeof chapter.audioUrl === 'string' ? chapter.audioUrl : ''
    const m = url.match(/\/([^/]+)\.mp3$/i)
    return m ? m[1] : ''
  }

  const AUDIO_BASE_TO_SURAH = {
    // Local MP3 basename -> Quran surah number (Hafs standard numbering)
    ad_duxa: 93,
    al_adiyat: 100,
    al_alya: 87,
    al_alyaq: 96,
    al_asr: 103,
    al_balyad: 90,
    al_bayyina: 98,
    al_burudj: 85,
    al_fadjr: 89,
    al_falaq: 113,
    al_fatixa: 1,
    al_fil: 105,
    al_gashiya: 88,
    al_ixlas: 112,
    al_kadr: 97,
    al_karia: 101,
    al_kausar: 108,
    al_kofirun: 109,
    al_lyayl: 92,
    al_masad: 111,
    al_maun: 107,
    al_mulk: 67,
    al_xumaza: 104,
    an_nas: 114,
    an_nasr: 110,
    ash_shams: 91,
    ash_sharx: 94,
    at_takasur: 102,
    at_tariq: 86,
    at_tin: 95,
    az_zalzalya: 99,
    kuraysh: 106,
    yasin: 36,
  }

  function isBismillah(arabic) {
    // The dataset includes Bismillah as verse #1 for most chapters.
    // But EveryAyah/AlQuranCloud numbering usually does NOT count Bismillah as ayah #1
    // (except Al-Fatiha). So we detect it and offset verse -> ayah mapping.
    const t = String(arabic || '').trim()
    return t.startsWith('بِسْمِ') || t.startsWith('بسم')
  }

  function buildEstimatedFullSurahItems(chapter) {
    const verses = chapter && Array.isArray(chapter.verses) ? chapter.verses : []
    if (!verses.length || !chapter || typeof chapter.audioUrl !== 'string' || !chapter.audioUrl) return []

    const weights = verses.map((verse) => {
      const arabic = String((verse && verse.arabic) || '').replace(/\s+/g, '')
      const translit = String((verse && verse.translit) || '').replace(/\s+/g, '')
      return Math.max(1, arabic.length + Math.max(0, Math.round(translit.length * 0.2)))
    })

    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1
    let consumed = 0

    return verses.map((verse, index) => {
      const weight = weights[index]
      const startRatio = consumed / totalWeight
      consumed += weight
      const endRatio = index === verses.length - 1 ? 1 : consumed / totalWeight
      return {
        domIndex: Number(verse && verse.index) || index + 1,
        surahNumber: Number(chapter.surahNumber) || 0,
        ayahNumber: Number(verse && verse.index) || index + 1,
        url: chapter.audioUrl,
        fullSurah: true,
        startRatio,
        endRatio,
      }
    })
  }

  class AudioPlayer {
    constructor(opts = {}) {
      // This module is UI + playback:
      // - builds per-ayah URLs for the selected surah
      // - plays them sequentially (ended -> next)
      // - highlights the current verse node (#v-{index}) and scrolls it into view

      this.audio = new Audio()
      this.audio.preload = 'auto'

      this.chapter = null
      this.items = []
      this.currentIndex = 0
      this.enabled = false
      this.lastActiveDomIndex = null
      this.pendingSeekRatio = null

      this.audio.addEventListener('ended', () => this._onEnded())
      this.audio.addEventListener('error', () => this._onError())
      this.audio.addEventListener('play', () => this._render())
      this.audio.addEventListener('pause', () => this._render())
      this.audio.addEventListener('loadedmetadata', () => this._onLoadedMetadata())
      this.audio.addEventListener('timeupdate', () => this._onTimeUpdate())

      this._render()
    }

    syncUI({ activePage, chapter, mode }) {
      const shouldEnable = (activePage === 'chapter' || activePage === 'quran' || activePage === 'reader' || activePage === 'reading') && !!chapter && mode === 'read'
      this.enabled = shouldEnable

      if (!this.enabled) {
        this.stop({ clearHighlight: true })
        this._hide()
        return
      }

      this._show()
      if (chapter && (!this.chapter || this.chapter.id !== chapter.id)) {
        this.setChapter(chapter)
      }
    }

    setChapter(chapter) {
      // Called whenever the active chapter changes.
      // We (re)build the playlist from the chapter verses and selected reciter.
      this.chapter = chapter || null
      this.items = []
      this.currentIndex = 0
      this.lastActiveDomIndex = null
      this._clearHighlight()

      this.audio.pause()
      this.audio.src = ''
      this.pendingSeekRatio = null

      if (chapter && chapter.audioMode === 'full-surah' && typeof chapter.audioUrl === 'string' && chapter.audioUrl) {
        this.items = buildEstimatedFullSurahItems(chapter)
        this._render()
        return
      }

      const reciter = getSelectedReciter()
      if (!reciter) {
        // No reciter selected: keep UI visible but disable playback.
        this._render()
        return
      }

      const base = getAudioBaseName(chapter)

      if (base === 'ayatalkursi') {
        // Ayat Al-Kursi is Quran 2:255 (single ayah).
        this.items = []
        this._render()
        // API equran.id v2: surah 2
        fetch(`https://equran.id/api/v2/surat/2`)
          .then(res => res.json())
          .then(data => {
            if (!data || !data.data || !Array.isArray(data.data.ayat)) return
            const ayah255 = data.data.ayat.find(a => a.nomorAyat === 255)
            if (!ayah255) return
            this.items = [
              {
                domIndex: 1,
                surahNumber: 2,
                ayahNumber: 255,
                url: ayah255.audio[reciter.folder] || ayah255.audio['05']
              }
            ]
            this._render()
          })
          .catch(err => {
            console.error('Failed to load Ayat Al-Kursi audio:', err)
            this._render()
          })
        return
      }

      const explicitSurahNumber = Number(chapter && chapter.surahNumber)
      const surahNumber = Number.isFinite(explicitSurahNumber) ? explicitSurahNumber : AUDIO_BASE_TO_SURAH[base]
      if (!Number.isFinite(surahNumber)) {
        this._render()
        return
      }

      const verses = chapter && Array.isArray(chapter.verses) ? chapter.verses : []
      const hasLeadingBismillah = verses.length > 0 && isBismillah(verses[0].arabic)
      const offset = hasLeadingBismillah && surahNumber !== 1 ? 1 : 0

      // Reset state while loading
      this.items = []
      this._render()

      fetch(`https://equran.id/api/v2/surat/${surahNumber}`)
        .then(res => res.json())
        .then(data => {
          if (!data || !data.data || !Array.isArray(data.data.ayat)) return
          
          this.items = data.data.ayat.map((ayah) => {
            const domIndex = ayah.nomorAyat + offset
            return {
              domIndex,
              surahNumber,
              ayahNumber: ayah.nomorAyat,
              url: ayah.audio[reciter.folder] || ayah.audio['05'] // Fallback to Mishary if reciter not found
            }
          })
          
          this._render()
        })
        .catch(err => {
          console.error('Failed to load audio data:', err)
          this._render()
        })
    }

    togglePlay() {
      if (!this.enabled) return
      if (this.audio.paused) this.play()
      else this.pause()
    }

    play() {
      if (!this.enabled) return
      const isFullSurah = !!(this.chapter && this.chapter.audioMode === 'full-surah')
      const reciter = isFullSurah ? { name: this.chapter.reciterName || '' } : getSelectedReciter()
      if (!reciter) {
        this._render()
        return
      }

      if (!this.items.length) {
        this._render()
        return
      }

      const item = this.items[this.currentIndex]
      if (!item) return

      if (this.audio.src !== item.url) {
        this.audio.pause()
        this.pendingSeekRatio = isFullSurah ? Number(item.startRatio || 0) : 0
        this.audio.src = item.url
        this.audio.load()
      } else if (isFullSurah) {
        this._seekToRatio(Number(item.startRatio || 0))
      }

      this._setHighlight(item.domIndex)
      this.audio.play().catch(() => {})
      this._render()
    }

    pause() {
      this.audio.pause()
      this._render()
    }

    stop({ clearHighlight = false } = {}) {
      this.audio.pause()
      this.audio.src = ''
      if (clearHighlight) this._clearHighlight()
      this._render()
    }

    prev() {
      if (!this.enabled) return
      if (!this.items.length) return
      this.currentIndex = Math.max(0, this.currentIndex - 1)
      this.play()
    }

    next() {
      if (!this.enabled) return
      if (!this.items.length) return
      this.currentIndex = Math.min(this.items.length - 1, this.currentIndex + 1)
      this.play()
    }

    _onEnded() {
      if (!this.items.length) return
      if (this.chapter && this.chapter.audioMode === 'full-surah') {
        if (this.loop) {
          this.currentIndex = 0
          this.play()
        } else {
          this.pause()
        }
        return
      }
      const nextIndex = this.currentIndex + 1
      if (nextIndex >= this.items.length) {
        if (this.loop) {
          this.currentIndex = 0
          this.play()
        } else {
          this.pause()
        }
        return
      }
      this.currentIndex = nextIndex
      this.play()
    }

    _onError() {
      // Network failure / 404 / decode error:
      // skip current ayah and try the next one to keep the flow going.
      if (!this.items.length) return
      if (this.chapter && this.chapter.audioMode === 'full-surah') {
        this.pause()
        return
      }
      const nextIndex = this.currentIndex + 1
      if (nextIndex >= this.items.length) {
        this.pause()
        return
      }
      this.currentIndex = nextIndex
      this.play()
    }

    _onLoadedMetadata() {
      if (this.chapter && this.chapter.audioMode === 'full-surah' && this.pendingSeekRatio !== null) {
        this._seekToRatio(this.pendingSeekRatio)
      }
    }

    _seekToRatio(ratio) {
      const duration = Number(this.audio.duration)
      const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
      if (!Number.isFinite(duration) || duration <= 0) {
        this.pendingSeekRatio = safeRatio
        return
      }
      const target = duration * safeRatio
      if (Math.abs((Number(this.audio.currentTime) || 0) - target) > 0.35) {
        try {
          this.audio.currentTime = target
        } catch {
          this.pendingSeekRatio = safeRatio
          return
        }
      }
      this.pendingSeekRatio = null
    }

    _onTimeUpdate() {
      if (!(this.chapter && this.chapter.audioMode === 'full-surah')) return
      if (!this.items.length) return
      const duration = Number(this.audio.duration)
      const currentTime = Number(this.audio.currentTime)
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return
      const ratio = currentTime / duration
      let nextIndex = this.items.findIndex((item) => ratio >= item.startRatio && ratio < item.endRatio)
      if (nextIndex === -1) nextIndex = this.items.length - 1
      if (nextIndex !== this.currentIndex) {
        this.currentIndex = nextIndex
        const item = this.items[this.currentIndex]
        if (item) this._setHighlight(item.domIndex)
        this._render()
      }
    }

    _setHighlight(domIndex) {
      if (!Number.isFinite(domIndex)) return

      if (this.lastActiveDomIndex && this.lastActiveDomIndex !== domIndex) {
        const prev = document.getElementById(`v-${this.lastActiveDomIndex}`)
        if (prev) prev.classList.remove('karaoke-active', 'highlight')
      }

      this.lastActiveDomIndex = domIndex
      const el = document.getElementById(`v-${domIndex}`)
      if (el) {
        el.classList.add('highlight')
        el.classList.add('karaoke-active')
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }

      document.body.classList.toggle('karaoke-mode', true)
    }

    _clearHighlight() {
      document
        .querySelectorAll('.verse.karaoke-active, .verse.highlight')
        .forEach((n) => n.classList.remove('karaoke-active', 'highlight'))
      document.body.classList.remove('karaoke-mode')
      this.lastActiveDomIndex = null
    }

    _hide() {
      // No longer uses separate container
    }

    _show() {
      // No longer uses separate container
    }

    _ensureUI() {
      // No longer uses separate UI, we render via app.js
    }

    _render() {
      // Call global renderPlayer so app.js updates the main player UI
      if (typeof window.renderPlayer === 'function') {
        window.renderPlayer()
      }
    }
  }

  window.AudioPlayer = AudioPlayer
})()
