import { applyManifestPatch } from '../config/manifest.ts'
import type { RuntimeTelemetry, SceneManifest } from '../config/types.ts'

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

function parseControlInput(value: unknown): ControlInput {
  const input = record(value)
  if (!input || typeof input.operation !== 'string') throw new Error('operation is required.')
  const allowedKeys = new Set([
    'operation', 'throttle', 'brake', 'pitch', 'roll', 'yaw', 'normalizedTime', 'timeScale', 'clipName', 'patch',
  ])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new Error(`Unsupported control field: ${key}.`)
  }
  if (input.clipName !== undefined && input.clipName !== null && typeof input.clipName !== 'string') {
    throw new Error('clipName must be a string or null.')
  }
  return input as unknown as ControlInput
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

async function executeControl(runtime: GameRuntimeControlSurface, rawInput: unknown): Promise<unknown> {
  try {
    const input = parseControlInput(rawInput)
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
    runtime: { type: 'object' },
    cost: { type: 'object' },
    authority: { type: 'object' },
  },
} as const

export function createWebMcpTools(runtime: GameRuntimeControlSurface): WebMcpTool[] {
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
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: {
            enum: [
              'start', 'pause', 'reset', 'set-controls', 'clear-controls', 'animation-play',
              'animation-pause', 'animation-scrub', 'animation-clip', 'animation-time-scale', 'apply-manifest-patch',
            ],
          },
          throttle: { type: 'number', minimum: -1, maximum: 1 },
          brake: { type: 'number', minimum: 0, maximum: 1 },
          pitch: { type: 'number', minimum: -1, maximum: 1 },
          roll: { type: 'number', minimum: -1, maximum: 1 },
          yaw: { type: 'number', minimum: -1, maximum: 1 },
          normalizedTime: { type: 'number', minimum: 0, maximum: 1 },
          timeScale: { type: 'number', minimum: 0, maximum: 4 },
          clipName: { type: ['string', 'null'] },
          patch: { type: 'object' },
        },
      },
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: (input) => executeControl(runtime, input),
    },
  ]
}
