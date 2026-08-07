import defaultManifestJson from '../../shared/default-scene.json' with { type: 'json' }
import {
  APPLE_SPATIAL_INPUT_PROFILE_LIMITS,
  APPLE_SPATIAL_INPUT_SCHEMA,
} from '@knowgrph/apple-spatial-input/profile'
import type {
  EnvironmentId,
  ManifestValidationResult,
  SceneManifest,
  ShipAssetKind,
  Vector3Tuple,
} from './types.ts'

type JsonRecord = Record<string, unknown>

const IDENTIFIER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const COLOR = /^#[0-9a-f]{6}$/i
const FORBIDDEN_PATCH_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function readObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: string[],
): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${path} must be an object.`)
    return {}
  }

  const record = value as JsonRecord
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not supported.`)
  }
  return record
}

function readString(
  value: unknown,
  path: string,
  issues: string[],
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {},
): string {
  const { minLength = 1, maxLength = 200, pattern } = options
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    issues.push(`${path} must be a string between ${minLength} and ${maxLength} characters.`)
    return ''
  }
  if (pattern && !pattern.test(value)) issues.push(`${path} has an invalid format.`)
  return value
}

function readColor(value: unknown, path: string, issues: string[]): string {
  return readString(value, path, issues, { minLength: 7, maxLength: 7, pattern: COLOR })
}

function readNumber(
  value: unknown,
  path: string,
  issues: string[],
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    issues.push(`${path} must be a finite number from ${minimum} through ${maximum}.`)
    return minimum
  }
  return value
}

function readInteger(
  value: unknown,
  path: string,
  issues: string[],
  minimum: number,
  maximum: number,
): number {
  const parsed = readNumber(value, path, issues, minimum, maximum)
  if (!Number.isInteger(value)) issues.push(`${path} must be an integer.`)
  return parsed
}

function readBoolean(value: unknown, path: string, issues: string[]): boolean {
  if (typeof value !== 'boolean') {
    issues.push(`${path} must be a boolean.`)
    return false
  }
  return value
}

function readEnum<T extends string>(
  value: unknown,
  path: string,
  issues: string[],
  values: readonly T[],
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    issues.push(`${path} must be one of: ${values.join(', ')}.`)
    return values[0] as T
  }
  return value as T
}

function readVector3(value: unknown, path: string, issues: string[]): Vector3Tuple {
  if (!Array.isArray(value) || value.length !== 3) {
    issues.push(`${path} must contain exactly three numbers.`)
    return [0, 0, 0]
  }
  return [
    readNumber(value[0], `${path}[0]`, issues, -1000, 1000),
    readNumber(value[1], `${path}[1]`, issues, -1000, 1000),
    readNumber(value[2], `${path}[2]`, issues, -1000, 1000),
  ]
}

function readNullableString(value: unknown, path: string, issues: string[]): string | null {
  return value === null ? null : readString(value, path, issues, { maxLength: 100 })
}

function readFramesPerSecond(value: unknown, path: string, issues: string[]): 30 | 60 | 90 | 120 {
  if (value === 30 || value === 60 || value === 90 || value === 120) return value
  issues.push(`${path} must be 30, 60, 90, or 120.`)
  return 60
}

