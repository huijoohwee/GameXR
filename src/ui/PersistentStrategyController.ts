import {
  GAME_OS_CONTROL_TOOL_ID,
  GAME_OS_PERSISTENT_STRATEGY_MODE_IDENTITY,
  GAME_OS_WORLD_SCHEMA,
  GameOsError,
  createGameOsCoreRuntime,
  createGameOsLocalWorldToolController,
  openGameOsIndexedDbContinuityStore,
  type GameOsIndexedDbContinuityStore, type GameOsModeRegistry,
  type GameOsJsonValue,
  type GameOsOperationResult,
  type GameOsOrder,
  type GameOsWorldState,
} from 'grph-shared/game-os/index'
import type { WebMcpTool } from '../mcp/contracts.ts'
import type { GameRuntime } from '../runtime/GameRuntime.ts'
import {
  DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG,
  PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT,
  persistentStrategyFactionColor,
  type PersistentStrategyVisualConfig,
} from '../runtime/PersistentStrategyProjection.ts'
import { createPersistentStrategySurfaceExit } from './shell.ts'
export const GAME_XR_WORLD_LEASE_TTL_MILLISECONDS = 2 * 60_000
export function requirePersistentStrategyWorldId(input: unknown): string {
  if (!input || typeof input !== 'object') {
    throw new GameOsError('input-invalid', 'Persistent strategy activation requires a worldId.')
  }
  const worldId = (input as { worldId?: unknown }).worldId
  if (typeof worldId !== 'string' || !worldId || worldId.trim() !== worldId) {
    throw new GameOsError('input-invalid', 'Persistent strategy activation requires a normalized worldId.')
  }
  return worldId
}

type StrategyProjectionEvent = Readonly<{
  worldId: string
  digest: string
  tick: number
}>

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Required persistent-world element #${id} is missing.`)
  return value as T
}

function option(value: string, label = value): HTMLOptionElement {
  const node = document.createElement('option')
  node.value = value
  node.textContent = label
  return node
}

function unitOption(unit: Readonly<GameOsWorldState['units'][number]>): HTMLOptionElement {
  const node = option(unit.id, `${unit.id} · ${unit.territoryId}`)
  node.dataset.factionId = unit.factionId
  return node
}

function isQueuedEmbeddedToolConflict(error: GameOsError): boolean {
  return error.code === 'order-invalid'
    && error.details.pendingOrderSource === 'embedded-tool'
}

export function shouldDetachPersistentStrategySession(error: unknown, activeWorldId?: string): error is GameOsError {
  if (!(error instanceof GameOsError) || isQueuedEmbeddedToolConflict(error)) return false
  if (error.code === 'surface_unavailable') {
    return Object.hasOwn(error.details, 'reason') || Object.hasOwn(error.details, 'failures')
  }
  if (
    error.code === 'lease_lost'
    && activeWorldId
    && error.details.worldId !== undefined
    && error.details.worldId !== activeWorldId
  ) return false
  return ['digest_mismatch', 'lease_lost', 'record_malformed'].includes(error.code)
}

