import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { GAME_OS_MAX_FACTION_COUNT } from 'grph-shared/game-os/index'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import type { ControlState, RuntimeTelemetry, SceneManifest } from '../src/config/types.ts'
import { createWebMcpTools, GAME_XR_WEB_MCP_TOOLS, type GameRuntimeControlSurface } from '../src/mcp/contracts.ts'
import {
  DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG,
  persistentStrategyFactionColor,
} from '../src/runtime/PersistentStrategyProjection.ts'
import { renderShell } from '../src/ui/shell.ts'

class RuntimeStub implements GameRuntimeControlSurface {
  manifest: SceneManifest = getDefaultSceneManifest()
  animationClips = ['barrel-roll']
  controls: ControlState = { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 }
  phase: RuntimeTelemetry['phase'] = 'idle'
  strategyVisuals = {
    layoutRadius: 4.2, verticalVariation: 0.18, territorySize: 0.58, unitScale: 1,
    factionColors: {} as Record<string, number>, neutralColor: 0x667085,
  }

  inspect(): RuntimeTelemetry {
    return {
      phase: this.phase,
      speed: 0,
      throttle: this.controls.throttle,
      altitude: 0,
      framesPerSecond: 60,
      frameTimeMilliseconds: 16.67,
      qualityScale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      camera: {
        mode: 'chase',
        position: [0, 4, 12],
        quaternion: [0, 0, 0, 1],
        lookTarget: [0, 0, -8],
        fieldOfViewDegrees: 58,
      },
      activeAsset: 'procedural',
      activeAnimation: null,
    }
  }
  async start() { this.phase = 'running' as const }
  pause() { this.phase = 'paused' }
  reset() { this.controls = { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 } }
  setThrottle(value: number) { this.controls.throttle = value }
  setBrake(value: number) { this.controls.brake = value }
  setTouchSteering(pitch: number, roll: number, yaw = roll) { Object.assign(this.controls, { pitch, roll, yaw }) }
  clearTouchSteering() { Object.assign(this.controls, { pitch: 0, roll: 0, yaw: 0 }) }
  playAnimations() { this.manifest.animation.playing = true }
  pauseAnimations() { this.manifest.animation.playing = false }
  scrubAnimation(_normalizedTime: number) {}
  async selectAnimationClip(name: string | null) { this.manifest.animation.importedClip = name }
  async setAnimationTimeScale(value: number) { this.manifest.animation.timeScale = value }
  configurePersistentStrategyVisuals(input: Partial<typeof this.strategyVisuals>) {
    this.strategyVisuals = { ...this.strategyVisuals, ...input }
    return this.strategyVisuals
  }
  async applyManifest(manifest: SceneManifest) { this.manifest = manifest }
}

type ControlSchemaBranch = {
  additionalProperties: boolean
  required: string[]
  properties: Record<string, { const?: string; properties?: Record<string, unknown> }>
}

function controlSchemaBranches(control: { inputSchema: Record<string, unknown> }): ControlSchemaBranch[] {
  return control.inputSchema.oneOf as ControlSchemaBranch[]
}

function controlSchemaBranch(
  control: { inputSchema: Record<string, unknown> },
  operation: string,
): ControlSchemaBranch {
  const branch = controlSchemaBranches(control)
    .find(candidate => candidate.properties.operation?.const === operation)
  assert(branch, `Missing control schema branch for ${operation}.`)
  return branch
}

test('WebMCP exposes exactly one inspection and one bounded control tool', () => {
  const tools = createWebMcpTools(new RuntimeStub())
  assert.deepEqual(tools.map((tool) => tool.name), [GAME_XR_WEB_MCP_TOOLS.inspect, GAME_XR_WEB_MCP_TOOLS.control])
  assert.equal(tools[0]?.annotations.readOnlyHint, true)
  assert.equal(tools[1]?.annotations.destructiveHint, true)
  assert.equal(tools[1]?.annotations.openWorldHint, false)
})

test('zero-mode shell omits persistent strategy UI before first paint', () => {
  let markup = ''
  const canvas = {} as HTMLCanvasElement
  const root = {
    set innerHTML(value: string) { markup = value },
    querySelector(selector: string) { return selector === '#game-canvas' ? canvas : null },
  } as unknown as HTMLElement
  assert.equal(renderShell(root, { persistentStrategyEnabled: false, basePath: '/test/' }), canvas)
  assert.match(markup, /href="\/test\/"|src="\/test\/icons\/gamexr\.svg"/u)
  assert.doesNotMatch(markup, /id="open-strategy"|id="strategy-panel"|id="strategy-world-id"/u)
  assert.match(markup, /data-persistent-strategy="false"/u)
})