export function validateSceneManifest(input: unknown): ManifestValidationResult {
  const issues: string[] = []
  const root = readObject(
    input,
    'manifest',
    ['$schema', 'schema', 'id', 'name', 'scene', 'ship', 'camera', 'motion', 'animation', 'audio', 'performance'],
    issues,
  )
  if (root.schema !== 'gamexr-scene/v1') issues.push('manifest.schema must equal gamexr-scene/v1.')
  if (root.$schema !== undefined && typeof root.$schema !== 'string') {
    issues.push('manifest.$schema must be a string when present.')
  }

  const scene = readObject(root.scene, 'manifest.scene', [
    'environment', 'backgroundColor', 'fogColor', 'fogDensity', 'boundsRadius', 'starCount',
    'asteroidCount', 'asteroidFieldRadius', 'planet', 'lighting',
  ], issues)
  const planet = readObject(scene.planet, 'manifest.scene.planet', [
    'enabled', 'radius', 'position', 'baseColor', 'emissiveColor', 'rotationSpeed',
  ], issues)
  const lighting = readObject(scene.lighting, 'manifest.scene.lighting', [
    'ambientIntensity', 'keyIntensity', 'keyColor', 'keyPosition',
  ], issues)
  const ship = readObject(root.ship, 'manifest.ship', [
    'asset', 'position', 'rotation', 'scale', 'appearance', 'flight',
  ], issues)
  const asset = readObject(ship.asset, 'manifest.ship.asset', ['kind', 'localAssetId'], issues)
  const appearance = readObject(ship.appearance, 'manifest.ship.appearance', [
    'hullColor', 'accentColor', 'canopyColor', 'exhaustColor', 'metalness', 'roughness',
  ], issues)
  const flight = readObject(ship.flight, 'manifest.ship.flight', [
    'acceleration', 'drag', 'maxForwardSpeed', 'pitchRate',
    'yawRate', 'rollRate', 'bankAngle', 'lateralAssist',
  ], issues)
  const camera = readObject(root.camera, 'manifest.camera', [
    'fieldOfView', 'near', 'far', 'chaseDistance', 'chaseHeight', 'lookAhead', 'damping',
  ], issues)
  const motion = readObject(root.motion, 'manifest.motion', [
    'keyboardEnabled', 'touchEnabled', 'deviceMotionEnabled', 'deviceOrientation', 'invertPitch',
    'sensitivity', 'deadZone', 'hapticsEnabled',
  ], issues)
  const deviceOrientation = readObject(motion.deviceOrientation, 'manifest.motion.deviceOrientation', [
    'schema', 'controlRangeDegrees', 'jitterThresholdDegrees', 'settledAxisThreshold',
    'smoothingRatePerSecond', 'calibrationTimeoutMilliseconds',
  ], issues)
  const animation = readObject(root.animation, 'manifest.animation', [
    'playing', 'timeScale', 'exhaustPulseSpeed', 'exhaustPulseAmount', 'wingFlexAmount',
    'asteroidDriftSpeed', 'importedClip', 'importedClipLoop',
  ], issues)
  const audio = readObject(root.audio, 'manifest.audio', [
    'enabled', 'masterGain', 'engineBaseFrequency', 'engineThrottleRange',
  ], issues)
  const performance = readObject(root.performance, 'manifest.performance', [
    'targetFramesPerSecond', 'maxPixelRatio', 'maxSimulationCatchUpSteps', 'dynamicResolution',
  ], issues)

  const assetKind = readEnum<ShipAssetKind>(asset.kind, 'manifest.ship.asset.kind', issues, ['procedural', 'local-glb'])
  const localAssetId = asset.localAssetId === null
    ? null
    : readString(asset.localAssetId, 'manifest.ship.asset.localAssetId', issues, { maxLength: 64, pattern: IDENTIFIER })
  if (assetKind === 'procedural' && localAssetId !== null) {
    issues.push('manifest.ship.asset.localAssetId must be null for a procedural ship.')
  }
  if (assetKind === 'local-glb' && localAssetId === null) {
    issues.push('manifest.ship.asset.localAssetId is required for a local-glb ship.')
  }

  const near = readNumber(camera.near, 'manifest.camera.near', issues, 0.01, 10)
  const far = readNumber(camera.far, 'manifest.camera.far', issues, 50, 5000)
  if (far <= near) issues.push('manifest.camera.far must be greater than manifest.camera.near.')

  const manifest: SceneManifest = {
    ...(typeof root.$schema === 'string' ? { $schema: root.$schema } : {}),
    schema: 'gamexr-scene/v1',
    id: readString(root.id, 'manifest.id', issues, { maxLength: 64, pattern: IDENTIFIER }),
    name: readString(root.name, 'manifest.name', issues, { maxLength: 80 }),
    scene: {
      environment: readEnum<EnvironmentId>(scene.environment, 'manifest.scene.environment', issues, ['deep-space', 'orbit', 'hangar']),
      backgroundColor: readColor(scene.backgroundColor, 'manifest.scene.backgroundColor', issues),
      fogColor: readColor(scene.fogColor, 'manifest.scene.fogColor', issues),
      fogDensity: readNumber(scene.fogDensity, 'manifest.scene.fogDensity', issues, 0, 0.03),
      boundsRadius: readNumber(scene.boundsRadius, 'manifest.scene.boundsRadius', issues, 20, 1000),
      starCount: readInteger(scene.starCount, 'manifest.scene.starCount', issues, 0, 4000),
      asteroidCount: readInteger(scene.asteroidCount, 'manifest.scene.asteroidCount', issues, 0, 128),
      asteroidFieldRadius: readNumber(scene.asteroidFieldRadius, 'manifest.scene.asteroidFieldRadius', issues, 10, 400),
      planet: {
        enabled: readBoolean(planet.enabled, 'manifest.scene.planet.enabled', issues),
        radius: readNumber(planet.radius, 'manifest.scene.planet.radius', issues, 0.5, 100),
        position: readVector3(planet.position, 'manifest.scene.planet.position', issues),
        baseColor: readColor(planet.baseColor, 'manifest.scene.planet.baseColor', issues),
        emissiveColor: readColor(planet.emissiveColor, 'manifest.scene.planet.emissiveColor', issues),
        rotationSpeed: readNumber(planet.rotationSpeed, 'manifest.scene.planet.rotationSpeed', issues, -2, 2),
      },
      lighting: {
        ambientIntensity: readNumber(lighting.ambientIntensity, 'manifest.scene.lighting.ambientIntensity', issues, 0, 10),
        keyIntensity: readNumber(lighting.keyIntensity, 'manifest.scene.lighting.keyIntensity', issues, 0, 20),
        keyColor: readColor(lighting.keyColor, 'manifest.scene.lighting.keyColor', issues),
        keyPosition: readVector3(lighting.keyPosition, 'manifest.scene.lighting.keyPosition', issues),
      },
    },
    ship: {
      asset: { kind: assetKind, localAssetId },
      position: readVector3(ship.position, 'manifest.ship.position', issues),
      rotation: readVector3(ship.rotation, 'manifest.ship.rotation', issues),
      scale: readNumber(ship.scale, 'manifest.ship.scale', issues, 0.01, 20),
      appearance: {
        hullColor: readColor(appearance.hullColor, 'manifest.ship.appearance.hullColor', issues),
        accentColor: readColor(appearance.accentColor, 'manifest.ship.appearance.accentColor', issues),
        canopyColor: readColor(appearance.canopyColor, 'manifest.ship.appearance.canopyColor', issues),
        exhaustColor: readColor(appearance.exhaustColor, 'manifest.ship.appearance.exhaustColor', issues),
        metalness: readNumber(appearance.metalness, 'manifest.ship.appearance.metalness', issues, 0, 1),
        roughness: readNumber(appearance.roughness, 'manifest.ship.appearance.roughness', issues, 0, 1),
      },
      flight: {
        acceleration: readNumber(flight.acceleration, 'manifest.ship.flight.acceleration', issues, 0, 200),
        drag: readNumber(flight.drag, 'manifest.ship.flight.drag', issues, 0, 20),
        maxForwardSpeed: readNumber(flight.maxForwardSpeed, 'manifest.ship.flight.maxForwardSpeed', issues, 1, 500),
        pitchRate: readNumber(flight.pitchRate, 'manifest.ship.flight.pitchRate', issues, 0, 10),
        yawRate: readNumber(flight.yawRate, 'manifest.ship.flight.yawRate', issues, 0, 10),
        rollRate: readNumber(flight.rollRate, 'manifest.ship.flight.rollRate', issues, 0, 10),
        bankAngle: readNumber(flight.bankAngle, 'manifest.ship.flight.bankAngle', issues, 0, 1.57),
        lateralAssist: readNumber(flight.lateralAssist, 'manifest.ship.flight.lateralAssist', issues, 0, 30),
      },
    },
    camera: {
      fieldOfView: readNumber(camera.fieldOfView, 'manifest.camera.fieldOfView', issues, 30, 100),
      near,
      far,
      chaseDistance: readNumber(camera.chaseDistance, 'manifest.camera.chaseDistance', issues, 2, 80),
      chaseHeight: readNumber(camera.chaseHeight, 'manifest.camera.chaseHeight', issues, -20, 40),
      lookAhead: readNumber(camera.lookAhead, 'manifest.camera.lookAhead', issues, 0, 100),
      damping: readNumber(camera.damping, 'manifest.camera.damping', issues, 0.1, 30),
    },
    motion: {
      keyboardEnabled: readBoolean(motion.keyboardEnabled, 'manifest.motion.keyboardEnabled', issues),
      touchEnabled: readBoolean(motion.touchEnabled, 'manifest.motion.touchEnabled', issues),
      deviceMotionEnabled: readBoolean(motion.deviceMotionEnabled, 'manifest.motion.deviceMotionEnabled', issues),
      deviceOrientation: {
        schema: readEnum(
          deviceOrientation.schema,
          'manifest.motion.deviceOrientation.schema',
          issues,
          [APPLE_SPATIAL_INPUT_SCHEMA],
        ),
        controlRangeDegrees: readNumber(
          deviceOrientation.controlRangeDegrees,
          'manifest.motion.deviceOrientation.controlRangeDegrees',
          issues,
          ...APPLE_SPATIAL_INPUT_PROFILE_LIMITS.controlRangeDegrees,
        ),
        jitterThresholdDegrees: readNumber(
          deviceOrientation.jitterThresholdDegrees,
          'manifest.motion.deviceOrientation.jitterThresholdDegrees',
          issues,
          ...APPLE_SPATIAL_INPUT_PROFILE_LIMITS.jitterThresholdDegrees,
        ),
        settledAxisThreshold: readNumber(
          deviceOrientation.settledAxisThreshold,
          'manifest.motion.deviceOrientation.settledAxisThreshold',
          issues,
          ...APPLE_SPATIAL_INPUT_PROFILE_LIMITS.settledAxisThreshold,
        ),
        smoothingRatePerSecond: readNumber(
          deviceOrientation.smoothingRatePerSecond,
          'manifest.motion.deviceOrientation.smoothingRatePerSecond',
          issues,
          ...APPLE_SPATIAL_INPUT_PROFILE_LIMITS.smoothingRatePerSecond,
        ),
        calibrationTimeoutMilliseconds: readNumber(
          deviceOrientation.calibrationTimeoutMilliseconds,
          'manifest.motion.deviceOrientation.calibrationTimeoutMilliseconds',
          issues,
          ...APPLE_SPATIAL_INPUT_PROFILE_LIMITS.calibrationTimeoutMilliseconds,
        ),
      },
      invertPitch: readBoolean(motion.invertPitch, 'manifest.motion.invertPitch', issues),
      sensitivity: readNumber(motion.sensitivity, 'manifest.motion.sensitivity', issues, 0.1, 4),
      deadZone: readNumber(motion.deadZone, 'manifest.motion.deadZone', issues, 0, 0.5),
      hapticsEnabled: readBoolean(motion.hapticsEnabled, 'manifest.motion.hapticsEnabled', issues),
    },
    animation: {
      playing: readBoolean(animation.playing, 'manifest.animation.playing', issues),
      timeScale: readNumber(animation.timeScale, 'manifest.animation.timeScale', issues, 0, 4),
      exhaustPulseSpeed: readNumber(animation.exhaustPulseSpeed, 'manifest.animation.exhaustPulseSpeed', issues, 0, 30),
      exhaustPulseAmount: readNumber(animation.exhaustPulseAmount, 'manifest.animation.exhaustPulseAmount', issues, 0, 1),
      wingFlexAmount: readNumber(animation.wingFlexAmount, 'manifest.animation.wingFlexAmount', issues, 0, 0.5),
      asteroidDriftSpeed: readNumber(animation.asteroidDriftSpeed, 'manifest.animation.asteroidDriftSpeed', issues, -3, 3),
      importedClip: readNullableString(animation.importedClip, 'manifest.animation.importedClip', issues),
      importedClipLoop: readBoolean(animation.importedClipLoop, 'manifest.animation.importedClipLoop', issues),
    },
    audio: {
      enabled: readBoolean(audio.enabled, 'manifest.audio.enabled', issues),
      masterGain: readNumber(audio.masterGain, 'manifest.audio.masterGain', issues, 0, 1),
      engineBaseFrequency: readNumber(audio.engineBaseFrequency, 'manifest.audio.engineBaseFrequency', issues, 20, 300),
      engineThrottleRange: readNumber(audio.engineThrottleRange, 'manifest.audio.engineThrottleRange', issues, 0, 1000),
    },
    performance: {
      targetFramesPerSecond: readFramesPerSecond(performance.targetFramesPerSecond, 'manifest.performance.targetFramesPerSecond', issues),
      maxPixelRatio: readNumber(performance.maxPixelRatio, 'manifest.performance.maxPixelRatio', issues, 0.75, 2),
      maxSimulationCatchUpSteps: readInteger(performance.maxSimulationCatchUpSteps, 'manifest.performance.maxSimulationCatchUpSteps', issues, 1, 5),
      dynamicResolution: readBoolean(performance.dynamicResolution, 'manifest.performance.dynamicResolution', issues),
    },
  }

  return issues.length === 0 ? { ok: true, value: manifest } : { ok: false, issues }
}

