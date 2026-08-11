import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GAME_OS_CONTROL_TOOL_ID,
  GAME_OS_INSPECT_TOOL_ID,
  GAME_OS_PERSISTENT_STRATEGY_MODE_IDENTITY,
  GAME_OS_WORLD_SCHEMA,
  GameOsError,
  GameOsModeRegistry,
  createGameOsCoreRuntime,
  createGameOsLocalWorldToolController,
  type GameOsModeDeclaration,
  type GameOsOperationResult,
  type GameOsWorldState,
} from 'grph-shared/game-os/index'
import {
  createGameXrPageHideCleanup,
  createPersistentStrategySurfaceExit,
  renderShell,
} from '../src/ui/shell.ts'
import {
  GAME_XR_WORLD_LEASE_TTL_MILLISECONDS,
  requirePersistentStrategyWorldId,
  shouldDetachPersistentStrategySession,
} from '../src/ui/PersistentStrategyController.ts'

class MemoryWorldDatabase {
  private readonly records = new Map<string, Record<string, unknown>>()
  private nextCompareAndPutFailure: Error | null = null
  private mutationAttempts = 0

  get size(): number { return this.records.size }
  get writeAttemptCount(): number { return this.mutationAttempts }

  failNextCompareAndPut(error: Error): void {
    this.nextCompareAndPutFailure = error
  }

  async get(worldId: string): Promise<Record<string, unknown> | null> {
    const value = this.records.get(worldId)
    return value ? structuredClone(value) : null
  }

  async getVersioned(worldId: string) {
    const value = this.records.get(worldId)
    return value ? { value: structuredClone(value), revision: String(value.revision) } : null
  }

  async compareAndPut(
    worldId: string,
    value: Record<string, unknown>,
    expectedRevision: string | null,
  ): Promise<boolean> {
    this.mutationAttempts += 1
    if (this.nextCompareAndPutFailure) {
      const error = this.nextCompareAndPutFailure
      this.nextCompareAndPutFailure = null
      throw error
    }
    const current = this.records.get(worldId)
    if ((current ? String(current.revision) : null) !== expectedRevision) return false
    this.records.set(worldId, structuredClone(value))
    return true
  }

  async compareAndDelete(worldId: string, expectedRevision: string): Promise<boolean> {
    this.mutationAttempts += 1
    if (String(this.records.get(worldId)?.revision) !== expectedRevision) return false
    this.records.delete(worldId)
    return true
  }
}

function modeDeclaration(): GameOsModeDeclaration {
  return {
    identity: GAME_OS_PERSISTENT_STRATEGY_MODE_IDENTITY,
    worldSchema: GAME_OS_WORLD_SCHEMA,
    persistence: { continuity: 'required', lease: 'single-writer' },
    surface: { overlayKind: 'gameplay' },
    adaptInput: (input) => ({ worldId: requirePersistentStrategyWorldId(input) }),
    createOverlay(input) {
      const worldId = requirePersistentStrategyWorldId(input)
      return { overlayId: `gamexr-test:${worldId}`, overlayKind: 'gameplay', state: { worldId } }
    },
    exit() {},
  }
}

test('persistent strategy world IDs are exact strings and are never coerced', () => {
  assert.equal(requirePersistentStrategyWorldId({ worldId: 'world-0' }), 'world-0')
  for (const input of [
    null,
    { worldId: 12 },
    { worldId: {} },
    { worldId: ' padded' },
    { worldId: 'trailing ' },
  ]) {
    assert.throws(
      () => requirePersistentStrategyWorldId(input),
      (error: unknown) => error instanceof GameOsError && error.code === 'input-invalid',
    )
  }
})

test('shell base paths are injectable in Node and canvas lookup stays exact', () => {
  const canvas = { id: 'game-canvas' } as unknown as HTMLCanvasElement
  const selectors: string[] = []
  const rootState = {
    innerHTML: '',
    querySelector(selector: string) {
      selectors.push(selector)
      return selector === '#game-canvas' ? canvas : null
    },
  }
  assert.equal(renderShell(rootState as unknown as HTMLElement, { basePath: '/gamexr/' }), canvas)
  assert.deepEqual(selectors, ['#game-canvas'])
  assert.match(rootState.innerHTML, /href="\/gamexr\/"/u)
  assert.match(rootState.innerHTML, /src="\/gamexr\/icons\/gamexr\.svg"/u)

  renderShell(rootState as unknown as HTMLElement)
  assert.match(rootState.innerHTML, /href="\/"/u)
  assert.match(rootState.innerHTML, /src="\/icons\/gamexr\.svg"/u)
})

