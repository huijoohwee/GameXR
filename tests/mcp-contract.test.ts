import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import type { ControlState, RuntimeTelemetry, SceneManifest } from '../src/config/types.ts'
import { createWebMcpTools, GAME_XR_WEB_MCP_TOOLS, type GameRuntimeControlSurface } from '../src/mcp/contracts.ts'

class RuntimeStub implements GameRuntimeControlSurface {
  manifest: SceneManifest = getDefaultSceneManifest()
  animationClips = ['barrel-roll']
  controls: ControlState = { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 }
  phase: RuntimeTelemetry['phase'] = 'idle'

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
  async applyManifest(manifest: SceneManifest) { this.manifest = manifest }
}

test('WebMCP exposes exactly one inspection and one bounded control tool', () => {
  const tools = createWebMcpTools(new RuntimeStub())
  assert.deepEqual(tools.map((tool) => tool.name), [GAME_XR_WEB_MCP_TOOLS.inspect, GAME_XR_WEB_MCP_TOOLS.control])
  assert.equal(tools[0]?.annotations.readOnlyHint, true)
  assert.equal(tools[1]?.annotations.openWorldHint, false)
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

test('invalid manifest patch returns a typed block and preserves state', async () => {
  const runtime = new RuntimeStub()
  const before = structuredClone(runtime.manifest)
  const control = createWebMcpTools(runtime)[1]
  assert(control)
  const result = await control.execute({ operation: 'apply-manifest-patch', patch: { scene: { asteroidCount: 999 } } }) as Record<string, unknown>
  assert.equal(result.status, 'blocked')
  assert.deepEqual(runtime.manifest, before)
})
