import { applyManifestPatch } from '../config/manifest.ts'
import type { RuntimeTelemetry, SceneManifest } from '../config/types.ts'
import { GAME_OS_MAX_FACTION_COUNT } from 'grph-shared/game-os/index'
import {
  PERSISTENT_STRATEGY_FACTION_ID_MAX_LENGTH,
  PERSISTENT_STRATEGY_FACTION_ID_PATTERN,
  normalizePersistentStrategyFactionColors,
  persistentStrategyRgbColor,
  type PersistentStrategyVisualConfig,
} from '../runtime/PersistentStrategyProjection.ts'

export const GAME_XR_WEB_MCP_TOOLS = {
  inspect: 'gamexr.inspect_runtime',
  control: 'gamexr.control_runtime',
} as const

export interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  execute: (input: unknown) => Promise<unknown>
}

export interface GameRuntimeControlSurface {
  readonly manifest: SceneManifest
  readonly animationClips: string[]
  inspect: () => RuntimeTelemetry
  start: () => Promise<void>
  pause: () => void
  reset: () => void
  setThrottle: (value: number) => void
  setBrake: (value: number) => void
  setTouchSteering: (pitch: number, roll: number, yaw?: number) => void
  clearTouchSteering: () => void
  playAnimations: () => void
  pauseAnimations: () => void
  scrubAnimation: (normalizedTime: number) => void
  selectAnimationClip: (name: string | null) => Promise<void>
  setAnimationTimeScale: (value: number) => Promise<void>
  configurePersistentStrategyVisuals: (
    input: Partial<PersistentStrategyVisualConfig>,
  ) => PersistentStrategyVisualConfig
  applyManifest: (manifest: SceneManifest) => Promise<void>
}

interface ControlInput {
  operation: string
  throttle?: number
  brake?: number
  pitch?: number
  roll?: number
  yaw?: number
  normalizedTime?: number
  timeScale?: number
  clipName?: string | null
  patch?: unknown
  strategyVisuals?: Partial<PersistentStrategyVisualConfig>
}