export class PersistentStrategyController {
  private readonly panel = element<HTMLElement>('strategy-panel')
  private readonly bootstrap = element<HTMLElement>('strategy-bootstrap')
  private readonly live = element<HTMLElement>('strategy-live')
  private readonly status = element<HTMLElement>('strategy-status')
  private readonly worldIdInput = element<HTMLInputElement>('strategy-world-id')
  private readonly seedInput = element<HTMLInputElement>('strategy-seed')
  private readonly unitSelect = element<HTMLSelectElement>('strategy-unit')
  private readonly targetSelect = element<HTMLSelectElement>('strategy-target')
  private readonly openButton = element<HTMLButtonElement>('strategy-open')
  private readonly moveButton = element<HTMLButtonElement>('strategy-move')
  private readonly claimButton = element<HTMLButtonElement>('strategy-claim')
  private readonly resetButton = element<HTMLButtonElement>('strategy-reset')
  private readonly closeButton = element<HTMLButtonElement>('strategy-close')
  private readonly layoutRadiusInput = element<HTMLInputElement>('strategy-layout-radius')
  private readonly heightVariationInput = element<HTMLInputElement>('strategy-height-variation')
  private readonly territorySizeInput = element<HTMLInputElement>('strategy-territory-size')
  private readonly unitScaleInput = element<HTMLInputElement>('strategy-unit-scale')
  private readonly factionColorsContainer = element<HTMLElement>('strategy-faction-colors')
  private readonly neutralColorInput = element<HTMLInputElement>('strategy-neutral-color')
  private readonly supplyLabel = element<HTMLElement>('strategy-supply-label')
  private readonly runtime: GameRuntime
  private readonly store: GameOsIndexedDbContinuityStore
  private readonly core
  private readonly toolsController
  private readonly exitSurface: () => void
  readonly tools: readonly WebMcpTool[]
  private currentState: Readonly<GameOsWorldState> | null = null
  private currentEvent: StrategyProjectionEvent | null = null
  private visualConfig = DEFAULT_PERSISTENT_STRATEGY_VISUAL_CONFIG
  private busy = false
  private disposed = false
  private renewalTimer = 0
  private projectionGapReason: string | null = null

  private constructor(
    runtime: GameRuntime,
    store: GameOsIndexedDbContinuityStore,
    registry: GameOsModeRegistry,
  ) {
    this.runtime = runtime
    this.store = store
    this.core = createGameOsCoreRuntime({
      store: this.store,
      registry,
      modeDeclaration: {
        identity: GAME_OS_PERSISTENT_STRATEGY_MODE_IDENTITY,
        worldSchema: GAME_OS_WORLD_SCHEMA,
        persistence: { continuity: 'required', lease: 'single-writer' },
        surface: { overlayKind: 'gameplay' },
        adaptInput(input) {
          return { worldId: requirePersistentStrategyWorldId(input) }
        },
        createOverlay(input) {
          const worldId = requirePersistentStrategyWorldId(input)
          return {
            overlayId: `gamexr:persistent-strategy:${worldId}`,
            overlayKind: 'gameplay',
            state: { worldId },
          }
        },
        exit: () => this.exitSurface(),
      },
      onSessionState: async (state, event) => {
        if (state && !this.ownsSurface(event)) return
        try {
          this.updateProjection(state, event)
          if (state) this.runtime.pause()
          this.runtime.projectPersistentStrategyWorld(state)
          this.projectionGapReason = null
        } catch (error) {
          this.projectionGapReason = error instanceof Error ? error.message : String(error as GameOsJsonValue)
          throw error
        }
      },
    })
    this.toolsController = createGameOsLocalWorldToolController(this.core, {
      leaseTtlMs: GAME_XR_WORLD_LEASE_TTL_MILLISECONDS,
    })
    this.exitSurface = createPersistentStrategySurfaceExit({
      shouldDisposeController: () => Boolean(this.currentState),
      clearProjection: () => this.runtime.projectPersistentStrategyWorld(null),
      stopRenewal: () => this.stopRenewal(),
      clearControllerState: () => this.clearControllerState(),
      disposeController: () => this.toolsController.dispose(),
      reportCleanupFailure: error => this.showError(new Error(
        `Displaced world cleanup reported: ${error instanceof Error ? error.message : String(error as GameOsJsonValue)}`,
      )),
    })
    this.tools = Object.freeze(this.toolsController.declarations.map((declaration) => ({
      name: declaration.identity,
      description: declaration.description,
      inputSchema: declaration.inputSchema as unknown as Record<string, unknown>,
      outputSchema: declaration.outputSchema as unknown as Record<string, unknown>,
      annotations: { ...declaration.annotations },
      execute: async (input: unknown) => {
        try {
          const result = await this.toolsController.invoke(
            declaration.identity,
            input as Record<string, unknown> | undefined,
          )
          this.reflectToolResult(result)
          return result
        } catch (error) {
          if (shouldDetachPersistentStrategySession(error, this.currentState?.worldId)) {
            await this.handleRenewalFailure(error)
          }
          throw error
        }
      },
    } satisfies WebMcpTool)))
  }

