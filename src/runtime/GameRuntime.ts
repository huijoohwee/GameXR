import {
  ACESFilmicToneMapping,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Group,
} from 'three'
import {
  createFlightSimCameraProfile,
  resolveFlightSimFollowTarget,
} from '@knowgrph/apple-spatial-input/camera'
import type { GameOsWorldState } from 'grph-shared/game-os/index'
import type { RuntimeTelemetry, SceneManifest } from '../config/types.ts'
import { LocalDatabase, requestPersistentStorage, type StoredAssetMetadata } from '../storage/LocalDatabase.ts'
import { AnimationController } from './AnimationController.ts'
import { AssetManager } from './AssetManager.ts'
import { AudioEngine } from './AudioEngine.ts'
import type { DeviceOrientationSnapshot } from './DeviceOrientationController.ts'
import { FlightSimulation } from './FlightSimulation.ts'
import { InputController } from './InputController.ts'
import { PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT, PersistentStrategyProjection, type PersistentStrategyVisualConfig } from './PersistentStrategyProjection.ts'
import { createProceduralShip } from './createProceduralShip.ts'
import { createWorld, type WorldResources } from './createWorld.ts'
import { disposeObject3D } from './resources.ts'

export const RUNTIME_TELEMETRY_EVENT = 'gamexr:telemetry'
export const RUNTIME_STATUS_EVENT = 'gamexr:status'
export const RUNTIME_DEVICE_MOTION_EVENT = 'gamexr:device-motion'

type RuntimePhase = RuntimeTelemetry['phase']

interface RuntimeStatusDetail {
  phase: RuntimePhase
  message: string
}

interface PreparedScene {
  scene: Scene
  world: WorldResources
  shipRoot: Group
  animation: AnimationController
}

function boundedPixelRatio(manifest: SceneManifest, qualityScale: number): number {
  return Math.max(0.65, Math.min(devicePixelRatio, manifest.performance.maxPixelRatio) * qualityScale)
}