test('flight and strategy share one declared scene-surface registry', async () => {
  const [mainSource, runtimeSource, strategySource] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/runtime/GameRuntime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/PersistentStrategyController.ts', import.meta.url), 'utf8'),
  ])
  assert.equal(mainSource.match(/new GameOsModeRegistry\(\)/gu)?.length, 1)
  assert.match(mainSource, /persistence:\s*\{ continuity: 'none', lease: 'none' \}/u)
  assert.match(mainSource, /PersistentStrategyController\.create\(runtime, modeRegistry\)/u)
  const startSource = runtimeSource.slice(runtimeSource.indexOf('async start()'), runtimeSource.indexOf('pause(): void'))
  const resetSource = runtimeSource.slice(runtimeSource.indexOf('reset(): void'), runtimeSource.indexOf('setThrottle'))
  assert(startSource.indexOf("this.phase === 'blocked'") < startSource.indexOf('this.claimFlightSurface()'))
  assert.match(resetSource, /this\.claimFlightSurface\(\)/u)
  assert.match(runtimeSource, /persistentStrategyProjection: PersistentStrategyProjection \| null = null/u)
  assert.doesNotMatch(runtimeSource, /readonly persistentStrategyProjection = new PersistentStrategyProjection/u)
  assert.match(runtimeSource,
    /if \(this\.persistentStrategyProjection\) \{\s*this\.camera\.add\([^)]+\.group\)\s*this\.scene\.add\(this\.camera\)\s*\}/u)
  assert.match(runtimeSource,
    /if \(!this\.persistentStrategyProjection\) \{[\s\S]*?this\.scene\.add\(this\.camera\)/u)
  assert.match(mainSource, /disposeRuntime: \(\) => \{[\s\S]*?return runtime\.dispose\(\)/u)
  assert.match(strategySource, /createGameOsCoreRuntime\(\{[\s\S]*?registry,/u)
})

test('inspection exposes the projected chase-camera pose without sensor samples', async () => {
  const inspect = createWebMcpTools(new RuntimeStub())[0]
  assert(inspect)
  const result = await inspect.execute({}) as {
    runtime: RuntimeTelemetry
  }
  assert.deepEqual(result.runtime.camera, {
    mode: 'chase',
    position: [0, 4, 12],
    quaternion: [0, 0, 0, 1],
    lookTarget: [0, 0, -8],
    fieldOfViewDegrees: 58,
  })
})

test('control tool applies local input with explicit zero-spend evidence', async () => {
  const runtime = new RuntimeStub()
  const control = createWebMcpTools(runtime)[1]
  assert(control)
  const result = await control.execute({ operation: 'set-controls', throttle: 0.75, pitch: -0.2, roll: 0.4, yaw: 0.1 }) as Record<string, unknown>
  assert.equal(result.status, 'applied')
  assert.equal(runtime.controls.throttle, 0.75)
  assert.deepEqual(result.cost, { modelCalls: 0, networkCalls: 0, paidCalls: 0, estimatedCostUsd: 0 })
})

test('control tool configures persistent strategy visuals without another scene owner', async () => {
  const runtime = new RuntimeStub()
  const control = createWebMcpTools(runtime, { persistentStrategyEnabled: true })[1]
  assert(control)
  const factionId = 'faction-0'
  const result = await control.execute({
    operation: 'strategy-visuals',
    strategyVisuals: { layoutRadius: 6, unitScale: 1.4, factionColors: { [factionId]: 0x11bbff } },
  }) as Record<string, unknown>
  assert.equal(result.status, 'applied')
  assert.equal(runtime.strategyVisuals.layoutRadius, 6)
  assert.equal(runtime.strategyVisuals.unitScale, 1.4)
  assert.equal(runtime.strategyVisuals.factionColors[factionId], 0x11bbff)
  const rejected = await control.execute({
    operation: 'strategy-visuals',
    strategyVisuals: { layoutRadius: 5, legacyRadius: 9 },
  }) as { status: string; detail?: string }
  assert.equal(rejected.status, 'blocked')
  assert.match(rejected.detail ?? '', /Unsupported strategy visual field/u)
})

test('strategy color contract deeply validates faction records and advertises the same JSON Schema', async () => {
  const runtime = new RuntimeStub()
  const control = createWebMcpTools(runtime, { persistentStrategyEnabled: true })[1]
  assert(control)
  const factionId = 'faction-0'
  const invalidFactionColors: unknown[] = [
    [],
    { '': 0x123456 },
    { ' padded': 0x123456 },
    { constructor: 0x123456 },
    JSON.parse('{"__proto__":1193046}'),
    { [factionId]: -1 },
    { [factionId]: 0x1000000 },
    { [factionId]: 1.5 },
    { [factionId]: '#123456' },
    Object.fromEntries(Array.from(
      { length: GAME_OS_MAX_FACTION_COUNT + 1 },
      (_, index) => [`faction-${index}`, index],
    )),
  ]
  for (const factionColors of invalidFactionColors) {
    const before = structuredClone(runtime.strategyVisuals)
    const result = await control.execute({
      operation: 'strategy-visuals',
      strategyVisuals: { factionColors },
    }) as { status: string; detail?: string }
    assert.equal(result.status, 'blocked', result.detail)
    assert.deepEqual(runtime.strategyVisuals, before)
  }
  const strategyBranch = controlSchemaBranch(control, 'strategy-visuals')
  const visualSchema = strategyBranch.properties.strategyVisuals as { properties: Record<string, unknown> }
  assert.deepEqual(visualSchema.properties.factionColors, {
    type: 'object',
    maxProperties: GAME_OS_MAX_FACTION_COUNT,
    propertyNames: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^(?!(?:__proto__|constructor|prototype)$)(?!.*[\\u0000-\\u001f\\u007f])\\S(?:.*\\S)?$',
    },
    additionalProperties: { type: 'integer', minimum: 0, maximum: 16777215 },
  })
})

test('strategy rendering derives a stable first-party fallback for arbitrary factions', () => {
  const first = persistentStrategyFactionColor('faction-0', DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG)
  const repeated = persistentStrategyFactionColor('faction-0', DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG)
  const second = persistentStrategyFactionColor('faction-1', DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG)
  assert.equal(first, repeated)
  assert.notEqual(first, second)
  assert(first >= 0 && first <= 0xffffff)
  assert.equal(persistentStrategyFactionColor(null, DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG), 0x667085)
})

test('zero-mode rollback removes the strategy visual capability and rejects its input', async () => {
  const runtime = new RuntimeStub()
  const control = createWebMcpTools(runtime)[1]
  assert(control)
  const branches = controlSchemaBranches(control)
  assert.equal(branches.some(branch => branch.properties.operation?.const === 'strategy-visuals'), false)
  assert.doesNotMatch(JSON.stringify(control.inputSchema), /strategyVisuals/u)
  const before = structuredClone(runtime.strategyVisuals)
  const result = await control.execute({
    operation: 'strategy-visuals',
    strategyVisuals: { layoutRadius: 6 },
  }) as { status: string; detail?: string }
  assert.equal(result.status, 'blocked')
  assert.equal(result.detail, 'Unsupported control field: strategyVisuals.')
  assert.deepEqual(runtime.strategyVisuals, before)
})

test('control JSON Schema exposes exact operation-specific branches matching runtime admission', async () => {
  const runtime = new RuntimeStub()
  const control = createWebMcpTools(runtime, { persistentStrategyEnabled: true })[1]
  assert(control)
  const branches = controlSchemaBranches(control)
  assert.equal(branches.every(branch => branch.additionalProperties === false), true)
  assert.deepEqual(controlSchemaBranch(control, 'pause').properties, { operation: { const: 'pause' } })
  assert.deepEqual(controlSchemaBranch(control, 'animation-scrub').required, ['operation', 'normalizedTime'])
  assert.deepEqual(controlSchemaBranch(control, 'strategy-visuals').required, ['operation', 'strategyVisuals'])
  for (const input of [
    { operation: 'pause', throttle: 1 },
    { operation: 'animation-scrub' },
    { operation: 'strategy-visuals' },
  ]) {
    const result = await control.execute(input) as { status: string }
    assert.equal(result.status, 'blocked')
  }
})

test('invalid manifest patch returns a typed block and preserves state', async () => {
  const runtime = new RuntimeStub()
  const before = structuredClone(runtime.manifest)
  const control = createWebMcpTools(runtime)[1]
  assert(control)
  const result = await control.execute({ operation: 'apply-manifest-patch', patch: { scene: { asteroidCount: 999 } } }) as Record<string, unknown>
  assert.equal(result.status, 'blocked')
  assert.deepEqual(runtime.manifest, before)
})