  static async create(runtime: GameRuntime, registry: GameOsModeRegistry): Promise<PersistentStrategyController> {
    const store = await openGameOsIndexedDbContinuityStore()
    try {
      return new PersistentStrategyController(runtime, store, registry)
    } catch (error) {
      store.close()
      throw error
    }
  }

  initialize(): void {
    element<HTMLButtonElement>('open-strategy').addEventListener('click', this.showPanel)
    element<HTMLButtonElement>('close-strategy-panel').addEventListener('click', this.hidePanel)
    this.openButton.addEventListener('click', () => void this.openWorld())
    this.moveButton.addEventListener('click', () => void this.moveUnit())
    this.claimButton.addEventListener('click', () => void this.claimTerritory())
    this.resetButton.addEventListener('click', () => void this.resetWorld())
    this.closeButton.addEventListener('click', () => void this.closeWorld())
    this.unitSelect.addEventListener('change', () => {
      this.renderTargets()
      this.renderSupply()
    })
    for (const input of [
      this.layoutRadiusInput,
      this.heightVariationInput,
      this.territorySizeInput,
      this.unitScaleInput,
      this.neutralColorInput,
    ]) input.addEventListener('change', this.applyVisualConfig)
    this.runtime.addEventListener(PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT, this.syncVisualControls)
    this.syncVisualControlValues(this.visualConfig)
    this.render(null, null)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.stopRenewal()
    this.runtime.removeEventListener(PERSISTENT_STRATEGY_VISUAL_CONFIG_EVENT, this.syncVisualControls)
    try {
      await this.toolsController.dispose()
    } finally {
      try {
        await this.core.dispose()
      } finally {
        this.store.close()
      }
    }
  }

  private readonly showPanel = (): void => {
    this.panel.hidden = false
    element<HTMLButtonElement>('open-strategy').setAttribute('aria-expanded', 'true')
  }

  private readonly hidePanel = (): void => {
    this.panel.hidden = true
    element<HTMLButtonElement>('open-strategy').setAttribute('aria-expanded', 'false')
  }

  private readonly applyVisualConfig = (): void => {
    this.configureVisuals(this.visualConfig.factionColors)
  }

  private applyFactionColor(factionId: string, input: HTMLInputElement): void {
    this.configureVisuals({
      ...this.visualConfig.factionColors,
      [factionId]: this.colorInput(input),
    })
  }

  private configureVisuals(factionColors: Readonly<Record<string, number>>): void {
    try {
      const config = this.runtime.configurePersistentStrategyVisuals({
        layoutRadius: Number(this.layoutRadiusInput.value),
        verticalVariation: Number(this.heightVariationInput.value),
        territorySize: Number(this.territorySizeInput.value),
        unitScale: Number(this.unitScaleInput.value),
        factionColors,
        neutralColor: this.colorInput(this.neutralColorInput),
      })
      this.status.textContent = `Strategy visuals updated locally at radius ${config.layoutRadius}.`
    } catch (error) {
      this.showError(error)
    }
  }

  private readonly syncVisualControls = (event: Event): void => {
    const config = (event as CustomEvent<PersistentStrategyVisualConfig>).detail
    this.syncVisualControlValues(config)
    this.renderFactionColorControls(this.currentState)
    this.renderTerritories(this.currentState)
  }

  private syncVisualControlValues(config: PersistentStrategyVisualConfig): void {
    this.visualConfig = config
    this.layoutRadiusInput.value = String(config.layoutRadius)
    this.heightVariationInput.value = String(config.verticalVariation)
    this.territorySizeInput.value = String(config.territorySize)
    this.unitScaleInput.value = String(config.unitScale)
    this.neutralColorInput.value = this.hexColor(config.neutralColor)
  }