const defaultValidation = validateSceneManifest(defaultManifestJson)
if (!defaultValidation.ok) {
  throw new Error(`Bundled GameXR manifest is invalid: ${defaultValidation.issues.join(' ')}`)
}
const bundledDefaultManifest = defaultValidation.value

export function getDefaultSceneManifest(): SceneManifest {
  return structuredClone(bundledDefaultManifest)
}

export function parseSceneManifest(source: string): ManifestValidationResult {
  try {
    return validateSceneManifest(JSON.parse(source) as unknown)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse failure.'
    return { ok: false, issues: [`Manifest is not valid JSON: ${message}`] }
  }
}

export function serializeSceneManifest(manifest: SceneManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function mergeJson(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch)
  const patchRecord = patch as JsonRecord
  const baseRecord = base && typeof base === 'object' && !Array.isArray(base) ? base as JsonRecord : {}
  const output: JsonRecord = structuredClone(baseRecord)

  for (const [key, value] of Object.entries(patchRecord)) {
    if (FORBIDDEN_PATCH_KEYS.has(key)) throw new Error(`Patch key ${key} is forbidden.`)
    output[key] = mergeJson(baseRecord[key], value)
  }
  return output
}

export function applyManifestPatch(manifest: SceneManifest, patch: unknown): ManifestValidationResult {
  try {
    return validateSceneManifest(mergeJson(manifest, patch))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown patch failure.'
    return { ok: false, issues: [message] }
  }
}
