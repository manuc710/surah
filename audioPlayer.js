/* global window, document, localStorage */

;(function () {
  function pad3(n) {
    return String(n).padStart(3, '0')
  }

  function safeParseJSON(raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  function getSelectedReciter() {
    // Expected format (stored by your reciter selector UI):
    // localStorage.selectedReciter = JSON.stringify({ name, arabic, folder })
    // We only need `folder` for EveryAyah URLs.
    const raw = localStorage.getItem('selectedReciter')
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
    // But EveryAyah numbering usually does NOT count Bismillah as ayah #1
    // (except Al-Fatiha). So we detect it and offset verse -> ayah mapping.
    const t = String(arabic || '').trim()
    return t.startsWith('بِسْمِ') || t.startsWith('بسم')
  }

  function buildEveryAyahUrl({ folder, surahNumber, ayahNumber }) {
    return `https://everyayah.com/data/${encodeURIComponent(folder)}/${pad3(surahNumber)}${pad3(ayahNumber)}.mp3`
  }

  class AudioPlayer {
    constructor(opts = {}) {
      // This module is UI + playback:
      // - builds per-ayah URLs for the selected surah
      // - plays them sequentially (ended -> next)
      // - highlights the current verse node (#v-{index}) and scrolls it into view
      this.containerId = typeof opts.containerId === 'string' ? opts.containerId : 'mini-player'
      this.container = document.getElementById(this.containerId)

      this.audio = new Audio()
      this.audio.preload = 'auto'

      this.chapter = null
      this.items = []
      this.currentIndex = 0
      this.enabled = false
      this.lastActiveDomIndex = null

      this.ui = {
        root: null,
        status: null,
        title: null,
        ayah: null,
        btnPrev: null,
        btnPlay: null,
        btnNext: null,
      }

      this.audio.addEventListener('ended', () => this._onEnded())
      this.audio.addEventListener('error', () => this._onError())
      this.audio.addEventListener('play', () => this._render())
      this.audio.addEventListener('pause', () => this._render())

      this._render()
    }

    syncUI({ activePage, chapter, mode }) {
      const shouldEnable = activePage === 'chapter' && !!chapter && mode === 'read'
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

      const reciter = getSelectedReciter()
      if (!reciter) {
        // No reciter selected: keep UI visible but disable playback.
        this._render()
        return
      }

      const base = getAudioBaseName(chapter)

      if (base === 'ayatalkursi') {
        // Ayat Al-Kursi is Quran 2:255 (single ayah).
        this.items = [
          {
            domIndex: 1,
            surahNumber: 2,
            ayahNumber: 255,
            url: buildEveryAyahUrl({ folder: reciter.folder, surahNumber: 2, ayahNumber: 255 }),
          },
        ]
        this._render()
        return
      }

      const surahNumber = AUDIO_BASE_TO_SURAH[base]
      if (!Number.isFinite(surahNumber)) {
        // If a chapter has no surah mapping yet, we disable playback for it.
        this._render()
        return
      }

      const verses = chapter && Array.isArray(chapter.verses) ? chapter.verses : []
      const hasLeadingBismillah = verses.length > 0 && isBismillah(verses[0].arabic)
      const offset = hasLeadingBismillah && surahNumber !== 1 ? 1 : 0

      this.items = verses
        .map((v) => {
          const domIndex = Number(v && v.index)
          if (!Number.isFinite(domIndex) || domIndex <= 0) return null

          const ayahNumber = domIndex - offset
          if (ayahNumber <= 0) return null

          return {
            domIndex,
            surahNumber,
            ayahNumber,
            url: buildEveryAyahUrl({ folder: reciter.folder, surahNumber, ayahNumber }),
          }
        })
        .filter(Boolean)

      this._render()
    }

    togglePlay() {
      if (!this.enabled) return
      if (this.audio.paused) this.play()
      else this.pause()
    }

    play() {
      if (!this.enabled) return

      const reciter = getSelectedReciter()
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
        this.audio.src = item.url
        this.audio.load()
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
      const nextIndex = this.currentIndex + 1
      if (nextIndex >= this.items.length) {
        this.pause()
        return
      }
      this.currentIndex = nextIndex
      this.play()
    }

    _onError() {
      // Network failure / 404 / decode error:
      // skip current ayah and try the next one to keep the flow going.
      if (!this.items.length) return
      const nextIndex = this.currentIndex + 1
      if (nextIndex >= this.items.length) {
        this.pause()
        return
      }
      this.currentIndex = nextIndex
      this.play()
    }

    _setHighlight(domIndex) {
      if (!Number.isFinite(domIndex)) return

      if (this.lastActiveDomIndex && this.lastActiveDomIndex !== domIndex) {
        const prev = document.getElementById(`v-${this.lastActiveDomIndex}`)
        if (prev) prev.classList.remove('karaoke-active')
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
      if (!this.container) return
      this.container.classList.add('hidden')
    }

    _show() {
      if (!this.container) return
      this.container.classList.remove('hidden')
    }

    _ensureUI() {
      if (!this.container) return
      if (this.ui.root) return

      const root = document.createElement('div')
      root.className = 'mini-player-inner'

      const title = document.createElement('div')
      title.className = 'mini-player-title'

      const status = document.createElement('div')
      status.className = 'mini-player-status muted'

      const controls = document.createElement('div')
      controls.className = 'mini-player-controls'

      const btnPrev = document.createElement('button')
      btnPrev.className = 'btn-icon'
      btnPrev.type = 'button'
      btnPrev.title = 'Previous ayah'
      btnPrev.textContent = '⏮'
      btnPrev.addEventListener('click', () => this.prev())

      const btnPlay = document.createElement('button')
      btnPlay.className = 'btn-icon'
      btnPlay.type = 'button'
      btnPlay.title = 'Play / Pause'
      btnPlay.textContent = '▶'
      btnPlay.addEventListener('click', () => this.togglePlay())

      const btnNext = document.createElement('button')
      btnNext.className = 'btn-icon'
      btnNext.type = 'button'
      btnNext.title = 'Next ayah'
      btnNext.textContent = '⏭'
      btnNext.addEventListener('click', () => this.next())

      const ayah = document.createElement('div')
      ayah.className = 'mini-player-ayah muted'

      controls.appendChild(btnPrev)
      controls.appendChild(btnPlay)
      controls.appendChild(btnNext)

      root.appendChild(title)
      root.appendChild(status)
      root.appendChild(controls)
      root.appendChild(ayah)

      this.container.innerHTML = ''
      this.container.appendChild(root)

      this.ui.root = root
      this.ui.status = status
      this.ui.title = title
      this.ui.ayah = ayah
      this.ui.btnPrev = btnPrev
      this.ui.btnPlay = btnPlay
      this.ui.btnNext = btnNext
    }

    _render() {
      if (!this.container) return
      this._ensureUI()

      const reciter = getSelectedReciter()

      const isPlaying = !this.audio.paused && !!this.audio.src
      const chapterTitle = this.chapter && this.chapter.displayTitle ? this.chapter.displayTitle : ''

      if (this.ui.title) {
        this.ui.title.textContent = chapterTitle ? `Karaoke: ${chapterTitle}` : 'Karaoke'
      }

      if (!reciter) {
        if (this.ui.status) this.ui.status.textContent = 'Choose a reciter to start playback.'
        if (this.ui.ayah) this.ui.ayah.textContent = ''
        if (this.ui.btnPrev) this.ui.btnPrev.disabled = true
        if (this.ui.btnNext) this.ui.btnNext.disabled = true
        if (this.ui.btnPlay) {
          this.ui.btnPlay.disabled = true
          this.ui.btnPlay.textContent = '▶'
        }
        return
      }

      if (!this.items.length) {
        if (this.ui.status) this.ui.status.textContent = 'This chapter is not available for EveryAyah playback.'
        if (this.ui.ayah) this.ui.ayah.textContent = ''
        if (this.ui.btnPrev) this.ui.btnPrev.disabled = true
        if (this.ui.btnNext) this.ui.btnNext.disabled = true
        if (this.ui.btnPlay) {
          this.ui.btnPlay.disabled = true
          this.ui.btnPlay.textContent = '▶'
        }
        return
      }

      if (this.ui.status) {
        this.ui.status.textContent = reciter.name ? `Reciter: ${reciter.name}` : `Folder: ${reciter.folder}`
      }

      if (this.ui.ayah) {
        const cur = this.items[this.currentIndex]
        this.ui.ayah.textContent = cur ? `Ayah ${cur.ayahNumber} / ${this.items[this.items.length - 1].ayahNumber}` : ''
      }

      if (this.ui.btnPlay) this.ui.btnPlay.textContent = isPlaying ? '⏸' : '▶'
      if (this.ui.btnPrev) this.ui.btnPrev.disabled = this.currentIndex <= 0
      if (this.ui.btnNext) this.ui.btnNext.disabled = this.currentIndex >= this.items.length - 1
    }
  }

  window.AudioPlayer = AudioPlayer
})()