  private hexColor(value: number): string {
    return `#${value.toString(16).padStart(6, '0')}`
  }

  private colorInput(input: HTMLInputElement): number {
    if (!/^#[0-9a-f]{6}$/iu.test(input.value)) throw new Error('Strategy color must use six hexadecimal digits.')
    return Number.parseInt(input.value.slice(1), 16)
  }

  private async openWorld(): Promise<void> {
    await this.runAction('Opening the device-local world…', async () => {
      const worldId = this.worldIdInput.value
      const seed = this.seedInput.value
      const result = await this.toolsController.invoke(GAME_OS_CONTROL_TOOL_ID, {
        operation: 'resume',
        playerActionConfirmed: true,
        worldId,
        seed,
      }) as GameOsOperationResult
      this.reflectToolResult(result)
      this.status.textContent = this.withProjectionGap(
        `World ${worldId} restored locally at tick ${result.tick ?? 0}.`,
      )
    })
  }

  private async moveUnit(): Promise<void> {
    const state = this.requireCurrentState()
    const unit = state.units.find((candidate) => candidate.id === this.unitSelect.value)
    if (!unit) return this.showError(new Error('Select a unit before moving.'))
    const order: GameOsOrder = {
      type: 'move-unit',
      sequence: state.lastOrderSequence + 1,
      factionId: unit.factionId,
      unitId: unit.id,
      targetTerritoryId: this.targetSelect.value,
    }
    await this.queueAndCommit(order)
  }

  private async claimTerritory(): Promise<void> {
    const state = this.requireCurrentState()
    const unit = state.units.find((candidate) => candidate.id === this.unitSelect.value)
    if (!unit) return this.showError(new Error('Select a unit before claiming.'))
    const order: GameOsOrder = {
      type: 'claim-territory',
      sequence: state.lastOrderSequence + 1,
      factionId: unit.factionId,
      unitId: unit.id,
      territoryId: unit.territoryId,
    }
    await this.queueAndCommit(order)
  }

  private async queueAndCommit(order: GameOsOrder): Promise<void> {
    await this.runAction('Committing the order to the local journal…', async () => {
      const worldId = this.requireCurrentState().worldId
      const committed = await this.toolsController.commitOrders(worldId, [order], Date.now())
      this.status.textContent = this.withProjectionGap(
        `Order committed locally at tick ${committed.tick}. No network or model call was made.`,
      )
    })
  }

  private async resetWorld(): Promise<void> {
    await this.runAction('Resetting through the atomic local envelope…', async () => {
      const worldId = this.currentState?.worldId ?? this.worldIdInput.value
      const hadActiveSession = this.currentState?.worldId === worldId
      const result = await this.toolsController.invoke(GAME_OS_CONTROL_TOOL_ID, {
        operation: 'reset',
        playerActionConfirmed: true,
        worldId,
        seed: this.seedInput.value,
      }) as GameOsOperationResult
      this.reflectToolResult(result)
      this.status.textContent = this.withProjectionGap(hadActiveSession
        ? `World ${worldId} reset explicitly at tick 0 and is ready to continue.`
        : `World ${worldId} reset explicitly at tick 0. Reopen to continue.`)
    })
  }

  private async closeWorld(): Promise<void> {
    const state = this.requireCurrentState()
    await this.runAction('Closing the local writer lease…', async () => {
      const result = await this.toolsController.invoke(GAME_OS_CONTROL_TOOL_ID, {
        operation: 'close',
        playerActionConfirmed: true,
        worldId: state.worldId,
      }) as GameOsOperationResult
      this.reflectToolResult(result)
      this.status.textContent = `World ${state.worldId} closed. Reopen to prove continuity.`
    })
  }

  private updateProjection(
    state: Readonly<GameOsWorldState> | null,
    event: StrategyProjectionEvent,
  ): void {
    this.currentState = state
    this.currentEvent = state ? event : null
    this.render(state, this.currentEvent)
  }

  private render(state: Readonly<GameOsWorldState> | null, event: StrategyProjectionEvent | null): void {
    this.bootstrap.hidden = Boolean(state)
    this.live.hidden = !state
    this.renderFactionColorControls(state)
    if (!state || !event) {
      this.setBusy(this.busy)
      return
    }
    element<HTMLElement>('strategy-tick').textContent = String(event.tick)
    element<HTMLElement>('strategy-digest').textContent = event.digest
    const selectedUnit = this.unitSelect.value
    this.unitSelect.replaceChildren(...state.units.map(unitOption))
    if (state.units.some((unit) => unit.id === selectedUnit)) this.unitSelect.value = selectedUnit
    this.renderTargets()
    this.renderSupply()
    this.renderTerritories(state)
    this.setBusy(this.busy)
  }

  private renderSupply(): void {
    const state = this.currentState
    const selectedUnit = state?.units.find(candidate => candidate.id === this.unitSelect.value)
    const selectedFaction = selectedUnit
      ? state?.factions.find(faction => faction.id === selectedUnit.factionId)
      : null
    const supply = selectedUnit
      ? selectedFaction?.supply ?? 0
      : state?.factions.reduce((total, faction) => total + faction.supply, 0) ?? 0
    this.supplyLabel.textContent = selectedUnit?.factionId ?? 'TOTAL'
    element<HTMLElement>('strategy-supply').textContent = String(supply)
  }

  private renderFactionColorControls(state: Readonly<GameOsWorldState> | null): void {
    if (!state) {
      this.factionColorsContainer.replaceChildren()
      return
    }
    const factionIds = new Set(state.factions.map(faction => faction.id))
    for (const unit of state.units) factionIds.add(unit.factionId)
    for (const territory of state.territories) {
      if (territory.ownerFactionId) factionIds.add(territory.ownerFactionId)
    }
    const controls = [...factionIds].sort((left, right) => left.localeCompare(right)).map((factionId) => {
      const label = document.createElement('label')
      const caption = document.createElement('span')
      caption.textContent = `${factionId} color`
      const input = document.createElement('input')
      input.type = 'color'
      input.dataset.factionId = factionId
      input.setAttribute('aria-label', `${factionId} faction color`)
      input.value = this.hexColor(persistentStrategyFactionColor(factionId, this.visualConfig))
      input.addEventListener('change', () => this.applyFactionColor(factionId, input))
      label.append(caption, input)
      return label
    })
    this.factionColorsContainer.replaceChildren(...controls)
  }

  private renderTerritories(state: Readonly<GameOsWorldState> | null): void {
    if (!state) {
      element<HTMLElement>('strategy-territories').replaceChildren()
      return
    }
    const cards = state.territories.map((territory) => {
      const card = document.createElement('div')
      card.className = 'strategy-territory'
      card.dataset.owner = territory.ownerFactionId ?? 'neutral'
      card.style.borderColor = this.hexColor(
        persistentStrategyFactionColor(territory.ownerFactionId, this.visualConfig),
      )
      const name = document.createElement('strong')
      name.textContent = territory.id
      const owner = document.createElement('small')
      owner.textContent = territory.ownerFactionId ?? 'neutral'
      card.append(name, owner)
      return card
    })
    element<HTMLElement>('strategy-territories').replaceChildren(...cards)
  }

  private renderTargets(): void {
    const state = this.currentState
    const selected = this.targetSelect.value
    const unit = state?.units.find((candidate) => candidate.id === this.unitSelect.value)
    const territory = state?.territories.find((candidate) => candidate.id === unit?.territoryId)
    const targets = territory?.neighborIds ?? []
    this.targetSelect.replaceChildren(...targets.map((target) => option(target)))
    if (targets.includes(selected)) this.targetSelect.value = selected
  }

  private reflectToolResult(result: unknown): void {
    if (!result || typeof result !== 'object') return
    const value = result as { status?: unknown; projectionGap?: unknown }
    if (value.status === 'opened' || value.status === 'resumed') this.startRenewal()
    if (value.status === 'closed') this.stopRenewal()
    if (value.projectionGap && typeof value.projectionGap === 'object') {
      const reason = (value.projectionGap as { reason?: unknown }).reason
      if (typeof reason === 'string') {
        this.projectionGapReason = reason
        this.status.textContent = this.withProjectionGap('World state is durable.')
      }
    } else if (Object.hasOwn(value, 'projectionGap')) {
      this.projectionGapReason = null
    }
  }

  private startRenewal(): void {
    this.stopRenewal()
    this.renewalTimer = window.setInterval(() => {
      void this.toolsController.renewActive(Date.now(), GAME_XR_WORLD_LEASE_TTL_MILLISECONDS)
        .catch((error: unknown) => this.handleRenewalFailure(error))
    }, GAME_XR_WORLD_LEASE_TTL_MILLISECONDS / 3)
  }

  private async handleRenewalFailure(error: unknown): Promise<void> {
    if (error instanceof GameOsError && error.code === 'store_unavailable') {
      return this.showError(new Error(`${error.message} The local writer session remains active; renewal will retry.`))
    }
    this.stopRenewal()
    let projectionCleanupFailure: unknown = null
    try {
      this.runtime.projectPersistentStrategyWorld(null)
    } catch (projectionError) {
      projectionCleanupFailure = projectionError
    }
    this.clearControllerState()
    let cleanupFailure: unknown = null
    try {
      await this.toolsController.dispose()
    } catch (cleanupError) {
      cleanupFailure = cleanupError
    }
    const reason = error instanceof Error ? error.message : String(error as GameOsJsonValue)
    const cleanup = cleanupFailure instanceof Error ? ` Cleanup also reported: ${cleanupFailure.message}` : ''
    const projection = projectionCleanupFailure instanceof Error
      ? ` Projection cleanup also reported: ${projectionCleanupFailure.message}`
      : ''
    this.showError(new Error(
      `${reason} The local writer session was closed; reopen before issuing another order.${cleanup}${projection}`,
    ))
  }

  private ownsSurface(event: StrategyProjectionEvent): boolean {
    const active = this.core.registry.inspectSurface()
    return active?.identity === GAME_OS_PERSISTENT_STRATEGY_MODE_IDENTITY
      && active.overlay.overlayId === `gamexr:persistent-strategy:${event.worldId}`
  }

  private clearControllerState(): void {
    this.currentState = null
    this.currentEvent = null
    this.projectionGapReason = null
    this.render(null, null)
  }

  private withProjectionGap(message: string): string {
    return this.projectionGapReason
      ? `${message} Visual projection gap: ${this.projectionGapReason}`
      : message
  }

  private stopRenewal(): void {
    window.clearInterval(this.renewalTimer)
    this.renewalTimer = 0
  }

  private requireCurrentState(): Readonly<GameOsWorldState> {
    if (!this.currentState) throw new GameOsError('lease_lost', 'No persistent strategy world is open.')
    return this.currentState
  }

  private async runAction(message: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.status.textContent = message
    this.setBusy(true)
    try {
      await action()
    } catch (error) {
      if (shouldDetachPersistentStrategySession(error, this.currentState?.worldId)) {
        await this.handleRenewalFailure(error)
      } else if (error instanceof GameOsError && error.code === 'store_unavailable' && this.currentState) {
        this.showError(new Error(`${error.message} The local writer session remains active; retry the action.`))
      } else {
        this.showError(error)
      }
    } finally {
      this.busy = false
      this.setBusy(false)
    }
  }

  private setBusy(busy: boolean): void {
    this.openButton.disabled = busy
    this.resetButton.disabled = busy
    for (const button of [this.moveButton, this.claimButton, this.closeButton]) {
      button.disabled = busy || !this.currentState
    }
  }

  private showError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error as GameOsJsonValue)
    this.status.textContent = `World action blocked: ${detail}`
  }
}
