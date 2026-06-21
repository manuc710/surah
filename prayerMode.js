/* global window, document, localStorage, DeviceOrientationEvent */

;(function () {
  const STORAGE_KEY = 'kyrilquran_html.prayerCalibration'
  const STABLE_MS = 220
  const POSES = {
    idle: { label: 'Ожидание', badge: '⚪', tone: 'idle' },
    qiyam: { label: 'Кыям', badge: '🟢', tone: 'qiyam' },
    ruku: { label: 'Руку', badge: '🟡', tone: 'ruku' },
    sujud: { label: 'Суджуд', badge: '🔴', tone: 'sujud' },
    jalsa: { label: 'Джальса', badge: '🔵', tone: 'jalsa' },
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  class PrayerModeController {
    constructor() {
      this.active = false
      this.calibration = this._loadCalibration()
      this.lastOrientation = null
      this.permissionState = 'unknown'
      this.pose = 'idle'
      this.pendingPose = null
      this.pendingPoseSince = 0
      this.rakahCount = 0
      this.sujudSeenInCycle = false
      this.context = null
      this.boundOrientation = (event) => this._onOrientation(event)
    }

    init() {
      this.indicator = document.getElementById('prayer-pose-indicator')
      this.indicatorBadge = document.getElementById('prayer-pose-indicator-badge')
      this.indicatorTitle = document.getElementById('prayer-pose-indicator-title')
      this.indicatorSubtitle = document.getElementById('prayer-pose-indicator-subtitle')
      this.modalBackdrop = document.getElementById('prayer-calibration-backdrop')
      this.modalText = document.getElementById('prayer-calibration-text')
      this.modalNote = document.getElementById('prayer-calibration-note')
      this.confirmButton = document.getElementById('prayer-calibration-confirm')
      this.closeButton = document.getElementById('prayer-calibration-close')
      if (this.confirmButton) this.confirmButton.addEventListener('click', () => this.confirmCalibration())
      if (this.closeButton) this.closeButton.addEventListener('click', () => this.hideCalibration())
      this._renderPose('idle')
    }

    _loadCalibration() {
      const parsed = safeParse(localStorage.getItem(STORAGE_KEY) || '')
      if (!parsed || typeof parsed !== 'object') return null
      const beta = Number(parsed.beta)
      const gamma = Number(parsed.gamma)
      if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null
      return { beta, gamma }
    }

    _saveCalibration() {
      if (!this.calibration) {
        localStorage.removeItem(STORAGE_KEY)
        return
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.calibration))
    }

    async preparePermissionRequest() {
      if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
        this.permissionState = 'unsupported'
        return this.permissionState
      }
      if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
        this.permissionState = 'granted'
        return this.permissionState
      }
      try {
        const result = await DeviceOrientationEvent.requestPermission()
        this.permissionState = result === 'granted' ? 'granted' : 'denied'
        return this.permissionState
      } catch {
        this.permissionState = 'denied'
        return this.permissionState
      }
    }

    sync(context) {
      this.context = context || null
      const shouldBeActive = !!(context && context.active)
      if (!shouldBeActive) {
        this.active = false
        this._pauseByPose()
        this._hideIndicator()
        this.hideCalibration()
        return
      }

      this.active = true
      this._showIndicator()
      this._startSensors()
      this._bindPageInfo()

      if (!this.calibration) {
        this.showCalibration('Встаньте прямо для калибровки. Нажмите "Готово".')
        this._pauseByPose()
        this._renderPose('idle', 'Ожидается калибровка')
        return
      }

      if (context && context.autoStart && typeof context.play === 'function') {
        if (this.lastOrientation) {
          this._applyPose(this._detectPose(this.lastOrientation.beta, this.lastOrientation.gamma), true)
        } else {
          context.play()
          this._renderPose(this.pose === 'idle' ? 'qiyam' : this.pose, 'Ожидание данных датчиков')
        }
      } else {
        this._renderPose(this.pose === 'idle' ? 'qiyam' : this.pose)
      }
    }

    showCalibration(message, note = '') {
      if (this.modalText) this.modalText.textContent = message || 'Встаньте прямо для калибровки. Нажмите "Готово".'
      if (this.modalNote) {
        this.modalNote.textContent = note || ''
        this.modalNote.classList.toggle('hidden', !note)
      }
      if (this.modalBackdrop) this.modalBackdrop.classList.remove('hidden')
    }

    hideCalibration() {
      if (this.modalBackdrop) this.modalBackdrop.classList.add('hidden')
      if (this.modalNote) {
        this.modalNote.textContent = ''
        this.modalNote.classList.add('hidden')
      }
    }

    async confirmCalibration() {
      const permission = await this.preparePermissionRequest()
      if (permission === 'unsupported') {
        this.showCalibration(
          'Ваше устройство не поддерживает датчики движения.',
          'Откройте режим на телефоне с акселерометром и гироскопом.',
        )
        return
      }
      if (permission === 'denied') {
        this.showCalibration(
          'Доступ к датчикам движения не разрешен.',
          'Разрешите доступ к Motion & Orientation в настройках браузера и нажмите "Готово" снова.',
        )
        return
      }
      if (!this.lastOrientation) {
        this.showCalibration(
          'Не удалось считать положение телефона.',
          'Подержите устройство неподвижно 1-2 секунды и нажмите "Готово" повторно.',
        )
        return
      }

      this.calibration = {
        beta: this.lastOrientation.beta,
        gamma: this.lastOrientation.gamma,
      }
      this._saveCalibration()
      this.rakahCount = 0
      this.sujudSeenInCycle = false
      this.pendingPose = null
      this.pendingPoseSince = 0
      this.hideCalibration()
      this._applyPose('qiyam', true)
    }

    recalibrate() {
      this.calibration = null
      this._saveCalibration()
      this.pose = 'idle'
      this.showCalibration('Встаньте прямо для калибровки. Нажмите "Готово".')
      this._pauseByPose()
      this._renderPose('idle', 'Ожидается калибровка')
    }

    _startSensors() {
      if (this.listening) return
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
      window.addEventListener('deviceorientation', this.boundOrientation)
      this.listening = true
    }

    _onOrientation(event) {
      const beta = Number(event && event.beta)
      const gamma = Number(event && event.gamma)
      if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return
      this.lastOrientation = { beta, gamma }
      if (!this.active || !this.calibration) return

      const pose = this._detectPose(beta, gamma)
      const now = Date.now()
      if (pose !== this.pendingPose) {
        this.pendingPose = pose
        this.pendingPoseSince = now
        return
      }
      if (pose !== this.pose && now - this.pendingPoseSince >= STABLE_MS) {
        this._applyPose(pose)
      }
    }

    _detectPose(beta, gamma) {
      if (!this.calibration) return 'idle'
      const diffBeta = beta - this.calibration.beta
      const diffGamma = Math.abs(gamma - this.calibration.gamma)
      if (diffBeta > 70 || (diffBeta > 45 && diffGamma > 24) || diffGamma > 38) return 'sujud'
      if (diffBeta > 30) return 'ruku'
      if (diffBeta >= 20) return 'jalsa'
      if (Math.abs(diffBeta) <= 20) return 'qiyam'
      return 'qiyam'
    }

    _applyPose(pose, force = false) {
      const nextPose = POSES[pose] ? pose : 'idle'
      const previousPose = this.pose
      if (!force && nextPose === previousPose) return

      if ((previousPose === 'sujud' || previousPose === 'jalsa') && nextPose === 'qiyam' && this.sujudSeenInCycle) {
        this.rakahCount += 1
        this.sujudSeenInCycle = false
      }
      if (nextPose === 'sujud') this.sujudSeenInCycle = true

      this.pose = nextPose
      if (nextPose === 'qiyam') this._resumeByPose()
      else this._pauseByPose()
      this._renderPose(nextPose)
    }

    _resumeByPose() {
      const context = this.context
      if (!context || typeof context.play !== 'function') return
      context.play()
    }

    _pauseByPose() {
      const context = this.context
      if (!context || typeof context.pause !== 'function') return
      context.pause()
    }

    _showIndicator() {
      if (this.indicator) this.indicator.classList.remove('hidden')
    }

    _hideIndicator() {
      if (this.indicator) this.indicator.classList.add('hidden')
    }

    _renderPose(pose, subtitleOverride = '') {
      const meta = POSES[pose] || POSES.idle
      if (this.indicator) {
        this.indicator.dataset.pose = pose
      }
      if (this.indicatorBadge) this.indicatorBadge.textContent = meta.badge
      if (this.indicatorTitle) this.indicatorTitle.textContent = meta.label

      const subtitle = subtitleOverride || this._buildSubtitle(pose)
      if (this.indicatorSubtitle) this.indicatorSubtitle.textContent = subtitle

      this._bindPageInfo()
      if (this.pagePose) this.pagePose.textContent = meta.label
      if (this.pageRakahs) this.pageRakahs.textContent = String(this.rakahCount)
      if (this.pageHint) this.pageHint.textContent = this._buildHint(pose)
    }

    _buildSubtitle(pose) {
      if (pose === 'qiyam') return 'Чтение и прокрутка активны'
      if (pose === 'ruku') return 'Аудио на паузе до выпрямления'
      if (pose === 'sujud') return 'Пауза и фиксация на текущем аяте'
      if (pose === 'jalsa') return 'Пауза в положении сидя'
      return 'Подготовка датчиков'
    }

    _buildHint(pose) {
      if (pose === 'sujud') return 'Субхана раббияль-аля'
      if (pose === 'jalsa') return 'Пауза: можно читать дуа между суджудами'
      if (pose === 'ruku') return 'Пауза: текст удерживается на текущем аяте'
      if (pose === 'qiyam') return 'Телефон в вертикальном положении, чтение продолжается'
      return 'Откалибруйте устройство, чтобы включить синхронизацию по позам'
    }

    _bindPageInfo() {
      this.pagePose = document.getElementById('prayer-current-pose')
      this.pageRakahs = document.getElementById('prayer-rakah-count')
      this.pageHint = document.getElementById('prayer-pose-message')
    }
  }

  const controller = new PrayerModeController()
  window.PrayerMode = controller
  document.addEventListener('DOMContentLoaded', () => controller.init())
})()