export class GameRuntime extends EventTarget {
  private manifestValue: SceneManifest
  private scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly renderer: WebGLRenderer
  private readonly input: InputController
  private readonly unsubscribeDeviceMotionLifecycle: () => void
  private readonly simulation: FlightSimulation
  private readonly audio: AudioEngine
  private readonly assetManager: AssetManager
  private persistentStrategyProjection: PersistentStrategyProjection | null = null
  private animation: AnimationController
  private world: WorldResources | null = null
  private shipRoot: Group | null = null
  private phase: RuntimePhase = 'idle'
  private lastError: string | null = null
  private animationFrame = 0
  private lastFrameTime = 0
  private accumulator = 0
  private frameSamples: number[] = []
  private qualityScale = 1
  private qualityRecoveryFrames = 0
  private lastTelemetryAt = 0
  private rebuildGeneration = 0
  private configurationQueue: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly resizeObserver: ResizeObserver
  private readonly desiredCameraPosition = new Vector3()
  private readonly desiredLookTarget = new Vector3()
  private readonly cameraUp = new Vector3(0, 1, 0)
  private readonly cameraMatrix = new Matrix4()
  private readonly desiredCameraRotation = new Quaternion()
  private cameraSequence = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    manifest: SceneManifest,
    private readonly database: LocalDatabase,
    private readonly claimFlightSurface: () => void = () => undefined,
  ) {
    super()
    this.manifestValue = structuredClone(manifest)
    this.camera = new PerspectiveCamera(
      manifest.camera.fieldOfView,
      1,
      manifest.camera.near,
      manifest.camera.far,
    )
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.input = new InputController(this.manifestValue)
    this.unsubscribeDeviceMotionLifecycle = this.input.subscribeDeviceOrientationLifecycle((snapshot) => {
      this.dispatchEvent(new CustomEvent<DeviceOrientationSnapshot>(RUNTIME_DEVICE_MOTION_EVENT, { detail: snapshot }))
    })
    this.simulation = new FlightSimulation(this.manifestValue)
    this.audio = new AudioEngine(this.manifestValue)
    this.assetManager = new AssetManager(database)
    this.animation = new AnimationController(this.manifestValue)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
  }

  async initialize(): Promise<void> {
    await this.rebuildScene(this.manifestValue)
    this.setPhase('idle', 'Ready. Start flight when you are ready.')
    this.renderSingleFrame(true)
  }

  get manifest(): SceneManifest {
    return structuredClone(this.manifestValue)
  }
  get animationClips(): string[] {
    return this.animation.availableImportedClips
  }
  get error(): string | null {
    return this.lastError
  }

  async applyManifest(manifest: SceneManifest): Promise<void> {
    this.assertUsable()
    const nextManifest = structuredClone(manifest)
    await this.enqueueConfiguration(async () => {
      this.assertUsable()
      const previousPhase = this.phase
      await this.rebuildScene(nextManifest, true)
      if (previousPhase === 'running') {
        this.phase = 'running'
        this.dispatchStatus('Configuration applied locally; flight remains running.')
      } else {
        this.setPhase('paused', 'Configuration applied locally.')
      }
    })
  }

  async start(): Promise<void> {
    this.assertUsable()
    if (this.phase === 'blocked') throw new Error(this.lastError ?? 'The runtime is blocked.')
    this.claimFlightSurface()
    let silentMode = false
    if (this.manifestValue.audio.enabled) {
      try {
        silentMode = !(await this.audio.startFromUserGesture())
      } catch {
        silentMode = true
      }
    }
    this.phase = 'running'
    this.lastFrameTime = performance.now()
    this.accumulator = 0
    this.dispatchStatus(silentMode
      ? 'Flight running locally in silent mode; use a direct gesture to enable audio.'
      : 'Flight running locally.')
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = requestAnimationFrame(this.frame)
  }

  pause(): void {
    if (this.disposed || this.phase === 'disposed') return
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
    if (this.phase !== 'blocked') this.phase = 'paused'
    void this.audio.suspend()
    this.dispatchStatus(this.phase === 'blocked' ? this.lastError ?? 'Runtime blocked.' : 'Flight paused.')
    this.renderSingleFrame()
  }

  reset(): void {
    this.assertUsable()
    this.claimFlightSurface()
    this.simulation.reset(this.manifestValue)
    this.animation.reset()
    this.accumulator = 0
    this.renderSingleFrame(true)
    this.dispatchStatus('Flight state reset to the active manifest.')
  }
  setThrottle(value: number): void {
    this.input.setThrottle(value)
  }
  setBrake(value: number): void {
    this.input.setBrake(value)
  }
  setTouchSteering(pitch: number, roll: number, yaw?: number): void {
    this.input.setTouchSteering(pitch, roll, yaw)
  }
  clearTouchSteering(): void {
    this.input.clearTouchSteering()
  }
  async enableDeviceMotion(): Promise<'granted' | 'denied' | 'unavailable'> {
    const snapshot = await this.input.enableDeviceOrientation()
    if (snapshot.phase === 'running' && snapshot.permission === 'granted') return 'granted'
    if (snapshot.permission === 'denied') return 'denied'
    return 'unavailable'
  }
  disableDeviceMotion(): DeviceOrientationSnapshot {
    return this.input.disableDeviceOrientation()
  }
  recenterDeviceMotion(): DeviceOrientationSnapshot {
    return this.input.recenterDeviceOrientation()
  }
  inspectDeviceMotion(): DeviceOrientationSnapshot {
    return this.input.inspectDeviceOrientation()
  }
  async setDeviceMotionEnabled(enabled: boolean): Promise<void> {
    this.assertUsable()
    await this.enqueueConfiguration(async () => {
      const nextManifest = structuredClone(this.manifestValue)
      nextManifest.motion.deviceMotionEnabled = enabled
      await this.database.saveScene(nextManifest)
      this.manifestValue = nextManifest
      this.input.configure(this.manifestValue)
    })
  }
  playAnimations(): void {
    this.animation.play()
    this.manifestValue.animation.playing = true
  }
  pauseAnimations(): void {
    this.animation.pause()
    this.manifestValue.animation.playing = false
  }
  scrubAnimation(normalizedTime: number): void {
    this.animation.scrub(normalizedTime)
    this.renderSingleFrame()
  }

  async selectAnimationClip(name: string | null): Promise<void> {
    await this.enqueueConfiguration(async () => {
      if (name && !this.animationClips.includes(name)) throw new Error(`Imported animation clip “${name}” is not available.`)
      const nextManifest = structuredClone(this.manifestValue)
      nextManifest.animation.importedClip = name
      await this.database.saveScene(nextManifest)
      this.animation.configure(nextManifest)
      this.manifestValue = nextManifest
      this.renderSingleFrame()
    })
  }

  async setAnimationTimeScale(value: number): Promise<void> {
    if (!Number.isFinite(value) || value < 0 || value > 4) throw new Error('Animation time scale must be from 0 through 4.')
    await this.enqueueConfiguration(async () => {
      const nextManifest = structuredClone(this.manifestValue)
      nextManifest.animation.timeScale = value
      await this.database.saveScene(nextManifest)
      this.animation.configure(nextManifest)
      this.manifestValue = nextManifest
    })
  }

  async importAsset(file: File): Promise<StoredAssetMetadata> {
    const imported = await this.assetManager.importLocalGlb(file)
    disposeObject3D(imported.root)
    return imported.metadata
  }

  listAssets(): Promise<StoredAssetMetadata[]> {
    return this.database.listAssets()
  }

  async deleteAsset(id: string): Promise<void> {
    const owners = (await this.database.listScenes())
      .filter((scene) => scene.ship.asset.localAssetId === id)
      .map((scene) => scene.name)
    if (owners.length > 0) {
      throw new Error(`Local asset is still used by: ${owners.join(', ')}. Change or delete those scene profiles first.`)
    }
    await this.database.deleteAsset(id)
  }

  requestPersistentStorage(): Promise<boolean> {
    return requestPersistentStorage()
  }

  projectPersistentStrategyWorld(state: Readonly<GameOsWorldState> | null): void {
    this.assertUsable()
    const projection = this.requirePersistentStrategyProjection()
    projection.update(state)
    this.canvas.dataset.gamexrPersistentStrategy = state ? 'visible' : 'hidden'
    this.canvas.dataset.gamexrPersistentStrategyAnchor =
      projection.group.parent === this.camera ? 'camera' : 'detached'
    this.renderSingleFrame(true)
  }

  configurePersistentStrategyVisuals(input: Partial<PersistentStrategyVisualConfig>): PersistentStrategyVisualConfig {
    this.assertUsable()
    const config = this.requirePersistentStrategyProjection().configure(input)
    this.canvas.dataset.gamexrPersistentStrategyLayoutRadius = String(config.layoutRadius)
    this.dispatchEvent(new CustomEvent(PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT, { detail: config }))
    this.renderSingleFrame(true)
    return config
  }

  inspect(): RuntimeTelemetry {
    const frameTime = this.averageFrameTime
    const controls = this.input.snapshot()
    return {
      phase: this.phase,
      speed: this.simulation.speed,
      throttle: controls.throttle,
      altitude: this.simulation.state.position.y,
      framesPerSecond: frameTime > 0 ? 1000 / frameTime : 0,
      frameTimeMilliseconds: frameTime,
      qualityScale: this.qualityScale,
      position: this.simulation.positionTuple,
      rotation: this.simulation.rotationTuple,
      camera: {
        mode: 'chase',
        position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        quaternion: [
          this.camera.quaternion.x,
          this.camera.quaternion.y,
          this.camera.quaternion.z,
          this.camera.quaternion.w,
        ],
        lookTarget: [this.desiredLookTarget.x, this.desiredLookTarget.y, this.desiredLookTarget.z],
        fieldOfViewDegrees: this.camera.fov,
      },
      activeAsset: this.manifestValue.ship.asset.localAssetId ?? 'procedural',
      activeAnimation: this.animation.activeImportedClip,
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.input.dispose()
    this.unsubscribeDeviceMotionLifecycle()
    this.persistentStrategyProjection?.dispose()
    delete this.canvas.dataset.gamexrPersistentStrategy
    delete this.canvas.dataset.gamexrPersistentStrategyAnchor
    delete this.canvas.dataset.gamexrPersistentStrategyLayoutRadius
    this.disposeSceneResources()
    await this.audio.dispose()
    this.renderer.dispose()
    this.database.close()
    this.phase = 'disposed'
    this.dispatchStatus('Runtime disposed and local resources released.')
  }

  private async rebuildScene(manifest: SceneManifest, persist = false): Promise<void> {
    const generation = ++this.rebuildGeneration
    let prepared: PreparedScene | null = null
    try {
      prepared = await this.prepareScene(manifest)
      if (generation !== this.rebuildGeneration) throw new Error('Scene update was superseded by a newer request.')
      if (persist) await this.database.saveScene(manifest)
      if (generation !== this.rebuildGeneration) throw new Error('Scene update was superseded by a newer request.')
    } catch (error) {
      if (prepared) this.disposePreparedScene(prepared)
      throw error
    }

    this.disposeSceneResources()
    this.scene = prepared.scene
    if (this.persistentStrategyProjection) {
      this.camera.add(this.persistentStrategyProjection.group)
      this.scene.add(this.camera)
    }
    this.world = prepared.world
    this.shipRoot = prepared.shipRoot
    this.animation = prepared.animation
    this.manifestValue = structuredClone(manifest)
    this.input.configure(this.manifestValue)
    this.simulation.reset(this.manifestValue)
    this.audio.configure(this.manifestValue)
    this.camera.fov = manifest.camera.fieldOfView
    this.camera.near = manifest.camera.near
    this.camera.far = manifest.camera.far
    this.camera.updateProjectionMatrix()
    this.qualityScale = 1
    this.renderer.setPixelRatio(boundedPixelRatio(manifest, this.qualityScale))
    this.resize()
    this.lastError = null
    this.updateSceneObjects(0, true)
  }

  private async prepareScene(manifest: SceneManifest): Promise<PreparedScene> {
    const scene = new Scene()
    const world = createWorld(scene, manifest)
    const animation = new AnimationController(manifest)
    let shipRoot: Group | null = null
    try {
      if (manifest.ship.asset.kind === 'procedural') {
        const ship = createProceduralShip(manifest)
        shipRoot = ship.root
        animation.attachProcedural(ship)
      } else {
        const assetId = manifest.ship.asset.localAssetId
        if (!assetId) throw new Error('A local-glb ship requires a local asset id.')
        const imported = await this.assetManager.loadLocalGlb(assetId)
        shipRoot = imported.root
        shipRoot.scale.multiplyScalar(manifest.ship.scale)
        animation.attachImported(imported.root, imported.animations)
      }
      scene.add(shipRoot)
      animation.configure(manifest)
      return { scene, world, shipRoot, animation }
    } catch (error) {
      animation.dispose()
      if (shipRoot) disposeObject3D(shipRoot)
      world.dispose()
      throw error
    }
  }

  private disposePreparedScene(prepared: PreparedScene): void {
    prepared.animation.dispose()
    disposeObject3D(prepared.shipRoot)
    prepared.world.dispose()
  }

  private enqueueConfiguration(operation: () => Promise<void>): Promise<void> {
    const queued = this.configurationQueue.then(operation)
    this.configurationQueue = queued.catch(() => undefined)
    return queued
  }

  private readonly frame = (time: number): void => {
    if (this.phase !== 'running' || this.disposed) return
    const elapsed = Math.min(0.1, Math.max(0, (time - this.lastFrameTime) / 1000))
    this.lastFrameTime = time
    this.accumulator += elapsed
    const fixedStep = 1 / this.manifestValue.performance.targetFramesPerSecond
    const maximumSteps = this.manifestValue.performance.maxSimulationCatchUpSteps
    let steps = 0
    const controls = this.input.snapshot()

    while (this.accumulator >= fixedStep && steps < maximumSteps) {
      this.simulation.step(fixedStep, controls)
      this.accumulator -= fixedStep
      steps += 1
    }
    if (steps === maximumSteps && this.accumulator >= fixedStep) this.accumulator %= fixedStep

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.animation.update(reducedMotion ? 0 : elapsed, controls.throttle)
    this.audio.update(controls.throttle, this.simulation.speed)
    this.updateSceneObjects(elapsed)
    this.renderer.render(this.scene, this.camera)
    this.recordFramePerformance(elapsed * 1000)
    if (time - this.lastTelemetryAt >= 100) {
      this.lastTelemetryAt = time
      this.dispatchEvent(new CustomEvent<RuntimeTelemetry>(RUNTIME_TELEMETRY_EVENT, { detail: this.inspect() }))
    }
    this.animationFrame = requestAnimationFrame(this.frame)
  }

  private updateSceneObjects(deltaSeconds: number, snapCamera = false): void {
    if (!this.shipRoot) return
    this.shipRoot.position.copy(this.simulation.state.position)
    this.shipRoot.quaternion.copy(this.simulation.state.rotation)
    const animationScale = this.manifestValue.animation.playing ? this.manifestValue.animation.timeScale : 0
    if (this.world?.planet) {
      this.world.planet.rotation.y += this.manifestValue.scene.planet.rotationSpeed * deltaSeconds * animationScale
    }
    if (this.world) {
      this.world.asteroidField.rotation.y += this.manifestValue.animation.asteroidDriftSpeed * deltaSeconds * animationScale * 0.05
    }

    const cameraConfig = this.manifestValue.camera
    const followTarget = resolveFlightSimFollowTarget({
      aircraft: this.simulation.canonicalAircraft,
      runId: this.rebuildGeneration,
      tick: this.cameraSequence++,
    }, 1, 'chase', createFlightSimCameraProfile({
      aircraftCollisionHalfSizeMeters: [0.1, 0.1, 0.1],
      chaseMinimumDistanceMeters: cameraConfig.chaseDistance,
      chaseTargetMinimumHeightMeters: Math.max(0.1, cameraConfig.lookAhead),
      chaseHeightMeters: cameraConfig.chaseHeight,
      chaseFovDegrees: cameraConfig.fieldOfView,
      chaseWingHalfSpanClearance: 1,
    }))
    this.desiredCameraPosition.fromArray(followTarget.position)
    this.desiredLookTarget.fromArray(followTarget.target)
    if (this.camera.fov !== followTarget.fovDegrees) {
      this.camera.fov = followTarget.fovDegrees
      this.camera.updateProjectionMatrix()
    }
    const blend = snapCamera ? 1 : 1 - Math.exp(-cameraConfig.damping * Math.max(deltaSeconds, 1 / 120))
    this.camera.position.lerp(this.desiredCameraPosition, blend)
    this.cameraMatrix.lookAt(this.camera.position, this.desiredLookTarget, this.cameraUp)
    this.desiredCameraRotation.setFromRotationMatrix(this.cameraMatrix)
    this.camera.quaternion.slerp(this.desiredCameraRotation, blend)
  }

  private recordFramePerformance(frameMilliseconds: number): void {
    if (!Number.isFinite(frameMilliseconds) || frameMilliseconds <= 0) return
    this.frameSamples.push(frameMilliseconds)
    if (this.frameSamples.length > 60) this.frameSamples.shift()
    if (!this.manifestValue.performance.dynamicResolution || this.frameSamples.length < 60) return
    const budget = 1000 / this.manifestValue.performance.targetFramesPerSecond
    const average = this.averageFrameTime
    if (average > budget * 1.2 && this.qualityScale > 0.65) {
      this.qualityScale = Math.max(0.65, this.qualityScale - 0.1)
      this.renderer.setPixelRatio(boundedPixelRatio(this.manifestValue, this.qualityScale))
      this.qualityRecoveryFrames = 0
      this.frameSamples = []
    } else if (average < budget * 0.72 && this.qualityScale < 1) {
      this.qualityRecoveryFrames += 60
      if (this.qualityRecoveryFrames >= 300) {
        this.qualityScale = Math.min(1, this.qualityScale + 0.05)
        this.renderer.setPixelRatio(boundedPixelRatio(this.manifestValue, this.qualityScale))
        this.qualityRecoveryFrames = 0
        this.frameSamples = []
      }
    } else {
      this.qualityRecoveryFrames = 0
    }
  }

  private get averageFrameTime(): number {
    return this.frameSamples.length === 0
      ? 0
      : this.frameSamples.reduce((sum, sample) => sum + sample, 0) / this.frameSamples.length
  }

  private renderSingleFrame(snapCamera = false): void {
    if (this.disposed) return
    this.updateSceneObjects(0, snapCamera)
    this.renderer.render(this.scene, this.camera)
    this.dispatchEvent(new CustomEvent<RuntimeTelemetry>(RUNTIME_TELEMETRY_EVENT, { detail: this.inspect() }))
  }

  private resize(): void {
    const parent = this.canvas.parentElement
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth)
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.phase !== 'running') this.renderSingleFrame()
  }

  private requirePersistentStrategyProjection(): PersistentStrategyProjection {
    if (!this.persistentStrategyProjection) {
      this.persistentStrategyProjection = new PersistentStrategyProjection()
      this.camera.add(this.persistentStrategyProjection.group)
      this.scene.add(this.camera)
    }
    return this.persistentStrategyProjection
  }

  private disposeSceneResources(): void {
    this.animation.dispose()
    if (this.shipRoot) disposeObject3D(this.shipRoot)
    this.shipRoot = null
    this.world?.dispose()
    this.world = null
  }

  private setPhase(phase: RuntimePhase, message: string): void {
    this.phase = phase
    this.dispatchStatus(message)
  }

  private dispatchStatus(message: string): void {
    this.dispatchEvent(new CustomEvent<RuntimeStatusDetail>(RUNTIME_STATUS_EVENT, {
      detail: { phase: this.phase, message },
    }))
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('GameXR runtime has already been disposed.')
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault()
    cancelAnimationFrame(this.animationFrame)
    this.lastError = 'Graphics context was lost. Waiting for the browser to restore it.'
    this.setPhase('blocked', this.lastError)
  }

  private readonly handleContextRestored = (): void => {
    void this.rebuildScene(this.manifestValue)
      .then(() => this.setPhase('paused', 'Graphics context restored.'))
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : 'Graphics context restoration failed.'
        this.setPhase('blocked', this.lastError)
      })
  }
}