test('pagehide cleanup ignores BFCache returns and queues one abrupt-return release', async () => {
  const events: string[] = []
  let finishStrategy = (): void => undefined
  const strategyCleanup = new Promise<void>((resolve) => { finishStrategy = resolve })
  const cleanup = createGameXrPageHideCleanup({
    disposeController: () => { events.push('controller') },
    disposeBridge: () => { events.push('bridge') },
    disposeStrategy: () => {
      events.push('strategy-started')
      return strategyCleanup
    },
    disposeRuntime: () => { events.push('runtime') },
    reportFailure: () => { events.push('failure') },
  })
  cleanup({ persisted: true })
  assert.deepEqual(events, [])
  cleanup({ persisted: false })
  cleanup({ persisted: false })
  assert.deepEqual(events, ['controller', 'bridge', 'strategy-started'])
  finishStrategy()
  await strategyCleanup
  await Promise.resolve()
  assert.deepEqual(events, ['controller', 'bridge', 'strategy-started', 'runtime'])
})

test('GameXR lease ownership expires below three minutes and cannot drift by tool input', async () => {
  assert(GAME_XR_WORLD_LEASE_TTL_MILLISECONDS > 0)
  assert(GAME_XR_WORLD_LEASE_TTL_MILLISECONDS < 3 * 60_000)
  const database = new MemoryWorldDatabase()
  const core = createGameOsCoreRuntime({ store: database, modeDeclaration: modeDeclaration() })
  const tools = createGameOsLocalWorldToolController(core, {
    clock: () => 1_000,
    sessionIdFactory: () => 'authority-test',
    leaseTtlMs: GAME_XR_WORLD_LEASE_TTL_MILLISECONDS,
  })
  try {
    for (const input of [
      { operation: 'resume', playerActionConfirmed: true, worldId: ' padded-world', seed: 'seed' },
      { operation: 'resume', playerActionConfirmed: true, worldId: 'world', seed: ' padded-seed' },
      {
        operation: 'resume', playerActionConfirmed: true, worldId: 'world', seed: 'seed',
        leaseTtlMs: 1,
      },
    ]) {
      await assert.rejects(
        () => tools.invoke(GAME_OS_CONTROL_TOOL_ID, input),
        (error: unknown) => error instanceof GameOsError && error.code === 'input-invalid',
      )
    }
    assert.equal(database.size, 0)
    assert.equal(database.writeAttemptCount, 0)
  } finally {
    await tools.dispose()
    await core.dispose()
  }
})

test('store-unavailable close preserves projection, renewal, and an exact retry', async () => {
  const database = new MemoryWorldDatabase()
  const projections: Array<Readonly<GameOsWorldState> | null> = []
  let clockNow = 1_000
  const core = createGameOsCoreRuntime({
    store: database,
    modeDeclaration: modeDeclaration(),
    onSessionState: state => { projections.push(state) },
  })
  const tools = createGameOsLocalWorldToolController(core, {
    clock: () => clockNow,
    sessionIdFactory: () => 'close-retry',
    leaseTtlMs: GAME_XR_WORLD_LEASE_TTL_MILLISECONDS,
  })
  try {
    await tools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'resume', playerActionConfirmed: true, worldId: 'retry-world', seed: 'retry-seed',
    })
    const unavailable = new GameOsError('store_unavailable', 'transient IndexedDB failure')
    database.failNextCompareAndPut(unavailable)
    await assert.rejects(
      () => tools.invoke(GAME_OS_CONTROL_TOOL_ID, {
        operation: 'close', playerActionConfirmed: true, worldId: 'retry-world',
      }),
      error => error === unavailable,
    )
    assert.equal(shouldDetachPersistentStrategySession(unavailable, 'retry-world'), false)
    assert.equal(projections.at(-1)?.worldId, 'retry-world')
    clockNow += 1_000
    await tools.renewActive()
    const closed = await tools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'close', playerActionConfirmed: true, worldId: 'retry-world',
    }) as GameOsOperationResult
    assert.equal(closed.status, 'closed')
    assert.equal(projections.at(-1), null)
  } finally {
    await tools.dispose()
    await core.dispose()
  }
})

test('surface displacement clears synchronously and catches queued cleanup failure', async () => {
  const events: string[] = []
  const cleanupFailures: unknown[] = []
  let stateAttached = true
  let rejectCleanup: (error: Error) => void = () => undefined
  const cleanup = new Promise<void>((_resolve, reject) => { rejectCleanup = reject })
  const registry = new GameOsModeRegistry()
  const exit = createPersistentStrategySurfaceExit({
    shouldDisposeController: () => stateAttached,
    clearProjection: () => { events.push('projection-cleared') },
    stopRenewal: () => { events.push('renewal-stopped') },
    clearControllerState: () => {
      stateAttached = false
      events.push('state-cleared')
    },
    disposeController: () => {
      events.push('cleanup-queued')
      return cleanup
    },
    reportCleanupFailure: error => { cleanupFailures.push(error) },
  })
  const declaration = (identity: string, onExit: () => void): GameOsModeDeclaration => ({
    identity,
    worldSchema: GAME_OS_WORLD_SCHEMA,
    persistence: { continuity: 'required', lease: 'single-writer' },
    surface: { overlayKind: 'gameplay' },
    adaptInput: input => ({ worldId: requirePersistentStrategyWorldId(input) }),
    createOverlay: input => ({
      overlayId: `${identity}:${requirePersistentStrategyWorldId(input)}`,
      overlayKind: 'gameplay',
    }),
    exit: onExit,
  })
  registry.registerMode(declaration('gamexr:test-incumbent', exit))
  registry.registerMode(declaration('gamexr:test-replacement', () => undefined))
  registry.activate('gamexr:test-incumbent', { worldId: 'world-0' })
  registry.activate('gamexr:test-replacement', { worldId: 'world-1' })

  assert.deepEqual(events, [
    'projection-cleared',
    'renewal-stopped',
    'state-cleared',
    'cleanup-queued',
  ])
  assert.equal(stateAttached, false)
  assert.equal(registry.liveOverlayCount, 1)
  assert.equal(registry.inspectSurface()?.identity, 'gamexr:test-replacement')

  const cleanupError = new Error('cleanup failed')
  rejectCleanup(cleanupError)
  await cleanup.catch(() => undefined)
  await Promise.resolve()
  assert.deepEqual(cleanupFailures, [cleanupError])
})

