import {
  applyManifestPatch,
  getDefaultSceneManifest,
  parseSceneManifest,
  serializeSceneManifest,
  validateSceneManifest,
} from '../config/manifest.ts'
import type { RuntimeTelemetry, SceneManifest } from '../config/types.ts'
import type { DeviceOrientationSnapshot } from '../runtime/DeviceOrientationController.ts'
import {
  RUNTIME_DEVICE_MOTION_EVENT,
  RUNTIME_STATUS_EVENT,
  RUNTIME_TELEMETRY_EVENT,
  type GameRuntime,
} from '../runtime/GameRuntime.ts'
import type { LocalDatabase } from '../storage/LocalDatabase.ts'
import { transportActionForPhase, transportLabelForPhase } from './runtimeStatus.ts'

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Required interface element #${id} is missing.`)
  return value as T
}

function numberInput(id: string): HTMLInputElement {
  return element<HTMLInputElement>(id)
}

function downloadText(filename: string, source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export class AppController {
  private readonly dialog = element<HTMLDialogElement>('config-dialog')
  private readonly editor = element<HTMLTextAreaElement>('manifest-editor')
  private readonly validationOutput = element<HTMLPreElement>('validation-output')
  private readonly stageStatus = element<HTMLParagraphElement>('stage-status')
  private readonly launchCard = element<HTMLElement>('launch-card')
  private readonly profileSelect = element<HTMLSelectElement>('profile-select')
  private readonly assetSelect = element<HTMLSelectElement>('asset-select')
  private readonly animationClip = element<HTMLSelectElement>('animation-clip')
  private readonly joystick = element<HTMLElement>('joystick')
  private readonly joystickKnob = element<HTMLElement>('joystick-knob')
  private readonly pauseButton = element<HTMLButtonElement>('pause-flight')
  private readonly motionButton = element<HTMLButtonElement>('motion-control')
  private readonly motionRecenterButton = element<HTMLButtonElement>('motion-recenter')
  private activeJoystickPointer: number | null = null
  private motionActionRevision = 0

  constructor(
    private readonly runtime: GameRuntime,
    private readonly database: LocalDatabase,
  ) {}

  async initialize(): Promise<void> {
    this.bindTransport()
    this.bindConfiguration()
    this.bindAssets()
    this.bindJoystick()
    this.runtime.addEventListener(RUNTIME_TELEMETRY_EVENT, this.handleTelemetry)
    this.runtime.addEventListener(RUNTIME_STATUS_EVENT, this.handleStatus)
    this.runtime.addEventListener(RUNTIME_DEVICE_MOTION_EVENT, this.handleDeviceMotionStatus)
    this.updateRuntimeStatus(this.runtime.inspect().phase, 'Ready. Start flight when you are ready.')
    this.syncManifestControls(this.runtime.manifest)
    this.syncDeviceMotionControls(this.runtime.inspectDeviceMotion())
    await Promise.all([this.refreshProfiles(), this.refreshAssets()])
    this.refreshAnimationClips()
    this.setValidation(true, 'Manifest valid. Every field is editable in this source-of-truth view.')
    document.getElementById('app')?.setAttribute('aria-busy', 'false')
  }

  dispose(): void {
    this.runtime.removeEventListener(RUNTIME_TELEMETRY_EVENT, this.handleTelemetry)
    this.runtime.removeEventListener(RUNTIME_STATUS_EVENT, this.handleStatus)
    this.runtime.removeEventListener(RUNTIME_DEVICE_MOTION_EVENT, this.handleDeviceMotionStatus)
  }

  private bindTransport(): void {
    element<HTMLButtonElement>('launch-flight').addEventListener('click', async () => {
      try {
        await this.startFlight()
      } catch (error) {
        this.showError(error)
      }
    })
    element<HTMLButtonElement>('launch-config').addEventListener('click', () => this.openConfiguration())
    element<HTMLButtonElement>('open-config').addEventListener('click', () => this.openConfiguration())
    element<HTMLButtonElement>('close-config').addEventListener('click', () => this.dialog.close())
    this.pauseButton.addEventListener('click', async () => {
      const action = transportActionForPhase(this.runtime.inspect().phase)
      if (action === 'pause') {
        this.runtime.pause()
        return
      }
      if (action === 'none') return
      try {
        await this.startFlight()
      } catch (error) {
        this.showError(error)
      }
    })
    element<HTMLButtonElement>('reset-flight').addEventListener('click', () => this.runtime.reset())
    element<HTMLButtonElement>('fullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await element<HTMLElement>('game-canvas').parentElement?.requestFullscreen()
      } catch (error) {
        this.showError(error)
      }
    })
    this.motionButton.addEventListener('click', () => void this.toggleDeviceMotion())
    this.motionRecenterButton.addEventListener('click', () => {
      const snapshot = this.runtime.recenterDeviceMotion()
      this.syncDeviceMotionControls(snapshot)
      this.stageStatus.textContent = snapshot.message
    })

    const throttle = element<HTMLInputElement>('throttle')
    throttle.addEventListener('input', () => {
      const value = throttle.valueAsNumber / 100
      this.runtime.setThrottle(value)
      element<HTMLOutputElement>('throttle-output').value = `${Math.round(value * 100)}%`
    })
    const brake = element<HTMLButtonElement>('brake')
    const releaseBrake = () => this.runtime.setBrake(0)
    brake.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      brake.setPointerCapture(event.pointerId)
      this.runtime.setBrake(1)
    })
    brake.addEventListener('pointerup', releaseBrake)
    brake.addEventListener('pointercancel', releaseBrake)
  }

  private bindConfiguration(): void {
    element<HTMLFormElement>('quick-config').addEventListener('submit', (event) => {
      event.preventDefault()
      void this.applyQuickConfiguration()
    })
    element<HTMLButtonElement>('apply-manifest').addEventListener('click', () => void this.applyEditorManifest())
    element<HTMLButtonElement>('export-manifest').addEventListener('click', () => {
      const manifest = this.runtime.manifest
      downloadText(`${manifest.id}.gamexr.json`, serializeSceneManifest(manifest))
    })
    element<HTMLInputElement>('manifest-file').addEventListener('change', async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0]
      if (!file) return
      const source = await file.text()
      const validation = parseSceneManifest(source)
      if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
      this.editor.value = serializeSceneManifest(validation.value)
      this.setValidation(true, 'Imported manifest is valid. Select “Validate & apply” to activate it.')
    })
    element<HTMLButtonElement>('load-profile').addEventListener('click', () => void this.loadSelectedProfile())
    element<HTMLButtonElement>('delete-profile').addEventListener('click', () => void this.deleteSelectedProfile())
    element<HTMLButtonElement>('reset-default').addEventListener('click', async () => {
      try {
        await this.runtime.applyManifest(getDefaultSceneManifest())
        this.syncManifestControls(this.runtime.manifest)
        await this.refreshProfiles()
      } catch (error) {
        this.showError(error)
      }
    })
    element<HTMLButtonElement>('persist-storage').addEventListener('click', async () => {
      try {
        const persisted = await this.runtime.requestPersistentStorage()
        this.stageStatus.textContent = persisted
          ? 'Browser granted durable storage for local scenes and assets.'
          : 'Durable storage was not granted; export important scene manifests.'
      } catch (error) {
        this.showError(error)
      }
    })
    element<HTMLButtonElement>('copy-inspection').addEventListener('click', async () => {
      try {
        const inspection = {
          schema: 'gamexr-runtime-inspection/v1',
          runtime: this.runtime.inspect(),
          manifest: this.runtime.manifest,
          tools: document.documentElement.dataset.gamexrWebmcpTools?.split(',').filter(Boolean) ?? [],
          cost: { modelCalls: 0, networkCalls: 0, paidCalls: 0, estimatedCostUsd: 0 },
        }
        await navigator.clipboard.writeText(JSON.stringify(inspection, null, 2))
        this.stageStatus.textContent = 'Runtime inspection copied.'
      } catch (error) {
        this.showError(error)
      }
    })
  }

  private async toggleDeviceMotion(): Promise<void> {
    const actionRevision = ++this.motionActionRevision
    const current = this.runtime.inspectDeviceMotion()
    if (current.phase === 'running' || current.phase === 'calibrating') {
      this.runtime.disableDeviceMotion()
      await this.applyDeviceMotionPreference(false, actionRevision)
      return
    }

    const permission = await this.runtime.enableDeviceMotion()
    if (actionRevision !== this.motionActionRevision) return
    if (permission !== 'granted') {
      const snapshot = this.runtime.inspectDeviceMotion()
      this.syncDeviceMotionControls(snapshot)
      this.stageStatus.textContent = snapshot.message
      return
    }
    await this.applyDeviceMotionPreference(true, actionRevision)
  }

  private async applyDeviceMotionPreference(enabled: boolean, actionRevision: number): Promise<void> {
    if (this.runtime.manifest.motion.deviceMotionEnabled === enabled) {
      this.syncDeviceMotionControls(this.runtime.inspectDeviceMotion())
      this.stageStatus.textContent = enabled
        ? 'Device motion is calibrated and controlling this local flight.'
        : 'Device motion is disabled and its listeners were released.'
      return
    }
    try {
      await this.runtime.setDeviceMotionEnabled(enabled)
      if (actionRevision !== this.motionActionRevision) return
      this.syncManifestControls(this.runtime.manifest)
      const snapshot = this.runtime.inspectDeviceMotion()
      this.syncDeviceMotionControls(snapshot)
      this.stageStatus.textContent = enabled
        ? 'Device motion is calibrated and controlling this local flight.'
        : 'Device motion is disabled and its listeners were released.'
    } catch (error) {
      if (enabled) this.runtime.disableDeviceMotion()
      this.showError(error)
    }
  }

  private bindAssets(): void {
    element<HTMLInputElement>('asset-file').addEventListener('change', async (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0]
      if (!file) return
      const status = element<HTMLParagraphElement>('asset-status')
      status.textContent = `Validating ${file.name} locally…`
      try {
        const metadata = await this.runtime.importAsset(file)
        await this.refreshAssets(metadata.id)
        status.textContent = `${metadata.name} admitted locally · ${metadata.admission.triangleCount.toLocaleString()} triangles · SHA-256 ${metadata.sha256.slice(0, 12)}…`
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'Asset import failed.'
      } finally {
        ;(event.currentTarget as HTMLInputElement).value = ''
      }
    })
    element<HTMLButtonElement>('use-asset').addEventListener('click', () => void this.activateSelectedAsset())
    element<HTMLButtonElement>('use-procedural').addEventListener('click', async () => {
      const validation = applyManifestPatch(this.runtime.manifest, {
        ship: { asset: { kind: 'procedural', localAssetId: null } },
        animation: { importedClip: null },
      })
      if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
      try {
        await this.runtime.applyManifest(validation.value)
        this.syncManifestControls(this.runtime.manifest)
        this.refreshAnimationClips()
        element<HTMLParagraphElement>('asset-status').textContent = 'Procedural ship active. No third-party asset bytes ship by default.'
      } catch (error) {
        this.showError(error)
      }
    })
    element<HTMLButtonElement>('delete-asset').addEventListener('click', () => void this.deleteSelectedAsset())
    this.animationClip.addEventListener('change', async () => {
      try {
        await this.runtime.selectAnimationClip(this.animationClip.value || null)
        this.syncManifestControls(this.runtime.manifest)
      } catch (error) {
        this.showError(error)
        this.refreshAnimationClips()
      }
    })
    element<HTMLButtonElement>('animation-play').addEventListener('click', () => {
      this.runtime.playAnimations()
      this.syncManifestControls(this.runtime.manifest)
    })
    element<HTMLButtonElement>('animation-pause').addEventListener('click', () => {
      this.runtime.pauseAnimations()
      this.syncManifestControls(this.runtime.manifest)
    })
    element<HTMLInputElement>('animation-scrub').addEventListener('input', (event) => {
      this.runtime.scrubAnimation((event.currentTarget as HTMLInputElement).valueAsNumber / 100)
    })
    element<HTMLInputElement>('animation-speed').addEventListener('change', async (event) => {
      try {
        await this.runtime.setAnimationTimeScale((event.currentTarget as HTMLInputElement).valueAsNumber / 100)
        this.syncManifestControls(this.runtime.manifest)
      } catch (error) {
        this.showError(error)
      }
    })
  }

  private bindJoystick(): void {
    const update = (event: PointerEvent) => {
      if (this.activeJoystickPointer !== event.pointerId) return
      const bounds = this.joystick.getBoundingClientRect()
      const radius = bounds.width / 2
      let x = (event.clientX - bounds.left - radius) / radius
      let y = (event.clientY - bounds.top - radius) / radius
      const length = Math.hypot(x, y)
      if (length > 1) {
        x /= length
        y /= length
      }
      this.joystickKnob.style.transform = `translate(calc(-50% + ${x * radius * 0.62}px), calc(-50% + ${y * radius * 0.62}px))`
      this.runtime.setTouchSteering(-y, x)
      this.joystick.setAttribute('aria-valuenow', x.toFixed(2))
    }
    const release = (event: PointerEvent) => {
      if (this.activeJoystickPointer !== event.pointerId) return
      this.activeJoystickPointer = null
      this.runtime.clearTouchSteering()
      this.joystickKnob.style.transform = 'translate(-50%, -50%)'
      this.joystick.releasePointerCapture(event.pointerId)
    }
    this.joystick.addEventListener('pointerdown', (event) => {
      if (!this.runtime.manifest.motion.touchEnabled) return
      event.preventDefault()
      this.activeJoystickPointer = event.pointerId
      this.joystick.setPointerCapture(event.pointerId)
      update(event)
    })
    this.joystick.addEventListener('pointermove', update)
    this.joystick.addEventListener('pointerup', release)
    this.joystick.addEventListener('pointercancel', release)
  }

  private async applyQuickConfiguration(): Promise<void> {
    const manifest = this.runtime.manifest
    manifest.name = element<HTMLInputElement>('scene-name').value.trim()
    manifest.id = element<HTMLInputElement>('scene-id').value.trim()
    manifest.scene.environment = element<HTMLSelectElement>('environment').value as SceneManifest['scene']['environment']
    manifest.ship.appearance.hullColor = element<HTMLInputElement>('hull-color').value
    manifest.ship.appearance.accentColor = element<HTMLInputElement>('accent-color').value
    manifest.ship.appearance.exhaustColor = element<HTMLInputElement>('exhaust-color').value
    manifest.scene.starCount = numberInput('star-count').valueAsNumber
    manifest.scene.asteroidCount = numberInput('asteroid-count').valueAsNumber
    manifest.ship.flight.acceleration = numberInput('acceleration').valueAsNumber
    manifest.ship.flight.maxForwardSpeed = numberInput('max-speed').valueAsNumber
    manifest.motion.sensitivity = numberInput('sensitivity').valueAsNumber
    manifest.motion.deadZone = numberInput('dead-zone').valueAsNumber
    manifest.performance.maxPixelRatio = numberInput('pixel-ratio').valueAsNumber
    manifest.motion.invertPitch = element<HTMLInputElement>('invert-pitch').checked
    manifest.audio.enabled = element<HTMLInputElement>('audio-enabled').checked
    const validation = validateSceneManifest(manifest)
    if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
    try {
      await this.runtime.applyManifest(validation.value)
      this.syncManifestControls(this.runtime.manifest)
      await this.refreshProfiles()
      this.setValidation(true, 'Configuration applied and saved locally.')
    } catch (error) {
      this.showError(error)
    }
  }

  private async applyEditorManifest(): Promise<void> {
    const validation = parseSceneManifest(this.editor.value)
    if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
    try {
      await this.runtime.applyManifest(validation.value)
      this.syncManifestControls(this.runtime.manifest)
      await this.refreshProfiles()
      this.refreshAnimationClips()
      this.setValidation(true, 'Manifest validated, applied, and saved locally.')
    } catch (error) {
      this.showError(error)
    }
  }

  private async refreshProfiles(selectedId = this.runtime.manifest.id): Promise<void> {
    const scenes = await this.database.listScenes()
    this.profileSelect.replaceChildren(...scenes.map((scene) => {
      const option = document.createElement('option')
      option.value = scene.id
      option.textContent = scene.name
      option.selected = scene.id === selectedId
      return option
    }))
  }

  private async loadSelectedProfile(): Promise<void> {
    const manifest = await this.database.getScene(this.profileSelect.value)
    if (!manifest) return this.setValidation(false, 'Selected local scene no longer exists.')
    const validation = validateSceneManifest(manifest)
    if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
    try {
      await this.runtime.applyManifest(validation.value)
      this.syncManifestControls(this.runtime.manifest)
      this.refreshAnimationClips()
    } catch (error) {
      this.showError(error)
    }
  }

  private async deleteSelectedProfile(): Promise<void> {
    const id = this.profileSelect.value
    if (!id || !confirm(`Delete local scene “${id}”? Export it first if you need a recovery copy.`)) return
    await this.database.deleteScene(id)
    if (this.runtime.manifest.id === id) await this.runtime.applyManifest(getDefaultSceneManifest())
    this.syncManifestControls(this.runtime.manifest)
    await this.refreshProfiles()
  }

  private async refreshAssets(selectedId?: string): Promise<void> {
    const assets = await this.runtime.listAssets()
    const options = assets.map((asset) => {
      const option = document.createElement('option')
      option.value = asset.id
      option.textContent = `${asset.name} · ${Math.round(asset.byteLength / 1024)} KB`
      option.selected = asset.id === selectedId
      return option
    })
    if (options.length === 0) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = 'No local assets'
      options.push(option)
    }
    this.assetSelect.replaceChildren(...options)
  }

  private async activateSelectedAsset(): Promise<void> {
    const id = this.assetSelect.value
    if (!id) return this.setValidation(false, 'Import and select a GLB first.')
    const validation = applyManifestPatch(this.runtime.manifest, {
      ship: { asset: { kind: 'local-glb', localAssetId: id } },
      animation: { importedClip: null },
    })
    if (!validation.ok) return this.setValidation(false, validation.issues.join('\n'))
    try {
      await this.runtime.applyManifest(validation.value)
      this.syncManifestControls(this.runtime.manifest)
      this.refreshAnimationClips()
      element<HTMLParagraphElement>('asset-status').textContent = `Local asset ${id} is active. It remains on this device.`
    } catch (error) {
      this.showError(error)
    }
  }

  private async deleteSelectedAsset(): Promise<void> {
    const id = this.assetSelect.value
    if (!id || !confirm(`Delete local asset “${id}”? This cannot be undone unless you retain the source GLB.`)) return
    try {
      await this.runtime.deleteAsset(id)
      await this.refreshAssets()
      element<HTMLParagraphElement>('asset-status').textContent = 'Local asset deleted.'
    } catch (error) {
      this.showError(error)
    }
  }

  private refreshAnimationClips(): void {
    const current = this.runtime.manifest.animation.importedClip
    const none = document.createElement('option')
    none.value = ''
    none.textContent = 'Procedural / none'
    const options = this.runtime.animationClips.map((name) => {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      option.selected = name === current
      return option
    })
    this.animationClip.replaceChildren(none, ...options)
    this.animationClip.value = current ?? ''
  }

  private syncManifestControls(manifest: SceneManifest): void {
    this.editor.value = serializeSceneManifest(manifest)
    element<HTMLInputElement>('scene-name').value = manifest.name
    element<HTMLInputElement>('scene-id').value = manifest.id
    element<HTMLSelectElement>('environment').value = manifest.scene.environment
    element<HTMLInputElement>('hull-color').value = manifest.ship.appearance.hullColor
    element<HTMLInputElement>('accent-color').value = manifest.ship.appearance.accentColor
    element<HTMLInputElement>('exhaust-color').value = manifest.ship.appearance.exhaustColor
    numberInput('star-count').valueAsNumber = manifest.scene.starCount
    numberInput('asteroid-count').valueAsNumber = manifest.scene.asteroidCount
    numberInput('acceleration').valueAsNumber = manifest.ship.flight.acceleration
    numberInput('max-speed').valueAsNumber = manifest.ship.flight.maxForwardSpeed
    numberInput('sensitivity').valueAsNumber = manifest.motion.sensitivity
    numberInput('dead-zone').valueAsNumber = manifest.motion.deadZone
    numberInput('pixel-ratio').valueAsNumber = manifest.performance.maxPixelRatio
    element<HTMLInputElement>('invert-pitch').checked = manifest.motion.invertPitch
    element<HTMLInputElement>('audio-enabled').checked = manifest.audio.enabled
    element<HTMLInputElement>('animation-speed').valueAsNumber = Math.round(manifest.animation.timeScale * 100)
    const touchEnabled = manifest.motion.touchEnabled
    element<HTMLInputElement>('throttle').disabled = !touchEnabled
    element<HTMLButtonElement>('brake').disabled = !touchEnabled
    this.joystick.setAttribute('aria-disabled', String(!touchEnabled))
    this.joystick.tabIndex = touchEnabled ? 0 : -1
    this.syncDeviceMotionControls(this.runtime.inspectDeviceMotion())
  }

  private syncDeviceMotionControls(snapshot: DeviceOrientationSnapshot): void {
    const phase = snapshot.phase
    const active = phase === 'calibrating' || phase === 'running'
    this.motionButton.dataset.state = phase
    this.motionButton.setAttribute('aria-pressed', String(active))
    this.motionButton.disabled = phase === 'requesting-permission' || phase === 'disposed'
    this.motionRecenterButton.hidden = phase !== 'running'
    this.motionRecenterButton.disabled = phase !== 'running'

    switch (phase) {
      case 'requesting-permission':
        this.motionButton.textContent = 'Allow Motion…'
        break
      case 'calibrating':
      case 'running':
        this.motionButton.textContent = 'Disable Motion'
        break
      case 'denied':
        this.motionButton.textContent = 'Retry Motion'
        break
      case 'unavailable':
        this.motionButton.textContent = 'Try Motion Again'
        break
      case 'disposed':
        this.motionButton.textContent = 'Motion closed'
        break
      case 'off':
        this.motionButton.textContent = 'Enable Motion'
        break
    }
  }

  private openConfiguration(): void {
    this.syncManifestControls(this.runtime.manifest)
    this.refreshAnimationClips()
    if (!this.dialog.open) this.dialog.showModal()
  }

  private setValidation(valid: boolean, message: string): void {
    this.validationOutput.dataset.valid = String(valid)
    this.validationOutput.textContent = message
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'The operation failed.'
    this.stageStatus.textContent = message
    this.setValidation(false, message)
  }

  private async startFlight(): Promise<void> {
    await this.runtime.start()
    this.launchCard.hidden = true
    void this.runtime.requestPersistentStorage().catch(() => false)
  }

  private updateRuntimeStatus(phase: RuntimeTelemetry['phase'], message: string): void {
    const badge = element<HTMLElement>('runtime-badge')
    badge.dataset.phase = phase
    element<HTMLElement>('runtime-phase').textContent = phase.toUpperCase()
    this.stageStatus.textContent = message
    document.documentElement.dataset.gamexrRuntime = phase
    if (phase === 'running') this.launchCard.hidden = true
    this.pauseButton.textContent = transportLabelForPhase(phase)
    this.pauseButton.disabled = transportActionForPhase(phase) === 'none'
  }

  private readonly handleTelemetry = (event: Event): void => {
    const telemetry = (event as CustomEvent<RuntimeTelemetry>).detail
    element<HTMLElement>('telemetry-speed').textContent = telemetry.speed.toFixed(1)
    element<HTMLElement>('telemetry-throttle').textContent = `${Math.round(telemetry.throttle * 100)}%`
    element<HTMLElement>('telemetry-altitude').textContent = telemetry.altitude.toFixed(1)
    element<HTMLElement>('telemetry-fps').textContent = String(Math.round(telemetry.framesPerSecond))
  }

  private readonly handleStatus = (event: Event): void => {
    const detail = (event as CustomEvent<{ phase: RuntimeTelemetry['phase']; message: string }>).detail
    this.updateRuntimeStatus(detail.phase, detail.message)
  }

  private readonly handleDeviceMotionStatus = (event: Event): void => {
    const snapshot = (event as CustomEvent<DeviceOrientationSnapshot>).detail
    this.syncDeviceMotionControls(snapshot)
    this.stageStatus.textContent = snapshot.message
  }
}
