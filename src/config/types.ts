import type { AppleSpatialInputProfile } from '@knowgrph/apple-spatial-input/profile'

export type Vector3Tuple = [number, number, number]
export type QuaternionTuple = [number, number, number, number]
export type EnvironmentId = 'deep-space' | 'orbit' | 'hangar'
export type ShipAssetKind = 'procedural' | 'local-glb'

export interface SceneManifest {
  $schema?: string
  schema: 'gamexr-scene/v1'
  id: string
  name: string
  scene: {
    environment: EnvironmentId
    backgroundColor: string
    fogColor: string
    fogDensity: number
    boundsRadius: number
    starCount: number
    asteroidCount: number
    asteroidFieldRadius: number
    planet: {
      enabled: boolean
      radius: number
      position: Vector3Tuple
      baseColor: string
      emissiveColor: string
      rotationSpeed: number
    }
    lighting: {
      ambientIntensity: number
      keyIntensity: number
      keyColor: string
      keyPosition: Vector3Tuple
    }
  }
  ship: {
    asset: {
      kind: ShipAssetKind
      localAssetId: string | null
    }
    position: Vector3Tuple
    rotation: Vector3Tuple
    scale: number
    appearance: {
      hullColor: string
      accentColor: string
      canopyColor: string
      exhaustColor: string
      metalness: number
      roughness: number
    }
    flight: {
      acceleration: number
      drag: number
      maxForwardSpeed: number
      pitchRate: number
      yawRate: number
      rollRate: number
      bankAngle: number
      lateralAssist: number
    }
  }
  camera: {
    fieldOfView: number
    near: number
    far: number
    chaseDistance: number
    chaseHeight: number
    lookAhead: number
    damping: number
  }
  motion: {
    keyboardEnabled: boolean
    touchEnabled: boolean
    deviceMotionEnabled: boolean
    deviceOrientation: AppleSpatialInputProfile
    invertPitch: boolean
    sensitivity: number
    deadZone: number
    hapticsEnabled: boolean
  }
  animation: {
    playing: boolean
    timeScale: number
    exhaustPulseSpeed: number
    exhaustPulseAmount: number
    wingFlexAmount: number
    asteroidDriftSpeed: number
    importedClip: string | null
    importedClipLoop: boolean
  }
  audio: {
    enabled: boolean
    masterGain: number
    engineBaseFrequency: number
    engineThrottleRange: number
  }
  performance: {
    targetFramesPerSecond: 30 | 60 | 90 | 120
    maxPixelRatio: number
    maxSimulationCatchUpSteps: number
    dynamicResolution: boolean
  }
}

export interface ControlState {
  throttle: number
  pitch: number
  yaw: number
  roll: number
  brake: number
}

export interface RuntimeTelemetry {
  phase: 'idle' | 'running' | 'paused' | 'blocked' | 'disposed'
  speed: number
  throttle: number
  altitude: number
  framesPerSecond: number
  frameTimeMilliseconds: number
  qualityScale: number
  position: Vector3Tuple
  rotation: Vector3Tuple
  camera: {
    mode: 'chase'
    position: Vector3Tuple
    quaternion: QuaternionTuple
    lookTarget: Vector3Tuple
    fieldOfViewDegrees: number
  }
  activeAsset: string
  activeAnimation: string | null
}

export interface ManifestValidationSuccess {
  ok: true
  value: SceneManifest
}

export interface ManifestValidationFailure {
  ok: false
  issues: string[]
}

export type ManifestValidationResult = ManifestValidationSuccess | ManifestValidationFailure