function firstMove(state: Readonly<GameOsWorldState>) {
  const unit = state.units[0]
  assert(unit)
  const territory = state.territories.find((candidate) => candidate.id === unit.territoryId)
  assert(territory)
  const targetTerritoryId = territory.neighborIds[0]
  assert(targetTerritoryId)
  return {
    type: 'move-unit' as const,
    sequence: state.lastOrderSequence + 1,
    factionId: unit.factionId,
    unitId: unit.id,
    targetTerritoryId,
  }
}

test('GameXR adapter reuses the shared local-world controller across an offline session boundary', async () => {
  const database = new MemoryWorldDatabase()
  const store = database
  const projected: Array<Readonly<GameOsWorldState> | null> = []
  const originalFetch = globalThis.fetch
  let clockNow = 1_000
  let outboundRequests = 0
  globalThis.fetch = async () => {
    outboundRequests += 1
    throw new Error('network-disabled')
  }
  const firstCore = createGameOsCoreRuntime({
    store,
    modeDeclaration: modeDeclaration(),
    onSessionState: (state) => { projected.push(state) },
  })
  const firstTools = createGameOsLocalWorldToolController(firstCore, {
    clock: () => clockNow,
    sessionIdFactory: () => 'tab-a',
    leaseTtlMs: 10_000,
  })
  let secondCore: ReturnType<typeof createGameOsCoreRuntime> | null = null
  let secondTools: ReturnType<typeof createGameOsLocalWorldToolController> | null = null
  try {
    assert.deepEqual(
      firstTools.declarations.map((declaration) => declaration.identity),
      [GAME_OS_INSPECT_TOOL_ID, GAME_OS_CONTROL_TOOL_ID],
    )
    const opened = await firstTools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'resume',
      playerActionConfirmed: true,
      worldId: 'gamexr-world',
      seed: 'offline-seed',
    }) as GameOsOperationResult
    assert.equal(opened.status, 'resumed')
    const initial = projected.at(-1)
    assert(initial)
    clockNow = 1_500
    await firstTools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'order',
      playerActionConfirmed: true,
      worldId: 'gamexr-world',
      orders: [firstMove(initial)],
    })
    clockNow = 2_000
    const committed = await firstTools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'commit',
      playerActionConfirmed: true,
      worldId: 'gamexr-world',
    }) as GameOsOperationResult
    assert.equal(committed.status, 'committed')
    assert.equal(committed.tick, 1)
    const committedState = projected.at(-1)
    assert(committedState)
    clockNow = 2_500
    await firstTools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      operation: 'close',
      playerActionConfirmed: true,
      worldId: 'gamexr-world',
    })
    assert.equal(projected.at(-1), null)
    await firstTools.dispose()
    await firstCore.dispose()

    secondCore = createGameOsCoreRuntime({ store, modeDeclaration: modeDeclaration() })
    secondTools = createGameOsLocalWorldToolController(secondCore, {
      clock: () => clockNow,
      sessionIdFactory: () => 'tab-b',
      leaseTtlMs: 10_000,
    })
    clockNow = 3_000
    const resumed = await secondTools.invoke(GAME_OS_CONTROL_TOOL_ID, {
      invocation: '/world @game-os #persistent-world operation=resume',
      playerActionConfirmed: true,
      worldId: 'gamexr-world',
      seed: 'offline-seed',
    }) as GameOsOperationResult
    assert.equal(resumed.tick, 1)
    assert.equal(resumed.digest, committed.digest)
    assert.equal(outboundRequests, 0)
  } finally {
    globalThis.fetch = originalFetch
    await firstTools.dispose()
    await firstCore.dispose()
    await secondTools?.dispose()
    await secondCore?.dispose()
  }
})

test('GameXR consumer preserves shared continuity compare-and-set conflicts', async () => {
  const store = new MemoryWorldDatabase()
  assert.equal(await store.compareAndPut('world', { worldId: 'world', revision: 'r1' }, null), true)
  assert.equal(await store.compareAndPut('world', { worldId: 'world', revision: 'r2' }, null), false)
  assert.equal((await store.get('world'))?.revision, 'r1')
})