type MutableStrategyVisualPatch = {
  -readonly [Key in keyof PersistentStrategyVisualConfig]?: PersistentStrategyVisualConfig[Key]
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function finiteNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a finite number from ${minimum} through ${maximum}.`)
  }
  return value
}

function parseStrategyVisuals(value: unknown): Partial<PersistentStrategyVisualConfig> {
  const input = record(value)
  if (!input) throw new Error('strategyVisuals must be an object.')
  const allowedKeys = new Set([
    'layoutRadius', 'verticalVariation', 'territorySize', 'unitScale', 'factionColors', 'neutralColor',
  ])
  const unknownKey = Object.keys(input).find(key => !allowedKeys.has(key))
  if (unknownKey) throw new Error(`Unsupported strategy visual field: ${unknownKey}.`)
  const visuals: MutableStrategyVisualPatch = {}
  if (Object.hasOwn(input, 'layoutRadius')) {
    visuals.layoutRadius = finiteNumber(input.layoutRadius, 'layoutRadius', 2, 10)
  }
  if (Object.hasOwn(input, 'verticalVariation')) {
    visuals.verticalVariation = finiteNumber(input.verticalVariation, 'verticalVariation', 0, 2)
  }
  if (Object.hasOwn(input, 'territorySize')) {
    visuals.territorySize = finiteNumber(input.territorySize, 'territorySize', 0.2, 1.5)
  }
  if (Object.hasOwn(input, 'unitScale')) {
    visuals.unitScale = finiteNumber(input.unitScale, 'unitScale', 0.4, 2.5)
  }
  if (Object.hasOwn(input, 'factionColors')) {
    visuals.factionColors = normalizePersistentStrategyFactionColors(input.factionColors)
  }
  if (Object.hasOwn(input, 'neutralColor')) {
    visuals.neutralColor = persistentStrategyRgbColor(input.neutralColor, 'neutralColor')
  }
  return visuals
}

function parseControlInput(value: unknown, persistentStrategyEnabled: boolean): ControlInput {
  const input = record(value)
  if (!input || typeof input.operation !== 'string') throw new Error('operation is required.')
  const allowedKeys = new Set([
    'operation', 'throttle', 'brake', 'pitch', 'roll', 'yaw', 'normalizedTime', 'timeScale', 'clipName', 'patch',
    ...(persistentStrategyEnabled ? ['strategyVisuals'] : []),
  ])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new Error(`Unsupported control field: ${key}.`)
  }
  const operationKeys: Readonly<Record<string, readonly string[]>> = {
    start: [], pause: [], reset: [], 'clear-controls': [], 'animation-play': [], 'animation-pause': [],
    'set-controls': ['throttle', 'brake', 'pitch', 'roll', 'yaw'],
    'animation-scrub': ['normalizedTime'],
    'animation-clip': ['clipName'],
    'animation-time-scale': ['timeScale'],
    'apply-manifest-patch': ['patch'],
    ...(persistentStrategyEnabled ? { 'strategy-visuals': ['strategyVisuals'] } : {}),
  }
  const admittedKeys = operationKeys[input.operation]
  const irrelevantKey = admittedKeys && Object.keys(input)
    .find(key => key !== 'operation' && !admittedKeys.includes(key))
  if (irrelevantKey) throw new Error(`${input.operation} does not accept ${irrelevantKey}.`)
  if (input.clipName !== undefined && input.clipName !== null && typeof input.clipName !== 'string') {
    throw new Error('clipName must be a string or null.')
  }
  if (input.strategyVisuals !== undefined) {
    if (input.operation !== 'strategy-visuals') {
      throw new Error('strategyVisuals is accepted only by the strategy-visuals operation.')
    }
  }
  if (input.operation === 'strategy-visuals' && input.strategyVisuals === undefined) {
    throw new Error('strategyVisuals is required by the strategy-visuals operation.')
  }
  return {
    ...input,
    ...(input.strategyVisuals === undefined ? {} : { strategyVisuals: parseStrategyVisuals(input.strategyVisuals) }),
  } as unknown as ControlInput
}

function runtimeEnvelope(runtime: GameRuntimeControlSurface, status: 'ok' | 'applied' | 'blocked', detail?: string) {
  return {
    schema: 'gamexr-runtime-result/v1',
    status,
    ...(detail ? { detail } : {}),
    runtime: runtime.inspect(),
    animationClips: runtime.animationClips,
    cost: {
      modelCalls: 0,
      networkCalls: 0,
      paidCalls: 0,
      estimatedCostUsd: 0,
    },
    authority: {
      owner: 'GameXR browser-local runtime',
      deploymentGranted: false,
      canonicalInvocationDiscovery: '/tool.catalog #tool-function @tool-function',
      canonicalInvocationExecution: '/tool.call #bridge-tool #tool-routing #approval-gate @bridge-tool @tool-function @tool-policy @cost-log',
    },
  }
}

async function executeControl(
  runtime: GameRuntimeControlSurface,
  rawInput: unknown,
  persistentStrategyEnabled: boolean,
): Promise<unknown> {
  try {
    const input = parseControlInput(rawInput, persistentStrategyEnabled)
    switch (input.operation) {
      case 'start':
        await runtime.start()
        break
      case 'pause':
        runtime.pause()
        break
      case 'reset':
        runtime.reset()
        break
      case 'set-controls': {
        const throttle = input.throttle === undefined ? runtime.inspect().throttle : finiteNumber(input.throttle, 'throttle', -1, 1)
        const brake = input.brake === undefined ? 0 : finiteNumber(input.brake, 'brake', 0, 1)
        const pitch = input.pitch === undefined ? 0 : finiteNumber(input.pitch, 'pitch', -1, 1)
        const roll = input.roll === undefined ? 0 : finiteNumber(input.roll, 'roll', -1, 1)
        const yaw = input.yaw === undefined ? 0 : finiteNumber(input.yaw, 'yaw', -1, 1)
        runtime.setThrottle(throttle)
        runtime.setBrake(brake)
        runtime.setTouchSteering(pitch, roll, yaw)
        break
      }
      case 'clear-controls':
        runtime.setThrottle(0)
        runtime.setBrake(0)
        runtime.clearTouchSteering()
        break
      case 'animation-play':
        runtime.playAnimations()
        break
      case 'animation-pause':
        runtime.pauseAnimations()
        break
      case 'animation-scrub':
        runtime.scrubAnimation(finiteNumber(input.normalizedTime, 'normalizedTime', 0, 1))
        break
      case 'animation-clip':
        await runtime.selectAnimationClip(input.clipName ?? null)
        break
      case 'animation-time-scale':
        await runtime.setAnimationTimeScale(finiteNumber(input.timeScale, 'timeScale', 0, 4))
        break
      case 'strategy-visuals': {
        runtime.configurePersistentStrategyVisuals(input.strategyVisuals ?? {})
        break
      }
      case 'apply-manifest-patch': {
        const validation = applyManifestPatch(runtime.manifest, input.patch)
        if (!validation.ok) throw new Error(validation.issues.join(' '))
        await runtime.applyManifest(validation.value)
        break
      }
      default:
        throw new Error(`Unsupported operation: ${input.operation}.`)
    }
    return runtimeEnvelope(runtime, 'applied')
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'GameXR control failed.'
    return runtimeEnvelope(runtime, 'blocked', detail)
  }
}

const outputSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['schema', 'status', 'runtime', 'cost', 'authority'],
  properties: {
    schema: { const: 'gamexr-runtime-result/v1' },
    status: { enum: ['ok', 'applied', 'blocked'] },
    detail: { type: 'string' },
    runtime: {
      type: 'object',
      additionalProperties: true,
      required: ['phase', 'position', 'rotation', 'camera'],
      properties: {
        camera: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'position', 'quaternion', 'lookTarget', 'fieldOfViewDegrees'],
          properties: {
            mode: { const: 'chase' },
            position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
            quaternion: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' } },
            lookTarget: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
            fieldOfViewDegrees: { type: 'number', minimum: 30, maximum: 100 },
          },
        },
      },
    },
    cost: { type: 'object' },
    authority: { type: 'object' },
  },
} as const

const exactOperationSchema = (
  operation: string,
  properties: Record<string, unknown> = {},
  required: readonly string[] = [],
) => ({
  type: 'object',
  additionalProperties: false,
  required: ['operation', ...required],
  properties: { operation: { const: operation }, ...properties },
})

const strategyVisualsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    layoutRadius: { type: 'number', minimum: 2, maximum: 10 },
    verticalVariation: { type: 'number', minimum: 0, maximum: 2 },
    territorySize: { type: 'number', minimum: 0.2, maximum: 1.5 },
    unitScale: { type: 'number', minimum: 0.4, maximum: 2.5 },
    factionColors: {
      type: 'object',
      maxProperties: GAME_OS_MAX_FACTION_COUNT,
      propertyNames: {
        type: 'string',
        minLength: 1,
        maxLength: PERSISTENT_STRATEGY_FACTION_ID_MAX_LENGTH,
        pattern: PERSISTENT_STRATEGY_FACTION_ID_PATTERN,
      },
      additionalProperties: { type: 'integer', minimum: 0, maximum: 16777215 },
    },
    neutralColor: { type: 'integer', minimum: 0, maximum: 16777215 },
  },
} as const

function controlInputSchema(persistentStrategyEnabled: boolean): Record<string, unknown> {
  const branches = [
    exactOperationSchema('start'),
    exactOperationSchema('pause'),
    exactOperationSchema('reset'),
    exactOperationSchema('set-controls', {
      throttle: { type: 'number', minimum: -1, maximum: 1 },
      brake: { type: 'number', minimum: 0, maximum: 1 },
      pitch: { type: 'number', minimum: -1, maximum: 1 },
      roll: { type: 'number', minimum: -1, maximum: 1 },
      yaw: { type: 'number', minimum: -1, maximum: 1 },
    }),
    exactOperationSchema('clear-controls'),
    exactOperationSchema('animation-play'),
    exactOperationSchema('animation-pause'),
    exactOperationSchema('animation-scrub', {
      normalizedTime: { type: 'number', minimum: 0, maximum: 1 },
    }, ['normalizedTime']),
    exactOperationSchema('animation-clip', { clipName: { type: ['string', 'null'] } }),
    exactOperationSchema('animation-time-scale', {
      timeScale: { type: 'number', minimum: 0, maximum: 4 },
    }, ['timeScale']),
    exactOperationSchema('apply-manifest-patch', { patch: { type: 'object' } }, ['patch']),
  ]
  if (persistentStrategyEnabled) {
    branches.push(exactOperationSchema(
      'strategy-visuals',
      { strategyVisuals: strategyVisualsSchema },
      ['strategyVisuals'],
    ))
  }
  return { type: 'object', oneOf: branches }
}

export function createWebMcpTools(
  runtime: GameRuntimeControlSurface,
  options: { persistentStrategyEnabled?: boolean } = {},
): WebMcpTool[] {
  const persistentStrategyEnabled = options.persistentStrategyEnabled === true
  return [
    {
      name: GAME_XR_WEB_MCP_TOOLS.inspect,
      description: 'Inspect the active browser-local GameXR scene, controls, animation, performance, and cost state.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async () => ({ ...runtimeEnvelope(runtime, 'ok'), manifest: runtime.manifest }),
    },
    {
      name: GAME_XR_WEB_MCP_TOOLS.control,
      description: 'Apply a bounded local GameXR transport, input, animation, or validated manifest-patch operation.',
      inputSchema: controlInputSchema(persistentStrategyEnabled),
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      execute: (input) => executeControl(runtime, input, persistentStrategyEnabled),
    },
  ]
}
